import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelTemplates from '@salesforce/apex/ChannelTemplateController.getChannelTemplates';
import saveTemplate from '@salesforce/apex/ChannelTemplateController.saveTemplate';
import validateTemplate from '@salesforce/apex/ChannelTemplateController.validateTemplate';
import classifyUploadedFiles from '@salesforce/apex/ChannelTemplateController.classifyUploadedFiles';
import saveComponentCatalog from '@salesforce/apex/ChannelTemplateController.saveComponentCatalog';
import getContentBlockPlaceholders from '@salesforce/apex/ChannelTemplateController.getContentBlockPlaceholders';
import deleteTemplateAsset from '@salesforce/apex/ChannelTemplateController.deleteTemplateAsset';
import deleteTemplate from '@salesforce/apex/ChannelTemplateController.deleteTemplate';

const COMPONENT_TYPES = [
    { value: 'RichText', label: 'Rich Text', icon: 'utility:display_rich_text', description: 'Formatted body copy with links and lists.', group: 'Content' },
    { value: 'Image', label: 'Image', icon: 'utility:image', description: 'Visual block with image URL and alt text.', group: 'Content' },
    { value: 'TextImage', label: 'Text-Image', icon: 'utility:layout_card', description: 'Two-column layout: rich text plus image.', group: 'Content' },
    { value: 'Banner', label: 'Banner', icon: 'utility:layout_banner', description: 'Promotional banner with copy and an image.', group: 'Content' },
    { value: 'Prefooter', label: 'Prefooter', icon: 'utility:note', description: 'Product and legal copy shown before the footer.', group: 'Content' },
    { value: 'Spacer', label: 'Spacer', icon: 'utility:spacer', description: 'Vertical space between components.', group: 'Layout' }
];

const CONTENT_SOURCES = [
    { value: '', label: 'Not bound' },
    { value: 'copy', label: 'Copy' },
    { value: 'imageUrl', label: 'Image URL' },
    { value: 'altText', label: 'Alt text' },
    { value: 'legal', label: 'Legal copy' }
];

const ICON_PATTERN = /^(utility|doctype|standard|custom|action):[A-Za-z0-9_]+$/;
const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

const BLOCK_SETTINGS = [
    { id: 'viewDesktop', label: 'View on desktop', hint: 'Hide writes desktopHide. Show writes nothing.' },
    { id: 'viewMobile', label: 'View on mobile', hint: 'Hide writes mobileHide. Show writes nothing.' },
    { id: 'padding', label: 'Padding', hint: 'Writes top, right, bottom, and left, for example 20px 40px 20px 40px.' },
    { id: 'background', label: 'Block background', hint: 'Writes the color, gradient, or image URL the author enters.' },
    { id: 'columnLayout', label: 'Column layout', hint: 'Left to right writes ltr. Right to left writes rtl.' },
    { id: 'heightDesktop', label: 'Block height on desktop', hint: 'Writes a pixel height, for example 240px.' },
    { id: 'heightMobile', label: 'Block height on mobile', hint: 'Writes a pixel height, for example 180px.' }
];

const CONTENT_SOURCE_IDS = new Set(['copy', 'imageUrl', 'altText', 'legal']);

function componentTypeToken(label, fileName) {
    const source = (String(label || '').trim() || fileName || 'Block').replace(/\.html$/i, '');
    let token = source.replace(/[^A-Za-z0-9_]+/g, '');
    if (!/^[A-Za-z]/.test(token)) token = `Block${token}`;
    if (!token) token = 'Block';
    return token.substring(0, 80);
}

function bindingMap(bindings) {
    const map = {};
    (bindings || []).forEach(binding => {
        const name = String(binding?.placeholder || '').replace(/[{}]/g, '').trim();
        if (name) map[name] = binding.source || '';
    });
    return map;
}

const EMPTY_TEMPLATE = () => ({
    Id: null,
    Name: '',
    Status__c: 'Draft',
    Version__c: 1,
    Description__c: ''
});

export default class ChannelTemplateManager extends LightningElement {
    @api channelId;
    @api channelName;

    @track editTemplate = EMPTY_TEMPLATE();
    @track catalogRows = [];
    @track expandedFile = '';
    @track placeholdersLoading = false;
    @track isModalOpen = false;
    @track isSaving = false;
    @track pendingDelete = null;

    acceptedHtml = ['.html'];
    acceptedCss = ['.css'];
    acceptedJs = ['.js'];
    contentPlaceholder = '{{CONTENT}}';

    _wiredTemplates;

    @wire(getChannelTemplates, { channelId: '$channelId' })
    wiredTemplates(result) {
        this._wiredTemplates = result;
    }

    get isLoading() {
        return !this._wiredTemplates?.data && !this._wiredTemplates?.error;
    }

    get errorMessage() {
        return this._wiredTemplates?.error?.body?.message || '';
    }

    get templates() {
        return (this._wiredTemplates?.data || []).map(template => ({
            ...template,
            statusClass: template.status === 'Active'
                ? 'slds-badge template-status template-status_active'
                : template.status === 'Archived'
                    ? 'slds-badge template-status template-status_archived'
                    : 'slds-badge template-status',
            validationClass: template.validationStatus === 'Valid'
                ? 'slds-badge template-validation template-validation_valid'
                : template.validationStatus === 'Invalid'
                    ? 'slds-badge template-validation template-validation_invalid'
                    : 'slds-badge template-validation',
            validationLabel: template.validationStatus || 'Not Validated',
            versionLabel: `v${template.version || 1}`,
            packageLabel: template.packageId && template.semVer
                ? `${template.packageId} · ${template.semVer}`
                : '',
            hashLabel: template.packageHash
                ? `SHA-256 ${template.packageHash.substring(0, 12)}…`
                : '',
            canModify: template.status !== 'Active',
            deleteDisabled: template.status === 'Active',
            hasAssets: (template.assets || []).length > 0,
            assets: (template.assets || []).map(asset => ({
                ...asset,
                deleteDisabled: template.status === 'Active',
                iconName: asset.assetType === 'MANIFEST'
                    ? 'doctype:attachment'
                    : asset.assetType === 'SHELL_CSS'
                    ? 'doctype:css'
                    : asset.assetType === 'SHELL_JS'
                        ? 'doctype:javascript'
                        : 'doctype:html',
                sizeLabel: this._formatBytes(asset.contentSize)
            }))
        }));
    }

    get hasTemplates() {
        return this.templates.length > 0;
    }

    get modalTitle() {
        return this.editTemplate.Id ? `Edit ${this.editTemplate.Name}` : `New ${this.channelName} Template`;
    }

    get hasSavedTemplate() {
        return !!this.editTemplate.Id;
    }

    get editingTemplate() {
        return this.templates.find(template => template.id === this.editTemplate.Id);
    }

    get editingAssets() {
        return this.editingTemplate?.assets || [];
    }

    get manifestAssets() {
        return this._assetsOfType('MANIFEST');
    }

    get shellHtmlAssets() {
        return this._assetsOfType('SHELL_HTML');
    }

    get shellCssAssets() {
        return this._assetsOfType('SHELL_CSS');
    }

    get shellJsAssets() {
        return this._assetsOfType('SHELL_JS');
    }

    get contentBlockAssets() {
        return this._assetsOfType('CONTENT_BLOCK');
    }

    get unclassifiedAssets() {
        return this._assetsOfType('UNCLASSIFIED');
    }

    get hasCatalogRows() {
        return this.catalogRows.length > 0;
    }

    get catalogView() {
        const editingLocked = this.isEditingActive;
        return this.catalogRows.map(row => {
            const settings = Array.isArray(row.blockSettings) ? row.blockSettings : [];
            const placeholders = row.placeholders;
            const bindings = row.bindings || {};
            const names = placeholders || [];
            const status = row.status || 'Draft';
            const contentActive = (row.activeTab || 'content') === 'content';
            const contentBindingRows = names
                .filter(name => !bindings[name] || CONTENT_SOURCE_IDS.has(bindings[name]))
                .map(name => ({
                    key: `${row.fileName}:${name}:content`,
                    fileName: row.fileName,
                    name,
                    token: `{{${name}}}`,
                    source: bindings[name] || '',
                    sourceOptions: CONTENT_SOURCES
                }));
            return {
                ...row,
                status,
                statusLabel: status,
                statusIcon: status === 'Active' ? 'utility:success' : status === 'Ready' ? 'utility:check' : 'utility:warning',
                statusIconVariant: status === 'Draft' ? 'warning' : 'success',
                expanded: this.expandedFile === row.fileName,
                cardClass: 'slds-card component-card',
                placeholdersLoading: placeholders == null,
                hasPlaceholders: Array.isArray(placeholders) && placeholders.length > 0,
                noPlaceholders: Array.isArray(placeholders) && placeholders.length === 0,
                contentBindingRows,
                hasContentBindings: contentBindingRows.length > 0,
                contentTabClass: 'slds-tabs_default__item' + (contentActive ? ' slds-is-active' : ''),
                settingsTabClass: 'slds-tabs_default__item' + (contentActive ? '' : ' slds-is-active'),
                contentTabSelected: contentActive,
                settingsTabSelected: !contentActive,
                contentPanelStyle: contentActive ? '' : 'display:none',
                settingsPanelStyle: contentActive ? 'display:none' : '',
                activateDisabled: status !== 'Ready' || editingLocked || this.isSaving,
                settingChoices: BLOCK_SETTINGS.map(setting => {
                    const checked = settings.includes(setting.id);
                    const placeholderChoices = names
                        .filter(name => !bindings[name] || bindings[name] === setting.id)
                        .map(name => ({
                            key: `${row.fileName}:${setting.id}:${name}`,
                            fileName: row.fileName,
                            setting: setting.id,
                            name,
                            token: `{{${name}}}`,
                            checked: bindings[name] === setting.id,
                            disabled: !checked || editingLocked
                        }));
                    return {
                        ...setting,
                        key: `${row.fileName}:${setting.id}`,
                        fileName: row.fileName,
                        checked,
                        choiceClass: 'block-setting-choice' + (checked ? ' block-setting-choice_active' : ''),
                        placeholderChoices,
                        hasPlaceholderChoices: placeholderChoices.length > 0,
                        bindingEmpty: Array.isArray(placeholders) && placeholders.length > 0 && placeholderChoices.length === 0
                    };
                })
            };
        });
    }

    get catalogSaveDisabled() {
        return this.isEditingActive || this.isSaving || this.placeholdersLoading;
    }

    get isEditingActive() {
        return this.editTemplate.Status__c === 'Active';
    }

    get validateDisabled() {
        return this.isSaving || this.isEditingActive;
    }

    get saveLabel() {
        return this.editTemplate.Id ? 'Save Details' : 'Create Template';
    }

    get statusOptions() {
        return [
            { label: 'Draft', value: 'Draft' },
            { label: 'Active', value: 'Active' },
            { label: 'Archived', value: 'Archived' }
        ];
    }

    handleNew() {
        this.editTemplate = EMPTY_TEMPLATE();
        this.catalogRows = [];
        this.expandedFile = '';
        this.isModalOpen = true;
    }

    handleEdit(event) {
        const id = event.currentTarget.dataset.id;
        const source = (this._wiredTemplates?.data || []).find(template => template.id === id);
        if (!source) return;
        this.editTemplate = {
            Id: source.id,
            Name: source.name,
            Status__c: source.status || 'Draft',
            Version__c: source.version || 1,
            Description__c: source.description || ''
        };
        this.catalogRows = [];
        this.expandedFile = '';
        this.isModalOpen = true;
        this._syncCatalogRows();
    }

    handleFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        let value = event.detail?.value ?? event.target?.value;
        if (field === 'Version__c') value = Number(value);
        this.editTemplate = { ...this.editTemplate, [field]: value };
    }

    async handleSave() {
        if (!(this.editTemplate.Name || '').trim()) {
            this._toast('Validation', 'Template Name is required.', 'warning');
            return;
        }
        this.isSaving = true;
        try {
            const id = await saveTemplate({
                record: this.editTemplate,
                channelId: this.channelId
            });
            this.editTemplate = { ...this.editTemplate, Id: id };
            await refreshApex(this._wiredTemplates);
            this._toast(
                'Template saved',
                'Template details saved. You can now attach shell and content block files.',
                'success'
            );
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleShellHtmlUpload(event) {
        this._registerUploads(event, 'SHELL_HTML');
    }

    handleShellCssUpload(event) {
        this._registerUploads(event, 'SHELL_CSS');
    }

    handleShellJsUpload(event) {
        this._registerUploads(event, 'SHELL_JS');
    }

    handleContentBlockUpload(event) {
        this._registerUploads(event, 'CONTENT_BLOCK');
    }

    async _registerUploads(event, assetType) {
        const documentIds = (event.detail.files || []).map(file => file.documentId);
        if (!documentIds.length) return;
        try {
            const classificationError = await classifyUploadedFiles({
                templateId: this.editTemplate.Id,
                documentIds,
                assetType
            });
            if (classificationError) throw new Error(classificationError);
            await refreshApex(this._wiredTemplates);
            if (assetType === 'CONTENT_BLOCK') this._syncCatalogRows();
            this._toast('Files attached', `${documentIds.length} template file(s) attached.`, 'success');
        } catch (error) {
            this._toast('Upload classification failed', error.body?.message || error.message, 'error');
        }
    }

    async handleDeleteAsset(event) {
        event.stopPropagation();
        try {
            await deleteTemplateAsset({
                templateId: event.currentTarget.dataset.templateId,
                documentId: event.currentTarget.dataset.id
            });
            await refreshApex(this._wiredTemplates);
            this._syncCatalogRows();
            this._toast('File removed', 'Template file removed.', 'success');
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
        }
    }

    handleCatalogChange(event) {
        const fileName = event.currentTarget.dataset.file;
        const field = event.currentTarget.dataset.field;
        const value = event.detail?.value ?? event.target?.value ?? '';
        this.catalogRows = this.catalogRows.map(row => {
            if (row.fileName !== fileName) return row;
            const nextValue = field === 'icon' ? String(value).trim() : value;
            return this._touchCard({ ...row, [field]: nextValue });
        });
    }

    handleBindingChange(event) {
        const fileName = event.currentTarget.dataset.file;
        const placeholder = event.currentTarget.dataset.placeholder;
        const source = event.detail?.value ?? '';
        if (source && !CONTENT_SOURCE_IDS.has(source)) return;
        this.catalogRows = this.catalogRows.map(row => {
            if (row.fileName !== fileName) return row;
            const bindings = { ...(row.bindings || {}) };
            const current = bindings[placeholder] || '';
            if (current && !CONTENT_SOURCE_IDS.has(current)) return row;
            bindings[placeholder] = source;
            return this._touchCard({ ...row, bindings, legacy: false });
        });
    }

    handleToggleCard(event) {
        const fileName = event.currentTarget.dataset.file;
        this.expandedFile = this.expandedFile === fileName ? '' : fileName;
    }

    handleCardTab(event) {
        event.stopPropagation();
        const fileName = event.currentTarget.dataset.file;
        const tab = event.currentTarget.dataset.tab;
        this.catalogRows = this.catalogRows.map(row => (
            row.fileName === fileName ? { ...row, activeTab: tab } : row
        ));
    }

    handleSettingChange(event) {
        const fileName = event.currentTarget.dataset.file;
        const setting = event.currentTarget.dataset.setting;
        const checked = event.detail?.checked ?? event.target.checked;
        this.catalogRows = this.catalogRows.map(row => {
            if (row.fileName !== fileName) return row;
            const current = new Set(Array.isArray(row.blockSettings) ? row.blockSettings : []);
            const bindings = { ...(row.bindings || {}) };
            if (checked) current.add(setting);
            else {
                current.delete(setting);
                Object.keys(bindings).forEach(name => {
                    if (bindings[name] === setting) bindings[name] = '';
                });
            }
            return this._touchCard({
                ...row,
                bindings,
                blockSettings: BLOCK_SETTINGS.map(item => item.id).filter(id => current.has(id)),
                legacy: false
            });
        });
    }

    handleSettingBindingChange(event) {
        const fileName = event.currentTarget.dataset.file;
        const setting = event.currentTarget.dataset.setting;
        const placeholder = event.currentTarget.dataset.placeholder;
        const checked = event.detail?.checked ?? event.target.checked;
        this.catalogRows = this.catalogRows.map(row => {
            if (row.fileName !== fileName) return row;
            const bindings = { ...(row.bindings || {}) };
            const current = bindings[placeholder] || '';
            let blockSettings = Array.isArray(row.blockSettings) ? [...row.blockSettings] : [];
            if (checked) {
                if (current && current !== setting) return row;
                bindings[placeholder] = setting;
                if (!blockSettings.includes(setting)) blockSettings = [...blockSettings, setting];
            } else if (current === setting) {
                bindings[placeholder] = '';
            }
            return this._touchCard({ ...row, bindings, blockSettings, legacy: false });
        });
    }

    async handleSaveCard(event) {
        event.stopPropagation();
        const fileName = event.currentTarget.dataset.file;
        const row = this.catalogRows.find(item => item.fileName === fileName);
        if (!row) return;
        const errors = this._cardErrors(row);
        if (errors.length) {
            this.catalogRows = this.catalogRows.map(item => (
                item.fileName === fileName
                    ? { ...item, status: 'Draft', validationMessage: errors.join(' ') }
                    : item
            ));
            try {
                await this._persistCatalog();
            } catch (error) {
                this._toast('Error', error.body?.message || error.message, 'error');
            }
            return;
        }
        const nextStatus = row.status === 'Active' ? 'Active' : 'Ready';
        const type = this._componentTypeFor(row);
        this.catalogRows = this.catalogRows.map(item => (
            item.fileName === fileName
                ? { ...item, type, status: nextStatus, validationMessage: '', icon: (item.icon || '').trim() }
                : item
        ));
        try {
            await this._persistCatalog();
            this._toast(
                nextStatus === 'Active' ? 'Block saved' : 'Block ready',
                nextStatus === 'Active'
                    ? `${row.label} stays available in Copy Center.`
                    : `${row.label} is ready to activate.`,
                'success'
            );
        } catch (error) {
            this.catalogRows = this.catalogRows.map(item => (
                item.fileName === fileName ? { ...item, status: 'Draft', validationMessage: error.body?.message || error.message } : item
            ));
            this._toast('Error', error.body?.message || error.message, 'error');
        }
    }

    async handleActivateCard(event) {
        event.stopPropagation();
        const fileName = event.currentTarget.dataset.file;
        const row = this.catalogRows.find(item => item.fileName === fileName);
        if (!row || row.status !== 'Ready') return;
        const previous = this.catalogRows.map(item => ({ ...item, bindings: { ...(item.bindings || {}) } }));
        this.catalogRows = this.catalogRows.map(item => (
            item.fileName === fileName ? { ...item, status: 'Active', validationMessage: '' } : item
        ));
        try {
            await this._persistCatalog();
            this._toast('Block activated', `${row.label || fileName} is available in Copy Center.`, 'success');
        } catch (error) {
            this.catalogRows = previous;
            this._toast('Error', error.body?.message || error.message, 'error');
        }
    }

    _touchCard(row) {
        if (row.status !== 'Ready' && row.status !== 'Active') return row;
        return { ...row, status: 'Draft', validationMessage: '' };
    }

    _componentTypeFor(row) {
        const existing = String(row.type || '').trim();
        if (TYPE_PATTERN.test(existing)) return existing;
        let token = componentTypeToken(row.label, row.fileName);
        const used = new Set(
            this.catalogRows
                .filter(item => item.fileName !== row.fileName && TYPE_PATTERN.test(item.type || ''))
                .map(item => item.type.toLowerCase())
        );
        if (!used.has(token.toLowerCase())) return token;
        let suffix = 2;
        while (used.has(`${token}${suffix}`.toLowerCase()) && suffix < 100) suffix += 1;
        return `${token}${suffix}`.substring(0, 80);
    }

    _cardErrors(row) {
        const errors = [];
        if (!(row.label || '').trim()) errors.push('Content Block Name is required.');
        if (!(row.description || '').trim()) errors.push('Description is required.');
        if (!ICON_PATTERN.test((row.icon || '').trim())) {
            errors.push('Enter an SLDS icon name such as utility:display_rich_text.');
        }
        if (row.placeholders == null) errors.push('Placeholders are still loading.');
        const bindings = row.bindings || {};
        (row.placeholders || []).filter(name => !bindings[name]).forEach(name => {
            errors.push(`Bind {{${name}}}.`);
        });
        const names = row.placeholders || [];
        if (names.length) {
            (Array.isArray(row.blockSettings) ? row.blockSettings : []).forEach(setting => {
                if (names.some(name => bindings[name] === setting)) return;
                const label = BLOCK_SETTINGS.find(item => item.id === setting)?.label || setting;
                errors.push(`Bind a placeholder to ${label}.`);
            });
        }
        return errors;
    }

    _catalogPayload() {
        return this.catalogRows.map(row => ({
            type: row.type || '',
            fileName: row.fileName,
            label: row.label || '',
            description: row.description || '',
            icon: row.icon || '',
            status: row.status || 'Draft',
            placeholders: row.placeholders || [],
            blockSettings: Array.isArray(row.blockSettings) ? row.blockSettings : [],
            bindings: Object.entries(row.bindings || {})
                .filter(([, source]) => source)
                .map(([placeholder, source]) => ({ placeholder, source }))
        }));
    }

    async _persistCatalog() {
        if (!this.editTemplate.Id) return;
        this.isSaving = true;
        try {
            await saveComponentCatalog({
                templateId: this.editTemplate.Id,
                componentsJson: JSON.stringify(this._catalogPayload())
            });
            await refreshApex(this._wiredTemplates);
            this.catalogRows = this.catalogRows.map(row => ({ ...row, persisted: true }));
        } finally {
            this.isSaving = false;
        }
    }

    async handleValidate() {
        if (!this.editTemplate.Id) return;
        this.isSaving = true;
        try {
            const result = await validateTemplate({ templateId: this.editTemplate.Id });
            await refreshApex(this._wiredTemplates);
            this._toast(
                result.valid ? 'Package valid' : 'Package invalid',
                result.message,
                result.valid ? 'success' : 'warning'
            );
        } catch (error) {
            this._toast('Validation failed', error.body?.message || error.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleDeleteTemplate(event) {
        const id = event.currentTarget.dataset.id;
        const template = (this._wiredTemplates?.data || []).find(item => item.id === id);
        this.pendingDelete = template || null;
    }

    closeDeleteModal() {
        this.pendingDelete = null;
    }

    async confirmDeleteTemplate() {
        const template = this.pendingDelete;
        this.pendingDelete = null;
        if (!template) return;
        try {
            await deleteTemplate({ templateId: template.id });
            await refreshApex(this._wiredTemplates);
            this._toast('Template deleted', `"${template.name}" and its files were deleted.`, 'success');
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
        }
    }

    closeModal() {
        this.isModalOpen = false;
        this.expandedFile = '';
        this.editTemplate = EMPTY_TEMPLATE();
    }

    _syncCatalogRows() {
        const saved = this.editingTemplate?.components || [];
        const previous = new Map(this.catalogRows.map(row => [row.fileName, row]));
        this.catalogRows = this.contentBlockAssets.map(asset => {
            if (previous.has(asset.name)) return previous.get(asset.name);
            const match = saved.find(component => this._sameFile(component.fileName, asset.name));
            const defaults = COMPONENT_TYPES.find(type => type.value === match?.type) || {};
            return {
                documentId: asset.documentId,
                fileName: asset.name,
                type: match?.type || '',
                label: match?.label || defaults.label || '',
                description: match?.description || defaults.description || '',
                icon: match?.icon || '',
                status: match?.status || (match ? 'Active' : 'Draft'),
                activeTab: 'content',
                validationMessage: '',
                persisted: !!match,
                placeholders: null,
                bindings: bindingMap(match?.bindings),
                blockSettings: Array.isArray(match?.blockSettings) ? [...match.blockSettings] : null,
                legacy: !Array.isArray(match?.bindings)
            };
        });
        this._loadPlaceholders();
    }

    async _loadPlaceholders() {
        if (!this.editTemplate.Id) return;
        this.placeholdersLoading = true;
        try {
            const scans = await getContentBlockPlaceholders({ templateId: this.editTemplate.Id });
            const byFile = new Map((scans || []).map(scan => [this._fileKey(scan.fileName), scan.placeholders || []]));
            this.catalogRows = this.catalogRows.map(row => {
                const found = byFile.get(this._fileKey(row.fileName));
                if (!found) return { ...row, placeholders: row.placeholders || [] };
                const bindings = { ...(row.bindings || {}) };
                found.forEach(name => {
                    if (!(name in bindings)) bindings[name] = '';
                });
                return { ...row, placeholders: found, bindings };
            });
            if (this.catalogRows.some(row => !row.persisted) && !this.isEditingActive) {
                await this._persistCatalog();
            }
        } catch (error) {
            this._toast('Placeholders', error.body?.message || error.message, 'error');
        } finally {
            this.placeholdersLoading = false;
        }
    }

    _fileKey(value) {
        return String(value || '').toLowerCase().replace(/\.html$/, '');
    }

    _sameFile(left, right) {
        const normalize = value => String(value || '').toLowerCase().replace(/\.html$/, '');
        return normalize(left) === normalize(right);
    }

    _assetsOfType(assetType) {
        return this.editingAssets.filter(asset => asset.assetType === assetType);
    }

    _formatBytes(value) {
        const bytes = Number(value || 0);
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
