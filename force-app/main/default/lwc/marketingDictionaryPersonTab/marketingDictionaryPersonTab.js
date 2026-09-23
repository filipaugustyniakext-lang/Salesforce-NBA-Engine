import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getPersonRecords from '@salesforce/apex/MarketingDictionaryManagerController.getPersonRecords';
import saveProductRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecord';
import saveProductRecordsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecordsBulk';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';

let _key = 0;
const newKey = () => String(++_key);
const newRow = (i) => ({ key: newKey(), name: '', label: `Name ${i}` });
const EMPTY_RECORD = () => ({ Name: '', Dictionary_Sub_Type__c: '' });

export default class MarketingDictionaryPersonTab extends LightningElement {

    @track activeSubTab = 'customerType';

    get isTab() {
        return {
            customerType: this.activeSubTab === 'customerType',
            audienceType: this.activeSubTab === 'audienceType'
        };
    }
    get vtabClass() {
        const base = 'vtab-item', active = base + ' vtab-item_active';
        return {
            customerType: this.activeSubTab === 'customerType' ? active : base,
            audienceType: this.activeSubTab === 'audienceType' ? active : base
        };
    }
    get vtabSelected() {
        return {
            customerType: this.activeSubTab === 'customerType',
            audienceType: this.activeSubTab === 'audienceType'
        };
    }
    handleSubTabClick(e) { this.activeSubTab = e.currentTarget.dataset.tab; }

    _wiredResult;
    _allRecords = [];
    isLoading = true;

    @wire(getPersonRecords)
    wiredRecords(result) {
        this._wiredResult = result;
        this.isLoading = false;
        if (result.data) {
            this._allRecords = result.data;
        } else if (result.error) {
            this._showToast('Error', result.error.body?.message || 'Failed to load records', 'error');
        }
    }

    get customerTypes()     { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Customer Type'); }
    get audienceTypes()     { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Audience Type'); }
    get customerTypeCount() { return this.customerTypes.length; }
    get audienceTypeCount() { return this.audienceTypes.length; }
    get hasCustomerTypes()  { return !this.isLoading && this.customerTypes.length > 0; }
    get hasAudienceTypes()  { return !this.isLoading && this.audienceTypes.length > 0; }

    @track isModalOpen = false;
    @track isDeleteModalOpen = false;
    @track editRecord = EMPTY_RECORD();
    @track isSaving = false;
    @track bulkRows = [newRow(1)];

    _activeSubtype = '';
    _isEditMode = false;
    _pendingDeleteId = null;
    _pendingDeleteName = '';

    get isEditMode()    { return this._isEditMode; }
    get isSingleRow()   { return this.bulkRows.length === 1; }
    get pendingDeleteName() { return this._pendingDeleteName; }
    get modalTitle() {
        if (this._isEditMode) return `Edit ${this._activeSubtype}`;
        const count = this.bulkRows.length;
        return `Add ${this._activeSubtype}${count > 1 ? ` (${count})` : ''}`;
    }
    get saveButtonLabel() {
        if (this._isEditMode) return 'Save';
        const filled = this.bulkRows.filter(r => r.name.trim()).length;
        return filled > 1 ? `Save ${filled}` : 'Save';
    }

    handleNewRecord(e) {
        this._activeSubtype = e.currentTarget.dataset.subtype;
        this._isEditMode = false;
        this.bulkRows = [newRow(1)];
        this.isModalOpen = true;
    }

    handleEditRecord(e) {
        const id = e.currentTarget.dataset.id;
        this._activeSubtype = e.currentTarget.dataset.subtype;
        this._isEditMode = true;
        const found = this._allRecords.find(r => r.Id === id);
        this.editRecord = found ? { ...found } : EMPTY_RECORD();
        this.isModalOpen = true;
    }

    handleFieldChange(e) {
        this.editRecord = { ...this.editRecord, [e.currentTarget.dataset.field]: e.detail.value };
    }

    handleBulkRowChange(e) {
        const key = e.currentTarget.dataset.key;
        this.bulkRows = this.bulkRows.map(r => r.key === key ? { ...r, name: e.detail.value } : r);
    }
    handleAddRow() { this.bulkRows = [...this.bulkRows, newRow(this.bulkRows.length + 1)]; }
    handleRemoveRow(e) {
        const key = e.currentTarget.dataset.key;
        if (this.bulkRows.length === 1) return;
        this.bulkRows = this.bulkRows.filter(r => r.key !== key).map((r, i) => ({ ...r, label: `Name ${i + 1}` }));
    }

    async handleSave() {
        if (this._isEditMode) {
            if (!this.editRecord.Name?.trim()) { this._showToast('Validation', 'Name is required', 'error'); return; }
            this.isSaving = true;
            try {
                await saveProductRecord({ record: this.editRecord });
                this._showToast('Success', `${this._activeSubtype} saved`, 'success');
                this.isModalOpen = false;
                await refreshApex(this._wiredResult);
            } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
            finally { this.isSaving = false; }
        } else {
            const filled = this.bulkRows.filter(r => r.name.trim());
            if (!filled.length) { this._showToast('Validation', 'Enter at least one name', 'error'); return; }
            const records = filled.map(r => ({ Name: r.name.trim(), Dictionary_Sub_Type__c: this._activeSubtype }));
            this.isSaving = true;
            try {
                await saveProductRecordsBulk({ recordsJson: JSON.stringify(records) });
                const label = filled.length === 1 ? this._activeSubtype : `${filled.length} ${this._activeSubtype} entries`;
                this._showToast('Success', `${label} saved`, 'success');
                this.isModalOpen = false;
                await refreshApex(this._wiredResult);
            } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
            finally { this.isSaving = false; }
        }
    }

    handleDeleteRecord(e) {
        this._pendingDeleteId = e.currentTarget.dataset.id;
        this._pendingDeleteName = e.currentTarget.dataset.name || 'this record';
        this.isDeleteModalOpen = true;
    }
    handleCancelDelete() {
        this._pendingDeleteId = null; this._pendingDeleteName = '';
        this.isDeleteModalOpen = false;
    }
    async handleConfirmDelete() {
        const id = this._pendingDeleteId;
        this.isDeleteModalOpen = false;
        this._pendingDeleteId = null; this._pendingDeleteName = '';
        try {
            await deleteDictionaryRecord({ recordId: id });
            this._showToast('Success', 'Record deleted', 'success');
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
    }

    handleCloseModal() { this.isModalOpen = false; }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}