import { LightningElement, api } from 'lwc';
import listCmsImages from '@salesforce/apex/ChannelTemplateController.listCmsImages';
import contentVersionDownloadUrl from '@salesforce/apex/ChannelTemplateController.contentVersionDownloadUrl';

const SOURCE_OPTIONS = [
    { label: 'URL', value: 'url' },
    { label: 'File upload', value: 'upload' },
    { label: 'Salesforce CMS / Files', value: 'cms' }
];

export default class CcImageSourceInput extends LightningElement {
    @api label = 'Image';
    @api required = false;
    @api disabled = false;
    sourceOptions = SOURCE_OPTIONS;
    cmsOptions = [];
    cmsLoading = false;
    errorMessage;
    _value = { source: 'url', url: null, contentId: null };

    @api
    get value() {
        return this._value;
    }
    set value(next) {
        this._value = { source: 'url', url: null, contentId: null, ...(next || {}) };
        if (this._value.source === 'cms') this.loadCms();
    }

    get source() {
        return this._value.source || 'url';
    }

    get isUrl() {
        return this.source === 'url';
    }

    get isUpload() {
        return this.source === 'upload';
    }

    get isCms() {
        return this.source === 'cms';
    }

    get url() {
        return this._value.url || '';
    }

    get hasPreview() {
        return !!this._value.url;
    }

    get acceptedFormats() {
        return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    }

    handleSource(event) {
        this.emit({ ...this._value, source: event.detail.value });
        if (event.detail.value === 'cms') this.loadCms();
    }

    handleUrl(event) {
        this.emit({ ...this._value, url: (event.target.value || '').trim() || null, contentId: null });
    }

    handleCms(event) {
        const option = this.cmsOptions.find(item => item.value === event.detail.value);
        this.emit({ ...this._value, contentId: event.detail.value, url: option?.url || null });
    }

    async handleUpload(event) {
        const file = (event.detail.files || [])[0];
        if (!file) return;
        this.errorMessage = null;
        try {
            const url = await contentVersionDownloadUrl({ contentDocumentId: file.documentId });
            this.emit({ ...this._value, source: 'upload', url, contentId: file.documentId });
        } catch (error) {
            this.errorMessage = error?.body?.message || 'The uploaded image could not be read.';
        }
    }

    handleClear() {
        this.emit({ ...this._value, url: null, contentId: null });
    }

    async loadCms() {
        if (this.cmsOptions.length || this.cmsLoading) return;
        this.cmsLoading = true;
        try {
            const images = await listCmsImages();
            this.cmsOptions = (images || []).map(image => ({ label: image.title, value: image.id, url: image.url }));
        } catch (error) {
            this.errorMessage = error?.body?.message || 'Images could not be loaded.';
        } finally {
            this.cmsLoading = false;
        }
    }

    emit(next) {
        this._value = next;
        this.dispatchEvent(new CustomEvent('change', { detail: { value: next } }));
    }
}
