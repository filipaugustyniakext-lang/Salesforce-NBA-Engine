import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getLocales from '@salesforce/apex/MarketingDictionaryManagerController.getLocales';
import saveLocale from '@salesforce/apex/MarketingDictionaryManagerController.saveLocale';
import saveLocales from '@salesforce/apex/MarketingDictionaryManagerController.saveLocales';
import updateLocaleDescriptions from '@salesforce/apex/MarketingDictionaryManagerController.updateLocaleDescriptions';
import setDefaultLocale from '@salesforce/apex/MarketingDictionaryManagerController.setDefaultLocale';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import getSalesforceLocales from '@salesforce/apex/SalesforceLocaleController.getSalesforceLocales';
import { buildLocaleLabelMap, localeLabelFor } from 'c/salesforceLocaleUtils';
import {
    runDictionaryDeleteWithDependencyCheck,
    runBulkDictionaryDeleteWithDependencyCheck,
    combineBlockedReports,
    isDependencyBlockedMessage,
    fetchDictionaryDeleteReport,
    reportHasDependencies
} from 'c/marketingDictionaryDeleteHelper';

const EMPTY_LOCALE = () => ({
    Topic_Description__c: ''
});

export default class MarketingDictionaryLocaleTab extends LightningElement {
    @track isLoading = true;
    @track isSaving = false;
    @track isModalOpen = false;
    @track modalMode = 'create';
    @track editLocale = EMPTY_LOCALE();
    @track newLocales = [];
    @track selectedLocaleIds = [];
    @track dependencyReport = null;

    _records = [];
    _localeLabels = new Map();
    _localeLabelsError;
    _editIds = [];

    @wire(getSalesforceLocales)
    wiredSalesforceLocales({ data, error }) {
        if (data) {
            this._localeLabels = buildLocaleLabelMap(data);
            this._localeLabelsError = undefined;
        } else if (error) {
            this._localeLabelsError = error.body?.message || 'Salesforce locale labels could not be loaded.';
        }
    }

    connectedCallback() {
        this._load();
    }

    async _load() {
        try {
            this._records = await getLocales();
        } catch (err) {
            this._toast('Error', err.body?.message || 'Failed to load locales.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    get locales() {
        return [...this._records]
            .sort((a, b) => {
                if (!!a.Is_Default__c !== !!b.Is_Default__c) return a.Is_Default__c ? -1 : 1;
                return String(a.Name || '').localeCompare(String(b.Name || ''));
            })
            .map(rec => {
                const isSelected = this.selectedLocaleIds.includes(rec.Id);
                return {
                    ...rec,
                    localeLabel: localeLabelFor(rec.Name, this._localeLabels),
                    isSelected,
                    checkboxId: `locale-cb-${rec.Id}`,
                    rowClass: isSelected ? 'locale-row_selected' : '',
                    isActive: rec.Is_Active__c === true,
                    isDefault: rec.Is_Default__c === true,
                    defaultDisabled: rec.Is_Active__c !== true || this.isSaving
                };
            });
    }
    get hasLocales() { return this.locales.length > 0; }
    get localeCount() { return this.locales.length; }
    get configuredLocaleCodes() { return this._records.map(rec => rec.Name); }
    get localeSelectedCount() { return this.selectedLocaleIds.length; }
    get hasLocaleSelection() { return this.selectedLocaleIds.length > 0; }
    get isAllLocalesSelected() {
        return this.locales.length > 0 && this.locales.every(loc => loc.isSelected);
    }
    get isSomeLocalesSelected() {
        const n = this.locales.filter(loc => loc.isSelected).length;
        return n > 0 && n < this.locales.length;
    }
    get isCreating() { return this.modalMode === 'create'; }
    get isEditing() { return this.modalMode !== 'create'; }
    get modalTitle() {
        if (this.modalMode === 'create') return 'Add Locales';
        if (this._editIds.length > 1) return `Edit ${this._editIds.length} locales`;
        return 'Edit Locale';
    }
    get editLocaleDisplay() {
        if (this._editIds.length > 1) {
            return `${this._editIds.length} locales`;
        }
        const rec = this._records.find(row => row.Id === this._editIds[0]);
        if (!rec) return '';
        const label = localeLabelFor(rec.Name, this._localeLabels);
        return label ? `${label} (${rec.Name})` : rec.Name;
    }
    get editDescriptionNote() {
        if (this._editIds.length < 2) {
            return 'The locale code cannot be changed.';
        }
        const descriptions = new Set(this._selectedRecords(this._editIds).map(rec => rec.Topic_Description__c || ''));
        return descriptions.size > 1
            ? 'Selected locales have different descriptions. Saving replaces each of them with the text below. Locale codes stay as they are.'
            : 'This description replaces the description on every selected locale. Locale codes stay as they are.';
    }
    get localeLabelsError() { return this._localeLabelsError; }

    handleNew() {
        this.modalMode = 'create';
        this._editIds = [];
        this.editLocale = EMPTY_LOCALE();
        this.newLocales = [];
        this.isModalOpen = true;
    }

    handleEdit(e) {
        this._openEdit([e.currentTarget.dataset.id]);
    }

    handleBulkEdit() {
        this._openEdit([...this.selectedLocaleIds]);
    }

    _openEdit(ids) {
        const records = this._selectedRecords(ids);
        if (!records.length) return;
        this.modalMode = 'edit';
        this._editIds = records.map(rec => rec.Id);
        const descriptions = new Set(records.map(rec => rec.Topic_Description__c || ''));
        this.editLocale = {
            Topic_Description__c: descriptions.size === 1 ? records[0].Topic_Description__c || '' : ''
        };
        this.isModalOpen = true;
    }

    closeModal() { this.isModalOpen = false; }

    handleLocaleSelection(e) {
        this.newLocales = e.detail.values || [];
    }

    handleDescriptionChange(e) {
        this.editLocale = { ...this.editLocale, Topic_Description__c: e.target.value };
    }

    async handleSave() {
        if (this.modalMode === 'create') {
            const picker = this.template.querySelector('c-salesforce-locale-picker');
            if (!this.newLocales.length) {
                if (picker) picker.reportValidity();
                this._toast('Validation', 'Select at least one locale.', 'warning');
                return;
            }
            const ok = await this._runSave(
                () => saveLocales({
                    localeCodes: this.newLocales.map(row => row.value),
                    description: this.editLocale.Topic_Description__c
                }),
                this.newLocales.length === 1 ? 'Locale added.' : `${this.newLocales.length} locales added.`
            );
            if (ok) this.isModalOpen = false;
            return;
        }
        const ok = await this._runSave(
            () => updateLocaleDescriptions({
                recordIds: this._editIds,
                description: this.editLocale.Topic_Description__c
            }),
            'Saved.'
        );
        if (ok) this.isModalOpen = false;
    }

    handleLocaleRowCheckbox(e) {
        const id = e.target.dataset.id;
        this.selectedLocaleIds = e.target.checked
            ? [...new Set([...this.selectedLocaleIds, id])]
            : this.selectedLocaleIds.filter(rowId => rowId !== id);
    }

    handleLocaleSelectAll(e) {
        this.selectedLocaleIds = e.target.checked ? this.locales.map(loc => loc.Id) : [];
    }

    handleClearLocaleSelection() {
        this.selectedLocaleIds = [];
    }

    async handleActiveToggle(e) {
        const id = e.target.dataset.id;
        const checked = e.target.checked === true;
        const ok = await this._runSave(
            () => saveLocale({ record: { Id: id, Is_Active__c: checked } }),
            checked ? 'Locale activated.' : 'Locale deactivated.'
        );
        if (!ok) {
            e.target.checked = !checked;
        }
    }

    async handleDefaultToggle(e) {
        const input = e.target;
        const id = input.dataset.id;
        const checked = input.checked === true;
        input.checked = !checked;
        if (this.isSaving) return;
        this.isSaving = true;
        try {
            this._records = await setDefaultLocale({ recordId: id, makeDefault: checked });
            this._toast('Success', checked ? 'Default locale updated.' : 'Default locale cleared.', 'success');
        } catch (err) {
            this._toast('Error', err.body?.message || err.message || 'Default locale could not be saved.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    renderedCallback() {
        this.template.querySelectorAll('input.locale-default-cb').forEach(el => {
            const rec = this._records.find(r => r.Id === el.dataset.id);
            if (rec) el.checked = rec.Is_Default__c === true;
        });
        this.template.querySelectorAll('input.locale-row-cb').forEach(el => {
            el.checked = this.selectedLocaleIds.includes(el.dataset.id);
        });
        const selectAll = this.template.querySelector('input.locale-select-all-cb');
        if (selectAll) {
            selectAll.indeterminate = this.isSomeLocalesSelected;
            selectAll.checked = this.isAllLocalesSelected;
        }
    }

    async handleDelete(e) {
        const { id, name } = e.currentTarget.dataset;
        const confirmed = await LightningConfirm.open({
            message: `Delete locale "${name}"?`,
            label: 'Delete Locale',
            theme: 'warning'
        });
        if (!confirmed) return;
        await this._deleteIds([id]);
    }

    async handleBulkDelete() {
        const ids = [...this.selectedLocaleIds];
        if (!ids.length) return;
        const confirmed = await LightningConfirm.open({
            message: `Delete ${ids.length} locale${ids.length === 1 ? '' : 's'}? Locales that are still in use are kept and listed.`,
            label: 'Delete Locales',
            theme: 'warning'
        });
        if (!confirmed) return;
        await this._deleteIds(ids);
    }

    async _deleteIds(ids) {
        this.isSaving = true;
        try {
            if (ids.length === 1) {
                const deleted = await runDictionaryDeleteWithDependencyCheck({
                    recordId: ids[0],
                    deleteFn: () => deleteDictionaryRecord({ recordId: ids[0] }),
                    onBlocked: (report) => { this.dependencyReport = report; }
                });
                if (!deleted) return;
                this.selectedLocaleIds = this.selectedLocaleIds.filter(id => id !== ids[0]);
                this._toast('Success', 'Deleted.', 'success');
                this._records = await getLocales();
                return;
            }
            const { deletedIds, blockedReports, failures } = await runBulkDictionaryDeleteWithDependencyCheck({
                recordIds: ids,
                deleteFn: (recordId) => deleteDictionaryRecord({ recordId })
            });
            const removed = new Set(deletedIds);
            this.selectedLocaleIds = this.selectedLocaleIds.filter(id => !removed.has(id));
            if (deletedIds.length) {
                this._toast('Success', `${deletedIds.length} deleted.`, 'success');
                this._records = await getLocales();
            }
            if (failures.length) {
                this._toast('Error', failures.map(f => f.message).join(' '), 'error');
            }
            const combined = combineBlockedReports(blockedReports);
            if (combined) this.dependencyReport = combined;
        } catch (err) {
            const message = err.body?.message || err.message || 'Delete failed.';
            if (ids.length === 1 && isDependencyBlockedMessage(message)) {
                const report = await fetchDictionaryDeleteReport(ids[0]);
                if (reportHasDependencies(report)) {
                    this.dependencyReport = report;
                    return;
                }
            }
            this._toast('Error', message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleCloseDependencyDialog() {
        this.dependencyReport = null;
    }

    get isDependencyDialogOpen() {
        return reportHasDependencies(this.dependencyReport);
    }

    _selectedRecords(ids) {
        const wanted = new Set(ids);
        return this._records.filter(rec => wanted.has(rec.Id));
    }

    async _runSave(action, successMessage) {
        this.isSaving = true;
        try {
            this._records = await action();
            if (successMessage) this._toast('Success', successMessage, 'success');
            return true;
        } catch (err) {
            this._toast('Error', err.body?.message || err.message || 'Save failed.', 'error');
            return false;
        } finally {
            this.isSaving = false;
        }
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
