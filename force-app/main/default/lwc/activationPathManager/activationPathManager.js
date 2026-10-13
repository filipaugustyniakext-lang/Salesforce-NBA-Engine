import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';

// Apex Imports
import getAllPathAllocations from '@salesforce/apex/ActivationPathController.getAllPathAllocations';
import saveAllocations from '@salesforce/apex/ActivationPathController.saveAllocations';
import deleteSingleAllocation from '@salesforce/apex/ActivationPathController.deleteSingleAllocation';

const COLUMNS = [
    { label: 'Path Name', fieldName: 'Path_Name__c', type: 'text', sortable: true },
    { label: 'Probability (%)', fieldName: 'Path_Probability__c', type: 'number', sortable: true, cellAttributes: { alignment: 'left' } },
    { label: 'Status', fieldName: 'StatusLabel', type: 'text' },
    { label: 'Last Modified Date', fieldName: 'LastModifiedDate', type: 'date', typeAttributes: { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' } },
    { label: 'Last Modified By', fieldName: 'LastModifiedByName', type: 'text' },
    { 
        type: 'action', 
        typeAttributes: { 
            rowActions: [
                { label: 'Delete Path', name: 'delete_path' }
            ] 
        } 
    }
];

export default class ActivationPathManager extends LightningElement {
    columns = COLUMNS;
    @track displayedData = [];
    isLoadingMain = true;

    @track draftAllocations = [];
    @track recordsToDelete = [];
    isModalOpen = false;
    isLoadingModal = false;

    connectedCallback() {
        this.loadMasterData();
    }

    renderedCallback() {
        this.updateSliderBackgrounds();
    }

    // Dynamic track fill for blue / light-gray slider
    updateSliderBackgrounds() {
        const sliders = this.template.querySelectorAll('.custom-slider');
        sliders.forEach(slider => {
            const val = slider.value || 0;
            slider.style.background = `linear-gradient(to right, #0176d3 0%, #0176d3 ${val}%, #e0e5ee ${val}%, #e0e5ee 100%)`;
        });
    }

    async loadMasterData() {
        this.isLoadingMain = true;
        try {
            const result = await getAllPathAllocations();
            this.displayedData = result.map(row => ({
                ...row,
                LastModifiedByName: row.LastModifiedBy ? row.LastModifiedBy.Name : '',
                StatusLabel: row.Path_Status__c ? 'Active' : 'Inactive'
            }));
        } catch (error) {
            this.showToast('Error Loading Data', this.getErrorMessage(error), 'error');
        } finally {
            this.isLoadingMain = false;
        }
    }

    handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;
        
        if (actionName === 'delete_path') {
            this.handleDirectDelete(row);
        }
    }

    async handleDirectDelete(row) {
        const confirmResult = await LightningConfirm.open({
            message: `Are you sure you want to permanently delete the path "${row.Path_Name__c}"?`,
            variant: 'headerless',
            label: 'Confirm Deletion',
        });

        if (confirmResult) {
            this.isLoadingMain = true;
            try {
                await deleteSingleAllocation({ allocationId: row.Id });
                this.showToast('Success', 'Path deleted successfully.', 'success');
                await this.loadMasterData();
            } catch (error) {
                this.showToast('Error Deleting Path', this.getErrorMessage(error), 'error');
            } finally {
                this.isLoadingMain = false;
            }
        }
    }

    openNewModal() {
        this.recordsToDelete = [];
        this.draftAllocations = this.displayedData.map(record => ({
            ...record,
            uiKey: record.Id
        }));

        if (this.draftAllocations.length === 0) {
            this.addNewDraftPath();
        }
        this.isModalOpen = true;
    }

    closeModal() {
        this.isModalOpen = false;
        this.isLoadingModal = false;
    }

    // Live total sum of ALL percentage allocations
    get totalProbability() {
        return this.draftAllocations.reduce((sum, alloc) => {
            return sum + (Number(alloc.Path_Probability__c) || 0);
        }, 0);
    }

    get draftDisplay() {
        return this.draftAllocations;
    }

    get isSetEqualDisabled() { return this.draftAllocations.filter(a => a.Path_Status__c).length === 0; }
    get isSaveDisabled() { return this.draftAllocations.length === 0; }

    // Helper: Rebalances 100% evenly across all active paths
    rebalanceActiveTo100() {
        let activeAllocations = this.draftAllocations.filter(a => a.Path_Status__c);
        if (activeAllocations.length === 0) return;
        
        let splitValue = Math.floor(100 / activeAllocations.length);
        let leftover = 100 - (splitValue * activeAllocations.length);
        
        activeAllocations.forEach((alloc, index) => {
            alloc.Path_Probability__c = splitValue + (index < leftover ? 1 : 0);
        });
        
        this.draftAllocations.filter(a => !a.Path_Status__c).forEach(alloc => {
            alloc.Path_Probability__c = 0;
        });
        
        this.draftAllocations = [...this.draftAllocations];
    }

    // Adds a new path and adjusts all active paths to sum to 100%
    addNewDraftPath() {
        const newRecord = {
            uiKey: 'temp_' + Date.now(),
            Path_Name__c: '',
            Name: 'New Path',
            Path_Probability__c: 0, 
            Path_Status__c: true
        };
        this.draftAllocations = [...this.draftAllocations, newRecord];
        this.rebalanceActiveTo100();
    }

    // Removes a path and adjusts remaining active paths to sum to 100%
    handleDeletePath(event) {
        const id = event.target.dataset.id;
        const targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        
        if (targetAlloc && targetAlloc.Id) {
            this.recordsToDelete.push(targetAlloc);
        }
        this.draftAllocations = this.draftAllocations.filter(a => a.uiKey !== id);
        this.rebalanceActiveTo100();
    }

    handleNameChange(event) {
        const id = event.target.dataset.id;
        let targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        if (targetAlloc) {
            targetAlloc.Path_Name__c = event.target.value;
            targetAlloc.Name = event.target.value ? event.target.value.substring(0, 80) : 'Unnamed Path';
        }
    }

    // Toggling a path ON/OFF rebalances active paths to sum to 100%
    handleStatusToggle(event) {
        const id = event.target.dataset.id;
        const isChecked = event.target.checked;
        let targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        
        if (targetAlloc) {
            targetAlloc.Path_Status__c = isChecked;
            if (!isChecked) {
                targetAlloc.Path_Probability__c = 0;
            }
            this.rebalanceActiveTo100();
        }
    }

    // Manual slider movement: allows total to drop below 100%, but caps max at 100%
    handleSliderChange(event) {
        const id = event.target.dataset.id;
        let newValue = parseInt(event.target.value, 10) || 0;
        
        let targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        if (targetAlloc) {
            const otherSum = this.draftAllocations
                .filter(a => a.uiKey !== id && a.Path_Status__c)
                .reduce((sum, a) => sum + (Number(a.Path_Probability__c) || 0), 0);
            
            const maxAllowed = Math.max(0, 100 - otherSum);

            // Cap upward movement so total never exceeds 100%
            if (newValue > maxAllowed) {
                newValue = maxAllowed;
                event.target.value = newValue;
            }

            targetAlloc.Path_Probability__c = newValue;
            this.draftAllocations = [...this.draftAllocations];
        }
    }

    setEqualProbabilities() {
        this.rebalanceActiveTo100();
    }

    async handleSave() {
        const missingNames = this.draftAllocations.some(a => !a.Path_Name__c || a.Path_Name__c.trim() === '');
        if (missingNames) {
            this.showToast('Error', 'Please provide a Path Name for all rows before saving.', 'error');
            return;
        }

        if (this.totalProbability > 100) {
            this.showToast('Error', 'Total allocation percentage cannot exceed 100%.', 'error');
            return;
        }

        this.isLoadingModal = true;
        
        try {
            const upsertList = this.draftAllocations.map(alloc => {
                let cleanRecord = {
                    Path_Name__c: alloc.Path_Name__c,
                    Name: alloc.Name,
                    Path_Probability__c: alloc.Path_Probability__c,
                    Path_Status__c: alloc.Path_Status__c
                };
                if (alloc.Id) cleanRecord.Id = alloc.Id;
                return cleanRecord;
            });

            const deleteList = this.recordsToDelete.map(alloc => ({ Id: alloc.Id }));

            await saveAllocations({ allocationsToUpsert: upsertList, allocationsToDelete: deleteList });
            this.showToast('Success', 'Path allocations saved successfully!', 'success');
            this.isModalOpen = false;
            await this.loadMasterData(); 
        } catch (error) {
            this.showToast('Error Saving Records', this.getErrorMessage(error), 'error');
        } finally {
            this.isLoadingModal = false;
        }
    }

    getErrorMessage(error) {
        if (Array.isArray(error.body)) {
            return error.body.map(e => e.message).join(', ');
        } else if (error?.body?.message) {
            return error.body.message;
        } else if (error?.message) {
            return error.message;
        }
        return 'An unknown error occurred.';
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}