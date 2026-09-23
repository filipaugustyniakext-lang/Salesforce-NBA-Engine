import { LightningElement, track, wire } from 'lwc';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import MARKETING_DICTIONARY_OBJECT from '@salesforce/schema/Marketing_Dictionary__c';

export default class CreateMarketingDictionaryModal extends LightningElement {
    @track selectedRecordTypeName = '';
    @track selectedRecordTypeId = '';
    @track isLoading = false;
    
    recordTypeMap = {};

    // Wire metadata lifecycle engine to extract Record Type IDs dynamically from schema
    @wire(getObjectInfo, { objectApiName: MARKETING_DICTIONARY_OBJECT })
    wiredObjectInfo({ error, data }) {
        if (data) {
            const rtInfos = data.recordTypeInfos;
            this.recordTypeMap = {};
            Object.keys(rtInfos).forEach(key => {
                const rt = rtInfos[key];
                this.recordTypeMap[rt.developerName] = rt.recordTypeId;
            });
        } else if (error) {
            console.error('Schema metadata fetch exception:', error);
        }
    }

    // Interactive button deck configuration mapping selection states
    get recordTypeOptions() {
        return [
            { label: 'Channels', value: 'Channels', icon: 'utility:cell_phone' },
            { label: 'Sales Process', value: 'SalesProcess', icon: 'utility:process' },
            { label: 'Topics', value: 'Topics', icon: 'utility:topic' }
        ].map(item => ({
            ...item,
            className: `rt-selector-pill ${this.selectedRecordTypeName === item.value ? 'pill-selected' : ''}`
        }));
    }

    // --- EVALUATION GETTERS ---
    get isChannels() { return this.selectedRecordTypeName === 'Channels'; }
    get isSalesProcess() { return this.selectedRecordTypeName === 'SalesProcess'; }
    get isTopics() { return this.selectedRecordTypeName === 'Topics'; }
    get isSaveDisabled() { return !this.selectedRecordTypeName; }

    // --- ACTION HANDLERS ---
    handleRecordTypeChange(event) {
        this.selectedRecordTypeName = event.currentTarget.dataset.value;
        this.selectedRecordTypeId = this.recordTypeMap[this.selectedRecordTypeName] || '';
        
        if (!this.selectedRecordTypeId) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Security / Profile Exception',
                message: `The Record Type "${this.selectedRecordTypeName}" is not assigned or active for your profile layout mapping.`,
                variant: 'warning'
            }));
        }
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleFormSubmitTrigger() {
        const triggerBtn = this.template.querySelector('.submit-hidden-trigger');
        if (triggerBtn) {
            triggerBtn.click();
        }
    }

    handleSubmit() {
        this.isLoading = true;
    }

    handleSuccess(event) {
        this.isLoading = false;
        this.dispatchEvent(new ShowToastEvent({
            title: 'Record Created',
            message: 'Marketing Dictionary catalog entry committed successfully.',
            variant: 'success'
        }));
        
        // Pass details back up to Aura component action override for safe list view routing
        this.dispatchEvent(new CustomEvent('success', { detail: { recordId: event.detail.id } }));
        this.handleCancel();
    }

    handleFormError() {
        this.isLoading = false;
    }
}