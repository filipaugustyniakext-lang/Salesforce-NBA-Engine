import { LightningElement, api, wire } from 'lwc';
import getSalesforceLocales from '@salesforce/apex/SalesforceLocaleController.getSalesforceLocales';

const MAX_VISIBLE_OPTIONS = 60;

export default class SalesforceLocalePicker extends LightningElement {
    @api label = 'Locale';
    @api
    get value() { return this._value; }
    set value(v) { this._value = v || ''; }
    @api required = false;
    @api disabled = false;
    @api fieldLevelHelp;

    searchTerm = '';
    _value = '';
    _options = [];
    _loaded = false;
    _error;

    @wire(getSalesforceLocales)
    wiredLocales({ data, error }) {
        if (data) {
            this._options = data;
            this._loaded = true;
            this._error = undefined;
        } else if (error) {
            this._options = [];
            this._loaded = true;
            this._error = error.body?.message || error.message || 'Salesforce locales could not be loaded.';
        }
    }

    get isLoading() { return !this._loaded; }
    get hasError() { return !!this._error; }
    get errorMessage() { return this._error; }

    get selectedOption() {
        return this._options.find(o => o.value === this._value);
    }

    get selectedLabel() {
        return this.selectedOption ? this.selectedOption.label : '';
    }

    get comboboxOptions() {
        const q = (this.searchTerm || '').trim().toLowerCase();
        const matches = q
            ? this._options.filter(o =>
                o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
            : this._options;
        const visible = matches.slice(0, MAX_VISIBLE_OPTIONS).map(o => ({
            label: `${o.label} (${o.value})`,
            value: o.value
        }));
        const selected = this.selectedOption;
        if (selected && !visible.some(o => o.value === selected.value)) {
            visible.unshift({ label: `${selected.label} (${selected.value})`, value: selected.value });
        }
        return visible;
    }

    get matchCountLabel() {
        const q = (this.searchTerm || '').trim().toLowerCase();
        if (!q) return `${this._options.length} Salesforce locales. Type to narrow the list.`;
        const n = this._options.filter(o =>
            o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).length;
        if (n > MAX_VISIBLE_OPTIONS) return `${n} matches, showing the first ${MAX_VISIBLE_OPTIONS}.`;
        return `${n} match${n === 1 ? '' : 'es'}.`;
    }

    get placeholder() {
        return this.isLoading ? 'Loading locales…' : 'Select a locale…';
    }

    get showMatchCount() {
        return !this.isLoading && !this.hasError;
    }

    get isComboboxDisabled() {
        return this.disabled || this.isLoading || this.hasError;
    }

    handleSearch(event) {
        this.searchTerm = event.target.value || '';
    }

    handleChange(event) {
        const value = event.detail.value || '';
        const option = this._options.find(o => o.value === value);
        this._value = value;
        this.dispatchEvent(new CustomEvent('change', {
            detail: { value, label: option ? option.label : '' }
        }));
    }

    @api
    reportValidity() {
        const combobox = this.template.querySelector('lightning-combobox');
        return combobox ? combobox.reportValidity() : true;
    }
}
