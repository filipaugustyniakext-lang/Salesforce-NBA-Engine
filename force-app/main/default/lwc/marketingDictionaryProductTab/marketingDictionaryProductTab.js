import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getProductRecords from '@salesforce/apex/MarketingDictionaryManagerController.getProductRecords';
import saveProductRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecord';
import saveProductRecordsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecordsBulk';
import saveProductRecordsBulkUpdate from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecordsBulkUpdate';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import getFonCustomerTypes from '@salesforce/apex/MarketingDictionaryManagerController.getFonCustomerTypes';
import setFonCustomerTypes from '@salesforce/apex/MarketingDictionaryManagerController.setFonCustomerTypes';

let _keyCounter = 0;
const newKey = () => String(++_keyCounter);
const EMPTY_RECORD = () => ({
    Name: '',
    Dictionary_Sub_Type__c: '',
    Related_Family_of_Needs__c: null,
    Related_Product_Type__c: null,
    For_Tagging_Only__c: false
});
const newRow = (index) => ({ key: newKey(), name: '', label: `Name ${index}` });
const newBulkEditRow = (rec) => ({
    key: rec.Id,
    id: rec.Id,
    name: rec.Name || '',
    fonId: rec.Related_Family_of_Needs__c || '',
    productTypeId: rec.Related_Product_Type__c || '',
    forTaggingOnly: rec.For_Tagging_Only__c === true,
    customerTypeSummary: (rec.inheritedCtList || []).map(ct => ct.Name).join(', ') || '—'
});

export default class MarketingDictionaryProductTab extends LightningElement {

    @track activeSubTab = 'productFamily';

    get isTab() {
        return {
            productFamily: this.activeSubTab === 'productFamily',
            productType: this.activeSubTab === 'productType'
        };
    }
    get vtabClass() {
        const base = 'vtab-item';
        const active = base + ' vtab-item_active';
        return {
            productFamily: this.activeSubTab === 'productFamily' ? active : base,
            productType: this.activeSubTab === 'productType' ? active : base
        };
    }
    get vtabSelected() {
        return {
            productFamily: this.activeSubTab === 'productFamily',
            productType: this.activeSubTab === 'productType'
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

    _decorateProductFamily(rec) {
        const fonCtSet = rec.Related_Family_of_Needs__c
            ? (this._fonCtMap[rec.Related_Family_of_Needs__c] || new Set())
            : new Set();
        const inheritedCtList = this.customerTypes.filter(ct => fonCtSet.has(ct.Id));
        return {
            ...rec,
            inheritedCtList,
            customerTypeSortKey: inheritedCtList.map(ct => ct.Name).join(', ').toLowerCase()
        };
    }

    get filteredSortedProductFamilies() {
        let list = this.productFamilies.map(rec => this._decorateProductFamily(rec));
        if (this._filterFonId) {
            list = list.filter(r => r.Related_Family_of_Needs__c === this._filterFonId);
        }
        if (this._filterProductTypeId) {
            list = list.filter(r => r.Related_Product_Type__c === this._filterProductTypeId);
        }
        if (this._filterCustomerTypeId) {
            list = list.filter(r =>
                r.inheritedCtList.some(ct => ct.Id === this._filterCustomerTypeId)
            );
        }
        const asc = this._sortAsc ? 1 : -1;
        list.sort((a, b) => {
            let av;
            let bv;
            switch (this._sortField) {
                case 'fon':
                    av = (a.Related_Family_of_Needs__r?.Name || '').toLowerCase();
                    bv = (b.Related_Family_of_Needs__r?.Name || '').toLowerCase();
                    break;
                case 'productType':
                    av = (a.Related_Product_Type__r?.Name || '').toLowerCase();
                    bv = (b.Related_Product_Type__r?.Name || '').toLowerCase();
                    break;
                case 'customerType':
                    av = a.customerTypeSortKey || '';
                    bv = b.customerTypeSortKey || '';
                    break;
                default:
                    av = (a.Name || '').toLowerCase();
                    bv = (b.Name || '').toLowerCase();
            }
            return av < bv ? -1 * asc : av > bv ? 1 * asc : 0;
        });
        return list;
    }

    get productFamilyRows() {
        const selected = new Set(this._selectedPfIds);
        return this.filteredSortedProductFamilies.map(rec => ({
            ...rec,
            rowKey: rec.Id,
            isSelected: selected.has(rec.Id),
            showTaggingBadge: rec.For_Tagging_Only__c === true
        }));
    }

    get filteredProductFamilyCount() { return this.filteredSortedProductFamilies.length; }
    get hasFilteredProductFamilies() { return !this.isLoading && this.filteredSortedProductFamilies.length > 0; }
    get isFilterActive() {
        return !!(this._filterFonId || this._filterProductTypeId || this._filterCustomerTypeId);
    }
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
    _filterProductTypeId = null;
    _filterCustomerTypeId = null;
    @track _selectedPfIds = [];

    get sortByNameIcon() { return this._sortIcon('name'); }
    get sortByFonIcon() { return this._sortIcon('fon'); }
    get sortByProductTypeIcon() { return this._sortIcon('productType'); }
    get sortByCustomerTypeIcon() { return this._sortIcon('customerType'); }
    get sortByNameTitle() { return this._sortTitle('name', 'Name'); }
    get sortByFonTitle() { return this._sortTitle('fon', 'Family of Needs'); }
    get sortByProductTypeTitle() { return this._sortTitle('productType', 'Product Type'); }
    get sortByCustomerTypeTitle() { return this._sortTitle('customerType', 'Customer Type'); }

    _sortIcon(field) {
        return this._sortField !== field ? 'utility:sort' : this._sortAsc ? 'utility:arrowup' : 'utility:arrowdown';
    }

    _sortTitle(field, label) {
        if (this._sortField !== field) {
            return `Sort by ${label}`;
        }
        return this._sortAsc ? `${label} A→Z (click to reverse)` : `${label} Z→A (click to reverse)`;
    }

    get filterFonId() { return this._filterFonId || ''; }
    get filterProductTypeId() { return this._filterProductTypeId || ''; }
    get filterCustomerTypeId() { return this._filterCustomerTypeId || ''; }

    get filterFonOptions() {
        return [{ label: 'All Families of Needs', value: '' }, ...this.familyOfNeeds.map(r => ({ label: r.Name, value: r.Id }))];
    }
    get filterProductTypeOptions() {
        return [{ label: 'All Product Types', value: '' }, ...this.productTypes.map(r => ({ label: r.Name, value: r.Id }))];
    }
    get filterCustomerTypeOptions() {
        return [{ label: 'All Customer Types', value: '' }, ...this.customerTypes.map(r => ({ label: r.Name, value: r.Id }))];
    }

    get hasPfSelection() { return this._selectedPfIds.length > 0; }
    get pfSelectionCount() { return this._selectedPfIds.length; }
    get bulkActionsDisabled() { return !this.hasPfSelection; }
    get allPfRowsSelected() {
        const visible = this.filteredSortedProductFamilies;
        return visible.length > 0 && visible.every(r => this._selectedPfIds.includes(r.Id));
    }
    get somePfRowsSelected() {
        return this._selectedPfIds.length > 0 && !this.allPfRowsSelected;
    }

    handleFilterFonChange(e) { this._filterFonId = e.detail.value || null; this._clearPfSelection(); }
    handleFilterProductTypeChange(e) { this._filterProductTypeId = e.detail.value || null; this._clearPfSelection(); }
    handleFilterCustomerTypeChange(e) { this._filterCustomerTypeId = e.detail.value || null; this._clearPfSelection(); }

    _clearPfSelection() { this._selectedPfIds = []; }

    handlePfRowSelect(event) {
        const id = event.target.dataset.id;
        const checked = event.target.checked;
        if (!id) return;
        if (checked) {
            if (!this._selectedPfIds.includes(id)) {
                this._selectedPfIds = [...this._selectedPfIds, id];
            }
        } else {
            this._selectedPfIds = this._selectedPfIds.filter(rowId => rowId !== id);
        }
    }

    handlePfSelectAll(event) {
        const checked = event.target.checked;
        if (checked) {
            this._selectedPfIds = this.filteredSortedProductFamilies.map(r => r.Id);
        } else {
            this._clearPfSelection();
        }
    }
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
    @track bulkProductTypeId = null;
    @track bulkEditRows = [];
    @track isBulkEditModalOpen = false;
    @track _bulkDeleteMode = false;

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
    get hasCustomerTypeOptions() { return this.customerTypes.length > 0; }
    get customerTypePickerLabel() {
        return this.bulkRows.length > 1
            ? 'Customer Types (applies to all entries below)'
            : 'Customer Types';
    }
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
        this.bulkProductTypeId = null;
        this._editModalCtSet = new Set();
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
        const isCheckbox = event.target?.type === 'checkbox';
        const value = isCheckbox ? event.target.checked : (event.detail.value || null);
        this.editRecord = { ...this.editRecord, [field]: value };
    }

    handleEditModalCtChange(event) {
        const ctId = event.currentTarget.dataset.ctId;
        const updated = new Set(this._editModalCtSet);
        if (event.target.checked) { updated.add(ctId); } else { updated.delete(ctId); }
        this._editModalCtSet = updated;
    }

    // ── Bulk mode handlers ──────────────────────────────────────────────────

    handleBulkFonChange(e) { this.bulkFonId = e.detail.value || null; }
    handleBulkProductTypeChange(e) { this.bulkProductTypeId = e.detail.value || null; }
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

    handleOpenBulkEdit() {
        const selected = new Set(this._selectedPfIds);
        const rows = this.productFamilies
            .filter(rec => selected.has(rec.Id))
            .map(rec => newBulkEditRow(this._decorateProductFamily(rec)));
        if (!rows.length) {
            this._showToast('Bulk edit', 'Select at least one Product Family.', 'info');
            return;
        }
        this.bulkEditRows = rows;
        this.isBulkEditModalOpen = true;
    }

    handleCloseBulkEditModal() {
        this.isBulkEditModalOpen = false;
        this.bulkEditRows = [];
    }

    handleBulkEditRowChange(event) {
        const key = event.currentTarget.dataset.key;
        const field = event.currentTarget.dataset.field;
        const isCheckbox = event.target?.type === 'checkbox';
        const value = isCheckbox ? event.target.checked : event.detail.value;
        this.bulkEditRows = this.bulkEditRows.map(row => {
            if (row.key !== key) return row;
            if (field === 'name') return { ...row, name: value };
            if (field === 'fonId') return { ...row, fonId: value || '' };
            if (field === 'productTypeId') return { ...row, productTypeId: value || '' };
            if (field === 'forTaggingOnly') return { ...row, forTaggingOnly: value === true };
            return row;
        });
    }

    async handleSaveBulkEdit() {
        const records = this.bulkEditRows
            .filter(r => r.name?.trim())
            .map(r => ({
                Id: r.id,
                Name: r.name.trim(),
                Dictionary_Sub_Type__c: 'Product Family',
                Related_Family_of_Needs__c: r.fonId || null,
                Related_Product_Type__c: r.productTypeId || null,
                For_Tagging_Only__c: r.forTaggingOnly === true
            }));
        if (!records.length) {
            this._showToast('Validation', 'Enter at least one name', 'error');
            return;
        }
        this.isSaving = true;
        try {
            await saveProductRecordsBulkUpdate({ recordsJson: JSON.stringify(records) });
            this._showToast('Success', `${records.length} Product Famil${records.length === 1 ? 'y' : 'ies'} updated`, 'success');
            this.handleCloseBulkEditModal();
            this._clearPfSelection();
            await refreshApex(this._wiredResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleBulkDeleteRequest() {
        if (!this._selectedPfIds.length) return;
        this._bulkDeleteMode = true;
        this._pendingDeleteName = `${this._selectedPfIds.length} Product Famil${this._selectedPfIds.length === 1 ? 'y' : 'ies'}`;
        this.isDeleteModalOpen = true;
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
            Related_Family_of_Needs__c: this.isProductFamily ? (this.bulkFonId || null) : null,
            Related_Product_Type__c: this.isProductFamily ? (this.bulkProductTypeId || null) : null,
            For_Tagging_Only__c: false
        }));
        this.isSaving = true;
        try {
            await saveProductRecordsBulk({
                recordsJson: JSON.stringify(records),
                customerTypeIds: this.isFamilyOfNeeds ? [...this._editModalCtSet] : null
            });
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
        this._bulkDeleteMode = false;
        this.isDeleteModalOpen = false;
    }
    async handleConfirmDelete() {
        if (this._bulkDeleteMode) {
            const ids = [...this._selectedPfIds];
            this.isDeleteModalOpen = false;
            this._bulkDeleteMode = false;
            this._pendingDeleteName = '';
            let deleted = 0;
            let blocked = 0;
            for (const id of ids) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await deleteDictionaryRecord({ recordId: id });
                    deleted += 1;
                } catch (e) {
                    blocked += 1;
                }
            }
            this._clearPfSelection();
            await refreshApex(this._wiredResult);
            if (deleted) {
                this._showToast('Deleted', `${deleted} record(s) removed.`, 'success');
            }
            if (blocked) {
                this._showToast('Some deletes blocked', `${blocked} record(s) still have dependencies.`, 'warning');
            }
            return;
        }
        const id = this._pendingDeleteId;
        this.isDeleteModalOpen = false;
        this._pendingDeleteId = null;
        this._pendingDeleteName = '';
        try {
            await deleteDictionaryRecord({ recordId: id });
            this._showToast('Success', 'Record deleted', 'success');
            await refreshApex(this._wiredResult);
        } catch (e) {
            const message = e.body?.message || e.message || 'Delete failed.';
            const blockedByDependency = message.includes('must be removed before it can be deleted')
                || message.includes('Please remove dependencies first');
            this._showToast(
                blockedByDependency ? 'Cannot delete' : 'Error',
                message,
                blockedByDependency ? 'warning' : 'error'
            );
        }
    }

    handleCloseModal() { this.isModalOpen = false; }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}