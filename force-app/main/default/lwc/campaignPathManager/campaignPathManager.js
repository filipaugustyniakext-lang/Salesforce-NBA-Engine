import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm'; // NEW: Standard confirmation popup

// Apex Imports
import getAllPathAllocations from '@salesforce/apex/CampaignPathController.getAllPathAllocations';
import getActiveCampaigns from '@salesforce/apex/CampaignPathController.getActiveCampaigns';
import getPathAllocations from '@salesforce/apex/CampaignPathController.getPathAllocations';
import saveAllocations from '@salesforce/apex/CampaignPathController.saveAllocations';
import deleteSingleAllocation from '@salesforce/apex/CampaignPathController.deleteSingleAllocation'; // NEW: Single delete

// NEW: Added the "Delete Path" row action to the columns array
const COLUMNS = [
    { label: 'Campaign', fieldName: 'CampaignName', type: 'text', sortable: true },
    { label: 'Path Name', fieldName: 'Path_Name__c', type: 'text', sortable: true },
    { label: 'Probability (%)', fieldName: 'Path_Propability__c', type: 'number', sortable: true, cellAttributes: { alignment: 'left' } },
    { label: 'Status', fieldName: 'StatusLabel', type: 'text' },
    { label: 'Last Modified Date', fieldName: 'LastModifiedDate', type: 'date', typeAttributes: { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' } },
    { label: 'Last Modified By', fieldName: 'LastModifiedByName', type: 'text' },
    { type: 'action', typeAttributes: { rowActions: [
        { label: 'Edit Paths for Campaign', name: 'edit_campaign' },
        { label: 'Delete Path', name: 'delete_path' }
    ] } }
];

export default class CampaignPathManager extends LightningElement {
    columns = COLUMNS;
    @track allData = [];
    @track displayedData = [];
    searchTerm = '';
    isLoadingMain = true;

    @track campaignOptions = [];
    @track draftAllocations = [];
    @track recordsToDelete = [];
    isModalOpen = false;
    isLoadingModal = false;
    selectedCampaignId;
    isCampaignLocked = false;

    connectedCallback() {
        this.loadMasterData();
    }

    loadMasterData() {
        this.isLoadingMain = true;
        getAllPathAllocations()
            .then(result => {
                this.allData = result.map(row => ({
                    ...row,
                    CampaignName: row.Campaign__r ? row.Campaign__r.Name : 'Unknown Campaign',
                    LastModifiedByName: row.LastModifiedBy ? row.LastModifiedBy.Name : '',
                    StatusLabel: row.Path_Status__c ? 'Active' : 'Inactive'
                }));
                this.filterData();
                this.isLoadingMain = false;
            })
            .catch(error => {
                this.showToast('Error', 'Failed to load master list', 'error');
                this.isLoadingMain = false;
            });
    }

    handleSearch(event) {
        this.searchTerm = event.target.value.toLowerCase();
        this.filterData();
    }

    filterData() {
        if (this.searchTerm) {
            this.displayedData = this.allData.filter(row => 
                (row.CampaignName && row.CampaignName.toLowerCase().includes(this.searchTerm)) ||
                (row.Path_Name__c && row.Path_Name__c.toLowerCase().includes(this.searchTerm))
            );
        } else {
            this.displayedData = [...this.allData];
        }
    }

    @wire(getActiveCampaigns)
    wiredCampaigns({ error, data }) {
        if (data) {
            this.campaignOptions = data.map(camp => ({ label: camp.Name, value: camp.Id }));
        }
    }

    // NEW LOGIC: Handling both row actions
    handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;
        
        if (actionName === 'edit_campaign') {
            this.openEditModal(row.Campaign__c);
        } else if (actionName === 'delete_path') {
            this.handleDirectDelete(row);
        }
    }

    // NEW LOGIC: Direct delete from the List View
    async handleDirectDelete(row) {
        // Trigger standard Lightning Confirm Popup
        const confirmResult = await LightningConfirm.open({
            message: `Are you sure you want to permanently delete the path "${row.Path_Name__c}"?`,
            variant: 'headerless',
            label: 'Confirm Deletion',
        });

        if (confirmResult) {
            this.isLoadingMain = true;
            deleteSingleAllocation({ allocationId: row.Id })
                .then(() => {
                    this.showToast('Success', 'Path deleted successfully.', 'success');
                    this.loadMasterData(); // Refresh list to remove the deleted row
                })
                .catch(error => {
                    this.showToast('Error', error.body ? error.body.message : 'Error deleting path', 'error');
                    this.isLoadingMain = false;
                });
        }
    }

    openNewModal() {
        this.selectedCampaignId = null;
        this.isCampaignLocked = false;
        this.draftAllocations = [];
        this.recordsToDelete = [];
        this.isModalOpen = true;
    }

    openEditModal(campaignId) {
        this.selectedCampaignId = campaignId;
        this.isCampaignLocked = true;
        this.draftAllocations = [];
        this.recordsToDelete = [];

        // Ensure the campaign being edited is present in the options list
        // (it may be inactive and therefore excluded from the @wire results)
        const alreadyInOptions = this.campaignOptions.some(o => o.value === campaignId);
        if (!alreadyInOptions) {
            const row = this.allData.find(r => r.Campaign__c === campaignId);
            if (row) {
                this.campaignOptions = [
                    { label: row.CampaignName, value: campaignId },
                    ...this.campaignOptions
                ];
            }
        }

        this.isModalOpen = true;
        this.loadAllocationsForModal();
    }

    closeModal() {
        this.isModalOpen = false;
    }

    handleCampaignChange(event) {
        this.selectedCampaignId = event.detail.value;
        this.loadAllocationsForModal();
    }

    loadAllocationsForModal() {
        this.isLoadingModal = true;
        getPathAllocations({ campaignId: this.selectedCampaignId })
            .then(result => {
                this.draftAllocations = result.map(record => ({
                    ...record,
                    uiKey: record.Id 
                }));
                if (this.draftAllocations.length === 0) {
                    this.addNewDraftPath();
                }
                this.isLoadingModal = false;
            })
            .catch(error => {
                this.showToast('Error', 'Could not load allocations', 'error');
                this.isLoadingModal = false;
            });
    }

    get draftDisplay() { return this.draftAllocations; }
    get isSetEqualDisabled() { return this.draftAllocations.filter(a => a.Path_Status__c).length === 0; }
    get isSaveDisabled() { return !this.selectedCampaignId; }

    addNewDraftPath() {
        let activeSum = this.draftAllocations.filter(a => a.Path_Status__c).reduce((sum, a) => sum + a.Path_Propability__c, 0);
        let leftover = Math.max(0, 100 - activeSum);

        const newRecord = {
            uiKey: 'temp_' + Date.now(),
            Campaign__c: this.selectedCampaignId,
            Path_Name__c: '',
            Name: 'New Path',
            Path_Propability__c: leftover, 
            Path_Status__c: true
        };
        this.draftAllocations = [...this.draftAllocations, newRecord];
    }

    handleDeletePath(event) {
        const id = event.target.dataset.id;
        const targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        
        if (targetAlloc.Id) {
            this.recordsToDelete.push(targetAlloc);
        }
        this.draftAllocations = this.draftAllocations.filter(a => a.uiKey !== id);

        if (targetAlloc.Path_Status__c && targetAlloc.Path_Propability__c > 0) {
            let active = this.draftAllocations.filter(a => a.Path_Status__c);
            if (active.length > 0) {
                let splitVal = Math.floor(targetAlloc.Path_Propability__c / active.length);
                let left = targetAlloc.Path_Propability__c - (splitVal * active.length);
                
                active.forEach((a, idx) => {
                    a.Path_Propability__c += splitVal + (idx < left ? 1 : 0);
                });
            }
        }
    }

    handleNameChange(event) {
        const id = event.target.dataset.id;
        let targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        targetAlloc.Path_Name__c = event.target.value;
        targetAlloc.Name = event.target.value ? event.target.value.substring(0, 80) : 'Unnamed Path';
    }

    handleStatusToggle(event) {
        const id = event.target.dataset.id;
        const isChecked = event.target.checked;
        let targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        targetAlloc.Path_Status__c = isChecked;
        
        if (!isChecked) {
            targetAlloc.Path_Propability__c = 0;
            this.redistributeRemainder(id, 0);
        } else {
            let currentSum = this.draftAllocations.filter(a => a.Path_Status__c && a.uiKey !== id).reduce((sum, a) => sum + a.Path_Propability__c, 0);
            targetAlloc.Path_Propability__c = Math.max(0, 100 - currentSum);
        }
    }

    handleSliderChange(event) {
        const id = event.target.dataset.id;
        const newValue = parseInt(event.target.value, 10);
        let targetAlloc = this.draftAllocations.find(a => a.uiKey === id);
        targetAlloc.Path_Propability__c = newValue;
        this.redistributeRemainder(id, newValue);
    }

    redistributeRemainder(changedId, newValue) {
        let otherActive = this.draftAllocations.filter(a => a.uiKey !== changedId && a.Path_Status__c);
        if (otherActive.length > 0) {
            let remainder = 100 - newValue;
            let splitValue = Math.floor(remainder / otherActive.length);
            let leftover = remainder - (splitValue * otherActive.length); 

            otherActive.forEach((alloc, index) => {
                alloc.Path_Propability__c = splitValue + (index < leftover ? 1 : 0);
            });
        } else {
            let targetAlloc = this.draftAllocations.find(a => a.uiKey === changedId);
            if (targetAlloc && targetAlloc.Path_Status__c) {
                targetAlloc.Path_Propability__c = 100;
            }
        }
        this.draftAllocations = [...this.draftAllocations];
    }

    setEqualProbabilities() {
        let activeAllocations = this.draftAllocations.filter(a => a.Path_Status__c);
        if (activeAllocations.length === 0) return;
        let splitValue = Math.floor(100 / activeAllocations.length);
        let leftover = 100 - (splitValue * activeAllocations.length);
        activeAllocations.forEach((alloc, index) => {
            alloc.Path_Propability__c = splitValue + (index < leftover ? 1 : 0);
        });
        this.draftAllocations.filter(a => !a.Path_Status__c).forEach(alloc => {
            alloc.Path_Propability__c = 0;
        });
        this.draftAllocations = [...this.draftAllocations];
    }

    handleSave() {
        const missingNames = this.draftAllocations.some(a => !a.Path_Name__c || a.Path_Name__c.trim() === '');
        if (missingNames) {
            this.showToast('Error', 'Please provide a Path Name for all rows before saving.', 'error');
            return;
        }

        this.isLoadingModal = true;
        
        const upsertList = this.draftAllocations.map(alloc => {
            let cleanRecord = {
                Campaign__c: alloc.Campaign__c,
                Path_Name__c: alloc.Path_Name__c,
                Name: alloc.Name,
                Path_Propability__c: alloc.Path_Propability__c,
                Path_Status__c: alloc.Path_Status__c
            };
            if (alloc.Id) cleanRecord.Id = alloc.Id;
            return cleanRecord;
        });

        const deleteList = this.recordsToDelete.map(alloc => ({ Id: alloc.Id }));

        saveAllocations({ allocationsToUpsert: upsertList, allocationsToDelete: deleteList })
            .then(() => {
                this.showToast('Success', 'Path allocations saved successfully!', 'success');
                this.isModalOpen = false;
                this.loadMasterData(); 
            })
            .catch(error => {
                this.showToast('Error saving records', error.body ? error.body.message : error.message, 'error');
                this.isLoadingModal = false;
            });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}