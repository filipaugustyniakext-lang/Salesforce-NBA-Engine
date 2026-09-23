import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getProductRecords from '@salesforce/apex/MarketingDictionaryManagerController.getProductRecords';
import saveProductRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecord';
import saveProductRecordsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecordsBulk';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import getFonCustomerTypes from '@salesforce/apex/MarketingDictionaryManagerController.getFonCustomerTypes';
import setFonCustomerTypes from '@salesforce/apex/MarketingDictionaryManagerController.setFonCustomerTypes';

let _keyCounter = 0;
const newKey = () => String(++_keyCounter);
const EMPTY_RECORD = () => ({ Name: '', Dictionary_Sub_Type__c: '', Related_Family_of_Needs__c: null, Related_Product_Type__c: null });
const newRow = (index) => ({ key: newKey(), name: '', label: `Name ${index}` });

export default class MarketingDictionaryProductTab extends LightningElement {

    @track activeSubTab = 'productFamily';

    get isTab() {
        return {
            productFamily: this.activeSubTab === 'productFamily',
            familyOfNeeds: this.activeSubTab === 'familyOfNeeds',
            productType:   this.activeSubTab === 'productType'
        };
    }
    get vtabClass() {
        const base = 'vtab-item', active = base + ' vtab-item_active';
        return {
            productFamily: this.activeSubTab === 'productFamily' ? active : base,
            familyOfNeeds: this.activeSubTab === 'familyOfNeeds' ? active : base,
            productType:   this.activeSubTab === 'productType'   ? active : base
        };
    }
    get vtabSelected() {
        return {
            productFamily: this.activeSubTab === 'productFamily',
            familyOfNeeds: this.activeSubTab === 'familyOfNeeds',
            productType:   this.activeSubTab === 'productType'
        };
    }
    handleSubTabClick(e) { this.activeSubTab = e.currentTarget.dataset.tab; }

    // ── Wire ────────────────────────────────────────────────────────────────

    _wiredResult;
    _allRecords = [];
    isLoading = true;

    @wire(getProductRecords)
    wiredRecords(result) {
        this._wiredResult = result;
        this.isLoading = false;
        if (result.data) {
            this._allRecords = result.data;
            // refresh FON CT cache whenever records reload
            this._rebuildFonCtCache();
        } else if (result.error) {
            this._showToast('Error', result.error.body?.message || 'Failed to load records', 'error');
        }
    }

    // ── FON → Customer Type cache ───────────────────────────────────────────
    // _fonCtMap: { [fonId]: Set<ctId> }

    _fonCtMap = {};

    async _rebuildFonCtCache() {
        const fons = this.familyOfNeeds;
        if (!fons.length) return;
        const results = await Promise.all(
            fons.map(f => getFonCustomerTypes({ fonId: f.Id }).then(rows => ({ fonId: f.Id, rows })).catch(() => ({ fonId: f.Id, rows: [] })))
        );
        const map = {};
        results.forEach(({ fonId, rows }) => {
            map[fonId] = new Set(rows.map(r => r.Customer_Type__c));
        });
        this._fonCtMap = map;
    }

    // ── Derived lists ───────────────────────────────────────────────────────

    get productFamilies() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Product Family'); }
    get familyOfNeeds()   { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Family of Needs'); }
    get customerTypes()   { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Customer Type'); }
    get productTypes()    { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Product Type'); }

    get familyOfNeedsWithCt() {
        return this.familyOfNeeds.map(rec => {
            const ctSet = this._fonCtMap[rec.Id] || new Set();
            return {
                ...rec,
                assignedCtList: this.customerTypes.filter(ct => ctSet.has(ct.Id))
            };
        });
    }

    get filteredSortedProductFamilies() {
        let list = this._filterFonId
            ? this.productFamilies.filter(r => r.Related_Family_of_Needs__c === this._filterFonId)
            : [...this.productFamilies];
        const asc = this._sortAsc ? 1 : -1;
        list.sort((a, b) => {
            let av, bv;
            if (this._sortField === 'fon') {
                av = (a.Related_Family_of_Needs__r?.Name || '').toLowerCase();
                bv = (b.Related_Family_of_Needs__r?.Name || '').toLowerCase();
            } else {
                av = (a.Name || '').toLowerCase();
                bv = (b.Name || '').toLowerCase();
            }
            return av < bv ? -1 * asc : av > bv ? 1 * asc : 0;
        });
        const allCts = this.customerTypes;
        return list.map(rec => {
            const fonCtSet = rec.Related_Family_of_Needs__c
                ? (this._fonCtMap[rec.Related_Family_of_Needs__c] || new Set())
                : new Set();
            return { ...rec, inheritedCtList: allCts.filter(ct => fonCtSet.has(ct.Id)) };
        });
    }

    get filteredProductFamilyCount() { return this.filteredSortedProductFamilies.length; }
    get hasFilteredProductFamilies() { return !this.isLoading && this.filteredSortedProductFamilies.length > 0; }
    get isFilterActive()  { return !!this._filterFonId; }
    get familyOfNeedsCount() { return this.familyOfNeeds.length; }
    get hasFamilyOfNeeds()   { return !this.isLoading && this.familyOfNeeds.length > 0; }
    get customerTypeCount()  { return this.customerTypes.length; }
    get hasCustomerTypes()   { return !this.isLoading && this.customerTypes.length > 0; }
    get productTypeCount()   { return this.productTypes.length; }
    get hasProductTypes()    { return !this.isLoading && this.productTypes.length > 0; }

    // ── Sort ────────────────────────────────────────────────────────────────

    _sortField = 'name';
    _sortAsc = true;
    _filterFonId = null;

    get sortByNameIcon()  { return this._sortField !== 'name' ? 'utility:sort' : this._sortAsc ? 'utility:arrowup' : 'utility:arrowdown'; }
    get sortByFonIcon()   { return this._sortField !== 'fon'  ? 'utility:sort' : this._sortAsc ? 'utility:arrowup' : 'utility:arrowdown'; }
    get sortByNameTitle() { return this._sortField !== 'name' ? 'Sort by Name' : this._sortAsc ? 'Name A→Z (click to reverse)' : 'Name Z→A (click to reverse)'; }
    get sortByFonTitle()  { return this._sortField !== 'fon'  ? 'Sort by Family of Needs' : this._sortAsc ? 'Family of Needs A→Z (click to reverse)' : 'Family of Needs Z→A (click to reverse)'; }

    get filterFonId() { return this._filterFonId || ''; }
    get filterFonOptions() {
        return [{ label: 'All Families of Needs', value: '' }, ...this.familyOfNeeds.map(r => ({ label: r.Name, value: r.Id }))];
    }

    handleFilterFonChange(e) { this._filterFonId = e.detail.value || null; }
    handleSortChange(e) {
        const field = e.currentTarget.dataset.sort;
        if (this._sortField === field) { this._sortAsc = !this._sortAsc; }
        else { this._sortField = field; this._sortAsc = true; }
    }

    // ── Combobox options ────────────────────────────────────────────────────

    get familyOfNeedsOptions() {
        return [{ label: '— None —', value: '' }, ...this.familyOfNeeds.map(r => ({ label: r.Name, value: r.Id }))];
    }
    get productTypeOptions() {
        return [{ label: '— None —', value: '' }, ...this.productTypes.map(r => ({ label: r.Name, value: r.Id }))];
    }

    // ── Modal state ─────────────────────────────────────────────────────────

    @track isModalOpen = false;
    @track isDeleteModalOpen = false;
    @track editRecord = EMPTY_RECORD();
    @track isSaving = false;
    @track bulkRows = [newRow(1)];
    @track bulkFonId = null;

    // CT selection state for the FON edit modal: Set<ctId>
    _editModalCtSet = new Set();

    _activeSubtype = '';
    _isEditMode = false;
    _pendingDeleteId = null;
    _pendingDeleteName = '';

    get isEditMode()     { return this._isEditMode; }
    get isProductFamily(){ return this._activeSubtype === 'Product Family'; }
    get isFamilyOfNeeds(){ return this._activeSubtype === 'Family of Needs'; }
    get isSingleRow()    { return this.bulkRows.length === 1; }
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

    // CT list annotated with checked state for the edit modal
    get editModalCtList() {
        return this.customerTypes.map(ct => ({
            Id: ct.Id,
            Name: ct.Name,
            checked: this._editModalCtSet.has(ct.Id)
        }));
    }

    // ── Open modal ──────────────────────────────────────────────────────────

    handleNewRecord(event) {
        this._activeSubtype = event.currentTarget.dataset.subtype;
        this._isEditMode = false;
        this.bulkRows = [newRow(1)];
        this.bulkFonId = null;
        this.isModalOpen = true;
    }

    async handleEditRecord(event) {
        const id = event.currentTarget.dataset.id;
        const subtype = event.currentTarget.dataset.subtype;
        this._activeSubtype = subtype;
        this._isEditMode = true;
        const found = this._allRecords.find(r => r.Id === id);
        this.editRecord = found ? { ...found } : EMPTY_RECORD();

        if (subtype === 'Family of Needs') {
            const existing = this._fonCtMap[id] || new Set();
            this._editModalCtSet = new Set(existing);
        } else {
            this._editModalCtSet = new Set();
        }

        this.isModalOpen = true;
    }

    // ── Edit mode handlers ──────────────────────────────────────────────────

    handleFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        this.editRecord = { ...this.editRecord, [field]: event.detail.value || null };
    }

    handleEditModalCtChange(event) {
        const ctId = event.currentTarget.dataset.ctId;
        const updated = new Set(this._editModalCtSet);
        if (event.target.checked) { updated.add(ctId); } else { updated.delete(ctId); }
        this._editModalCtSet = updated;
    }

    // ── Bulk mode handlers ──────────────────────────────────────────────────

    handleBulkFonChange(e) { this.bulkFonId = e.detail.value || null; }
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

    // ── Save ────────────────────────────────────────────────────────────────

    async handleSave() {
        if (this._isEditMode) { await this._saveEdit(); }
        else { await this._saveBulk(); }
    }

    async _saveEdit() {
        if (!this.editRecord.Name?.trim()) {
            this._showToast('Validation', 'Name is required', 'error');
            return;
        }
        this.isSaving = true;
        try {
            const savedId = await saveProductRecord({ record: this.editRecord });
            const fonId = this.editRecord.Id || savedId;
            if (this._activeSubtype === 'Family of Needs') {
                await setFonCustomerTypes({ fonId, customerTypeIds: [...this._editModalCtSet] });
                this._fonCtMap = { ...this._fonCtMap, [fonId]: new Set(this._editModalCtSet) };
            }
            this._showToast('Success', `${this._activeSubtype} saved`, 'success');
            this.isModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    async _saveBulk() {
        const filled = this.bulkRows.filter(r => r.name.trim());
        if (!filled.length) {
            this._showToast('Validation', 'Enter at least one name', 'error');
            return;
        }
        const records = filled.map(r => ({
            Name: r.name.trim(),
            Dictionary_Sub_Type__c: this._activeSubtype,
            Related_Family_of_Needs__c: this.isProductFamily ? (this.bulkFonId || null) : null
        }));
        this.isSaving = true;
        try {
            await saveProductRecordsBulk({ recordsJson: JSON.stringify(records) });
            const label = filled.length === 1 ? this._activeSubtype : `${filled.length} ${this._activeSubtype} entries`;
            this._showToast('Success', `${label} saved`, 'success');
            this.isModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    // ── Delete ──────────────────────────────────────────────────────────────

    handleDeleteRecord(e) {
        this._pendingDeleteId = e.currentTarget.dataset.id;
        this._pendingDeleteName = e.currentTarget.dataset.name || 'this record';
        this.isDeleteModalOpen = true;
    }
    handleCancelDelete() {
        this._pendingDeleteId = null;
        this._pendingDeleteName = '';
        this.isDeleteModalOpen = false;
    }
    async handleConfirmDelete() {
        const id = this._pendingDeleteId;
        this.isDeleteModalOpen = false;
        this._pendingDeleteId = null;
        this._pendingDeleteName = '';
        try {
            await deleteDictionaryRecord({ recordId: id });
            this._showToast('Success', 'Record deleted', 'success');
            await refreshApex(this._wiredResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || e.message, 'error');
        }
    }

    handleCloseModal() { this.isModalOpen = false; }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}