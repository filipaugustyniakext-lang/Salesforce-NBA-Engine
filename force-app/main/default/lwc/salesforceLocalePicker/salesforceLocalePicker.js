import { LightningElement, api, wire } from 'lwc';
import getSalesforceLocales from '@salesforce/apex/SalesforceLocaleController.getSalesforceLocales';

const MAX_VISIBLE_OPTIONS = 60;

export default class SalesforceLocalePicker extends LightningElement {
    @api label = 'Locales';
    @api required = false;
    @api disabled = false;
    @api fieldLevelHelp;
    /** Locale codes that already exist and cannot be selected again. */
    @api
    get takenValues() { return [...this._taken]; }
    set takenValues(values) { this._taken = new Set(values || []); }

    _taken = new Set();
    _selected = [];
    _query = '';
    _options = [];
    _loaded = false;
    _error;
    _isOpen = false;
    _activeIndex = 0;
    _validityMessage = '';

    @api
    get values() { return this._selected.map(row => row.value); }
    set values(next) {
        const codes = Array.isArray(next) ? next : [];
        this._selected = codes.map(code => {
            const known = this._options.find(option => option.value === code);
            return { value: code, label: known ? known.label : code };
        });
    }

    @wire(getSalesforceLocales)
    wiredLocales({ data, error }) {
        if (data) {
            this._options = data;
            this._selected = this._selected.map(row => {
                const known = data.find(option => option.value === row.value);
                return known ? { value: known.value, label: known.label } : row;
            });
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
    get hasSelection() { return this._selected.length > 0; }
    get selectedBadges() {
        return this._selected.map(row => ({
            value: row.value,
            text: row.label && row.label !== row.value ? `${row.label} (${row.value})` : row.value
        }));
    }

    get placeholder() {
        if (this.isLoading) return 'Loading locales…';
        return this.hasSelection
            ? 'Add another language, country or code'
            : 'Type a language, country or code, e.g. Switzerland or de_CH';
    }

    get comboboxClass() {
        return `slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click${this._isOpen ? ' slds-is-open' : ''}`;
    }

    get formElementClass() {
        return `slds-form-element${this.showError ? ' slds-has-error' : ''}`;
    }

    get inputValue() {
        return this._isOpen ? this._query : '';
    }

    get visibleOptions() {
        const query = (this._isOpen ? this._query : '').trim().toLowerCase();
        const matches = query
            ? this._options.filter(option => this._matches(option, query))
            : this._options;
        const selected = new Set(this._selected.map(row => row.value));
        return matches.slice(0, MAX_VISIBLE_OPTIONS).map((option, index) => {
            const isTaken = this._taken.has(option.value);
            const isSelected = selected.has(option.value);
            let optionClass = 'slds-media slds-listbox__option slds-listbox__option_plain slds-media_small';
            if (isTaken) optionClass += ' locale-option_taken';
            if (index === this._activeIndex) optionClass += ' slds-has-focus';
            return {
                value: option.value,
                text: `${option.label} (${option.value})`,
                isTaken,
                isSelected,
                optionClass
            };
        });
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

    _matches(option, query) {
        return option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query);
    }

    handleFocus() {
        if (this.isDisabled) return;
        this._isOpen = true;
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
                this._toggle(option.value);
            }
        } else if (event.key === 'Escape') {
            this._isOpen = false;
            this._query = '';
        }
    }

    handleOptionMouseDown(event) {
        event.preventDefault();
        this._toggle(event.currentTarget.dataset.value);
    }

    handleRemoveBadge(event) {
        event.preventDefault();
        this._toggle(event.currentTarget.dataset.value);
    }

    handleBlur() {
        this._isOpen = false;
        this._query = '';
    }

    _toggle(value) {
        if (this._taken.has(value)) {
            return;
        }
        const option = this._options.find(row => row.value === value);
        if (!option) return;
        const exists = this._selected.some(row => row.value === value);
        this._selected = exists
            ? this._selected.filter(row => row.value !== value)
            : [...this._selected, { value: option.value, label: option.label }];
        this._validityMessage = '';
        this.dispatchEvent(new CustomEvent('change', {
            detail: { values: this._selected.map(row => ({ value: row.value, label: row.label })) }
        }));
    }

    @api
    reportValidity() {
        if (this.required && !this._selected.length) {
            this._validityMessage = 'Select at least one locale.';
            return false;
        }
        this._validityMessage = '';
        return !this.hasError;
    }
}
