import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelTemplates from '@salesforce/apex/ChannelTemplateController.getChannelTemplates';
import saveTemplate from '@salesforce/apex/ChannelTemplateController.saveTemplate';
import classifyUploadedFiles from '@salesforce/apex/ChannelTemplateController.classifyUploadedFiles';
import deleteTemplateAsset from '@salesforce/apex/ChannelTemplateController.deleteTemplateAsset';
import deleteTemplate from '@salesforce/apex/ChannelTemplateController.deleteTemplate';
import getShellPreviewRegions from '@salesforce/apex/ChannelTemplateController.getShellPreviewRegions';
import syncDraftBlockCatalog from '@salesforce/apex/ChannelTemplateController.syncDraftBlockCatalog';
import activateTemplatePackage from '@salesforce/apex/ChannelTemplateController.activateTemplatePackage';
import {
    COUNTRY_OPTIONS,
    CLASSIFICATION_OPTIONS,
    WIZARD_STEPS,
    composeRecordName,
    normalizeSlug
} from './templateStudioUtils';

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
    @track shellRegions = [];
    @track shellRegionError = '';

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
        return (this._wiredTemplates?.data || []).map(item => ({
            ...item,
            statusClass: item.status === 'Active'
                ? 'slds-badge template-status template-status_active'
                : item.status === 'Archived'
                    ? 'slds-badge template-status template-status_archived'
                    : 'slds-badge template-status',
            blockLabels: (item.contentBlockNames || []).length
                ? item.contentBlockNames
                : (item.components || []).map(c => c.fileName).filter(Boolean),
            hasBlocks: (item.contentBlockNames || []).length > 0
                || (item.components || []).length > 0,
            regionSummary: (item.shellPreviewRegions || []).join(', ') || 'None detected',
            validationLines: item.validationIssues || [],
            hasValidationIssues: (item.validationIssues || []).length > 0,
            variantLabel: item.messageVariantCount === 1
                ? '1 message variant'
                : `${item.messageVariantCount || 0} message variants`,
            deleteDisabled: item.deleteBlockedByMessages || item.status === 'Active',
            deleteTitle: item.deleteBlockedByMessages
                ? 'Unassign this template from all message variants before deleting.'
                : item.status === 'Active'
                    ? 'Archive the template before deleting.'
                    : 'Delete template'
        }));
    }

    get modalTitle() {
        const step = WIZARD_STEPS.find(s => s.value === this.wizardStep);
        const action = this.draft.Id ? 'Edit' : 'New';
        return `${action} ${this.channelName} template — ${step?.label || ''}`;
    }

    get hasRecordId() {
        return !!this.draft.Id;
    }

    get isBasicStep() { return this.wizardStep === 'basic'; }
    get isShellStep() { return this.wizardStep === 'shell'; }
    get isBlocksStep() { return this.wizardStep === 'blocks'; }
    get isSummaryStep() { return this.wizardStep === 'summary'; }

    get studioPanelClass() {
        return this.isShellStep
            ? 'studio-panel studio-panel--shell-columns'
            : 'studio-panel';
    }

    get navItems() {
        return WIZARD_STEPS.map(step => ({
            ...step,
            itemClass: 'studio-nav__item' + (this.wizardStep === step.value ? ' studio-nav__item_active' : ''),
            ariaCurrent: this.wizardStep === step.value ? 'step' : 'false'
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

    get summaryBlockNames() {
        const fromAssets = this.blockHtmlAssets.map(a => a.name);
        return fromAssets.length
            ? fromAssets
            : ['None — optional for shell-only templates (not required to activate).'];
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
        return 'Activate this template for Copy Center assignment.';
    }

    handleNew() {
        this.draft = EMPTY_DRAFT();
        this.wizardStep = 'basic';
        this.shellRegions = [];
        this.shellRegionError = '';
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
        this.isModalOpen = true;
        if (source.id) this._refreshShellRegions(source.id);
    }

    handleNavSelect(event) {
        const step = event.currentTarget.dataset.step;
        if (!step) return;
        this.wizardStep = step;
        if (step === 'shell' || step === 'summary') {
            this._refreshShellRegions(this.draft.Id);
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

    async handleBlockHtmlUpload(event) {
        await this._classifyUpload(event, 'CONTENT_BLOCK');
    }

    async handleBlockCssUpload(event) {
        await this._classifyUpload(event, 'SHELL_CSS');
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
            this._toast('Activation', error.body?.message || error.message, 'error');
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
            if (assetType === 'CONTENT_BLOCK') {
                await syncDraftBlockCatalog({ templateId: this.draft.Id });
            }
            await refreshApex(this._wiredTemplates);
            await this._refreshShellRegions(this.draft.Id);
            this._toast('Uploaded', 'File attached to the template definition.', 'success');
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
            this.shellRegions = await getShellPreviewRegions({ templateId }) || [];
            this.shellRegionError = this.shellRegions.length
                ? ''
                : 'No cc-preview regions found in the shell HTML yet.';
        } catch (error) {
            this.shellRegions = [];
            this.shellRegionError = error.body?.message || error.message;
        }
    }

    _assets(assetType) {
        if (!this.draft.Id) return [];
        const source = (this._wiredTemplates?.data || []).find(t => t.id === this.draft.Id);
        return (source?.assets || [])
            .filter(asset => asset.assetType === assetType)
            .map(asset => ({
                ...asset,
                deleteDisabled: source?.status === 'Active'
            }));
    }

    _fileTiles(assetType, tileIcon) {
        return this._assets(assetType).map(asset => ({
            ...asset,
            tileIcon
        }));
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
