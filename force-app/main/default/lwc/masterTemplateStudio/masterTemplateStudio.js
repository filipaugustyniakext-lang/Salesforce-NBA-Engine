import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelTemplates from '@salesforce/apex/ChannelTemplateController.getChannelTemplates';
import saveTemplate from '@salesforce/apex/ChannelTemplateController.saveTemplate';
import classifyUploadedFiles from '@salesforce/apex/ChannelTemplateController.classifyUploadedFiles';
import deleteTemplateAsset from '@salesforce/apex/ChannelTemplateController.deleteTemplateAsset';
import deleteTemplate from '@salesforce/apex/ChannelTemplateController.deleteTemplate';
import getTemplateRenderSource from '@salesforce/apex/ChannelTemplateController.getTemplateRenderSource';
import { scanCcPreviewRegionLabelsInOrder, parseTemplateKind, parseShellEditorFields, parseShellVariants } from 'c/copyTemplatePreview';
import getChannelRecords from '@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords';
import saveShellBindings from '@salesforce/apex/ChannelTemplateController.saveShellBindings';
import listCmsImages from '@salesforce/apex/ChannelTemplateController.listCmsImages';
import contentVersionDownloadUrl from '@salesforce/apex/ChannelTemplateController.contentVersionDownloadUrl';
import syncDraftBlockCatalog from '@salesforce/apex/ChannelTemplateController.syncDraftBlockCatalog';
import saveComponentCatalog from '@salesforce/apex/ChannelTemplateController.saveComponentCatalog';
import validateContentBlockDefinition from '@salesforce/apex/ChannelTemplateController.validateContentBlockDefinition';
import activateTemplatePackage from '@salesforce/apex/ChannelTemplateController.activateTemplatePackage';
import {
    COUNTRY_OPTIONS,
    CLASSIFICATION_OPTIONS,
    WIZARD_STEPS,
    composeRecordName,
    normalizeSlug
} from './templateStudioUtils';

const VALID_BLOCK_ICON = /^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$/;

function formatUiComponentTitle(componentId) {
    const raw = String(componentId || '').trim();
    if (!raw) return '';
    return raw
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

const IMAGE_SOURCE_OPTIONS = [
    { label: 'Upload Image', value: 'upload' },
    { label: 'Paste URL', value: 'url' },
    { label: 'Choose from Salesforce Content', value: 'cms' }
];

const EMPTY_DRAFT = () => ({
    Id: null,
    Name: '',
    Template_Slug__c: '',
    Country_Code__c: 'PL',
    Template_Classification__c: 'Commercial',
    Status__c: 'Draft',
    Version__c: 1,
    Description__c: ''
});

export default class MasterTemplateStudio extends LightningElement {
    @api channelId;
    @api channelName;

    @track draft = EMPTY_DRAFT();
    @track wizardStep = 'basic';
    @track isModalOpen = false;
    @track isSaving = false;
    @track pendingDelete = null;
    @track pendingBlockDelete = null;
    @track shellRegions = [];
    @track shellRegionError = '';
    @track templateKind = 'multi';
    @track shellBindings = [];
    @track shellPreviewValues = {};
    @track shellVariants = [];
    @track shellVariantState = {};
    @track selectedShellBindingKey = '';
    @track cmsSearchQuery = '';
    @track intentOptions = [];
    @track cmsImages = [];
    @track showNewBlockDefinitionForm = false;
    @track pendingBlockDraft = {
        label: '',
        description: '',
        icon: '',
        fileName: '',
        draftKey: '',
        validated: false
    };
    @track blockBindingTab = 'content';
    /** Catalog type or uploaded file name — drives single-block preview on Content Blocks step. */
    @track previewBlockKey = '';
    acceptedHtml = ['.html'];
    acceptedCss = ['.css'];

    countryOptions = COUNTRY_OPTIONS;
    classificationOptions = CLASSIFICATION_OPTIONS;
    wizardSteps = WIZARD_STEPS;

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

    get hasTemplates() {
        return (this._wiredTemplates?.data || []).length > 0;
    }

    get computedRecordName() {
        return composeRecordName(
            this.draft.Country_Code__c,
            this.draft.Template_Slug__c,
            this.draft.Template_Classification__c
        );
    }

    get templates() {
        return (this._wiredTemplates?.data || []).map(item => {
            const shellRegions = item.shellPreviewRegions || [];
            const blockLabels = (item.contentBlockNames || []).length
                ? item.contentBlockNames
                : (item.components || []).map(c => c.fileName).filter(Boolean);
            const validationStatus = String(item.validationStatus || '').trim();
            const validationIsValid = validationStatus === 'Valid';
            const packageValidationBadge = this._packageValidationBadge(validationStatus);
            const supplementalValidationIssues = (item.validationIssues || []).filter(line =>
                this._isSupplementalValidationIssue(line, validationStatus)
            );
            const displayStatus = item.status === 'Active' && !validationIsValid
                ? 'Draft'
                : item.status;
            const statusClass = displayStatus === 'Active'
                ? 'slds-badge template-status template-status_active'
                : displayStatus === 'Archived'
                    ? 'slds-badge template-status template-status_archived'
                    : 'slds-badge template-status';

            return {
            ...item,
            displayStatus,
            statusClass,
            blockLabels,
            blockBadges: blockLabels.map((label, index) => ({
                key: `block-${item.id}-${index}-${label}`,
                label
            })),
            hasBlocks: blockLabels.length > 0,
            shellRegionBadges: shellRegions.map((label, index) => ({
                key: `region-${item.id}-${index}-${label}`,
                label
            })),
            hasShellRegions: shellRegions.length > 0,
            packageValidationBadge,
            supplementalValidationIssues,
            hasSupplementalValidationIssues: supplementalValidationIssues.length > 0,
            showValidationPending: false,
            copyCenterUsageClass: 'slds-badge slds-badge_lightest',
            variantLabel: item.messageVariantCount === 1
                ? '1 message variant'
                : `${item.messageVariantCount || 0} message variants`,
            deleteDisabled: item.deleteBlockedByMessages || item.status === 'Active',
            deleteTitle: item.deleteBlockedByMessages
                ? 'Unassign this template from all message variants before deleting.'
                : item.status === 'Active'
                    ? 'Archive the template before deleting.'
                    : 'Delete template',
            editTitle: 'Edit template definition'
            };
        });
    }

    _packageValidationBadge(validationStatus) {
        if (validationStatus === 'Valid') {
            return {
                label: 'Package is valid',
                className: 'slds-badge slds-theme_success'
            };
        }
        if (validationStatus === 'Invalid') {
            return {
                label: 'Package is invalid',
                className: 'slds-badge slds-theme_error'
            };
        }
        if (!validationStatus || validationStatus === 'Not Validated') {
            return {
                label: 'Not validated yet',
                className: 'slds-badge slds-theme_warning'
            };
        }
        return null;
    }

    _isSupplementalValidationIssue(line, validationStatus) {
        const text = String(line || '').trim();
        if (!text) return false;
        const normalized = text.toLowerCase();
        if (normalized === 'package is valid.' || normalized === 'package is valid') return false;
        return true;
    }

    get modalTitle() {
        const step = WIZARD_STEPS.find(s => s.value === this.wizardStep);
        const action = this.draft.Id ? 'Edit' : 'New';
        return `${action} ${this.channelName} template — ${step?.label || ''}`;
    }

    get hasRecordId() {
        return !!this.draft.Id;
    }

    get isActiveTemplate() {
        return this.draft.Status__c === 'Active';
    }

    get blockDefinitionFormTitle() {
        return this.isEditingExistingBlock
            ? 'Edit content block definition'
            : 'New content block definition';
    }

    get isEditingExistingBlock() {
        return !!this._findBlockDefinition(
            this.pendingBlockDraft.draftKey,
            this.pendingBlockDraft.fileName
        );
    }

    get blockIconPreviewName() {
        const icon = (this.pendingBlockDraft.icon || '').trim();
        return icon && VALID_BLOCK_ICON.test(icon) ? icon : '';
    }

    get contentBlockCards() {
        return this._savedBlockDefinitions()
            .filter(component => !(
                this.showNewBlockDefinitionForm
                && (
                    (this.pendingBlockDraft.draftKey && component.type === this.pendingBlockDraft.draftKey)
                    || (this.pendingBlockDraft.fileName
                        && component.fileName === this.pendingBlockDraft.fileName)
                )
            ))
            .map((component, index) => {
            const status = (component.status || 'Draft').trim();
            const validated = status === 'Ready' || status === 'Active';
            const previewKey = this._blockPreviewKey(component);
            const selected = this._previewKeysMatch(previewKey, this.previewBlockKey);
            return {
                key: `${component.type || 'block'}-${index}`,
                type: component.type,
                fileName: component.fileName || '',
                label: component.label || '',
                description: component.description || '',
                displayTitle: component.label || component.fileName || component.type || 'Content block',
                fileMeta: component.fileName ? component.fileName : 'HTML not uploaded yet',
                statusLabel: status,
                statusBadgeClass: this._blockStatusBadgeClass(status),
                validationLabel: validated ? 'Validated' : 'Not validated',
                validationBadgeClass: validated
                    ? 'slds-badge slds-theme_success'
                    : 'slds-badge slds-badge_lightest',
                descriptionDisplay: component.description || 'No description provided.',
                documentId: this._contentBlockDocumentId(component.fileName),
                summaryCardClass: 'studio-block-summary-card slds-card slds-card_boundary'
                    + (selected ? ' studio-block-summary-card_selected' : ''),
                previewKey
            };
        });
    }

    get hasContentBlockCards() {
        return this._savedBlockDefinitions().length > 0;
    }

    get showBlocksEmptyState() {
        return this.hasRecordId && !this.hasContentBlockCards && !this.showNewBlockDefinitionForm;
    }

    get showAddBlockDefinitionButton() {
        return this.hasRecordId && this.hasContentBlockCards && !this.showNewBlockDefinitionForm;
    }

    get saveBlockDefinitionDisabled() {
        return this.isSaving || !this.pendingBlockDraft.label?.trim();
    }

    get validateBlockDefinitionDisabled() {
        return (
            this.isSaving
            || !this.pendingBlockDraft.label?.trim()
            || !this.pendingBlockDraft.draftKey
            || !this.pendingBlockDraft.fileName
        );
    }

    get activateBlockDefinitionDisabled() {
        return this.isSaving || !this.pendingBlockDraft.validated;
    }

    get isBasicStep() { return this.wizardStep === 'basic'; }
    get isShellStep() { return this.wizardStep === 'shell'; }
    get isBlocksStep() { return this.wizardStep === 'blocks'; }
    get isSummaryStep() { return this.wizardStep === 'summary'; }

    get studioPanelClass() {
        if (this.isShellStep) return 'studio-panel studio-panel--shell-step';
        if (this.isBlocksStep) return 'studio-panel studio-panel--blocks-step';
        return 'studio-panel';
    }

    get isSingleBlockTemplate() {
        return this.templateKind === 'single';
    }

    get visibleWizardSteps() {
        const steps = this.isSingleBlockTemplate
            ? WIZARD_STEPS.filter(step => step.value !== 'blocks')
            : WIZARD_STEPS;
        const numbers = ['I', 'II', 'III', 'IV'];
        return steps.map((step, index) => ({ ...step, number: numbers[index] || step.number }));
    }

    get shellBindingRows() {
        const labels = {
            text: 'Text input',
            richtext: 'Rich text',
            image: 'Image',
            action: 'Button'
        };
        const actionOptions = [
            { label: 'URL', value: 'url' },
            { label: 'Intent', value: 'intent' }
        ];
        const seenVariants = new Set();
        return (this.shellBindings || []).map(row => {
            const showVariant = !!row.variantName && !seenVariants.has(row.variantName);
            if (row.variantName) seenVariants.add(row.variantName);
            const bindingKey = row.bindingKey || row.placeholder;
            const labelChoiceOptions = (row.labelOptions || []).map(option => ({ label: option, value: option }));
            if (row.labelOptions?.length) {
                labelChoiceOptions.push({ label: row.labelCustomOption || 'Custom Label', value: '__custom__' });
            }
            const isDualImage = row.editor === 'image' && (row.imageModes || []).includes('light') && (row.imageModes || []).includes('dark');
            const showImageSettings = row.editor === 'image';
            return {
                ...row,
                bindingKey,
                rowTitle: row.bindingTitle || row.placeholder,
                showPlaceholderCode: !row.bindingTitle,
                placeholderLabel: `{{${row.placeholder}}}`,
                editorLabel: labels[row.editor] || row.editor,
                isAction: row.editor === 'action',
                isIntent: row.editor === 'action' && row.actionMode === 'intent',
                isUrlMode: row.editor === 'action' && row.actionMode !== 'intent',
                isText: row.editor === 'text' && !row.labelOptions?.length,
                isLabelPicklist: row.editor === 'text' && !!row.labelOptions?.length,
                isRichtext: row.editor === 'richtext',
                showImageSettings,
                imagePanels: showImageSettings
                    ? this._buildImagePanels(row, bindingKey, isDualImage)
                    : [],
                selected: bindingKey === this.selectedShellBindingKey,
                rowClass: 'slds-box slds-box_x-small slds-m-bottom_x-small shell-binding'
                    + (bindingKey === this.selectedShellBindingKey ? ' shell-binding_selected' : ''),
                actionOptions,
                actionRadioName: `shell-action-${bindingKey}`,
                inputId: `shell-preview-${bindingKey}`,
                labelInputId: `shell-label-${bindingKey}`,
                labelChoiceOptions,
                showCustomLabelInput: row.labelChoice === '__custom__',
                showVariant,
                variantEnabled: row.variantName ? this.shellVariantState?.[row.variantName] !== false : false
            };
        });
    }

    get shellBindingGroups() {
        const groups = [];
        const groupIndex = new Map();
        (this.shellBindingRows || []).forEach(row => {
            const groupKey = row.uiComponent || row.bindingKey;
            if (!groupIndex.has(groupKey)) {
                groupIndex.set(groupKey, groups.length);
                groups.push({
                    key: groupKey,
                    title: row.uiComponent ? formatUiComponentTitle(row.uiComponent) : row.rowTitle,
                    showGroupHeading: !!row.uiComponent,
                    rows: []
                });
            }
            groups[groupIndex.get(groupKey)].rows.push(row);
        });
        return groups.map(group => {
            const variantToggles = group.rows
                .filter(row => row.showVariant)
                .map(row => ({
                    key: row.variantName,
                    variantName: row.variantName,
                    variantLabel: row.variantLabel,
                    variantEnabled: row.variantEnabled
                }));
            const rows = variantToggles.length
                ? group.rows.map(row => ({ ...row, showVariant: false }))
                : group.rows;
            return { ...group, variantToggles, rows };
        });
    }

    get filteredCmsImages() {
        const query = String(this.cmsSearchQuery || '').trim().toLowerCase();
        if (!query) return this.cmsImages || [];
        return (this.cmsImages || []).filter(image => (
            String(image.title || '').toLowerCase().includes(query)
        ));
    }

    get shellPreviewValuesJson() {
        return JSON.stringify(this._buildShellPreviewValues());
    }

    get shellVariantStateJson() {
        return JSON.stringify(this.shellVariantState || {});
    }

    get hasShellBindings() {
        return this.isSingleBlockTemplate && this.shellBindingRows.length > 0;
    }

    get navItems() {
        const definedBlockCount = this._savedBlockDefinitions().length;
        const activeBlockCount = this._savedBlockDefinitions().filter(
            component => (component.status || '').toLowerCase() === 'active'
        ).length;
        return this.visibleWizardSteps.map(step => ({
            ...step,
            itemClass: 'studio-nav__item' + (this.wizardStep === step.value ? ' studio-nav__item_active' : ''),
            ariaCurrent: this.wizardStep === step.value ? 'step' : 'false',
            showBlockCounts: step.value === 'blocks',
            definedBlockCount,
            activeBlockCount
        }));
    }

    get shellHtmlAssets() {
        return this._assets('SHELL_HTML');
    }

    get shellFileTiles() {
        const tiles = this._fileTiles('SHELL_HTML', 'doctype:html');
        return tiles.length ? [tiles[0]] : [];
    }

    get hasShellFile() {
        return this.shellFileTiles.length > 0;
    }

    get shellUploadLabel() {
        return this.hasShellFile ? 'Replace shell HTML' : 'Upload shell HTML';
    }

    get blockHtmlAssets() {
        return this._assets('CONTENT_BLOCK');
    }

    get blockHtmlFileTiles() {
        return this._fileTiles('CONTENT_BLOCK', 'doctype:html');
    }

    get blockCssAssets() {
        return this._assets('SHELL_CSS');
    }

    get blockCssFileTiles() {
        return this._fileTiles('SHELL_CSS', 'doctype:css');
    }

    get shellRegionsDisplay() {
        return (this.shellRegions || []).map((label, index) => ({
            key: `region-${index}-${label}`,
            label
        }));
    }

    get shellRegionsOk() {
        return (this.shellRegions || []).length > 0;
    }

    get summaryBlockEntries() {
        const definitions = this._savedBlockDefinitions();
        if (!definitions.length) {
            return [{
                key: 'summary-blocks-none',
                label: 'None — optional for shell-only templates (not required to activate).'
            }];
        }
        return definitions.map((component, index) => ({
            key: `summary-block-${component.type || index}`,
            label: component.label || component.fileName || component.type || 'Content block'
        }));
    }

    get summaryValidationLines() {
        const lines = [];
        if (!this.shellRegionsOk) {
            lines.push('Shell HTML must include at least one cc-preview region.');
        } else {
            lines.push('Content block files are optional unless you assign block HTML in Copy Center.');
        }
        return lines;
    }

    get nextDisabled() {
        if (this.isSaving) return true;
        if (this.isBasicStep && !normalizeSlug(this.draft.Template_Slug__c)) return true;
        if (this.isShellStep && !this.shellRegionsOk) return true;
        return false;
    }

    get saveDisabled() {
        return this.isSaving || !normalizeSlug(this.draft.Template_Slug__c);
    }

    get activateDisabled() {
        return this.isSaving || !this.draft.Id || !this.shellRegionsOk;
    }

    get activateTitle() {
        if (!this.draft.Id) {
            return 'Save the template draft before activation.';
        }
        if (!this.shellRegionsOk) {
            return 'Upload shell HTML with cc-preview regions before activation.';
        }
        return 'Validate the package and activate this template for Copy Center. Unvalidated packages cannot become active.';
    }

    handleNew() {
        this.draft = EMPTY_DRAFT();
        this.wizardStep = 'basic';
        this.shellRegions = [];
        this.shellRegionError = '';
        this.showNewBlockDefinitionForm = false;
        this._resetPendingBlockDraft();
        this.previewBlockKey = '';
        this.isModalOpen = true;
    }

    handleEdit(event) {
        const id = event.currentTarget.dataset.id;
        const source = (this._wiredTemplates?.data || []).find(t => t.id === id);
        if (!source) return;
        this.draft = {
            Id: source.id,
            Name: source.name,
            Template_Slug__c: source.templateSlug || '',
            Country_Code__c: source.countryCode || 'PL',
            Template_Classification__c: source.templateClassification || 'Commercial',
            Status__c: source.status === 'Active' ? 'Active' : 'Draft',
            Version__c: source.version || 1,
            Description__c: source.description || ''
        };
        this.wizardStep = 'basic';
        this.shellRegions = source.shellPreviewRegions || [];
        this.shellRegionError = '';
        this.showNewBlockDefinitionForm = false;
        this._resetPendingBlockDraft();
        this.previewBlockKey = '';
        this.isModalOpen = true;
        if (source.id) this._refreshShellRegions(source.id);
    }

    async handleNavSelect(event) {
        const step = event.currentTarget.dataset.step;
        if (!step || (step === 'blocks' && this.isSingleBlockTemplate)) return;
        this.wizardStep = step;
        if (step === 'shell' || step === 'blocks' || step === 'summary') {
            this._refreshShellRegions(this.draft.Id);
        }
        if (step === 'blocks' && this.draft.Id) {
            await this._syncDraftBlockCatalogIfNeeded();
        }
        if (step === 'shell' || step === 'blocks') {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
        }
    }

    handleFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.detail?.value ?? event.target?.value;
        this.draft = { ...this.draft, [field]: value };
    }

    async handleSaveDraft() {
        const slug = normalizeSlug(this.draft.Template_Slug__c);
        if (!slug) {
            this._toast('Validation', 'Template Name is required.', 'warning');
            return;
        }
        this.isSaving = true;
        try {
            const record = {
                ...this.draft,
                Template_Slug__c: slug,
                Name: composeRecordName(
                    this.draft.Country_Code__c,
                    slug,
                    this.draft.Template_Classification__c
                ),
                Status__c: this.draft.Status__c === 'Active' ? 'Active' : 'Draft'
            };
            const id = await saveTemplate({ record, channelId: this.channelId });
            this.draft = { ...this.draft, Id: id, Name: record.Name };
            if (this.blockHtmlAssets.length) {
                await syncDraftBlockCatalog({ templateId: id });
            }
            await refreshApex(this._wiredTemplates);
            this._toast('Saved', 'Template definition saved as Draft.', 'success');
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleNext() {
        if (this.isBasicStep) {
            if (!normalizeSlug(this.draft.Template_Slug__c)) {
                this._toast('Validation', 'Template Name is required.', 'warning');
                return;
            }
            this.wizardStep = 'shell';
            return;
        }
        if (this.isShellStep) {
            if (!this.shellRegionsOk) {
                this.shellRegionError = 'Upload shell HTML with at least one cc-preview wrapper.';
                this._toast('Shell', this.shellRegionError, 'warning');
                return;
            }
            this.wizardStep = this.isSingleBlockTemplate ? 'summary' : 'blocks';
            if (this.draft.Id) {
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                Promise.resolve(this._syncDraftBlockCatalogIfNeeded()).then(() => {
                    // eslint-disable-next-line @lwc/lwc/no-async-operation
                    requestAnimationFrame(() => this._refreshStudioPreviews());
                });
            }
            return;
        }
        if (this.isBlocksStep) {
            this.wizardStep = 'summary';
            this._refreshShellRegions(this.draft.Id);
        }
    }

    handleBack() {
        const steps = this.visibleWizardSteps;
        const index = steps.findIndex(step => step.value === this.wizardStep);
        if (index > 0) this.wizardStep = steps[index - 1].value;
    }

    renderedCallback() {
        this.template.querySelectorAll('[data-shell-preview-input]').forEach((input) => {
            if (this.template.activeElement === input) return;
            const placeholder = input.dataset.placeholder || input.dataset.labelPlaceholder;
            if (!placeholder || !Object.prototype.hasOwnProperty.call(this.shellPreviewValues, placeholder)) return;
            const value = this.shellPreviewValues[placeholder] || '';
            if (input.value !== value) input.value = value;
        });
    }

    handleSelectShellBinding(event) {
        this.selectedShellBindingKey = event.currentTarget.dataset.bindingKey;
        this.cmsSearchQuery = '';
    }

    handleShellPreviewValueChange(event) {
        const placeholder = this._previewPlaceholder(event);
        const value = event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'value')
            ? event.detail.value
            : (event.target?.value ?? '');
        if (!placeholder) return;
        this._setShellPreviewValue(placeholder, value);
    }

    async handleShellImageUpload(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const imageMode = event.currentTarget.dataset.imageMode || '';
        const file = (event.detail?.files || [])[0];
        if (!file?.documentId || !bindingKey) return;
        const row = this._shellBinding(bindingKey);
        if (!row) return;
        const placeholder = this._imagePlaceholder(row, imageMode || 'default');
        try {
            const url = await contentVersionDownloadUrl({ contentDocumentId: file.documentId });
            this._setShellPreviewValue(placeholder, url);
        } catch (error) {
            this._toast('Image upload', error.body?.message || error.message, 'error');
        }
    }

    handleShellImageSourceChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const imageMode = event.currentTarget.dataset.imageMode || 'default';
        const sourceMode = event.detail.value;
        const patch = {};
        if (imageMode === 'light') patch.imageLightSource = sourceMode;
        else if (imageMode === 'dark') patch.imageDarkSource = sourceMode;
        else patch.imageSource = sourceMode;
        this._updateShellBinding(bindingKey, patch);
        if (sourceMode === 'cms') {
            this._loadCmsImages();
        }
    }

    handleShellImageUrlChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const imageMode = event.currentTarget.dataset.imageMode || 'default';
        const row = this._shellBinding(bindingKey);
        if (!row) return;
        const value = event.detail?.value ?? event.target?.value ?? '';
        const placeholder = this._imagePlaceholder(row, imageMode);
        this._setShellPreviewValue(placeholder, value);
    }

    handleCmsSearchChange(event) {
        this.cmsSearchQuery = event.detail?.value ?? event.target?.value ?? '';
    }

    handlePickCmsImage(event) {
        const url = event.currentTarget.dataset.url;
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const imageMode = event.currentTarget.dataset.imageMode || 'default';
        if (!bindingKey || !url) return;
        const row = this._shellBinding(bindingKey);
        if (!row) return;
        this._setShellPreviewValue(this._imagePlaceholder(row, imageMode), url);
    }

    handleShellLabelChoiceChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const labelChoice = event.detail.value;
        this._updateShellBinding(bindingKey, { labelChoice });
    }

    handleShellLabelCustomChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const labelCustomText = event.detail?.value ?? event.target?.value ?? '';
        this._updateShellBinding(bindingKey, { labelCustomText });
        this._syncLabelPreview(bindingKey);
    }

    handleShellButtonLabelChange(event) {
        const input = event.currentTarget;
        const labelKey = input?.dataset?.labelPlaceholder;
        if (!labelKey) return;
        const value = event.detail?.value ?? input?.value ?? '';
        this._setShellPreviewValue(labelKey, value);
    }

    handleShellActionUrlChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const actionUrl = event.detail?.value ?? event.target?.value ?? '';
        this._updateShellBinding(bindingKey, { actionUrl });
        this._syncActionUrlPreview(bindingKey);
    }

    _previewPlaceholder(event) {
        const from = (node) => node?.dataset?.placeholder || node?.getAttribute?.('data-placeholder') || '';
        return from(event.currentTarget) || from(event.target) || '';
    }

    _setShellPreviewValue(placeholder, value) {
        const next = String(value ?? '');
        if ((this.shellPreviewValues[placeholder] || '') === next) return;
        this.shellPreviewValues = { ...this.shellPreviewValues, [placeholder]: next };
        this.template.querySelector('c-copy-template-preview-panel')?.applyPreviewValues(this.shellPreviewValues);
    }

    handleShellVariantToggle(event) {
        const name = event.currentTarget?.dataset?.variant;
        if (!name) return;
        const enabled = event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'checked')
            ? !!event.detail.checked
            : !!event.target?.checked;
        this.shellVariantState = { ...this.shellVariantState, [name]: enabled };
        this.template.querySelector('c-copy-template-preview-panel')?.applyVariantState(this.shellVariantState);
    }

    handleShellActionModeChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const actionMode = event.detail.value;
        this._updateShellBinding(bindingKey, {
            actionMode,
            intentId: actionMode === 'intent' ? (this._shellBinding(bindingKey)?.intentId || '') : ''
        });
        this._syncActionUrlPreview(bindingKey);
    }

    handleShellIntentChange(event) {
        const bindingKey = event.currentTarget.dataset.bindingKey;
        const intentId = event.detail.value || '';
        this._updateShellBinding(bindingKey, { intentId });
    }

    async handleShellUpload(event) {
        await this._classifyUpload(event, 'SHELL_HTML');
    }

    handleAddBlockDefinition() {
        this.showNewBlockDefinitionForm = true;
        this._resetPendingBlockDraft();
        this.previewBlockKey = '';
    }

    handleBlockSummaryPreview(event) {
        const previewKey = event.currentTarget.dataset.previewKey;
        if (!previewKey) return;
        this.previewBlockKey = previewKey;
        this.showNewBlockDefinitionForm = false;
        this._resetPendingBlockDraft();
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => this._refreshStudioPreviews());
    }

    handleEditBlockDefinition(event) {
        event.stopPropagation();
        const blockType = event.currentTarget.dataset.type;
        const fileName = event.currentTarget.dataset.fileName;
        const component = this._findBlockDefinition(blockType, fileName);
        if (!component) return;
        const status = (component.status || 'Draft').trim();
        this.previewBlockKey = this._blockPreviewKey(component);
        this.pendingBlockDraft = {
            label: component.label || '',
            description: component.description || '',
            icon: component.icon || '',
            fileName: component.fileName || '',
            draftKey: component.type || '',
            validated: status === 'Ready' || status === 'Active'
        };
        this.showNewBlockDefinitionForm = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => this._refreshStudioPreviews());
    }

    handleCancelBlockDefinition() {
        this.showNewBlockDefinitionForm = false;
        this._resetPendingBlockDraft();
    }

    handleDeleteBlockDefinition(event) {
        event.stopPropagation();
        const blockType = event.currentTarget.dataset.type;
        const fileName = event.currentTarget.dataset.fileName;
        const component = this._findBlockDefinition(blockType, fileName);
        if (!component) return;
        this.pendingBlockDelete = {
            type: blockType,
            title: component.label || component.fileName || blockType,
            fileName: component.fileName || ''
        };
    }

    closeBlockDeleteModal() {
        this.pendingBlockDelete = null;
    }

    async confirmDeleteBlockDefinition() {
        const pending = this.pendingBlockDelete;
        this.pendingBlockDelete = null;
        if (!pending || !this.draft.Id) return;
        this.isSaving = true;
        try {
            const rows = this._componentCatalogRows().filter(row => row.type !== pending.type);
            await saveComponentCatalog({
                templateId: this.draft.Id,
                componentsJson: JSON.stringify(rows)
            });
            const documentIds = this._contentBlockDocumentIdsToRemove(
                pending.fileName,
                rows.length === 0
            );
            for (const documentId of documentIds) {
                await deleteTemplateAsset({
                    templateId: this.draft.Id,
                    documentId
                });
            }
            if (
                this.showNewBlockDefinitionForm
                && this.pendingBlockDraft.draftKey === pending.type
            ) {
                this.showNewBlockDefinitionForm = false;
                this._resetPendingBlockDraft();
            }
            if (this.previewBlockKey === pending.type) {
                this.previewBlockKey = '';
            }
            await refreshApex(this._wiredTemplates);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
            this._toast('Deleted', 'Content block definition removed.', 'success');
        } catch (error) {
            this._toast('Error', this._apexErrorMessage(error), 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handlePendingBlockFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.detail?.value ?? event.target?.value ?? '';
        this.pendingBlockDraft = { ...this.pendingBlockDraft, [field]: value, validated: false };
    }

    async handleBlockDefinitionUpload(event) {
        const uploaded = (event.detail.files || [])[0];
        await this._classifyUpload(event, 'CONTENT_BLOCK');
        let fileName = '';
        if (uploaded?.name) {
            fileName = this._normalizeUploadedBlockFileName(uploaded.name);
            this.pendingBlockDraft = {
                ...this.pendingBlockDraft,
                fileName,
                validated: false
            };
        } else {
            await refreshApex(this._wiredTemplates);
            const latest = this.blockHtmlAssets[this.blockHtmlAssets.length - 1];
            if (latest?.name) {
                fileName = latest.name;
                this.pendingBlockDraft = {
                    ...this.pendingBlockDraft,
                    fileName,
                    validated: false
                };
            }
        }
        if (fileName) {
            this.previewBlockKey = fileName;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
        }
    }

    async handleSaveBlockDefinition() {
        await this._persistBlockDefinition('Draft');
    }

    async handleValidateBlockDefinition() {
        if (!this.draft.Id || this.validateBlockDefinitionDisabled) return;
        this.isSaving = true;
        try {
            await this._persistBlockDefinition('Draft', { silent: true });
            const blockKey = this._pendingBlockKey();
            const result = await validateContentBlockDefinition({
                templateId: this.draft.Id,
                blockKey
            });
            if (!result?.valid) {
                this.pendingBlockDraft = { ...this.pendingBlockDraft, validated: false };
                this._toast('Validation', result?.message || 'Content block validation failed.', 'warning');
                return;
            }
            await this._persistBlockDefinition('Ready', { silent: true });
            this.pendingBlockDraft = { ...this.pendingBlockDraft, validated: true };
            const variant = result?.hasBindingWarnings ? 'warning' : 'success';
            const title = result?.hasBindingWarnings ? 'Validated with notes' : 'Validated';
            this._toast(title, result.message, variant);
        } catch (error) {
            this._toast('Validation failed', this._apexErrorMessage(error), 'error');
        } finally {
            this.isSaving = false;
        }
    }

    async handleActivateBlockDefinition() {
        if (!this.draft.Id || this.activateBlockDefinitionDisabled) return;
        this.isSaving = true;
        try {
            await this._persistBlockDefinition('Active');
            this.showNewBlockDefinitionForm = false;
            this._resetPendingBlockDraft();
            this._toast('Activated', 'Content block definition is active.', 'success');
        } catch (error) {
            this._toast('Activation failed', this._apexErrorMessage(error), 'error');
        } finally {
            this.isSaving = false;
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
            await this._refreshShellRegions(this.draft.Id);
            this._toast('Removed', 'File removed.', 'success');
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
        }
    }

    async handleActivate() {
        if (!this.draft.Id || this.activateDisabled) return;
        this.isSaving = true;
        try {
            await activateTemplatePackage({ templateId: this.draft.Id });
            this.draft = { ...this.draft, Status__c: 'Active' };
            await refreshApex(this._wiredTemplates);
            this._toast('Activated', 'Template definition is active.', 'success');
            this.closeModal();
        } catch (error) {
            this._toast('Activation failed', this._apexErrorMessage(error), 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleDeleteTemplate(event) {
        const id = event.currentTarget.dataset.id;
        this.pendingDelete = (this._wiredTemplates?.data || []).find(t => t.id === id) || null;
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
            this._toast('Deleted', 'Template definition deleted.', 'success');
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
        }
    }

    closeModal() {
        this.isModalOpen = false;
        this.draft = EMPTY_DRAFT();
        this.wizardStep = 'basic';
        this.shellRegions = [];
        this.showNewBlockDefinitionForm = false;
        this._resetPendingBlockDraft();
        this.previewBlockKey = '';
    }

    async _classifyUpload(event, assetType) {
        if (!this.draft.Id) {
            this._toast('Save first', 'Save basic properties before uploading files.', 'warning');
            return;
        }
        const documentIds = (event.detail.files || []).map(file => file.documentId);
        if (!documentIds.length) return;
        try {
            const errorMessage = await classifyUploadedFiles({
                templateId: this.draft.Id,
                documentIds,
                assetType
            });
            if (errorMessage) throw new Error(errorMessage);
            await refreshApex(this._wiredTemplates);
            await this._refreshShellRegions(this.draft.Id);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
            if (assetType === 'SHELL_HTML' && this.isActiveTemplate) {
                this._toast(
                    'Shell updated',
                    'This active template shell change affects every email using this template.',
                    'warning'
                );
            } else {
                this._toast('Uploaded', 'File attached to the template definition.', 'success');
            }
        } catch (error) {
            this._toast('Upload failed', error.body?.message || error.message, 'error');
        }
    }

    async _refreshShellRegions(templateId) {
        if (!templateId) {
            this.shellRegions = [];
            this.templateKind = 'multi';
            this.shellBindings = [];
            this.shellVariants = [];
            this.shellVariantState = {};
            return;
        }
        try {
            const source = await getTemplateRenderSource({ templateId });
            const shellHtml = source?.shellHtml || '';
            this.shellRegions = scanCcPreviewRegionLabelsInOrder(shellHtml);
            this.templateKind = parseTemplateKind(shellHtml);
            this._mergeShellBindings(shellHtml, source?.shellBindingsJson);
            this._seedShellPreviewLabelDefaults();
            this._mergeShellVariants(shellHtml);
            if (this.isSingleBlockTemplate) {
                this._loadIntentOptions();
                if (this.wizardStep === 'blocks') this.wizardStep = 'shell';
            }
            this.shellRegionError = this.shellRegions.length
                ? ''
                : 'No cc-preview regions found in the shell HTML yet.';
        } catch (error) {
            this.shellRegions = [];
            this.templateKind = 'multi';
            this.shellBindings = [];
            this.shellVariants = [];
            this.shellVariantState = {};
            this.shellRegionError = error.body?.message || error.message;
        }
    }

    _mergeShellBindings(shellHtml, savedJson) {
        let saved = [];
        try {
            saved = JSON.parse(savedJson || '[]');
        } catch (error) {
            saved = [];
        }
        const savedByKey = new Map((Array.isArray(saved) ? saved : []).map(row => [
            row.bindingKey || row.placeholder,
            row
        ]));
        this.shellBindings = parseShellEditorFields(shellHtml).map(field => {
            const key = field.bindingKey || field.placeholder;
            const previous = savedByKey.get(key) || {};
            const labelOptions = field.labelOptions || [];
            const defaultLabelChoice = labelOptions.length ? labelOptions[0] : '';
            return {
                ...field,
                bindingKey: key,
                actionMode: previous.actionMode === 'intent' ? 'intent' : 'url',
                intentId: previous.intentId || '',
                actionUrl: previous.actionUrl || '',
                labelChoice: previous.labelChoice || defaultLabelChoice,
                labelCustomText: previous.labelCustomText || '',
                imageSource: previous.imageSource || 'upload',
                imageLightSource: previous.imageLightSource || 'upload',
                imageDarkSource: previous.imageDarkSource || 'upload'
            };
        });
    }

    _seedShellPreviewLabelDefaults() {
        const next = { ...(this.shellPreviewValues || {}) };
        let changed = false;
        (this.shellBindings || []).forEach(row => {
            if (row.editor !== 'action' || !row.labelPlaceholder) return;
            const key = row.labelPlaceholder;
            const defaultLabel = String(row.labelDefault || '').trim();
            if (!defaultLabel) return;
            if (next[key] == null || next[key] === '') {
                next[key] = defaultLabel;
                changed = true;
            }
        });
        if (changed) {
            this.shellPreviewValues = next;
        }
    }

    _buildImagePanels(row, bindingKey, isDualImage) {
        const panels = isDualImage
            ? [
                { mode: 'light', title: 'Light mode', source: row.imageLightSource || 'upload', placeholder: row.placeholderLight || row.placeholder },
                { mode: 'dark', title: 'Dark mode', source: row.imageDarkSource || 'upload', placeholder: row.placeholderDark || row.placeholder }
            ]
            : [{ mode: 'default', title: 'Image', source: row.imageSource || 'upload', placeholder: row.placeholder }];
        return panels.map(panel => {
            const sourceMenuItems = IMAGE_SOURCE_OPTIONS.map(option => ({
                ...option,
                checked: panel.source === option.value
            }));
            const activeSource = IMAGE_SOURCE_OPTIONS.find(option => option.value === panel.source);
            return {
                ...panel,
                key: `${bindingKey}-${panel.mode}`,
                bindingKey,
                sourceOptions: IMAGE_SOURCE_OPTIONS,
                sourceMenuItems,
                sourceMenuLabel: activeSource?.label || 'Image source',
                sourceRadioName: `image-source-${bindingKey}-${panel.mode}`,
                showUpload: panel.source === 'upload',
                showUrl: panel.source === 'url',
                showCms: panel.source === 'cms',
                urlValue: this.shellPreviewValues[panel.placeholder] || ''
            };
        });
    }

    _imagePlaceholder(row, imageMode) {
        if (imageMode === 'dark') return row.placeholderDark || row.placeholder;
        if (imageMode === 'light') return row.placeholderLight || row.placeholder;
        return row.placeholder;
    }

    async _loadCmsImages() {
        if ((this.cmsImages || []).length) return;
        try {
            this.cmsImages = await listCmsImages();
        } catch (error) {
            this.cmsImages = [];
            this._toast('Salesforce Content', error.body?.message || error.message, 'error');
        }
    }

    _shellBinding(bindingKey) {
        return (this.shellBindings || []).find(row => (row.bindingKey || row.placeholder) === bindingKey);
    }

    _updateShellBinding(bindingKey, patch) {
        if (!bindingKey) return;
        this.shellBindings = this.shellBindings.map(row => (
            (row.bindingKey || row.placeholder) === bindingKey ? { ...row, ...patch } : row
        ));
        if (patch.labelChoice != null || patch.labelCustomText != null) {
            this._syncLabelPreview(bindingKey);
        }
        this._persistShellBindings();
    }

    _syncLabelPreview(bindingKey) {
        const row = this._shellBinding(bindingKey);
        if (!row?.labelOptions?.length) return;
        const value = row.labelChoice === '__custom__'
            ? (row.labelCustomText || row.placeholder)
            : (row.labelChoice || row.placeholder);
        this._setShellPreviewValue(row.placeholder, value);
    }

    _syncActionUrlPreview(bindingKey) {
        const row = this._shellBinding(bindingKey);
        if (!row?.urlPlaceholder) return;
        const value = row.actionMode === 'intent'
            ? '#'
            : (row.actionUrl || '#');
        this._setShellPreviewValue(row.urlPlaceholder, value);
    }

    _buildShellPreviewValues() {
        const values = { ...(this.shellPreviewValues || {}) };
        (this.shellBindings || []).forEach(row => {
            if (row.labelOptions?.length) {
                values[row.placeholder] = row.labelChoice === '__custom__'
                    ? (row.labelCustomText || row.placeholder)
                    : (row.labelChoice || row.placeholder);
            }
            if (row.editor === 'action' && row.urlPlaceholder) {
                values[row.urlPlaceholder] = row.actionMode === 'intent'
                    ? '#'
                    : (row.actionUrl || values[row.urlPlaceholder] || '#');
            }
        });
        return values;
    }

    _mergeShellVariants(shellHtml) {
        const detected = parseShellVariants(shellHtml);
        const previous = this.shellVariantState || {};
        const next = {};
        detected.forEach(variant => {
            next[variant.name] = previous[variant.name] !== false;
        });
        this.shellVariants = detected;
        this.shellVariantState = next;
    }

    async _loadIntentOptions() {
        if (!this.channelId) {
            this.intentOptions = [];
            return;
        }
        try {
            const channels = await getChannelRecords();
            const channel = (channels || []).find(row => row.Id === this.channelId);
            this.intentOptions = (channel?.Channel_Banner_Intents__r || []).map(intent => ({
                label: intent.Name,
                value: intent.Id
            }));
        } catch (error) {
            this.intentOptions = [];
        }
    }

    async _persistShellBindings() {
        if (!this.draft.Id || !this.isSingleBlockTemplate) return;
        try {
            await saveShellBindings({
                templateId: this.draft.Id,
                bindingsJson: JSON.stringify(this.shellBindings)
            });
        } catch (error) {
            this._toast('Bindings', error.body?.message || error.message, 'error');
        }
    }

    _templateRecord() {
        if (!this.draft.Id) return null;
        return (this._wiredTemplates?.data || []).find(t => t.id === this.draft.Id) || null;
    }

    _savedBlockDefinitions() {
        const source = this._templateRecord();
        return (source?.components || []).filter(
            component => component.label || component.fileName || component.type
        );
    }

    _findBlockDefinition(type, fileName) {
        const defs = this._savedBlockDefinitions();
        const normalizedType = String(type || '').trim();
        const normalizedFile = String(fileName || '').trim();
        if (normalizedType) {
            const byType = defs.find(item => item.type === normalizedType);
            if (byType) return byType;
        }
        if (normalizedFile) {
            const targetKey = this._normalizeBlockFileKey(normalizedFile);
            return defs.find(item => this._normalizeBlockFileKey(item.fileName) === targetKey);
        }
        return null;
    }

    _blockPreviewKey(component) {
        if (!component) return '';
        return (component.type || component.fileName || '').trim();
    }

    _normalizeBlockFileKey(fileName) {
        const text = String(fileName || '').trim().toLowerCase();
        if (!text) return '';
        const base = text.replace(/^.*[/\\]/, '');
        return base.endsWith('.html') ? base.slice(0, -5) : base;
    }

    _previewKeysMatch(left, right) {
        if (!left || !right) return false;
        const normalizedLeft = this._normalizeBlockFileKey(left);
        const normalizedRight = this._normalizeBlockFileKey(right);
        if (normalizedLeft && normalizedLeft === normalizedRight) return true;
        return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
    }

    _blockStatusBadgeClass(status) {
        const normalized = (status || 'Draft').toLowerCase();
        if (normalized === 'active') return 'slds-badge slds-theme_success';
        if (normalized === 'ready') return 'slds-badge slds-theme_info';
        return 'slds-badge slds-badge_lightest';
    }

    _contentBlockDocumentId(fileName) {
        const ids = this._contentBlockDocumentIdsForFile(fileName);
        return ids[0] || null;
    }

    _contentBlockDocumentIdsForFile(fileName) {
        if (!fileName) return [];
        const target = fileName.toLowerCase().replace(/\.html$/i, '');
        return this.blockHtmlAssets
            .filter(item => {
                const name = (item.name || '').toLowerCase();
                const base = name.replace(/\.html$/i, '');
                return name === fileName.toLowerCase() || base === target;
            })
            .map(item => item.documentId)
            .filter(Boolean);
    }

    /** After catalog changes, drop orphaned CONTENT_BLOCK uploads (e.g. repeat uploads of the same file). */
    _contentBlockDocumentIdsToRemove(deletedFileName, catalogNowEmpty) {
        const ids = new Set();
        if (catalogNowEmpty) {
            this.blockHtmlAssets.forEach(asset => {
                if (asset.documentId) ids.add(asset.documentId);
            });
            return [...ids];
        }
        this._contentBlockDocumentIdsForFile(deletedFileName).forEach(id => ids.add(id));
        return [...ids];
    }

    _assets(assetType) {
        const source = this._templateRecord();
        if (!source) return [];
        return (source.assets || []).filter(asset => asset.assetType === assetType);
    }

    _componentCatalogRows() {
        const source = this._templateRecord();
        return (source?.components || []).map(component => ({
            type: component.type || '',
            label: component.label || '',
            description: component.description || '',
            icon: component.icon || '',
            fileName: component.fileName,
            status: component.status || 'Draft',
            placeholders: component.placeholders || [],
            blockSettings: component.blockSettings || [],
            bindings: (component.bindings || []).map(binding => ({
                placeholder: binding.placeholder,
                source: binding.source
            })),
            layout: this._parseLayoutJson(component.layoutJson)
        }));
    }

    _parseLayoutJson(layoutJson) {
        if (!layoutJson) return undefined;
        try {
            return JSON.parse(layoutJson);
        } catch (error) {
            return undefined;
        }
    }

    _resetPendingBlockDraft() {
        this.pendingBlockDraft = {
            label: '',
            description: '',
            icon: '',
            fileName: '',
            draftKey: '',
            validated: false
        };
        this.blockBindingTab = 'content';
    }

    _pendingBlockKey() {
        return this.pendingBlockDraft.fileName || this.pendingBlockDraft.draftKey;
    }

    _componentTypeToken(label, fileName) {
        const seed = String(label || fileName || 'block')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const token = seed || 'block';
        return /^[a-z]/.test(token) ? token : `block_${token}`;
    }

    async _persistBlockDefinition(status, options = {}) {
        const { silent = false } = options;
        if (!this.draft.Id) return;
        if (status === 'Draft' && this.saveBlockDefinitionDisabled) return;
        if (status !== 'Draft' && !this.pendingBlockDraft.validated && status === 'Active') return;

        const label = (this.pendingBlockDraft.label || '').trim();
        let description = (this.pendingBlockDraft.description || '').trim();
        const icon = (this.pendingBlockDraft.icon || '').trim();
        const fileName = (this.pendingBlockDraft.fileName || '').trim();
        const draftKey = this.pendingBlockDraft.draftKey
            || this._componentTypeToken(label, fileName);
        const publishable = status === 'Ready' || status === 'Active';
        if (publishable && !description) {
            description = label;
        }

        if (!silent) {
            this.isSaving = true;
        }
        try {
            const rows = this._componentCatalogRows();
            let row = rows.find(entry => entry.type === draftKey);
            if (!row && fileName) {
                row = rows.find(entry => entry.fileName === fileName);
            }
            if (row) {
                row.label = label;
                row.description = description;
                row.fileName = fileName;
                row.icon = icon || row.icon || '';
                row.status = status;
                if (!row.type) row.type = draftKey;
                if (publishable && !row.icon) row.icon = 'utility:component';
            } else {
                rows.push({
                    type: draftKey,
                    label,
                    description,
                    icon: icon || (publishable ? 'utility:component' : ''),
                    fileName,
                    status,
                    placeholders: [],
                    blockSettings: [],
                    bindings: []
                });
            }
            await saveComponentCatalog({
                templateId: this.draft.Id,
                componentsJson: JSON.stringify(rows)
            });
            await refreshApex(this._wiredTemplates);
            this.pendingBlockDraft = {
                ...this.pendingBlockDraft,
                draftKey,
                validated: status === 'Ready' || status === 'Active'
            };
            this.previewBlockKey = draftKey || fileName || this.previewBlockKey;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
            if (!silent) {
                const title = status === 'Active' ? 'Activated' : 'Saved';
                const message = status === 'Active'
                    ? 'Content block definition is active.'
                    : 'Content block definition saved as Draft.';
                this._toast(title, message, 'success');
                if (status === 'Draft') {
                    this.showNewBlockDefinitionForm = false;
                    this._resetPendingBlockDraft();
                }
            }
        } catch (error) {
            if (!silent) {
                this._toast('Error', this._apexErrorMessage(error), 'error');
            }
            throw error;
        } finally {
            if (!silent) {
                this.isSaving = false;
            }
        }
    }

    _normalizeUploadedBlockFileName(rawName) {
        const name = String(rawName || '').trim();
        return name.replace(/^\[CONTENT_BLOCK\]\s*/i, '');
    }

    _fileTiles(assetType, tileIcon) {
        return this._assets(assetType).map(asset => ({
            ...asset,
            tileIcon
        }));
    }

    _refreshStudioPreviews() {
        this.template.querySelectorAll('c-copy-template-preview-panel').forEach(panel => {
            panel.refreshPreview();
        });
    }

    async _syncDraftBlockCatalogIfNeeded() {
        if (!this.draft.Id || !this.blockHtmlAssets.length) return;
        try {
            await syncDraftBlockCatalog({ templateId: this.draft.Id });
            await refreshApex(this._wiredTemplates);
        } catch (error) {
            this._toast('Content blocks', this._apexErrorMessage(error), 'error');
        }
    }

    _apexErrorMessage(error) {
        if (Array.isArray(error?.body)) {
            return error.body.map(item => item.message).filter(Boolean).join(' ');
        }
        return error?.body?.message
            || error?.body?.pageErrors?.[0]?.message
            || error?.message
            || 'Activation failed. Check permissions and shell HTML, then try again.';
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}