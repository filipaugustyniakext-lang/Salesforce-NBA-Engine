import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getPersonRecords from '@salesforce/apex/MarketingDictionaryManagerController.getPersonRecords';
import saveProductRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecord';
import saveProductRecordsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecordsBulk';
import getFilterCount from '@salesforce/apex/PersonFilterCountController.getFilterCount';
import getTotalCount from '@salesforce/apex/PersonFilterCountController.getTotalCount';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import { confirmDictionaryRenameIfNeeded } from 'c/marketingDictionaryRenamePrompt';
import {
    runDictionaryDeleteWithDependencyCheck,
    isDependencyBlockedMessage,
    fetchDictionaryDeleteReport,
    reportHasDependencies
} from 'c/marketingDictionaryDeleteHelper';

let _key = 0;
const newKey = () => String(++_key);
const newRow = (i) => ({ key: newKey(), name: '', label: `Name ${i}` });
const EMPTY_RECORD = () => ({ Name: '', Dictionary_Sub_Type__c: '' });
const COUNT_CONCURRENCY = 4;
const RESTART_GUARD_MS = 2000;
const numberFormat = new Intl.NumberFormat();

export default class MarketingDictionaryPersonTab extends LightningElement {

    _editOriginalName = '';

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
            this.startCounting();
        } else if (result.error) {
            this._showToast('Error', result.error.body?.message || 'Failed to load records', 'error');
        }
    }

    get customerTypes()     { return this.withCounts(this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Customer Type')); }
    get audienceTypes()     { return this.withCounts(this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Audience Type')); }
    get customerTypeCount() { return this.customerTypes.length; }
    get audienceTypeCount() { return this.audienceTypes.length; }
    get hasCustomerTypes()  { return !this.isLoading && this.customerTypes.length > 0; }
    get hasAudienceTypes()  { return !this.isLoading && this.audienceTypes.length > 0; }

    // ─── Live Data360 counts ─────────────────────────────────────────────────
    // Every value that has a filter is counted in its own call, at most COUNT_CONCURRENCY at a time, so the list
    // fills in as results arrive. Counts are never stored; they run whenever the tab opens or Refresh is pressed.

    @track counts = {};
    total = null;
    _countRun = 0;
    _countStartedAt = 0;

    disconnectedCallback() {
        this._countRun += 1;
    }

    /** Called by the app when the Person tab is opened again. */
    @api
    refreshCounts() {
        if (!this._allRecords.length || Date.now() - this._countStartedAt < RESTART_GUARD_MS) return;
        this.startCounting();
    }

    handleRefreshCounts() {
        this.startCounting();
    }

    get isCounting() {
        return Object.values(this.counts).some(entry => entry.status === 'loading');
    }

    get hasTotal() {
        return this.total !== null && this.total !== undefined;
    }

    get totalNumber() {
        return this.hasTotal ? numberFormat.format(this.total) : '';
    }

    get totalText() {
        return this.hasTotal ? `${numberFormat.format(this.total)} unified individuals in total` : '';
    }

    withCounts(records) {
        return records.map(rec => {
            const entry = this.counts[rec.Id] || { status: rec.Data360_Filter_JSON__c ? 'loading' : 'none' };
            const share = entry.status === 'ok' && this.hasTotal && this.total > 0
                ? (entry.count / this.total) * 100
                : null;
            return {
                ...rec,
                isLoadingCount: entry.status === 'loading',
                hasCount: entry.status === 'ok',
                hasNoFilter: entry.status === 'none',
                hasCountError: entry.status === 'error',
                countText: entry.status === 'ok' ? numberFormat.format(entry.count) : '',
                countTitle: entry.status === 'ok'
                    ? `${numberFormat.format(entry.count)} unified individuals${share === null ? '' : ` (${share > 0 && share < 0.1 ? '<0.1' : share.toFixed(1)}% of all unified individuals)`}`
                    : '',
                shareText: share === null ? '' : `${share > 0 && share < 0.1 ? '<0.1' : share.toFixed(1)}%`,
                countError: entry.error || ''
            };
        });
    }

    startCounting() {
        const run = ++this._countRun;
        this._countStartedAt = Date.now();
        const next = {};
        const queue = [];
        this._allRecords.forEach(rec => {
            if (rec.Data360_Filter_JSON__c) {
                next[rec.Id] = { status: 'loading' };
                queue.push(rec);
            } else {
                next[rec.Id] = { status: 'none' };
            }
        });
        this.counts = next;
        if (!queue.length) {
            this.total = null;
            return;
        }
        getTotalCount()
            .then(total => {
                if (run === this._countRun) this.total = total;
            })
            .catch(() => {
                if (run === this._countRun) this.total = null;
            });
        const worker = async () => {
            while (queue.length && run === this._countRun) {
                const rec = queue.shift();
                let entry;
                try {
                    const count = await getFilterCount({ filterJson: rec.Data360_Filter_JSON__c });
                    entry = { status: 'ok', count };
                } catch (error) {
                    entry = { status: 'error', error: error?.body?.message || error?.message || 'The count failed.' };
                }
                if (run !== this._countRun) return;
                this.counts = { ...this.counts, [rec.Id]: entry };
            }
        };
        const workers = Math.min(COUNT_CONCURRENCY, queue.length);
        for (let i = 0; i < workers; i++) {
            worker();
        }
    }

    // ─── Data360 filter in the edit modal ────────────────────────────────────

    filterError = '';

    get editFilterJson() {
        return this.editRecord?.Data360_Filter_JSON__c || '';
    }

    handleFilterChange(event) {
        this.editRecord = { ...this.editRecord, Data360_Filter_JSON__c: event.detail.value };
    }

    handleFilterValidity(event) {
        this.filterError = event.detail.error || '';
    }

    get modalClass() {
        return `slds-modal slds-fade-in-open${this._isEditMode ? ' slds-modal_medium' : ''}`;
    }

    @track isModalOpen = false;
    @track isDeleteModalOpen = false;
    @track dependencyReport = null;
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
        this._editOriginalName = this.editRecord.Name || '';
        this.filterError = '';
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
            if (this.filterError) { this._showToast('Validation', `Fix the Data360 filter first: ${this.filterError}`, 'error'); return; }
            this.isSaving = true;
            try {
                const proceed = await confirmDictionaryRenameIfNeeded(
                    this.editRecord.Id,
                    this._editOriginalName,
                    this.editRecord.Name
                );
                if (!proceed) {
                    this.isSaving = false;
                    return;
                }
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
        this._pendingDeleteId = null;
        this._pendingDeleteName = '';
        try {
            const deleted = await runDictionaryDeleteWithDependencyCheck({
                recordId: id,
                deleteFn: () => deleteDictionaryRecord({ recordId: id }),
                onBlocked: (report) => { this.dependencyReport = report; }
            });
            if (!deleted) {
                return;
            }
            this._showToast('Success', 'Record deleted', 'success');
            await refreshApex(this._wiredResult);
        } catch (e) {
            const message = e.body?.message || e.message || 'Delete failed.';
            if (isDependencyBlockedMessage(message) && id) {
                const report = await fetchDictionaryDeleteReport(id);
                if (reportHasDependencies(report)) {
                    this.dependencyReport = report;
                    return;
                }
            }
            this._showToast('Error', message, 'error');
        }
    }

    handleCloseDependencyDialog() {
        this.dependencyReport = null;
    }

    get isDependencyDialogOpen() {
        return reportHasDependencies(this.dependencyReport);
    }

    handleCloseModal() { this.isModalOpen = false; }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}