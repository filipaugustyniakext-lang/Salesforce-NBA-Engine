import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelTemplates from '@salesforce/apex/ChannelTemplateController.getChannelTemplates';
import saveTemplate from '@salesforce/apex/ChannelTemplateController.saveTemplate';
import validateTemplate from '@salesforce/apex/ChannelTemplateController.validateTemplate';
import classifyUploadedFiles from '@salesforce/apex/ChannelTemplateController.classifyUploadedFiles';
import deleteTemplateAsset from '@salesforce/apex/ChannelTemplateController.deleteTemplateAsset';
import deleteTemplate from '@salesforce/apex/ChannelTemplateController.deleteTemplate';

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
    @track isModalOpen = false;
    @track isSaving = false;
    @track pendingDelete = null;

    acceptedHtml = ['.html'];
    acceptedCss = ['.css'];
    acceptedJs = ['.js'];
    acceptedJson = ['.json'];

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

    get isEditingActive() {
        return this.editTemplate.Status__c === 'Active';
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
        this.isModalOpen = true;
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

    handleManifestUpload(event) {
        this._registerUploads(event, 'MANIFEST');
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
            this._toast('Files attached', `${documentIds.length} template file(s) attached.`, 'success');
        } catch (error) {
            this._toast('Upload classification failed', error.body?.message || error.message, 'error');
        }
    }

    async handleDeleteAsset(event) {
        try {
            await deleteTemplateAsset({
                templateId: event.currentTarget.dataset.templateId,
                documentId: event.currentTarget.dataset.id
            });
            await refreshApex(this._wiredTemplates);
            this._toast('File removed', 'Template file removed.', 'success');
        } catch (error) {
            this._toast('Error', error.body?.message || error.message, 'error');
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
        this.editTemplate = EMPTY_TEMPLATE();
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
