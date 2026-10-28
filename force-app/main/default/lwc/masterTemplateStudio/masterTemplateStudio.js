import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelTemplates from '@salesforce/apex/ChannelTemplateController.getChannelTemplates';
import saveTemplate from '@salesforce/apex/ChannelTemplateController.saveTemplate';
import classifyUploadedFiles from '@salesforce/apex/ChannelTemplateController.classifyUploadedFiles';
import deleteTemplateAsset from '@salesforce/apex/ChannelTemplateController.deleteTemplateAsset';
import deleteTemplate from '@salesforce/apex/ChannelTemplateController.deleteTemplate';
import getTemplateRenderSource from '@salesforce/apex/ChannelTemplateController.getTemplateRenderSource';
import { scanCcPreviewRegionLabelsInOrder } from 'c/copyTemplatePreview';
import syncDraftBlockCatalog from '@salesforce/apex/ChannelTemplateController.syncDraftBlockCatalog';
import saveComponentCatalog from '@salesforce/apex/ChannelTemplateController.saveComponentCatalog';
import validateContentBlockDefinition from '@salesforce/apex/ChannelTemplateController.validateContentBlockDefinition';
import activateTemplatePackage from '@salesforce/apex/ChannelTemplateController.activateTemplatePackage';
import getContentBlockPlaceholders from '@salesforce/apex/ChannelTemplateController.getContentBlockPlaceholders';
import {
    parseBlockTemplate,
    alignLayout,
    layoutBindings,
    STRUCTURAL_PLACEHOLDERS
} from 'c/contentBindingModel';
import {
    COUNTRY_OPTIONS,
    CLASSIFICATION_OPTIONS,
    WIZARD_STEPS,
    composeRecordName,
    normalizeSlug,
    CONTENT_BINDING_SOURCE_OPTIONS,
    LEGACY_BLOCK_SETTING_OPTIONS,
    isContentPlaceholder,
    suggestContentBindingSource,
    mergeBindingRows,
    isContentBindingSource
} from './templateStudioUtils';

const VALID_BLOCK_ICON = /^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$/;

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
    @track showNewBlockDefinitionForm = false;
    @track pendingBlockDraft = {
        label: '',
        description: '',
        icon: '',
        fileName: '',
        draftKey: '',
        validated: false,
        blockHtml: '',
        bindings: [],
        layout: null,
        legacyBlockSettings: []
    };
    @track blockBindingTab = 'content';
    /** Catalog type or uploaded file name — drives single-block preview on Content Blocks step. */
    @track previewBlockKey = '';
    acceptedHtml = ['.html'];
    acceptedCss = ['.css'];

    countryOptions = COUNTRY_OPTIONS;
    classificationOptions = CLASSIFICATION_OPTIONS;
    wizardSteps = WIZARD_STEPS;
    contentBindingSourceOptions = CONTENT_BINDING_SOURCE_OPTIONS;

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

    get blockHasHtml() {
        return !!String(this.pendingBlockDraft.blockHtml || '').trim();
    }

    get blockBindingScan() {
        return parseBlockTemplate(this.pendingBlockDraft.blockHtml || '');
    }

    get blockUsesModernLayout() {
        return !!this.blockBindingScan?.usesLayout;
    }

    get blockDetectedBindingBadges() {
        const scan = this.blockBindingScan;
        const boundPlaceholders = this._boundPlaceholderNames();
        const badgeLight = 'slds-badge slds-badge_lightest';
        const badgeSuccess = 'slds-badge slds-theme_success';
        const badges = [];
        if (this.blockHasHtml) {
            badges.push({
                key: 'container',
                label: scan.hasContainer ? 'binding-container found' : 'No binding-container',
                badgeClass: scan.hasContainer ? badgeSuccess : badgeLight
            });
            badges.push({
                key: 'columns',
                label: scan.columns?.length
                    ? `${scan.columns.length} binding-column region(s)`
                    : 'No binding-column markers',
                badgeClass: (scan.columns?.length || 0) > 0 ? badgeSuccess : badgeLight
            });
        }
        const placeholders = this._placeholdersInBlockHtml();
        placeholders.filter(name => STRUCTURAL_PLACEHOLDERS.includes(name)).forEach(name => {
            badges.push({
                key: `struct-${name}`,
                label: `{{${name}}}`,
                badgeClass: boundPlaceholders.has(name) ? badgeSuccess : badgeLight
            });
        });
        placeholders.filter(name => isContentPlaceholder(name, STRUCTURAL_PLACEHOLDERS)).forEach(name => {
            badges.push({
                key: `content-${name}`,
                label: `{{${name}}} (content)`,
                badgeClass: boundPlaceholders.has(name) ? badgeSuccess : badgeLight
            });
        });
        if (this.blockHasHtml && !placeholders.length) {
            badges.push({ key: 'none', label: 'No {{placeholders}} detected', badgeClass: badgeLight });
        }
        return badges;
    }

    get blockContentBindingRows() {
        const placeholders = this._placeholdersInBlockHtml().filter(name =>
            isContentPlaceholder(name, STRUCTURAL_PLACEHOLDERS)
        );
        const bindingByPlaceholder = new Map(
            (this.pendingBlockDraft.bindings || [])
                .filter(row => isContentBindingSource(row.source))
                .map(row => [row.placeholder, row.source])
        );
        return placeholders.map(placeholder => ({
            key: placeholder,
            placeholder,
            placeholderLabel: `{{${placeholder}}}`,
            source: bindingByPlaceholder.get(placeholder) || '',
            unbound: !bindingByPlaceholder.get(placeholder)
        }));
    }

    get blockContentBindingsEmpty() {
        return this.blockHasHtml && this.blockContentBindingRows.length === 0;
    }

    get blockLayoutFlagRows() {
        const scan = this.blockBindingScan;
        const layout = alignLayout(this.pendingBlockDraft.layout, scan);
        const rows = [];
        const blockFlags = [
            ['hideDesktop', 'Allow hide on desktop', scan.block?.hideDesktop],
            ['hideMobile', 'Allow hide on mobile', scan.block?.hideMobile],
            ['padding', 'Allow block padding', scan.block?.padDesktop || scan.block?.padMobile],
            ['backgroundColor', 'Allow block background color', scan.block?.bgColor],
            ['backgroundImage', 'Allow block background image', scan.block?.bgImage],
            ['backgroundGradient', 'Allow block background gradient', scan.block?.bgGradient],
            ['columnDirection', 'Allow column direction (LTR / RTL)', scan.columnDirection]
        ];
        blockFlags.forEach(([flag, label, present]) => {
            if (!present) return;
            rows.push({
                key: `block-${flag}`,
                flag,
                columnIndex: null,
                label,
                checked: !!layout[flag]
            });
        });
        (scan.columns || []).forEach((column, index) => {
            const options = layout.columns[index] || {};
            const columnFlags = [
                ['padding', `Column ${index + 1}: padding`, column.padDesktop || column.padMobile],
                ['backgroundColor', `Column ${index + 1}: background color`, column.bgColor],
                ['backgroundImage', `Column ${index + 1}: background image`, column.bgImage],
                ['backgroundGradient', `Column ${index + 1}: background gradient`, column.bgGradient]
            ];
            columnFlags.forEach(([flag, label, present]) => {
                if (!present) return;
                rows.push({
                    key: `col-${index}-${flag}`,
                    flag,
                    columnIndex: index,
                    label,
                    checked: !!options[flag]
                });
            });
        });
        return rows;
    }

    get blockShowLayoutColors() {
        const layout = alignLayout(this.pendingBlockDraft.layout, this.blockBindingScan);
        return !!layout.backgroundColor && !!this.blockBindingScan.block?.bgColor;
    }

    get blockLayoutBackgroundColors() {
        const layout = alignLayout(this.pendingBlockDraft.layout, this.blockBindingScan);
        return (layout.backgroundColors || []).join('\n');
    }

    get blockShowLayoutGradient() {
        const layout = alignLayout(this.pendingBlockDraft.layout, this.blockBindingScan);
        return !!layout.backgroundGradient && !!this.blockBindingScan.block?.bgGradient;
    }

    get blockLayoutGradientCss() {
        const layout = alignLayout(this.pendingBlockDraft.layout, this.blockBindingScan);
        const preset = (layout.gradients || [])[0];
        return preset?.css || '';
    }

    get blockLayoutGradientLabel() {
        const layout = alignLayout(this.pendingBlockDraft.layout, this.blockBindingScan);
        const preset = (layout.gradients || [])[0];
        return preset?.label || 'Block gradient';
    }

    get legacyBlockSettingRows() {
        const enabled = new Set(this.pendingBlockDraft.legacyBlockSettings || []);
        return LEGACY_BLOCK_SETTING_OPTIONS.map(option => ({
            key: option.value,
            value: option.value,
            label: option.label,
            checked: enabled.has(option.value)
        }));
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

    get navItems() {
        const definedBlockCount = this._savedBlockDefinitions().length;
        const activeBlockCount = this._savedBlockDefinitions().filter(
            component => (component.status || '').toLowerCase() === 'active'
        ).length;
        return WIZARD_STEPS.map(step => ({
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

    get pendingBlockFileTiles() {
        const fileName = (this.pendingBlockDraft.fileName || '').trim();
        if (!fileName) return [];
        const targetKey = this._normalizeBlockFileKey(fileName);
        const tile = this.blockHtmlFileTiles.find(
            asset => this._normalizeBlockFileKey(asset.name) === targetKey
        );
        if (tile) return [tile];
        return [{
            documentId: '',
            name: fileName,
            tileIcon: 'doctype:html',
            downloadUrl: '',
            deleteDisabled: true
        }];
    }

    get hasPendingBlockFile() {
        return this.pendingBlockFileTiles.length > 0;
    }

    get blockDefinitionUploadLabel() {
        return this.hasPendingBlockFile ? 'Replace content block HTML' : 'Upload content block HTML';
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
        if (!step) return;
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
            this.wizardStep = 'blocks';
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
        const index = WIZARD_STEPS.findIndex(s => s.value === this.wizardStep);
        if (index > 0) this.wizardStep = WIZARD_STEPS[index - 1].value;
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
        this._refreshStudioPreviews();
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
            validated: status === 'Ready' || status === 'Active',
            blockHtml: '',
            bindings: (component.bindings || []).map(binding => ({
                placeholder: binding.placeholder,
                source: binding.source
            })),
            layout: this._parseLayoutJson(component.layoutJson),
            legacyBlockSettings: [...(component.blockSettings || [])]
        };
        this.showNewBlockDefinitionForm = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        Promise.resolve(this._refreshPendingBlockHtml()).then(() => {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
        });
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
            await this._refreshPendingBlockHtml({ suggestBindings: true });
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => this._refreshStudioPreviews());
        }
    }

    handleContentBindingChange(event) {
        const placeholder = event.currentTarget.dataset.placeholder;
        const source = event.detail?.value || '';
        if (!placeholder) return;
        const others = (this.pendingBlockDraft.bindings || []).filter(
            row => row.placeholder !== placeholder
        );
        const bindings = source
            ? [...others, { placeholder, source }]
            : others;
        this.pendingBlockDraft = { ...this.pendingBlockDraft, bindings, validated: false };
    }

    handleLayoutFlagChange(event) {
        const flag = event.currentTarget.dataset.flag;
        const columnIndexRaw = event.currentTarget.dataset.columnIndex;
        const checked = !!event.target.checked;
        if (!flag) return;
        const scan = this.blockBindingScan;
        const layout = alignLayout(this.pendingBlockDraft.layout, scan);
        if (
            columnIndexRaw === undefined
            || columnIndexRaw === ''
            || columnIndexRaw === 'null'
        ) {
            layout[flag] = checked;
        } else {
            const columnIndex = Number(columnIndexRaw);
            if (!Array.isArray(layout.columns)) layout.columns = [];
            while (layout.columns.length <= columnIndex) {
                layout.columns.push({});
            }
            layout.columns[columnIndex] = {
                ...(layout.columns[columnIndex] || {}),
                [flag]: checked
            };
        }
        this.pendingBlockDraft = { ...this.pendingBlockDraft, layout, validated: false };
    }

    handleLayoutColorsChange(event) {
        const scan = this.blockBindingScan;
        const layout = alignLayout(this.pendingBlockDraft.layout, scan);
        const colors = String(event.detail?.value ?? event.target?.value ?? '')
            .split(/[\s,]+/)
            .map(value => value.trim())
            .filter(value => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value));
        layout.backgroundColors = colors;
        this.pendingBlockDraft = { ...this.pendingBlockDraft, layout, validated: false };
    }

    handleLayoutGradientChange(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.detail?.value ?? event.target?.value ?? '';
        const scan = this.blockBindingScan;
        const layout = alignLayout(this.pendingBlockDraft.layout, scan);
        const preset = (layout.gradients || [])[0] || {
            id: 'gradient-1',
            label: 'Block gradient',
            css: ''
        };
        if (field === 'label') preset.label = value;
        else preset.css = value;
        layout.gradients = [preset];
        this.pendingBlockDraft = { ...this.pendingBlockDraft, layout, validated: false };
    }

    handleLegacyBlockSettingChange(event) {
        const value = event.currentTarget.dataset.value;
        const checked = !!event.target.checked;
        if (!value) return;
        const settings = new Set(this.pendingBlockDraft.legacyBlockSettings || []);
        if (checked) settings.add(value);
        else settings.delete(value);
        this.pendingBlockDraft = {
            ...this.pendingBlockDraft,
            legacyBlockSettings: [...settings],
            validated: false
        };
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
            return;
        }
        try {
            const source = await getTemplateRenderSource({ templateId });
            this.shellRegions = scanCcPreviewRegionLabelsInOrder(source?.shellHtml || '');
            this.shellRegionError = this.shellRegions.length
                ? ''
                : 'No cc-preview regions found in the shell HTML yet.';
        } catch (error) {
            this.shellRegions = [];
            this.shellRegionError = error.body?.message || error.message;
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
            validated: false,
            blockHtml: '',
            bindings: [],
            layout: null,
            legacyBlockSettings: []
        };
        this.blockBindingTab = 'content';
    }

    _boundPlaceholderNames() {
        const scan = this.blockBindingScan;
        if (!this.blockHasHtml) return new Set();
        const layout = alignLayout(this.pendingBlockDraft.layout, scan);
        const contentBindings = (this.pendingBlockDraft.bindings || []).filter(
            row => row.placeholder && row.source && isContentBindingSource(row.source)
        );
        const merged = mergeBindingRows(contentBindings, layoutBindings(layout, scan));
        return new Set(merged.map(row => row.placeholder));
    }

    _placeholdersInBlockHtml() {
        const names = [];
        const pattern = /\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g;
        const html = String(this.pendingBlockDraft.blockHtml || '');
        let match = pattern.exec(html);
        while (match) {
            if (!names.includes(match[1])) names.push(match[1]);
            match = pattern.exec(html);
        }
        return names;
    }

    async _refreshPendingBlockHtml(options = {}) {
        const { suggestBindings = false } = options;
        const fileName = (this.pendingBlockDraft.fileName || '').trim();
        if (!this.draft.Id || !fileName) {
            this.pendingBlockDraft = { ...this.pendingBlockDraft, blockHtml: '' };
            return;
        }
        try {
            const scans = await getContentBlockPlaceholders({ templateId: this.draft.Id });
            const targetKey = this._normalizeBlockFileKey(fileName);
            const match = (scans || []).find(item =>
                this._normalizeBlockFileKey(item.fileName) === targetKey
            );
            const blockHtml = match?.htmlBody || '';
            let bindings = [...(this.pendingBlockDraft.bindings || [])];
            if (suggestBindings && blockHtml) {
                const placeholders = (match?.placeholders || []).filter(name =>
                    isContentPlaceholder(name, STRUCTURAL_PLACEHOLDERS)
                );
                const structuralBindings = bindings.filter(row => !isContentBindingSource(row.source));
                const contentByPlaceholder = new Map(
                    bindings
                        .filter(row => isContentBindingSource(row.source))
                        .map(row => [row.placeholder, row])
                );
                placeholders.forEach(placeholder => {
                    if (contentByPlaceholder.has(placeholder) && contentByPlaceholder.get(placeholder).source) {
                        return;
                    }
                    const source = suggestContentBindingSource(placeholder);
                    if (source) contentByPlaceholder.set(placeholder, { placeholder, source });
                });
                bindings = [
                    ...structuralBindings,
                    ...contentByPlaceholder.values()
                ];
            }
            const scan = parseBlockTemplate(blockHtml);
            const layout = this.pendingBlockDraft.layout
                ? alignLayout(this.pendingBlockDraft.layout, scan)
                : alignLayout(null, scan);
            this.pendingBlockDraft = {
                ...this.pendingBlockDraft,
                blockHtml,
                bindings,
                layout
            };
        } catch (error) {
            this._toast('Content block scan', this._apexErrorMessage(error), 'error');
        }
    }

    _catalogBindingsForSave() {
        const html = this.pendingBlockDraft.blockHtml || '';
        const scan = parseBlockTemplate(html);
        const layout = alignLayout(this.pendingBlockDraft.layout, scan);
        const contentBindings = (this.pendingBlockDraft.bindings || []).filter(
            row => row.placeholder && row.source && isContentBindingSource(row.source)
        );
        const layoutBindingRows = layoutBindings(layout, scan);
        return mergeBindingRows(contentBindings, layoutBindingRows);
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
            const bindings = this._catalogBindingsForSave();
            const layout = alignLayout(this.pendingBlockDraft.layout, parseBlockTemplate(this.pendingBlockDraft.blockHtml || ''));
            const blockSettings = this.blockUsesModernLayout
                ? []
                : [...(this.pendingBlockDraft.legacyBlockSettings || [])];
            if (row) {
                row.label = label;
                row.description = description;
                row.fileName = fileName;
                row.icon = icon || row.icon || '';
                row.status = status;
                row.bindings = bindings;
                row.layout = layout;
                row.blockSettings = blockSettings;
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
                    blockSettings,
                    bindings,
                    layout
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