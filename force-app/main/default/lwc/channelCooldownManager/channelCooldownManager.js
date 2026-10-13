import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { deleteRecord } from 'lightning/uiRecordApi';

// Active Backend Apex Operation Endpoint Mappings
import upsertChannelSettings from '@salesforce/apex/CommunicationCooldownController.upsertChannelSettings';
import getAllCooldownRecords from '@salesforce/apex/CommunicationCooldownController.getAllCooldownRecords';

export default class ChannelCooldownManager extends LightningElement {
    // Dynamic Reactive Component Track Hooks Data Triggers
    @track masterTableData = [];
    @track filteredData = [];
    @track searchFilterKey = '';
    @track isLoading = false;
    
    // Modal Interaction State Management
    @track isModalOpen = false;
    @track isEditMode = false;
    @track currentRecordId = null;
    
    // Controlled Symmetrical Form Binding Fields Data Model 
    @track formCategory = 'Channel';
    @track formNameValue = '';
    @track formAudience = 'Contact';
    @track formDays = 0;
    @track formIsActive = true;

    // Move columns inside a getter to cleanly pass the dynamic row actions function
    get tableColumns() {
        return [
            { label: 'Cooldown Category', fieldName: 'Cooldown_Category__c', type: 'text', sortable: true },
            { label: 'Name', fieldName: 'Name__c', type: 'text', sortable: true },
            { label: 'Audience Type', fieldName: 'Audience_Type__c', type: 'text', sortable: true },
            { label: 'Cooldown Period (Days)', fieldName: 'Cooldown_Days__c', type: 'number', cellAttributes: { alignment: 'left' } },
            { label: 'Rule Status', fieldName: 'StatusLabelText__c', type: 'text', sortable: true }, 
            { label: 'Last Modified Date', fieldName: 'LastModifiedDate', type: 'date', typeAttributes: { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' } },
            { label: 'Modified By', fieldName: 'LastModifiedByName', type: 'text' },
            { 
                type: 'action', 
                typeAttributes: { 
                    rowActions: this.determineRowActions.bind(this), 
                    menuAlignment: 'right' 
                } 
            }
        ];
    }

    // Dynamic Row Action Handler: Flips the label based on row status
    determineRowActions(row, doneCallback) {
        const actions = [
            { label: 'Edit', name: 'edit', iconName: 'utility:edit' }
        ];

        // If active, show Deactivate. If inactive, show Activate.
        if (row.IsActive__c) {
            actions.push({ label: 'Deactivate', name: 'toggle_status', iconName: 'utility:choice' });
        } else {
            actions.push({ label: 'Activate', name: 'toggle_status', iconName: 'utility:choice' });
        }

        actions.push({ label: 'Delete', name: 'delete', iconName: 'utility:delete' });
        
        doneCallback(actions);
    }

    get categoryOptions() {
        return [
            { label: 'Channel', value: 'Channel' },
            { label: 'Product Category', value: 'ProductCategory' },
            { label: 'Product', value: 'Product' }
        ];
    }

    get audienceOptions() {
        return [
            { label: 'Contact', value: 'Contact' },
            { label: 'Prospect', value: 'Prospect' }
        ];
    }

    get modalTitle() {
        return this.isEditMode ? 'Modify Communication Cooldown Settings' : 'Create New Communication Cooldown Rule';
    }

    // Component Lifecycle Initialization Context Event
    connectedCallback() {
        this.fetchMasterMatrixData();
    }

    // Imperial Backend Data Pull Engine Operation Handler
    async fetchMasterMatrixData() {
        this.isLoading = true;
        try {
            const result = await getAllCooldownRecords();
            
            this.masterTableData = result.map(row => {
                // Defensively read data parameters regardless of what case style Apex sent them back in
                const rawCategory = row.Cooldown_Category__c || row.cooldownCategory || '';
                const rawNameValue = row.Name__c || row.nameValue || row.Name || '';
                const rawAudience = row.Audience_Type__c || row.audienceType || '';
                const rawDays = row.Cooldown_Days__c !== undefined ? row.Cooldown_Days__c : row.cooldownDays;
                const rawIsActive = row.IsActive__c !== undefined ? row.IsActive__c : row.isActive;

                return {
                    ...row,
                    Cooldown_Category__c: rawCategory === 'ProductCategory' ? 'Product Category' : rawCategory,
                    Name__c: rawNameValue,
                    Audience_Type__c: rawAudience,
                    Cooldown_Days__c: rawDays,
                    IsActive__c: rawIsActive,
                    LastModifiedByName: row.LastModifiedBy ? row.LastModifiedBy.Name : '',
                    StatusLabelText__c: rawIsActive ? 'Active' : 'Inactive'
                };
            });
            
            this.applyDataFiltering();
        } catch (error) {
            this.showNotification('System Error', 'Error retrieving data index array: ' + (error.body?.message || error.message), 'error');
        } finally {
            this.isLoading = false;
        }
    }

    // Real-Time Search Filtering Query Resolution Evaluation Engine
    handleSearchChange(event) {
        this.searchFilterKey = event.target.value.toLowerCase().trim();
        this.applyDataFiltering();
    }

    applyDataFiltering() {
        if (!this.searchFilterKey) {
            this.filteredData = [...this.masterTableData];
        } else {
            this.filteredData = this.masterTableData.filter(row => {
                const categoryMatch = row.Cooldown_Category__c ? row.Cooldown_Category__c.toLowerCase().includes(this.searchFilterKey) : false;
                const nameMatch = row.Name__c ? row.Name__c.toLowerCase().includes(this.searchFilterKey) : false;
                const audienceMatch = row.Audience_Type__c ? row.Audience_Type__c.toLowerCase().includes(this.searchFilterKey) : false;
                
                return categoryMatch || nameMatch || audienceMatch;
            });
        }
    }

    // Control Form Workspace Opening / Variable Flushes
    openCreationModal() {
        this.isEditMode = false;
        this.currentRecordId = null;
        this.formCategory = 'Channel';
        this.formNameValue = '';
        this.formAudience = 'Contact';
        this.formDays = 0;
        this.formIsActive = true;
        this.isModalOpen = true;
    }

    closeCreationModal() {
        this.isModalOpen = false;
    }

    // Component Real-Time UI Element Tracker Inputs Changes
    handleFormCategoryChange(event) { this.formCategory = event.target.value; }
    handleFormNameChange(event) { this.formNameValue = event.target.value; }
    handleFormAudienceChange(event) { this.formAudience = event.target.value; }
    handleFormDaysChange(event) { this.formDays = event.target.value; }
    handleFormActiveChange(event) { this.formIsActive = event.target.checked; }

    // Sequential Validation Strategy Form and Duplicate Pre-Existence Interceptor Entry Point
    async handleFormSave() {
        const allValid = [...this.template.querySelectorAll('.modal-input')].reduce((validSoFar, inputCmp) => {
            inputCmp.reportValidity();
            return validSoFar && inputCmp.checkValidity();
        }, true);
        
        if (!allValid) return;

        const parsedDays = parseInt(this.formDays, 10);
        if (isNaN(parsedDays) || parsedDays < 0) {
            this.showNotification('Validation Error', 'Cooldown period must be a positive integer value.', 'error');
            return;
        }

        if (!this.isEditMode) {
            const hasDuplicateCombination = this.masterTableData.some(row => {
                const dbCategory = (row.Cooldown_Category__c || '').toLowerCase().replace(/\s+/g, '');
                const uiCategory = (this.formCategory || '').toLowerCase().replace(/\s+/g, '').trim();
                
                const dbName = (row.Name__c || '').toLowerCase().trim();
                const uiName = (this.formNameValue || '').toLowerCase().trim();
                
                const dbAudience = (row.Audience_Type__c || '').toLowerCase().trim();
                const uiAudience = (this.formAudience || '').toLowerCase().trim();
                
                return dbCategory === uiCategory && dbName === uiName && dbAudience === uiAudience;
            });

            if (hasDuplicateCombination) {
                this.showNotification(
                    'Rule Pre-Existence Conflict', 
                    `A setting strategy combination rule for "${this.formCategory} - ${this.formNameValue} - ${this.formAudience}" already exists. Please edit that configuration instead.`, 
                    'error'
                );
                return;
            }
        }

        this.isLoading = true;
        try {
            await upsertChannelSettings({
                recordId: this.currentRecordId,
                cooldownCategory: this.formCategory,
                nameValue: this.formNameValue.trim(),
                audienceType: this.formAudience,
                cooldownDays: parsedDays,
                isActive: this.formIsActive
            });

            this.showNotification('Success!', 'Configuration matrix record committed successfully.', 'success');
            this.closeCreationModal();
            await this.fetchMasterMatrixData();
        } catch (error) {
            this.showNotification('Server Error', error.body?.message || 'Error occurred during processing.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    async handleRowAction(event) {
        const actionName = event.detail.action.name;
        const targetRow = event.detail.row;

        switch (actionName) {
            case 'edit':
                this.initializeRowEditing(targetRow);
                break;
            case 'toggle_status':
                this.executeQuickStatusToggle(targetRow);
                break;
            case 'delete':
                this.executeRowDeletion(targetRow);
                break;
            default:
                break;
        }
    }

    initializeRowEditing(row) {
        this.isEditMode = true;
        this.currentRecordId = row.Id;
        this.formCategory = row.Cooldown_Category__c === 'Product Category' ? 'ProductCategory' : row.Cooldown_Category__c;
        this.formNameValue = row.Name__c;
        this.formAudience = row.Audience_Type__c;
        this.formDays = row.Cooldown_Days__c;
        this.formIsActive = row.IsActive__c;
        this.isModalOpen = true;
    }

    async executeQuickStatusToggle(row) {
        this.isLoading = true;
        try {
            const invertedStatus = !row.IsActive__c;
            const mappedCategory = row.Cooldown_Category__c === 'Product Category' ? 'ProductCategory' : row.Cooldown_Category__c;
            
            await upsertChannelSettings({
                recordId: row.Id,
                cooldownCategory: mappedCategory,
                nameValue: row.Name__c,
                audienceType: row.Audience_Type__c,
                cooldownDays: row.Cooldown_Days__c,
                isActive: invertedStatus
            });

            this.showNotification('Status Updated', `The configuration status has been successfully set to ${invertedStatus ? 'Active' : 'Inactive'}.`, 'success');
            await this.fetchMasterMatrixData();
        } catch (error) {
            this.showNotification('Update Failure', 'Could not apply inline toggle status adjustment.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    async executeRowDeletion(row) {
        const userConfirmation = confirm(`Are you absolutely sure you want to permanently delete the cooldown configuration for ${row.Name__c} - ${row.Audience_Type__c}?`);
        if (!userConfirmation) return;

        this.isLoading = true;
        try {
            await deleteRecord(row.Id);
            this.showNotification('Deleted Successfully', 'The configuration layout record row has been purged from the matrix grid.', 'success');
            await this.fetchMasterMatrixData();
        } catch (error) {
            this.showNotification('Deletion Blocked', 'Error occurred trying to erase record profile context parameters.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    showNotification(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}