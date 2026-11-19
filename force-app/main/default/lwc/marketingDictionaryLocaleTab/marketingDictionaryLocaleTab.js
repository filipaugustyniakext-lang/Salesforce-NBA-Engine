import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getLocales from '@salesforce/apex/MarketingDictionaryManagerController.getLocales';
import saveLocale from '@salesforce/apex/MarketingDictionaryManagerController.saveLocale';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import { formatLocaleToken, parseLocale } from 'c/copyMessageNaming';

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
        const id = e.target.dataset.id;
        const checked = e.target.checked === true;
        const snapshot = this._records.map(rec => ({ ...rec }));
        // Only one locale is the default. Turning one on clears every other row immediately.
        this._records = this._records.map(rec => {
            if (rec.Id === id) {
                return {
                    ...rec,
                    Is_Default__c: checked,
                    Is_Active__c: checked ? true : rec.Is_Active__c
                };
            }
            return checked ? { ...rec, Is_Default__c: false } : rec;
        });
        const record = { Id: id, Is_Default__c: checked };
        if (checked) {
            record.Is_Active__c = true;
        }
        const ok = await this._save(
            record,
            checked ? 'Default locale updated.' : 'Default locale cleared.'
        );
        if (!ok) {
            this._records = snapshot;
            e.target.checked = !checked;
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
        this.isSaving = true;
        try {
            await deleteDictionaryRecord({ recordId: id });
            this._toast('Success', 'Deleted.', 'success');
            this._records = await getLocales();
        } catch (err) {
            const message = err.body?.message || err.message || 'Delete failed.';
            const blocked = message.includes('dependencies');
            this._toast(blocked ? 'Cannot delete' : 'Error', message, blocked ? 'warning' : 'error');
        } finally {
            this.isSaving = false;
        }
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
