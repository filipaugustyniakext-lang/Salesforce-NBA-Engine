import { LightningElement, api, wire } from 'lwc';
import getSalesforceLocales from '@salesforce/apex/SalesforceLocaleController.getSalesforceLocales';

const MAX_VISIBLE_OPTIONS = 60;

export default class SalesforceLocalePicker extends LightningElement {
    @api label = 'Locale';
    @api
    get value() { return this._value; }
    set value(next) {
        this._value = next || '';
        if (!this._isOpen) {
            this._query = '';
        }
    }
    @api required = false;
    @api disabled = false;
    @api fieldLevelHelp;

    _value = '';
    _query = '';
    _options = [];
    _loaded = false;
    _error;
    _isOpen = false;
    _activeIndex = 0;
    _validityMessage = '';

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
    get errorMessage() { return this._validityMessage || this._error; }
    get showError() { return !!this.errorMessage; }
    get isDisabled() { return this.disabled || this.isLoading || this.hasError; }

    get selectedOption() {
        return this._options.find(option => option.value === this._value);
    }

    get inputValue() {
        if (this._isOpen) {
            return this._query;
        }
        const selected = this.selectedOption;
        return selected ? this._optionText(selected) : this._value;
    }

    get placeholder() {
        if (this.isLoading) return 'Loading locales…';
        return 'Type a language, country or code, e.g. Polish or pl_PL';
    }

    get comboboxClass() {
        return `slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click${this._isOpen ? ' slds-is-open' : ''}`;
    }

    get formElementClass() {
        return `slds-form-element${this.showError ? ' slds-has-error' : ''}`;
    }

    get visibleOptions() {
        const query = (this._isOpen ? this._query : '').trim().toLowerCase();
        const matches = query
            ? this._options.filter(option => this._matches(option, query))
            : this._options;
        return matches.slice(0, MAX_VISIBLE_OPTIONS).map((option, index) => ({
            value: option.value,
            text: this._optionText(option),
            optionClass: index === this._activeIndex
                ? 'slds-media slds-listbox__option slds-listbox__option_plain slds-media_small slds-has-focus'
                : 'slds-media slds-listbox__option slds-listbox__option_plain slds-media_small'
        }));
    }

    get hasVisibleOptions() { return this.visibleOptions.length > 0; }

    get dropdownNote() {
        const query = (this._query || '').trim().toLowerCase();
        const total = query
            ? this._options.filter(option => this._matches(option, query)).length
            : this._options.length;
        if (total > this.visibleOptions.length) {
            return `Showing ${this.visibleOptions.length} of ${total}. Keep typing to narrow the list.`;
        }
        return '';
    }

    _optionText(option) {
        return `${option.label} (${option.value})`;
    }

    _matches(option, query) {
        return option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query);
    }

    handleFocus() {
        if (this.isDisabled) return;
        this._isOpen = true;
        this._query = '';
        this._activeIndex = 0;
        this._validityMessage = '';
    }

    handleInput(event) {
        this._query = event.target.value || '';
        this._isOpen = true;
        this._activeIndex = 0;
    }

    handleKeydown(event) {
        if (this.isDisabled) return;
        const options = this.visibleOptions;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this._isOpen = true;
            this._activeIndex = Math.min(this._activeIndex + 1, Math.max(options.length - 1, 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this._activeIndex = Math.max(this._activeIndex - 1, 0);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const option = options[this._activeIndex];
            if (this._isOpen && option) {
                this._select(option.value);
            }
        } else if (event.key === 'Escape') {
            this._isOpen = false;
            this._query = '';
        }
    }

    handleOptionMouseDown(event) {
        event.preventDefault();
        this._select(event.currentTarget.dataset.value);
    }

    handleBlur() {
        this._isOpen = false;
        this._query = '';
    }

    _select(value) {
        const option = this._options.find(row => row.value === value);
        this._value = value;
        this._query = '';
        this._isOpen = false;
        this._validityMessage = '';
        this.dispatchEvent(new CustomEvent('change', {
            detail: { value, label: option ? option.label : '' }
        }));
    }

    @api
    reportValidity() {
        if (this.required && !this._value) {
            this._validityMessage = 'Select a locale.';
            return false;
        }
        this._validityMessage = '';
        return !this.hasError;
    }
}
