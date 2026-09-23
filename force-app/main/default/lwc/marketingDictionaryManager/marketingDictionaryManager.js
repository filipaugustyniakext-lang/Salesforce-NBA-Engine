import { LightningElement, track, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDictionaryRecords from '@salesforce/apex/MarketingDictionaryController.getDictionaryRecords';
import getDictionaryRecordTypes from '@salesforce/apex/MarketingDictionaryController.getDictionaryRecordTypes';

export default class MarketingDictionaryManager extends NavigationMixin(LightningElement) {
    @track isLoading = false;
    @track selectedCategory = ''; 
    @track selectedRecordTypeId = '';
    @track records = [];
    @track searchQuery = '';

    recordTypesMap = {};

    @track isFormModalOpen = false;
    @track selectedRecordId = ''; 

    @api 
    get recordTypeId() {
        return this._recordTypeId;
    }
    set recordTypeId(value) {
        this._recordTypeId = value;
        this.processIncomingRecordType();
    }
    _recordTypeId;

    connectedCallback() {
        this.fetchRecordTypeIds();
    }

    fetchRecordTypeIds() {
        this.isLoading = true;
        getDictionaryRecordTypes()
            .then(data => {
                this.recordTypesMap = data;
                this.isLoading = false;
                this.processIncomingRecordType(); 
            })
            .catch(error => {
                this.isLoading = false;
                console.error('Error fetching record types metadata: ', error);
            });
    }

    // FIXED: Performs a safe 15-character match to prevent 15 vs 18 character comparison failures
    processIncomingRecordType() {
        if (this._recordTypeId && Object.keys(this.recordTypesMap).length > 0) {
            let matchedCategory = '';
            const incomingId15 = this._recordTypeId.substring(0, 15);
            
            console.log('LWC processing ID:', incomingId15);
            console.log('LWC available Record Types:', JSON.stringify(this.recordTypesMap));

            for (const [developerName, rtId] of Object.entries(this.recordTypesMap)) {
                if (rtId && rtId.substring(0, 15) === incomingId15) {
                    if (developerName === 'Channel') matchedCategory = 'channel';
                    else if (developerName === 'Sales_Process_Type') matchedCategory = 'salesprocess';
                    else if (developerName === 'Topic_Goal') matchedCategory = 'topic';
                    break;
                }
            }
            
            if (matchedCategory) {
                this.selectedCategory = matchedCategory;
                this.selectedRecordTypeId = this._recordTypeId;
                this.loadDictionaryRecords();
            } else {
                console.warn('No category matched the incoming Record Type ID:', this._recordTypeId);
            }
        }
    }

    get isChannelSelected() { return this.selectedCategory === 'channel'; }
    get isSalesProcessSelected() { return this.selectedCategory === 'salesprocess'; }
    get isTopicSelected() { return this.selectedCategory === 'topic'; }

    get workspaceTitle() {
        if (this.isChannelSelected) return 'Channels';
        if (this.isSalesProcessSelected) return 'Sales Process Type';
        if (this.isTopicSelected) return 'Topic (Goal)';
        return 'Marketing Dictionary';
    }

    get searchPlaceholder() {
        return `Search ${this.workspaceTitle} values...`;
    }

    get formModalTitle() {
        const action = this.selectedRecordId ? 'Edit' : 'Add New';
        let label = '';
        if (this.isChannelSelected) label = 'Channel Value';
        else if (this.isSalesProcessSelected) label = 'Sales Process Value';
        else if (this.isTopicSelected) label = 'Topic Goal Value';
        return `${action} ${label}`;
    }

    loadDictionaryRecords() {
        this.isLoading = true;
        let rtName = '';
        if (this.selectedCategory === 'channel') rtName = 'Channel';
        else if (this.selectedCategory === 'salesprocess') rtName = 'Sales_Process_Type';
        else if (this.selectedCategory === 'topic') rtName = 'Topic_Goal';

        getDictionaryRecords({ recordTypeDeveloperName: rtName })
            .then(data => {
                this.records = data;
                this.isLoading = false;
            })
            .catch(error => {
                this.isLoading = false;
                this.showToast('System Error', 'Error reading dictionary data.', 'error');
                console.error(error);
            });
    }

    handleSearchFilter(event) {
        this.searchQuery = event.target.value.toLowerCase();
    }

    get filteredRecords() {
        if (!this.searchQuery) return this.records;
        return this.records.filter(row => {
            const nameMatch = row.Name ? row.Name.toLowerCase().includes(this.searchQuery) : false;
            const channelMatch = row.Channels__c ? row.Channels__c.toLowerCase().includes(this.searchQuery) : false;
            const salesMatch = row.Sales_Process_Type__c ? row.Sales_Process_Type__c.toLowerCase().includes(this.searchQuery) : false;
            const topicGoalMatch = row.Topic_Goal__c ? row.Topic_Goal__c.toLowerCase().includes(this.searchQuery) : false;
            const topicGroupMatch = row.Topic_Group__c ? row.Topic_Group__c.toLowerCase().includes(this.searchQuery) : false;
            
            return nameMatch || channelMatch || salesMatch || topicGoalMatch || topicGroupMatch;
        });
    }

    handleOpenCreateForm() {
        this.selectedRecordId = ''; 
        this.isFormModalOpen = true;
    }

    handleOpenEditForm(event) {
        this.selectedRecordId = event.currentTarget.dataset.id;
        this.isFormModalOpen = true;
    }

    handleCloseFormModal() {
        this.isFormModalOpen = false;
        this.selectedRecordId = '';
    }

    handleSaveForm() {
        const formSubmit = this.template.querySelector('.submit-btn-ref');
        if (formSubmit) {
            formSubmit.click();
        }
    }

    handleFormSuccess() {
        this.isFormModalOpen = false;
        this.showToast('Success!', 'The dictionary entry was saved successfully.', 'success');
        this.loadDictionaryRecords(); 
    }

    handleFormError(event) {
        this.showToast('Validation Error', event.detail.message, 'error');
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}