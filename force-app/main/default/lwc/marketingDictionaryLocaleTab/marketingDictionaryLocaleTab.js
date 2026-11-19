import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getLocales from '@salesforce/apex/MarketingDictionaryManagerController.getLocales';
import saveLocale from '@salesforce/apex/MarketingDictionaryManagerController.saveLocale';
import setDefaultLocale from '@salesforce/apex/MarketingDictionaryManagerController.setDefaultLocale';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import { formatLocaleToken, parseLocale } from 'c/copyMessageNaming';
import {
    runDictionaryDeleteWithDependencyCheck,
    isDependencyBlockedMessage,
    fetchDictionaryDeleteReport,
    reportHasDependencies
} from 'c/marketingDictionaryDeleteHelper';

const EMPTY_LOCALE = () => ({
    Name: '',
    Dictionary_Sub_Type__c: 'Locale',
    Topic_Description__c: '',
    Is_Active__c: true,
    Is_Default__c: false
});

export default class MarketingDictionaryLocaleTab extends LightningElement {
    @track isLoading = true;
    @track isSaving = false;
    @track isModalOpen = false;
    @track editLocale = EMPTY_LOCALE();
    @track editCountryCode = '';
    @track editLanguageCode = '';
    @track dependencyReport = null;

    _records = [];

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
            .map(rec => ({
                ...rec,
                isActive: rec.Is_Active__c === true,
                isDefault: rec.Is_Default__c === true,
                defaultDisabled: rec.Is_Active__c !== true || this.isSaving
            }));
    }
    get hasLocales() { return this.locales.length > 0; }
    get localeCount() { return this.locales.length; }
    get modalTitle() { return this.editLocale.Id ? 'Edit Locale' : 'Add Locale'; }
    get editPreview() {
        return formatLocaleToken(this.editCountryCode, this.editLanguageCode) || '—';
    }

    handleNew() {
        this.editLocale = EMPTY_LOCALE();
        this.editCountryCode = '';
        this.editLanguageCode = '';
        this.isModalOpen = true;
    }

    handleEdit(e) {
        const rec = this._records.find(r => r.Id === e.currentTarget.dataset.id);
        if (!rec) return;
        this.editLocale = { ...rec };
        const parsed = parseLocale(rec.Name);
        this.editCountryCode = parsed.countryCode ? parsed.countryCode.toLowerCase() : '';
        this.editLanguageCode = parsed.language || '';
        this.isModalOpen = true;
    }

    closeModal() { this.isModalOpen = false; }

    handleCountryChange(e) { this.editCountryCode = e.target.value; }
    handleLanguageChange(e) { this.editLanguageCode = e.target.value; }
    handleDescriptionChange(e) {
        this.editLocale = { ...this.editLocale, Topic_Description__c: e.target.value };
    }

    async handleSave() {
        const token = formatLocaleToken(this.editCountryCode, this.editLanguageCode);
        if (!token || token.indexOf('-') < 0) {
            this._toast('Validation', 'Country code and language code are required.', 'warning');
            return;
        }
        const record = {
            Id: this.editLocale.Id,
            Name: token,
            Dictionary_Sub_Type__c: 'Locale',
            Topic_Description__c: this.editLocale.Topic_Description__c,
            Is_Active__c: this.editLocale.Id ? this.editLocale.Is_Active__c === true : true,
            Is_Default__c: this.editLocale.Id ? this.editLocale.Is_Default__c === true : !this._records.some(r => r.Is_Default__c)
        };
        if (await this._save(record, 'Saved.')) {
            this.isModalOpen = false;
        }
    }

    async handleActiveToggle(e) {
        const id = e.target.dataset.id;
        const checked = e.target.checked === true;
        const ok = await this._save({ Id: id, Is_Active__c: checked }, checked ? 'Locale activated.' : 'Locale deactivated.');
        if (!ok) {
            e.target.checked = !checked;
        }
    }

    async handleDefaultToggle(e) {
        const input = e.target;
        const id = input.dataset.id;
        const checked = input.checked === true;
        // Keep showing the saved state until the backend confirms the change.
        input.checked = !checked;
        if (this.isSaving) {
            return;
        }
        this.isSaving = true;
        try {
            this._records = await setDefaultLocale({ recordId: id, makeDefault: checked });
            this._toast(
                'Success',
                checked ? 'Default locale updated.' : 'Default locale cleared.',
                'success'
            );
        } catch (err) {
            this._toast('Error', err.body?.message || err.message || 'Default locale could not be saved.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    renderedCallback() {
        // Native checkboxes keep their own checked state, so the Default column is re-synced from the saved rows.
        this.template.querySelectorAll('input.locale-default-cb').forEach(el => {
            const rec = this._records.find(r => r.Id === el.dataset.id);
            if (rec) {
                el.checked = rec.Is_Default__c === true;
            }
        });
    }

    async handleDelete(e) {
        const { id, name } = e.currentTarget.dataset;
        const confirmed = await LightningConfirm.open({
            message: `Delete locale "${name}"?`,
            label: 'Delete Locale',
            theme: 'warning'
        });
        if (!confirmed) return;
        this.isSaving = true;
        try {
            const deleted = await runDictionaryDeleteWithDependencyCheck({
                recordId: id,
                deleteFn: () => deleteDictionaryRecord({ recordId: id }),
                onBlocked: (report) => { this.dependencyReport = report; }
            });
            if (!deleted) {
                return;
            }
            this._toast('Success', 'Deleted.', 'success');
            this._records = await getLocales();
        } catch (err) {
            const message = err.body?.message || err.message || 'Delete failed.';
            if (isDependencyBlockedMessage(message)) {
                const report = await fetchDictionaryDeleteReport(id);
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

    async _save(record, successMessage) {
        this.isSaving = true;
        try {
            this._records = await saveLocale({ record });
            this._toast('Success', successMessage, 'success');
            return true;
        } catch (err) {
            this._toast('Error', err.body?.message || 'Save failed.', 'error');
            return false;
        } finally {
            this.isSaving = false;
        }
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
