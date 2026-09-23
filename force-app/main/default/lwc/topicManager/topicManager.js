import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { refreshApex } from '@salesforce/apex';
import CAMPAIGN_OBJECT from '@salesforce/schema/Campaign';

import getTopics from '@salesforce/apex/TopicManagerController.getTopics';
import deleteTopic from '@salesforce/apex/TopicManagerController.deleteTopic';
import toggleTopicStatus from '@salesforce/apex/TopicManagerController.toggleTopicStatus'; // NEW IMPORT

// Row actions are now evaluated dynamically per row
const getRowActions = (row, doneCallback) => {
    if (row.isParentRow) {
        doneCallback([]); 
    } else {
        const isActive = row.IsActive === true;
        doneCallback([
            { label: 'Edit', name: 'edit' },
            { label: isActive ? 'Deactivate Topic' : 'Activate Topic', name: 'toggle_status' },
            { label: 'Clone', name: 'clone' },
            { label: 'Delete', name: 'delete' }
        ]);
    }
};

const COLUMNS = [
    { type: 'text', fieldName: 'Name', label: 'NBA Topic' },
    { type: 'number', fieldName: 'Topic_Overall_Score__c', label: 'Score', cellAttributes: { alignment: 'left' } },
    { type: 'number', fieldName: 'Topic_Loyalization_Score__c', label: 'Loyalization', cellAttributes: { alignment: 'left' } },
    { type: 'number', fieldName: 'Topic_Ease_Score__c', label: 'Ease', cellAttributes: { alignment: 'left' } },
    { type: 'number', fieldName: 'Topic_Maximum_Duration_Days__c', label: 'Duration', cellAttributes: { alignment: 'left' } },
    { type: 'text', fieldName: 'windowLabel', label: 'Window' }, 
    { type: 'boolean', fieldName: 'IsActive', label: 'Active' },
    { type: 'action', typeAttributes: { rowActions: getRowActions } } 
];

export default class TopicManager extends NavigationMixin(LightningElement) {
    gridColumns = COLUMNS;
    @track gridData = []; 
    allGridData = []; 
    
    @track isModalOpen = false; // Controls modal visibility

    selectedTopicId = null; 
    topicRecordTypeId;
    
    loyalizationScore = 3;
    easeScore = 3;
    isActive = true;
    searchTerm = '';

    wiredTopicsResult; 

    @wire(getObjectInfo, { objectApiName: CAMPAIGN_OBJECT })
    handleObjectInfo({ error, data }) {
        if (data) {
            const rtis = data.recordTypeInfos;
            this.topicRecordTypeId = Object.keys(rtis).find((rti) => rtis[rti].name === 'Topic');
        }
    }

    @wire(getTopics)
    wiredTopics(result) {
        this.wiredTopicsResult = result;
        if (result.data) {
            this.buildTreeGrid(result.data);
        } else if (result.error) {
            console.error('Error fetching topics:', result.error);
        }
    }

    buildTreeGrid(data) {
        // Only Topic IDs that are in the returned dataset are valid parents
        const topicIds = new Set(data.map(row => row.Id));

        // childrenMap: topicParentId -> array of mapped child rows
        const childrenMap = new Map();

        const mapRow = row => {
            const start = row.Topic_Start_Window_Day__c || 0;
            const end = row.Topic_End_Window_Day__c || 0;
            return { ...row, windowLabel: `Days ${start}-${end}` };
        };

        // First pass: collect children for every Topic that has a Topic parent
        data.forEach(row => {
            if (row.ParentId && topicIds.has(row.ParentId)) {
                if (!childrenMap.has(row.ParentId)) {
                    childrenMap.set(row.ParentId, []);
                }
                childrenMap.get(row.ParentId).push(mapRow(row));
            }
        });

        // Second pass: build top-level rows
        // A Topic is top-level when its ParentId is null OR its parent is not a Topic
        const result = [];
        const added = new Set();

        data.forEach(row => {
            // Skip if this row is a child of a Topic (it will appear nested)
            if (row.ParentId && topicIds.has(row.ParentId)) return;
            if (added.has(row.Id)) return;
            added.add(row.Id);

            const mapped = mapRow(row);
            if (childrenMap.has(row.Id)) {
                // This Topic has Topic children — show as a parent node
                result.push({ ...mapped, _children: childrenMap.get(row.Id) });
            } else {
                // Leaf Topic — show as a standalone row
                result.push(mapped);
            }
        });

        this.allGridData = result;
        this.gridData = [...this.allGridData];
    }

    handleSearch(event) {
        this.searchTerm = event.target.value;
        const searchKey = this.searchTerm.toLowerCase();
        if (!searchKey) {
            this.gridData = [...this.allGridData];
            return;
        }

        let filteredData = [];
        for (let parent of this.allGridData) {
            let parentMatches = parent.Name.toLowerCase().includes(searchKey);
            let matchingChildren = [];

            if (parent._children) {
                matchingChildren = parent._children.filter(child => {
                    const nameMatch = child.Name && child.Name.toLowerCase().includes(searchKey);
                    const descMatch = child.Description && child.Description.toLowerCase().includes(searchKey);
                    return nameMatch || descMatch;
                });
            }

            if (parentMatches) {
                filteredData.push({ ...parent });
            } else if (matchingChildren.length > 0) {
                filteredData.push({ ...parent, _children: matchingChildren });
            }
        }
        this.gridData = filteredData;
    }

    get currentTopicScore() {
        const score = (this.easeScore * 0.3) + (this.loyalizationScore * 0.7);
        return score.toFixed(1);
    }

    get calculatedProgressRing() {
        return (this.currentTopicScore / 7) * 100;
    }

    get isEmpty() {
        return this.gridData.length === 0;
    }

    get isSearchEmpty() {
        return this.isEmpty && this.searchTerm.trim().length > 0;
    }

    get hasNoTopics() {
        return this.isEmpty && !this.searchTerm.trim() && !!this.wiredTopicsResult;
    }

    // --- MODAL CONTROLS ---

    openModal() {
        this.isModalOpen = true;
    }

    closeModal() {
        this.isModalOpen = false;
        this.selectedTopicId = null;
    }

    handleNewTopic() {
        this.selectedTopicId = null; 
        this.loyalizationScore = 3;  
        this.easeScore = 3;
        this.isActive = true;          
        
        this.openModal(); // Open modal first so DOM elements exist
        
        // Slight delay to ensure lightning-input-fields are rendered before resetting
        setTimeout(() => {
            const inputFields = this.template.querySelectorAll('lightning-input-field');
            if (inputFields) {
                inputFields.forEach(field => field.reset());
            }
        }, 50);
    }

    handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;
        
        if (row.Id && !row.isParentRow) { 
            if (actionName === 'edit') {
                this.selectedTopicId = row.Id;
                this.loyalizationScore = row.Topic_Loyalization_Score__c || 3;
                this.easeScore = row.Topic_Ease_Score__c || 3;
                this.isActive = row.IsActive === undefined ? true : row.IsActive;
                this.openModal();
            } else if (actionName === 'toggle_status') {
                this.toggleStatus(row);
            } else if (actionName === 'clone') {
                this.cloneSelectedTopic(row);
            } else if (actionName === 'delete') {
                this.deleteSelectedTopic(row.Id);
            }
        }
    }

    // --- ACTIONS ---

    toggleStatus(row) {
        const newStatus = !row.IsActive;
        toggleTopicStatus({ topicId: row.Id, isActive: newStatus })
            .then(() => {
                this.showToast('Success', `Topic successfully ${newStatus ? 'Activated' : 'Deactivated'}.`, 'success');
                return refreshApex(this.wiredTopicsResult);
            })
            .catch(error => {
                this.showToast('Error', error.body ? error.body.message : error.message, 'error');
            });
    }

    cloneSelectedTopic(row) {
        this.selectedTopicId = null;
        this.loyalizationScore = row.Topic_Loyalization_Score__c || 3;
        this.easeScore = row.Topic_Ease_Score__c || 3;
        this.isActive = row.IsActive === undefined ? true : row.IsActive;
        
        this.openModal(); // Open modal to render fields

        // Increased timeout to ensure modal is fully rendered before injecting cloned data
        setTimeout(() => {
            const inputFields = this.template.querySelectorAll('lightning-input-field');
            if (inputFields) {
                inputFields.forEach(field => {
                    switch(field.fieldName) {
                        case 'Name':
                            field.value = row.Name + ' (Clone)';
                            break;
                        case 'ParentId':
                            field.value = row.ParentId;
                            break;
                        case 'Description':
                            field.value = row.Description;
                            break;
                        case 'Topic_Maximum_Duration_Days__c':
                            field.value = row.Topic_Maximum_Duration_Days__c;
                            break;
                        case 'Topic_Start_Window_Day__c':
                            field.value = row.Topic_Start_Window_Day__c;
                            break;
                        case 'Topic_End_Window_Day__c':
                            field.value = row.Topic_End_Window_Day__c;
                            break;
                    }
                });
            }
            
            this.showToast('Topic Copied', 'Data copied! Make your changes and click Save to create the clone.', 'info');
        }, 150); 
    }

    deleteSelectedTopic(idToDelete) {
        deleteTopic({ topicId: idToDelete })
            .then(() => {
                this.showToast('Deleted', 'Topic deleted successfully.', 'success');
                return refreshApex(this.wiredTopicsResult);
            })
            .catch(error => {
                this.showToast('Error Deleting', error.body ? error.body.message : error.message, 'error');
            });
    }

    handleLoyalizationChange(event) {
        this.loyalizationScore = event.target.value;
    }

    handleEaseChange(event) {
        this.easeScore = event.target.value;
    }

    handleActiveChange(event) {
        this.isActive = event.target.checked;
    }

    handleSuccess() {
        this.showToast('Success!', 'Topic saved successfully.', 'success');
        this.closeModal(); // Close modal upon success
        return refreshApex(this.wiredTopicsResult); 
    }

    navigateToMembers() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordRelationshipPage',
            attributes: {
                recordId: this.selectedTopicId,
                objectApiName: 'Campaign',
                relationshipApiName: 'CampaignMembers',
                actionName: 'view'
            }
        });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}