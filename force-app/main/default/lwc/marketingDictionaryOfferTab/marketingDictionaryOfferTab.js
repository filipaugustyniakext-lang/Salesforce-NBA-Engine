import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getOfferRecords from '@salesforce/apex/MarketingDictionaryManagerController.getOfferRecords';
import saveOfferRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveOfferRecord';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import toggleOfferActive from '@salesforce/apex/MarketingDictionaryManagerController.toggleOfferActive';
import getProductFamilyOptions from '@salesforce/apex/MarketingDictionaryManagerController.getProductFamilyOptions';
import saveAttributeRule from '@salesforce/apex/MarketingDictionaryManagerController.saveAttributeRule';
import saveAttributeRulesBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveAttributeRulesBulk';
import deleteAttributeRule from '@salesforce/apex/MarketingDictionaryManagerController.deleteAttributeRule';
import getReferenceValues from '@salesforce/apex/MarketingDictionaryManagerController.getReferenceValues';
import saveReferenceValue from '@salesforce/apex/MarketingDictionaryManagerController.saveReferenceValue';
import saveReferenceValuesForFamilies from '@salesforce/apex/MarketingDictionaryManagerController.saveReferenceValuesForFamilies';
import saveRangeReferenceValues from '@salesforce/apex/MarketingDictionaryManagerController.saveRangeReferenceValues';
import updateRangeReferenceValue from '@salesforce/apex/MarketingDictionaryManagerController.updateRangeReferenceValue';
import deleteReferenceValue from '@salesforce/apex/MarketingDictionaryManagerController.deleteReferenceValue';
import toggleReferenceValueActive from '@salesforce/apex/MarketingDictionaryManagerController.toggleReferenceValueActive';
import updateReferenceAttributeMaster from '@salesforce/apex/MarketingDictionaryManagerController.updateReferenceAttributeMaster';

const PARAM_TYPES = [
    { label: 'Text', value: 'Text' },
    { label: 'Number', value: 'Number' },
    { label: 'Decimal', value: 'Decimal' },
    { label: 'Text Area', value: 'TextArea' },
    { label: 'Picklist', value: 'Picklist' },
    { label: 'Checkbox', value: 'Checkbox' },
    { label: 'Date', value: 'Date' },
    { label: 'Currency', value: 'Currency' },
    { label: 'Percent', value: 'Percent' },
    { label: 'URL', value: 'URL' },
];

const VALUE_TYPES = ['Percent', 'Currency', 'Number', 'Days', 'Months', 'Text', 'Picklist', 'Range'];

const ALL_FAMILIES = '__ALL__';

const EMPTY_REF = () => ({
    Name: '', Product_Family__c: null, Reference_Value__c: null,
    Value_Type__c: '', Reference_Value_Pairs__c: null,
    Description__c: '', Is_Active__c: true
});

const NEW_PAIR = () => ({ _key: Math.random().toString(36).slice(2), key: '' });

// A pending attribute being built in the add-attribute form inside the family modal
const EMPTY_PENDING = () => ({
    _key: Math.random().toString(36).slice(2),   // client-side identity for list rendering
    _attrId: null,                               // set when editing an existing attribute record
    _ruleId: null,                               // set when editing an existing rule record
    creationMethod: 'reference',                  // 'reference' | 'new'
    // reference method
    refValueId: null,
    refAttrName: '',
    inheritedType: '',
    inheritedValue: null,
    inheritedValueType: '',
    refPicklistPowers: [],                        // [{_key, label, power}] for Picklist reference values
    // new method
    Name: '',
    Parameter_Type__c: '',
    picklistValues: '',
    valueMode: 'predefined',                      // 'predefined' | 'per_offer'
    predefinedValue: '',
    // shared
    displayName: '',
    Attribute_Description__c: '',
    Parameter_Help_Text__c: '',
    impactsAttractiveness: false,
    Is_Required__c: false,
    weight: '',          // stored as integer 0-100 (percent)
    Display_Order__c: null,
    // error flag
    hasError: false,
    errorMsg: ''
});

export default class MarketingDictionaryOfferTab extends LightningElement {

    // ─── Vertical tab state ───────────────────────────────────────────────────
    @track _activeVtab = 'ref';

    get isRefTab() { return this._activeVtab === 'ref'; }
    get isAttrTab() { return this._activeVtab === 'attr'; }
    get refVtabClass() { return `vtab-item${this._activeVtab === 'ref' ? ' vtab-item_active' : ''}`; }
    get attrVtabClass() { return `vtab-item${this._activeVtab === 'attr' ? ' vtab-item_active' : ''}`; }
    handleVtabSelect(e) { this._activeVtab = e.currentTarget.dataset.tab; }

    // ─── Shared ───────────────────────────────────────────────────────────────
    @track isSaving = false;
    @track isDeleteModalOpen = false;
    _deleteId = null;
    _deleteType = null;
    _deleteAttrId = null;
    _deleteKey = null;
    _deleteFamilyId = null;
    _deleteRangeMaxId = null;
    deleteTargetName = '';

    paramTypeOptions = PARAM_TYPES;
    valueTypeOptions = VALUE_TYPES.map(t => ({ label: t, value: t }));
    filterOptions = [
        { label: 'All', value: 'all' },
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
    ];

    _productFamilyOptions = [];
    _productFamilyMap = {};

    @wire(getProductFamilyOptions)
    wiredFamilies({ data, error }) {
        if (data) {
            this._productFamilyOptions = data.map(r => ({ label: r.Name, value: r.Id }));
            this._productFamilyMap = Object.fromEntries(data.map(r => [r.Id, r.Name]));
        } else if (error) {
            this._showToast('Error', error.body?.message || 'Failed to load product families', 'error');
        }
    }

    get productFamilyOptions() { return this._productFamilyOptions; }

    // ─── Reference Values ─────────────────────────────────────────────────────
    @track isRefLoading = true;
    @track isRefModalOpen = false;
    @track editRefValue = EMPTY_REF();
    @track selectedFamilyIds = [];
    @track isFamilyDropdownOpen = false;
    @track refPairs = [NEW_PAIR()];
    @track rangeMin = 0;
    @track rangeMax = 100;
    _editRangeMinId = null;   // Id of the Min record when editing an existing range
    _editRangeMaxId = null;   // Id of the Max record when editing an existing range
    _refModalLocked = false;
    @track refSearchTerm = '';
    @track refFilterActive = 'all';
    @track refFilterFamily = 'all';
    _wiredRefResult;
    _rawRefRecords = [];

    @track isMasterEditModalOpen = false;
    @track masterEdit = { oldName: '', Name: '', Value_Type__c: '' };

    @wire(getReferenceValues)
    wiredRef(result) {
        this._wiredRefResult = result;
        this.isRefLoading = false;
        if (result.data) { this._rawRefRecords = result.data; }
        else if (result.error) { this._showToast('Error', result.error.body?.message || 'Failed to load reference values', 'error'); }
    }

    get refFamilyFilterOptions() {
        const seen = new Set();
        const opts = [{ label: 'All Families', value: 'all' }];
        this._rawRefRecords.forEach(r => {
            const id = r.Product_Family__c;
            const name = r.Product_Family__r?.Name;
            if (id && name && !seen.has(id)) { seen.add(id); opts.push({ label: name, value: id }); }
        });
        return opts;
    }

    // Merge the two DB records of a range (same Range_Key__c) into one synthetic
    // row so the list and pickers show a single interconnected range entry.
    _collapseRanges(records) {
        const out = [];
        const byKey = {};
        records.forEach(r => {
            if (r.Value_Type__c === 'Range' && r.Range_Key__c) {
                (byKey[r.Range_Key__c] = byKey[r.Range_Key__c] || []).push(r);
            } else {
                out.push(r);
            }
        });
        Object.keys(byKey).forEach(key => {
            const grp = byKey[key];
            const minRec = grp.find(r => r.Range_Bound__c === 'Min') || grp[0];
            const maxRec = grp.find(r => r.Range_Bound__c === 'Max') || grp[grp.length - 1];
            out.push({
                ...minRec,
                Value_Type__c: 'Range',
                Reference_Value__c: null,
                _isRange: true,
                _rangeKey: key,
                _minId: minRec.Id,
                _maxId: maxRec ? maxRec.Id : null,
                _rangeMin: minRec.Reference_Value__c,
                _rangeMax: maxRec ? maxRec.Reference_Value__c : null
            });
        });
        return out;
    }

    get _refRecordsView() { return this._collapseRanges(this._rawRefRecords); }

    get filteredRefRecords() {
        const q = this.refSearchTerm.toLowerCase();
        return this._refRecordsView.filter(r => {
            if (this.refFilterActive === 'active' && !r.Is_Active__c) return false;
            if (this.refFilterActive === 'inactive' && r.Is_Active__c) return false;
            if (this.refFilterFamily !== 'all' && r.Product_Family__c !== this.refFilterFamily) return false;
            if (!q) return true;
            return (r.Name || '').toLowerCase().includes(q) ||
                   (r.Product_Family__r?.Name || '').toLowerCase().includes(q) ||
                   (r.Description__c || '').toLowerCase().includes(q);
        });
    }

    get groupedRefValues() {
        const byName = {};
        this.filteredRefRecords.forEach(r => {
            const key = r.Name || '(Unnamed)';
            if (!byName[key]) byName[key] = [];
            byName[key].push({
                ...r,
                familyName: r.Product_Family__r?.Name || null,
                displayValue: this._formatRefValue(r),
                statusBadgeClass: r.Is_Active__c ? 'slds-badge rv-badge-active' : 'slds-badge rv-badge-inactive',
                statusLabel: r.Is_Active__c ? 'Active' : 'Inactive',
                toggleIcon: r.Is_Active__c ? 'utility:check' : 'utility:close',
                toggleTitle: r.Is_Active__c ? 'Deactivate' : 'Activate',
                rowClass: r.Is_Active__c ? '' : 'rv-row-inactive'
            });
        });
        return Object.keys(byName).sort().map(name => ({
            name, rows: byName[name], count: byName[name].length,
            pluralSuffix: byName[name].length === 1 ? 'y' : 'ies'
        }));
    }

    _formatRefValue(r) {
        if (r != null && r._isRange) {
            const lo = r._rangeMin, hi = r._rangeMax;
            if (lo == null && hi == null) return '—';
            return `${lo != null ? lo : '?'} – ${hi != null ? hi : '?'}`;
        }
        if (r != null && r.Value_Type__c === 'Picklist') {
            try {
                const arr = JSON.parse(r.Reference_Value_Pairs__c || '[]');
                if (Array.isArray(arr) && arr.length) {
                    return arr.map(item => (typeof item === 'string' ? item : item?.key)).filter(Boolean).join(', ');
                }
            } catch (e) { /* fall through */ }
            return '—';
        }
        if (r == null || r.Reference_Value__c == null) return '—';
        const val = Number(r.Reference_Value__c);
        switch (r.Value_Type__c) {
            case 'Percent':  return `${val}%`;
            case 'Currency': return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            case 'Days':     return `${val} days`;
            case 'Months':   return `${val} months`;
            default:         return String(val);
        }
    }

    get refTotalCount() { return this._refRecordsView.length; }
    get refActiveCount() { return this._refRecordsView.filter(r => r.Is_Active__c).length; }
    get hasRefRecords() { return !this.isRefLoading && this.filteredRefRecords.length > 0; }
    get isRefEmpty() { return !this.isRefLoading && this._rawRefRecords.length === 0; }
    get refModalTitle() {
        if (this._refModalLocked) return `Add value for: ${this.editRefValue.Name}`;
        return this.editRefValue.Id ? `Edit: ${this.editRefValue.Name}` : 'New Reference Value';
    }
    get refModalLocked() { return this._refModalLocked; }

    // ─── Multi-select Product Family (create mode) ──────────────────────────
    get isRefPicklistType() { return this.editRefValue.Value_Type__c === 'Picklist'; }
    get isRefRangeType() { return this.editRefValue.Value_Type__c === 'Range'; }
    get showRefValueInput() { return !this.isRefPicklistType && !this.isRefRangeType; }
    get showFamilyMultiSelect() { return !this._refModalLocked; }

    get isAllFamiliesSelected() {
        return this._productFamilyOptions.length > 0 &&
            this.selectedFamilyIds.length === this._productFamilyOptions.length;
    }

    // Options rendered inside the open dropdown (ALL first, then families)
    get familyDropdownOptions() {
        const selected = new Set(this.selectedFamilyIds);
        const options = this._productFamilyOptions.map(o => ({
            value: o.value,
            label: o.label,
            selected: selected.has(o.value),
            cssClass: `slds-listbox__item rv-listbox__item${selected.has(o.value) ? ' rv-listbox__item_selected' : ''}`
        }));
        options.unshift({
            value: ALL_FAMILIES,
            label: 'ALL families',
            selected: this.isAllFamiliesSelected,
            cssClass: `slds-listbox__item rv-listbox__item rv-listbox__item_all${this.isAllFamiliesSelected ? ' rv-listbox__item_selected' : ''}`
        });
        return options;
    }

    get selectedFamilyCount() { return this.selectedFamilyIds.length; }

    // Text shown on the collapsed combobox trigger
    get familyTriggerLabel() {
        const n = this.selectedFamilyIds.length;
        if (n === 0) return 'Select product family...';
        if (this.isAllFamiliesSelected) return 'ALL families';
        if (n === 1) {
            const opt = this._productFamilyOptions.find(o => o.value === this.selectedFamilyIds[0]);
            return opt ? opt.label : '1 selected';
        }
        return `${n} families selected`;
    }
    get familyTriggerHasSelection() { return this.selectedFamilyIds.length > 0; }
    get familyComboboxClass() {
        return `slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click${this.isFamilyDropdownOpen ? ' slds-is-open' : ''}`;
    }

    toggleFamilyDropdown() { this.isFamilyDropdownOpen = !this.isFamilyDropdownOpen; }
    closeFamilyDropdown() { this.isFamilyDropdownOpen = false; }

    handleFamilyOptionSelect(e) {
        e.preventDefault();
        const val = e.currentTarget.dataset.value;
        if (val === ALL_FAMILIES) {
            const all = this._productFamilyOptions.map(o => o.value);
            this.selectedFamilyIds = this.isAllFamiliesSelected ? [] : all;
            return;
        }
        const set = new Set(this.selectedFamilyIds);
        if (set.has(val)) { set.delete(val); } else { set.add(val); }
        this.selectedFamilyIds = [...set];
    }

    // ─── Picklist labels (Picklist value type) ──────────────────────────────
    handlePairChange(e) {
        const key = e.currentTarget.dataset.key;
        this.refPairs = this.refPairs.map(p =>
            p._key === key ? { ...p, key: e.detail.value } : p
        );
    }
    handleAddPair() { this.refPairs = [...this.refPairs, NEW_PAIR()]; }
    handleRemovePair(e) {
        const key = e.currentTarget.dataset.key;
        const next = this.refPairs.filter(p => p._key !== key);
        this.refPairs = next.length ? next : [NEW_PAIR()];
    }

    handleRefSearch(e) { this.refSearchTerm = e.target.value; }
    handleRefFilterChange(e) { this.refFilterActive = e.detail.value; }
    handleRefFamilyFilterChange(e) { this.refFilterFamily = e.detail.value; }
    _resetRangeState() {
        this.rangeMin = 0;
        this.rangeMax = 100;
        this._editRangeMinId = null;
        this._editRangeMaxId = null;
    }

    handleNewRefValue() {
        this._refModalLocked = false;
        this.editRefValue = EMPTY_REF();
        this.selectedFamilyIds = [];
        this.refPairs = [NEW_PAIR()];
        this._resetRangeState();
        this.isRefModalOpen = true;
    }

    handleEditMasterAttr(e) {
        const attrName = e.currentTarget.dataset.attrname;
        const existing = this._rawRefRecords.find(r => r.Name === attrName);
        this.masterEdit = { oldName: attrName, Name: attrName, Value_Type__c: existing?.Value_Type__c || '' };
        this.isMasterEditModalOpen = true;
    }

    handleMasterEditFieldChange(e) {
        this.masterEdit = { ...this.masterEdit, [e.currentTarget.dataset.field]: e.detail.value };
    }
    handleCloseMasterEditModal() { this.isMasterEditModalOpen = false; }

    async handleSaveMasterAttr() {
        if (!this.masterEdit.Name?.trim()) { this._showToast('Validation', 'Attribute Name is required.', 'warning'); return; }
        this.isSaving = true;
        try {
            await updateReferenceAttributeMaster({
                oldName: this.masterEdit.oldName,
                newName: this.masterEdit.Name.trim(),
                newType: this.masterEdit.Value_Type__c || ''
            });
            this._showToast('Success', 'Attribute name/type updated across all values.', 'success');
            this.isMasterEditModalOpen = false;
            await refreshApex(this._wiredRefResult);
        } catch (err) { this._showToast('Error', err.body?.message || 'Update failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    handleAddForFamily(e) {
        const attrName = e.currentTarget.dataset.attrname;
        const existing = this._rawRefRecords.find(r => r.Name === attrName);
        this._refModalLocked = true;
        this.editRefValue = { ...EMPTY_REF(), Name: attrName, Value_Type__c: existing?.Value_Type__c || '' };
        this.selectedFamilyIds = [];
        this.refPairs = [NEW_PAIR()];
        this._resetRangeState();
        this.isRefModalOpen = true;
    }
    handleCloseRefModal() { this.isRefModalOpen = false; }

    handleEditRefValue(e) {
        const rec = this._refRecordsView.find(r => r.Id === e.currentTarget.dataset.id);
        this._refModalLocked = true;
        this.editRefValue = rec ? { ...rec } : EMPTY_REF();
        this.selectedFamilyIds = [];
        this.refPairs = this._parsePairs(rec?.Reference_Value_Pairs__c);
        this._resetRangeState();
        if (rec && rec._isRange) {
            this.rangeMin = rec._rangeMin != null ? Number(rec._rangeMin) : 0;
            this.rangeMax = rec._rangeMax != null ? Number(rec._rangeMax) : 100;
            this._editRangeMinId = rec._minId;
            this._editRangeMaxId = rec._maxId;
        }
        this.isRefModalOpen = true;
    }

    _parsePairs(json) {
        if (!json) return [NEW_PAIR()];
        try {
            const arr = JSON.parse(json);
            if (Array.isArray(arr) && arr.length) {
                return arr.map(item => ({
                    _key: Math.random().toString(36).slice(2),
                    key: typeof item === 'string' ? item : (item?.key ?? '')
                }));
            }
        } catch (e) { /* fall through to empty label */ }
        return [NEW_PAIR()];
    }

    // Parse the JSON label array stored on a Picklist reference value → plain string labels
    _refLabels(refRecord) {
        if (!refRecord || refRecord.Value_Type__c !== 'Picklist') return [];
        try {
            const arr = JSON.parse(refRecord.Reference_Value_Pairs__c || '[]');
            if (Array.isArray(arr)) {
                return arr.map(item => (typeof item === 'string' ? item : item?.key)).filter(Boolean);
            }
        } catch (e) { /* ignore */ }
        return [];
    }

    // Build power-of-effect rows for a Picklist reference value, preserving any saved values
    _buildRefPowers(refRecord, savedJson) {
        const labels = this._refLabels(refRecord);
        let saved = {};
        if (savedJson) {
            try {
                const obj = JSON.parse(savedJson);
                if (obj && typeof obj === 'object') saved = obj;
            } catch (e) { /* ignore */ }
        }
        return labels.map(label => ({
            _key: Math.random().toString(36).slice(2),
            label,
            power: saved[label] != null ? String(saved[label]) : ''
        }));
    }

    handleRefFieldChange(e) {
        const field = e.currentTarget.dataset.field;
        const value = field === 'Reference_Value__c'
            ? (e.detail.value === '' || e.detail.value == null ? null : Number(e.detail.value))
            : e.detail.value;
        this.editRefValue = { ...this.editRefValue, [field]: value };
    }

    handleRefCheckboxChange(e) {
        this.editRefValue = { ...this.editRefValue, [e.currentTarget.dataset.field]: e.detail.checked };
    }

    handleRangeChange(e) {
        this.rangeMin = e.detail.min;
        this.rangeMax = e.detail.max;
    }

    async _saveRangeRefValue() {
        const lo = Number(this.rangeMin);
        const hi = Number(this.rangeMax);
        if (isNaN(lo) || isNaN(hi)) { this._showToast('Validation', 'Enter a valid min and max.', 'warning'); return; }
        if (lo >= hi) { this._showToast('Validation', 'Min must be less than max.', 'warning'); return; }

        this.isSaving = true;
        try {
            if (this._editRangeMinId) {
                await updateRangeReferenceValue({
                    minId: this._editRangeMinId, maxId: this._editRangeMaxId,
                    minValue: lo, maxValue: hi,
                    description: this.editRefValue.Description__c || '',
                    isActive: this.editRefValue.Is_Active__c !== false
                });
            } else {
                const base = {
                    Name: this.editRefValue.Name.trim(),
                    Description__c: this.editRefValue.Description__c || '',
                    Is_Active__c: this.editRefValue.Is_Active__c !== false
                };
                let familyIds;
                if (this._refModalLocked) {
                    if (!this.editRefValue.Product_Family__c) { this._showToast('Validation', 'Product Family is required.', 'warning'); this.isSaving = false; return; }
                    familyIds = [this.editRefValue.Product_Family__c];
                } else {
                    if (!this.selectedFamilyIds.length) { this._showToast('Validation', 'Select at least one product family.', 'warning'); this.isSaving = false; return; }
                    familyIds = this.selectedFamilyIds;
                }
                await saveRangeReferenceValues({ record: base, minValue: lo, maxValue: hi, familyIds });
            }
            this._showToast('Success', 'Range reference value saved.', 'success');
            this.isRefModalOpen = false;
            await refreshApex(this._wiredRefResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Save failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    async handleSaveRefValue() {
        if (!this.editRefValue.Name?.trim()) { this._showToast('Validation', 'Attribute Name is required.', 'warning'); return; }

        if (this.editRefValue.Value_Type__c === 'Range') { await this._saveRangeRefValue(); return; }

        const isPicklist = this.editRefValue.Value_Type__c === 'Picklist';
        let pairsJson = null;
        if (isPicklist) {
            const labels = [];
            const seen = new Set();
            for (const p of this.refPairs) {
                const label = (p.key || '').trim();
                if (!label || seen.has(label.toLowerCase())) continue;
                seen.add(label.toLowerCase());
                labels.push(label);
            }
            if (!labels.length) { this._showToast('Validation', 'Add at least one picklist label.', 'warning'); return; }
            pairsJson = JSON.stringify(labels);
        }

        const record = {
            ...this.editRefValue,
            Reference_Value_Pairs__c: pairsJson,
            Reference_Value__c: isPicklist ? null : this.editRefValue.Reference_Value__c
        };

        this.isSaving = true;
        try {
            if (this._refModalLocked) {
                if (!record.Product_Family__c) { this._showToast('Validation', 'Product Family is required.', 'warning'); this.isSaving = false; return; }
                await saveReferenceValue({ record });
            } else {
                if (!this.selectedFamilyIds.length) { this._showToast('Validation', 'Select at least one product family.', 'warning'); this.isSaving = false; return; }
                const { Id, Product_Family__c, ...base } = record;
                await saveReferenceValuesForFamilies({ record: base, familyIds: this.selectedFamilyIds });
            }
            this._showToast('Success', 'Reference value saved.', 'success');
            this.isRefModalOpen = false;
            await refreshApex(this._wiredRefResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Save failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    async handleToggleRefActive(e) {
        const id = e.currentTarget.dataset.id;
        const rec = this._refRecordsView.find(r => r.Id === id);
        if (!rec) return;
        const newActive = !rec.Is_Active__c;
        try {
            if (rec._isRange) {
                await toggleReferenceValueActive({ recordId: rec._minId, isActive: newActive });
                if (rec._maxId) await toggleReferenceValueActive({ recordId: rec._maxId, isActive: newActive });
            } else {
                await toggleReferenceValueActive({ recordId: id, isActive: newActive });
            }
            this._showToast('Success', rec.Is_Active__c ? 'Deactivated.' : 'Activated.', 'success');
            await refreshApex(this._wiredRefResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Update failed.', 'error'); }
    }

    handleDeleteRefValue(e) {
        const id = e.currentTarget.dataset.id;
        const rec = this._refRecordsView.find(r => r.Id === id);
        this._deleteType = 'ref';
        this._deleteId = id;
        this._deleteRangeMaxId = rec && rec._isRange ? rec._maxId : null;
        this.deleteTargetName = e.currentTarget.dataset.name;
        this.isDeleteModalOpen = true;
    }

    // ─── Offer Attributes — list view ─────────────────────────────────────────
    @track searchTerm = '';
    @track filterActive = 'all';
    @track filterFamily = 'all';
    isLoading = true;
    _wiredResult;
    _rawRecords = [];

    @wire(getOfferRecords)
    wiredOffers(result) {
        this._wiredResult = result;
        this.isLoading = false;
        if (result.data) { this._rawRecords = result.data; }
        else if (result.error) { this._showToast('Error', result.error.body?.message || 'Failed to load', 'error'); }
    }

    // Attributes grouped by product family for the list view
    get groupedByFamily() {
        const q = this.searchTerm.toLowerCase();
        const filtered = this._rawRecords.filter(r => {
            if (this.filterActive === 'active' && !r.Is_Active__c) return false;
            if (this.filterActive === 'inactive' && r.Is_Active__c) return false;
            if (!q) return true;
            return (r.Name || '').toLowerCase().includes(q) ||
                   (r.Parameter_Type__c || '').toLowerCase().includes(q) ||
                   (r.Value_Source__c || '').toLowerCase().includes(q);
        });

        // Collect all distinct families that have at least one rule
        const familyMap = {};
        filtered.forEach(attr => {
            (attr.Offer_Attribute_Rules__r || []).forEach(rule => {
                const fid = rule.Product_Family__c;
                if (this.filterFamily !== 'all' && fid !== this.filterFamily) return;
                if (!familyMap[fid]) {
                    familyMap[fid] = {
                        familyId: fid,
                        familyName: rule.Product_Family__r?.Name || this._productFamilyMap[fid] || fid,
                        attrs: []
                    };
                }
                const weightWarning = this._familyWeightSumWarning(fid);
                familyMap[fid].attrs.push({
                    ...attr,
                    rule,
                    ruleId: rule.Id,
                    statusBadgeClass: attr.Is_Active__c ? 'slds-badge oa-badge-active' : 'slds-badge oa-badge-inactive',
                    statusLabel: attr.Is_Active__c ? 'Active' : 'Inactive',
                    toggleIcon: attr.Is_Active__c ? 'utility:check' : 'utility:close',
                    toggleTitle: attr.Is_Active__c ? 'Deactivate' : 'Activate',
                    refValueDisplay: rule.Reference_Value__r ? this._formatRefValue(rule.Reference_Value__r) : null,
                    weightDisplay: rule.Impacts_Attractiveness__c
                        ? (rule.Attractiveness_Weight__c != null ? `${(Number(rule.Attractiveness_Weight__c) * 100).toFixed(1)}%` : null)
                        : null,
                    weightMissing: rule.Impacts_Attractiveness__c && rule.Attractiveness_Weight__c == null,
                    weightWarning
                });
            });
        });

        return Object.values(familyMap).sort((a, b) => a.familyName.localeCompare(b.familyName))
            .map(grp => {
                const enriched = grp.attrs.map(a => ({
                    ...a,
                    sourceBadgeLabel: this._sourceBadgeLabel(a),
                    sourceBadgeClass: this._sourceBadgeClass(a),
                    weightBadgeLabel: a.rule.Impacts_Attractiveness__c && a.rule.Attractiveness_Weight__c != null
                        ? `★ ${Math.round(Number(a.rule.Attractiveness_Weight__c) * 100)}%` : null,
                    requiredLabel: a.rule.Is_Required__c ? 'Required' : null,
                    typeBadgeLabel: a.Parameter_Type__c || null
                }));
                return {
                    ...grp,
                    attrs: enriched,
                    attractAttrs:  enriched.filter(a => a.rule.Impacts_Attractiveness__c),
                    requiredAttrs: enriched.filter(a => !a.rule.Impacts_Attractiveness__c && a.rule.Is_Required__c),
                    optionalAttrs: enriched.filter(a => !a.rule.Impacts_Attractiveness__c && !a.rule.Is_Required__c),
                    weightSumOk: this._isFamilyWeightOk(grp.familyId),
                    weightSumWarning: this._familyWeightSumWarning(grp.familyId)
                };
            });
    }

    _isFamilyWeightOk(familyId) {
        const rules = this._rawRecords.flatMap(r => r.Offer_Attribute_Rules__r || [])
            .filter(r => r.Product_Family__c === familyId && r.Impacts_Attractiveness__c);
        if (rules.length === 0) return true;
        const sum = rules.reduce((s, r) => s + (Number(r.Attractiveness_Weight__c) || 0), 0);
        return Math.abs(sum - 1) <= 0.0001;
    }

    _familyWeightSumWarning(familyId) {
        const rules = this._rawRecords.flatMap(r => r.Offer_Attribute_Rules__r || [])
            .filter(r => r.Product_Family__c === familyId && r.Impacts_Attractiveness__c);
        if (rules.length === 0) return null;
        const sum = parseFloat(rules.reduce((s, r) => s + (Number(r.Attractiveness_Weight__c) || 0), 0).toFixed(4));
        if (Math.abs(sum - 1) <= 0.0001) return null;
        return sum > 1 ? `Attractiveness weights exceed 1 (${sum})` : `Attractiveness weights sum to ${sum}, must equal 1`;
    }

    _sourceBadgeLabel(attr) {
        if (attr.Value_Source__c === 'Autopopulate') return '↗ Autopopulate';
        if (attr.Value_Source__c === 'Apriori') return 'Pre-defined';
        if (attr.Value_Source__c === 'Operator Defined') return 'Operator';
        return null;
    }
    _sourceBadgeClass(attr) {
        if (attr.Value_Source__c === 'Autopopulate') return 'slds-badge oa-badge-autopopulate';
        if (attr.Value_Source__c === 'Apriori') return 'slds-badge oa-badge-apriori';
        if (attr.Value_Source__c === 'Operator Defined') return 'slds-badge oa-badge-operator';
        return 'slds-badge slds-badge_lightest';
    }

    get listFamilyFilterOptions() {
        const opts = [{ label: 'All Families', value: 'all' }];
        this._productFamilyOptions.forEach(o => opts.push(o));
        return opts;
    }

    get hasGroups() { return !this.isLoading && this.groupedByFamily.length > 0; }
    get hasRecords() { return this.hasGroups; }
    get offerCount() { return this._rawRecords.length; }
    get activeCount() { return this._rawRecords.filter(r => r.Is_Active__c).length; }
    get isEmpty() { return !this.isLoading && this._rawRecords.length === 0; }
    get isEmptyFiltered() { return !this.isLoading && !this.isEmpty && this.groupedByFamily.length === 0; }

    handleSearch(e) { this.searchTerm = e.target.value; }
    handleFilterChange(e) { this.filterActive = e.detail.value; }
    handleFilterFamilyChange(e) { this.filterFamily = e.detail.value; }

    handleDeleteAttribute(e) {
        this._deleteType = 'attr';
        this._deleteId = e.currentTarget.dataset.id;
        this.deleteTargetName = e.currentTarget.dataset.name;
        this.isDeleteModalOpen = true;
    }

    // Delete a row inside the family modal — if unsaved just remove from list;
    // if saved, open confirmation modal to delete from org
    handleFmDeleteRow(e) {
        e.stopPropagation();
        const key    = e.currentTarget.dataset.key;
        const attrId = e.currentTarget.dataset.attrid;
        const name   = e.currentTarget.dataset.name;
        if (!attrId) {
            // unsaved row — just remove from pending list
            this.fmPendingList = this.fmPendingList.filter(r => r._key !== key);
            return;
        }
        // saved row — confirm before deleting from org
        this._deleteType = 'attrFromModal';
        this._deleteId   = attrId;
        this._deleteKey  = key;
        this.deleteTargetName = name;
        this.isDeleteModalOpen = true;
    }

    // Delete entire family configuration from summary card
    handleDeleteFamilyConfig(e) {
        const familyId   = e.currentTarget.dataset.familyid;
        const familyName = e.currentTarget.dataset.familyname;
        this._deleteType     = 'familyConfig';
        this._deleteFamilyId = familyId;
        this.deleteTargetName = `all attribute assignments for "${familyName}"`;
        this.isDeleteModalOpen = true;
    }

    async handleToggleActive(e) {
        const id = e.currentTarget.dataset.id;
        const rec = this._rawRecords.find(r => r.Id === id);
        if (!rec) return;
        try {
            await toggleOfferActive({ recordId: id, isActive: !rec.Is_Active__c });
            this._showToast('Success', rec.Is_Active__c ? 'Deactivated.' : 'Activated.', 'success');
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Update failed.', 'error'); }
    }

    handleDeleteRule(e) {
        this._deleteType = 'rule';
        this._deleteId = e.currentTarget.dataset.ruleid;
        this._deleteAttrId = e.currentTarget.dataset.attrid;
        this.deleteTargetName = e.currentTarget.dataset.name || 'this assignment';
        this.isDeleteModalOpen = true;
    }

    // ─── Family modal — step 1: choose family / step 2: build attributes ──────
    @track isFamilyModalOpen = false;
    @track fmStep = 1;                 // 1 = pick family, 2 = build attributes
    @track fmFamilyId = null;
    @track fmPendingList = [];         // array of EMPTY_PENDING() objects, each a row in the summary
    @track fmPendingForm = null;       // the attribute currently being composed in the form (EMPTY_PENDING)
    @track fmFormVisible = false;
    @track _fmExpandedKeys = new Set(); // keys of expanded row cards — empty = all collapsed by default

    // ── Reference values section (UI-only for now) ──────────────────────────
    @track isFmRefSectionOpen = false;  // collapsible; collapsed when the modal opens
    @track fmRefSelections = {};         // { [refValueId]: { use, impacts, value, powers:[{_key,label,power}] } }

    toggleFmRefSection() { this.isFmRefSectionOpen = !this.isFmRefSectionOpen; }
    get fmRefSectionChevron() { return this.isFmRefSectionOpen ? 'utility:chevrondown' : 'utility:chevronright'; }
    get fmRefSectionHint() { return this.isFmRefSectionOpen ? '' : 'Use reference values'; }

    // All reference values available for the selected family
    get fmRefSectionRows() {
        return this._refRecordsView
            .filter(r => r.Product_Family__c === this.fmFamilyId && r.Is_Active__c)
            .map(r => {
                const sel = this.fmRefSelections[r.Id] || {};
                const isPicklist = r.Value_Type__c === 'Picklist';
                const isRange = r._isRange === true;
                const labels = isPicklist ? this._refLabels(r) : [];
                const powers = sel.powers || [];
                const defaultValue = this._refDefaultValue(r);
                return {
                    id: r.Id,
                    name: r.Name,
                    valueType: r.Value_Type__c,
                    displayValue: this._formatRefValue(r),
                    isPicklist,
                    showValueInput: !isPicklist && !isRange,
                    value: sel.value != null ? sel.value : defaultValue,
                    use: !!sel.use,
                    impacts: !!sel.impacts,
                    showImpactsToggle: !!sel.use,
                    showPowers: !!sel.use && !!sel.impacts && isPicklist,
                    powerRows: labels.map(label => {
                        const row = powers.find(p => p.label === label) || { _key: label, label, power: '' };
                        const num = row.power === '' || row.power == null ? null : Number(row.power);
                        const invalid = num == null || isNaN(num) || num < 0 || num > 1;
                        return { _key: `${r.Id}::${label}`, label, power: row.power ?? '',
                                 inputClass: invalid ? 'rv-power-input rv-power-input_warn' : 'rv-power-input' };
                    }),
                    cardClass: sel.use ? 'fm-refsec-card fm-refsec-card_active' : 'fm-refsec-card'
                };
            });
    }
    get fmHasRefSectionRows() { return this.fmRefSectionRows.length > 0; }

    // The value assigned to a reference value (the numeric reference value itself), as a string for the input
    _refDefaultValue(r) {
        if (!r || r.Value_Type__c === 'Picklist') return '';
        return r.Reference_Value__c != null ? String(r.Reference_Value__c) : '';
    }

    _fmRefSel(refId) {
        return this.fmRefSelections[refId] || { use: false, impacts: false, powers: [] };
    }
    _setFmRefSel(refId, patch) {
        this.fmRefSelections = { ...this.fmRefSelections, [refId]: { ...this._fmRefSel(refId), ...patch } };
    }

    handleFmRefUse(e) {
        const refId = e.currentTarget.dataset.id;
        const checked = e.target.checked !== undefined ? e.target.checked : e.detail.checked;
        const patch = { use: checked };
        if (!checked) { patch.impacts = false; }
        else {
            const rec = this._rawRefRecords.find(r => r.Id === refId);
            const cur = this._fmRefSel(refId).powers || [];
            if (rec && rec.Value_Type__c === 'Picklist' && !cur.length) {
                patch.powers = this._refLabels(rec).map(label => ({ _key: label, label, power: '' }));
            }
        }
        this._setFmRefSel(refId, patch);
    }

    handleFmRefValue(e) {
        const refId = e.currentTarget.dataset.id;
        const value = e.detail.value;
        this._setFmRefSel(refId, { value });
    }

    handleFmRefImpacts(e) {
        const refId = e.currentTarget.dataset.id;
        const checked = e.target.checked !== undefined ? e.target.checked : e.detail.checked;
        const rec = this._rawRefRecords.find(r => r.Id === refId);
        const patch = { impacts: checked };
        if (checked && rec && rec.Value_Type__c === 'Picklist' && !(this._fmRefSel(refId).powers || []).length) {
            patch.powers = this._refLabels(rec).map(label => ({ _key: label, label, power: '' }));
        }
        this._setFmRefSel(refId, patch);
    }

    handleFmRefPower(e) {
        const refId = e.currentTarget.dataset.id;
        const label = e.currentTarget.dataset.label;
        let value = e.target.value !== undefined ? e.target.value : e.detail.value;
        if (value !== '' && value != null) {
            let num = Number(value);
            if (!isNaN(num)) { if (num > 1) num = 1; if (num < 0) num = 0; value = String(num); }
        }
        const powers = (this._fmRefSel(refId).powers || []).map(p =>
            p.label === label ? { ...p, power: value } : p
        );
        if (!powers.some(p => p.label === label)) powers.push({ _key: label, label, power: value });
        this._setFmRefSel(refId, { powers });
    }

    get fmFamilyName() { return this._productFamilyMap[this.fmFamilyId] || ''; }
    get fmStep1() { return this.fmStep === 1; }
    get fmStep2() { return this.fmStep === 2; }
    get fmShowBack() { return this.fmStep === 2 && !this._fmIsEdit; }
    get fmHasPending() { return this.fmPendingList.length > 0; }
    @track _fmIsEdit = false;

    get fmModalTitle() {
        if (this.fmStep === 1) return 'Add Attributes — Select Product Family';
        return `${this._fmIsEdit ? 'Edit' : 'Add'} Attributes for: ${this.fmFamilyName}`;
    }

    // ── Step-1 ─────────────────────────────────────────────────────────────────
    handleOpenFamilyModal() {
        this._fmIsEdit = false;
        this.fmStep = 1;
        this.fmFamilyId = null;
        this._fmLastFamilyId = null;
        this.fmPendingList = [];
        this.fmPendingForm = null;
        this.fmFormVisible = false;
        this.fmRefSelections = {};
        this.isFmRefSectionOpen = true;
        this.isFamilyModalOpen = true;
    }

    // Opens modal at step 2 pre-populated with existing attributes for a family
    handleOpenEditFamilyModal(e) {
        const familyId = e.currentTarget.dataset.familyid;
        this._fmIsEdit = true;
        this.fmStep = 2;
        this.fmFamilyId = familyId;
        this.fmPendingForm = null;
        this.fmFormVisible = false;
        this.fmRefSelections = {};
        this.isFmRefSectionOpen = true;

        // Reconstruct pending list from saved records
        const pendingList = [];
        this._rawRecords.forEach(attr => {
            const rule = (attr.Offer_Attribute_Rules__r || []).find(r => r.Product_Family__c === familyId);
            if (!rule) return;
            const isRef = attr.Value_Source__c === 'Autopopulate';
            const refRec = rule.Reference_Value__r;
            pendingList.push({
                _key: Math.random().toString(36).slice(2),
                _attrId: attr.Id,
                _ruleId: rule.Id,
                creationMethod: isRef ? 'reference' : 'new',
                refValueId: isRef ? rule.Reference_Value__c : null,
                refAttrName: isRef ? (refRec?.Name || attr.Name) : '',
                inheritedType: isRef ? (refRec?.Value_Type__c || '') : '',
                inheritedValue: isRef ? (refRec?.Reference_Value__c ?? null) : null,
                inheritedValueType: isRef ? (refRec?.Value_Type__c || '') : '',
                refPicklistPowers: isRef ? this._buildRefPowers(refRec, rule.Picklist_Power_Values__c) : [],
                Name: attr.Name,
                Parameter_Type__c: attr.Parameter_Type__c || '',
                // MERGE 2026-09-14: read options from dedicated Picklist_Values__c (was hardcoded '').
                // To revert: change back to `picklistValues: ''`.
                picklistValues: attr.Picklist_Values__c || '',
                valueMode: attr.Value_Source__c === 'Apriori' ? 'predefined' : 'per_offer',
                predefinedValue: attr.Value_Source__c === 'Apriori' ? (attr.Default_Value__c || '') : '',
                displayName: attr.Name,
                Attribute_Description__c: attr.Attribute_Description__c || '',
                Parameter_Help_Text__c: attr.Parameter_Help_Text__c || '',
                impactsAttractiveness: rule.Impacts_Attractiveness__c || false,
                Is_Required__c: rule.Is_Required__c || false,
                weight: rule.Attractiveness_Weight__c != null
                    ? String(Math.round(Number(rule.Attractiveness_Weight__c) * 100)) : '',
                Display_Order__c: rule.Display_Order__c ?? null,
                _label: attr.Name,
                _fmActive: attr.Is_Active__c,
                hasError: false,
                errorMsg: ''
            });
        });
        this.fmPendingList = pendingList;
        this._fmLastFamilyId = familyId;
        this._fmExpandedKeys = new Set();
        this.isFamilyModalOpen = true;
    }

    handleFmFamilyChange(e) { this.fmFamilyId = e.detail.value; }

    handleFmStep1Next() {
        if (!this.fmFamilyId) { this._showToast('Validation', 'Please select a product family.', 'warning'); return; }
        // Only wipe the pending list if the family changed since it was last populated
        if (this.fmFamilyId !== this._fmLastFamilyId) {
            this.fmPendingList = [];
            this._fmLastFamilyId = this.fmFamilyId;
        }
        this._fmExpandedKeys = new Set();
        this.fmStep = 2;
        this.fmPendingForm = null;
        this.fmFormVisible = false;
    }

    handleCloseFamilyModal() { this.isFamilyModalOpen = false; }
    handleFmBack() {
        if (this._fmIsEdit) return;
        this.fmStep = 1;
        this.fmPendingForm = null;
        this.fmFormVisible = false;
    }

    handleFmActionClick(e) { e.stopPropagation(); }

    handleFmToggleExpand(e) {
        const key = e.currentTarget.dataset.key;
        const next = new Set(this._fmExpandedKeys);
        if (next.has(key)) { next.delete(key); } else { next.add(key); }
        this._fmExpandedKeys = next;
    }


    creationMethodOptions = [
        { label: 'Reference Attribute', value: 'reference' },
        { label: 'Custom Attribute',    value: 'new' }
    ];
    valueModeOptions = [
        { label: 'Pre-defined Value',  value: 'predefined' },
        { label: 'Defined per Offer',  value: 'per_offer'  }
    ];

    get fmPendingFormCreationMethod() { return this.fmPendingForm?.creationMethod ?? 'reference'; }
    get fmPendingFormValueMode()      { return this.fmPendingForm?.valueMode      ?? 'predefined'; }

    // New-form radio handlers
    handleFmCreationMethodRadio(e) {
        const method = e.detail.value;
        this.fmPendingForm = { ...this.fmPendingForm, creationMethod: method, refValueId: null, refAttrName: '', inheritedType: '', inheritedValue: null, inheritedValueType: '', Name: '', Parameter_Type__c: '' };
    }
    handleFmValueModeRadio(e) {
        this.fmPendingForm = { ...this.fmPendingForm, valueMode: e.detail.value };
    }

    // Per-row radio handlers
    handleFmRowMethodRadio(e) {
        const key    = e.currentTarget.dataset.key;
        const method = e.detail.value;
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key !== key ? r : {
                ...r, creationMethod: method,
                refValueId: null, refAttrName: '', inheritedType: '', inheritedValue: null, inheritedValueType: '',
                Name: r.Name, Parameter_Type__c: r.Parameter_Type__c
            }
        );
    }
    handleFmRowValueModeRadio(e) {
        const key  = e.currentTarget.dataset.key;
        const mode = e.detail.value;
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key !== key ? r : { ...r, valueMode: mode }
        );
    }

    // ── Step-2 form ───────────────────────────────────────────────────────────
    get fmRefAttrOptions() {
        // Reference values for the selected family (range pairs collapsed to one)
        return this._refRecordsView
            .filter(r => r.Product_Family__c === this.fmFamilyId && r.Is_Active__c)
            .map(r => ({ label: `${r.Name} (${this._formatRefValue(r)})`, value: r.Id }));
    }

    get fmHasRefAttrs() { return this.fmRefAttrOptions.length > 0; }

    get fmIsReference() { return this.fmPendingForm?.creationMethod === 'reference'; }
    get fmIsNew() { return this.fmPendingForm?.creationMethod === 'new'; }
    get fmIsPicklist() { return this.fmPendingForm?.Parameter_Type__c === 'Picklist'; }
    get fmShowPredefinedValue() {
        return this.fmIsNew
            && this.fmPendingForm?.Parameter_Type__c
            && this.fmPendingForm?.Parameter_Type__c !== 'Checkbox'
            && this.fmPendingForm?.Parameter_Type__c !== 'Picklist';
    }
    get fmShowValueMode() { return this.fmShowPredefinedValue; }
    get fmValueModeIsPredefined() { return this.fmPendingForm?.valueMode === 'predefined'; }
    get fmPredefinedInputType() { return this._predefinedInputType(this.fmPendingForm?.Parameter_Type__c); }
    get fmPredefinedPlaceholder() { return this._predefinedPlaceholder(this.fmPendingForm?.Parameter_Type__c); }

    handleFmShowForm() {
        this.fmPendingForm = EMPTY_PENDING();
        this.fmFormVisible = true;
    }

    handleFmRefAttrChange(e) {
        const refId = e.detail.value;
        const refRecord = this._refRecordsView.find(r => r.Id === refId);
        this.fmPendingForm = {
            ...this.fmPendingForm,
            refValueId: refId,
            refAttrName: refRecord?.Name || '',
            inheritedType: refRecord?.Value_Type__c || '',
            inheritedValue: refRecord?.Reference_Value__c ?? null,
            inheritedValueType: refRecord?.Value_Type__c || '',
            refPicklistPowers: this._buildRefPowers(refRecord),
            displayName: this.fmPendingForm.displayName || refRecord?.Name || ''
        };
    }

    // ── Picklist reference: labels (grayed) + Power of effect ──────────────────
    get fmRefIsPicklist() {
        return this.fmPendingForm?.creationMethod === 'reference'
            && this.fmPendingForm?.inheritedType === 'Picklist';
    }
    get fmShowRefPowers() {
        return this.fmRefIsPicklist && this.fmPendingForm?.impactsAttractiveness;
    }
    get fmRefPowerRows() {
        return (this.fmPendingForm?.refPicklistPowers || []).map(row => {
            const num = row.power === '' || row.power == null ? null : Number(row.power);
            const invalid = this.fmPendingForm?.impactsAttractiveness &&
                (num == null || isNaN(num) || num < 0 || num > 1);
            return {
                ...row,
                inputClass: invalid ? 'rv-power-input rv-power-input_warn' : 'rv-power-input'
            };
        });
    }

    handleFmRefPowerInput(e) {
        const key = e.currentTarget.dataset.key;
        let value = e.target.value !== undefined ? e.target.value : e.detail.value;
        if (value !== '' && value != null) {
            let num = Number(value);
            if (!isNaN(num)) {
                if (num > 1) num = 1;
                if (num < 0) num = 0;
                value = String(num);
            }
        }
        this.fmPendingForm = {
            ...this.fmPendingForm,
            refPicklistPowers: (this.fmPendingForm.refPicklistPowers || []).map(row =>
                row._key === key ? { ...row, power: value } : row
            )
        };
    }

    handleFmFormField(e) {
        const field = e.currentTarget.dataset.field;
        const value = e.detail.value;
        this.fmPendingForm = { ...this.fmPendingForm, [field]: value };
    }

    handleFmFormCheckbox(e) {
        const field   = e.currentTarget.dataset.field;
        const checked = e.target.checked !== undefined ? e.target.checked : e.detail.checked;
        this.fmPendingForm = { ...this.fmPendingForm, [field]: checked };
    }

    handleFmAddToPending() {
        const p = this.fmPendingForm;
        // Validate
        if (p.creationMethod === 'reference' && !p.refValueId) {
            this._showToast('Validation', 'Select a reference attribute.', 'warning'); return;
        }
        if (p.creationMethod === 'new') {
            if (!p.Name?.trim()) { this._showToast('Validation', 'Attribute Name is required.', 'warning'); return; }
            if (!p.Parameter_Type__c) { this._showToast('Validation', 'Attribute Type is required.', 'warning'); return; }
            // Pre-defined value must be filled and valid before the attribute can be added
            if (this.fmShowValueMode && p.valueMode === 'predefined') {
                const raw = p.predefinedValue;
                if (raw == null || String(raw).trim() === '') {
                    this._showToast('Validation', 'Enter a pre-defined value.', 'warning'); return;
                }
                if (['Number', 'Decimal', 'Currency', 'Percent'].includes(p.Parameter_Type__c) && isNaN(Number(raw))) {
                    this._showToast('Validation', 'Pre-defined value must be a valid number.', 'warning'); return;
                }
            }
        }
        // Power of effect required for every label (decimal 0–1) when a Picklist reference impacts attractiveness
        if (this.fmShowRefPowers) {
            const invalid = (p.refPicklistPowers || []).some(row => {
                const n = Number(row.power);
                return row.power === '' || row.power == null || isNaN(n) || n < 0 || n > 1;
            });
            if (invalid) { this._showToast('Validation', 'Enter a Power of effect (0–1) for every picklist label.', 'warning'); return; }
        }
        const label = p.creationMethod === 'reference'
            ? (p.displayName?.trim() || p.refAttrName)
            : p.Name.trim();
        // Check duplicate name in pending list (only against new rows, not existing saved ones)
        if (this.fmPendingList.some(row => !row._attrId && row._label?.toLowerCase() === label.toLowerCase())) {
            this._showToast('Validation', `"${label}" is already in the list.`, 'warning'); return;
        }
        const newRow = { ...p, _label: label, weight: '', hasError: false, errorMsg: '' };
        this.fmPendingList = [...this.fmPendingList, newRow];
        this.fmPendingForm = EMPTY_PENDING();
        this.fmFormVisible = false;
    }

    handleFmCancelForm() {
        this.fmPendingForm = null;
        this.fmFormVisible = false;
    }

    handleFmRemovePending(e) {
        const key = e.currentTarget.dataset.key;
        this.fmPendingList = this.fmPendingList.filter(r => r._key !== key);
    }

    // ── Summary table — weight inputs ─────────────────────────────────────────
    handleFmWeightInput(e) {
        const key = e.currentTarget.dataset.key;
        const val = e.target.value !== undefined ? e.target.value : e.detail.value;
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key === key ? { ...r, weight: val } : r
        );
    }

    handleFmAttractiveness(e) {
        const key = e.currentTarget.dataset.key;
        const checked = e.target.checked !== undefined ? e.target.checked : e.detail.checked;
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key === key ? { ...r, impactsAttractiveness: checked, Is_Required__c: checked ? true : r.Is_Required__c, weight: checked ? r.weight : '' } : r
        );
    }

    handleFmRequired(e) {
        const key = e.currentTarget.dataset.key;
        const checked = e.target.checked !== undefined ? e.target.checked : e.detail.checked;
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key === key ? { ...r, Is_Required__c: checked } : r
        );
    }

    get fmSummaryRows() {
        return this.fmPendingList.map(r => {
            const missing = r.impactsAttractiveness && (r.weight === '' || r.weight == null);
            const isRef  = r.creationMethod === 'reference';
            const isNew  = r.creationMethod === 'new';
            const type   = isRef ? r.inheritedType : r.Parameter_Type__c;
            const isPicklist = isNew && r.Parameter_Type__c === 'Picklist';
            const showValueMode = isNew && r.Parameter_Type__c && r.Parameter_Type__c !== 'Checkbox' && r.Parameter_Type__c !== 'Picklist';
            const showPredefined = showValueMode && r.valueMode === 'predefined';
            const isActive = r._fmActive !== false;
            const weightInt = r.weight !== '' && r.weight != null ? parseInt(r.weight, 10) : null;
            return {
                ...r,
                isReference: isRef,
                isCustom: isNew,
                isPicklist,
                showValueMode,
                showPredefinedValue: showPredefined,
                weightMissing: missing,
                weightInputClass: missing ? 'fm-hdr-weight fm-hdr-weight_warn' : 'fm-hdr-weight',
                weightInt: weightInt ?? 0,
                weightDisplay: weightInt != null ? `${weightInt}%` : '—',
                predefinedValueDisplay: this._formatPredefinedValue(r.predefinedValue, type),
                predefinedInputType: this._predefinedInputType(type),
                predefinedPlaceholder: this._predefinedPlaceholder(type),
                _isNew: !r._attrId,
                isExpanded: this._fmExpandedKeys.has(r._key),
                chevronIcon: this._fmExpandedKeys.has(r._key) ? 'utility:chevrondown' : 'utility:chevronright',
                fmRowCardClass: missing ? 'fm-row-card fm-row-card_warn' : 'fm-row-card',
                activeSelectValue: isActive ? 'active' : 'inactive',
                activeSelectClass: isActive ? 'fm-hdr-select fm-hdr-select_active' : 'fm-hdr-select fm-hdr-select_inactive',
                requiredSelectValue: (r.impactsAttractiveness || r.Is_Required__c) ? 'required' : 'optional',
                requiredSelectClass: (r.impactsAttractiveness || r.Is_Required__c) ? 'fm-hdr-select fm-hdr-select_required' : 'fm-hdr-select fm-hdr-select_optional',
                showRequiredSelect: !r.impactsAttractiveness,
                isRequiredLocked: r.impactsAttractiveness,
                creationMethod: r.creationMethod,
                valueMode: r.valueMode
            };
        });
    }

    _formatPredefinedValue(val, type) {
        if (val == null || val === '') return null;
        const n = Number(val);
        if (isNaN(n)) return String(val);
        switch (type) {
            case 'Percent':  return `${n}%`;
            case 'Currency': return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            case 'Number':
            case 'Decimal':  return String(n);
            default:         return String(val);
        }
    }

    _predefinedInputType(type) {
        switch (type) {
            case 'Number':
            case 'Decimal':
            case 'Currency':
            case 'Percent':  return 'number';
            case 'Date':     return 'date';
            case 'URL':      return 'url';
            default:         return 'text';
        }
    }

    _predefinedPlaceholder(type) {
        switch (type) {
            case 'Number':   return 'e.g. 100';
            case 'Decimal':  return 'e.g. 3.75';
            case 'Currency': return 'e.g. 5000.00';
            case 'Percent':  return 'e.g. 12';
            case 'Date':     return '';
            case 'URL':      return 'https://...';
            default:         return 'e.g. value';
        }
    }

    // ── Per-row edit handlers ─────────────────────────────────────────────────
    handleFmRowRefAttr(e) {
        const key   = e.currentTarget.dataset.key;
        const refId = e.detail.value;
        const rec   = this._refRecordsView.find(r => r.Id === refId);
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key !== key ? r : {
                ...r,
                refValueId: refId,
                refAttrName: rec?.Name || '',
                inheritedType: rec?.Value_Type__c || '',
                inheritedValue: rec?.Reference_Value__c ?? null,
                displayName: r.displayName || rec?.Name || ''
            }
        );
    }

    handleFmRowField(e) {
        const key   = e.currentTarget.dataset.key;
        const field = e.currentTarget.dataset.field;
        const val   = e.detail.value;
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key !== key ? r : { ...r, [field]: val, _label: field === 'Name' ? val : (field === 'displayName' ? val || r.refAttrName : r._label) }
        );
    }

    handleFmActiveSelect(e) {
        const key = e.currentTarget.dataset.key;
        const active = e.target.value === 'active';
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key !== key ? r : { ...r, _fmActive: active }
        );
    }

    handleFmRequiredSelect(e) {
        const key = e.currentTarget.dataset.key;
        const required = e.target.value === 'required';
        this.fmPendingList = this.fmPendingList.map(r =>
            r._key !== key ? r : { ...r, Is_Required__c: required }
        );
    }

    get fmWeightSumInfo() {
        const attractRows = this.fmPendingList.filter(r => r.impactsAttractiveness);
        if (attractRows.length === 0) return null;
        const sum = attractRows.reduce((s, r) => s + (parseInt(r.weight, 10) || 0), 0);
        const isExact = sum === 100;
        const isOver  = sum > 100;
        const remaining = 100 - sum;
        // An active attractiveness attribute counted in the total but sitting at 0
        // contributes nothing to the score despite being flagged — flag it so Fix
        // can surface even when the total is already exactly 100%.
        const hasZeroActive = attractRows.some(
            r => r._fmActive !== false && (parseInt(r.weight, 10) || 0) === 0
        );
        const notExact = !isExact;
        return {
            sum, isExact, isOver, isUnder: notExact && !isOver, notExact, remaining,
            hasZeroActive, needsFix: notExact || hasZeroActive
        };
    }

    get fmWeightSumClass() {
        if (!this.fmWeightSumInfo) return '';
        const info = this.fmWeightSumInfo;
        if (info.isExact && !info.hasZeroActive) return 'fm-sum fm-sum-ok';
        return 'fm-sum fm-sum-warn';
    }

    // Distribute weight equally across all active attractiveness rows
    handleFmEqualizeWeights() {
        const targets = this.fmPendingList.filter(
            r => r.impactsAttractiveness && r._fmActive !== false
        );
        if (targets.length === 0) return;
        const base      = Math.floor(100 / targets.length);
        const remainder = 100 - base * targets.length;
        const targetKeys = targets.map(r => r._key);
        let applied = 0;
        this.fmPendingList = this.fmPendingList.map(r => {
            if (!targetKeys.includes(r._key)) return r;
            const extra = applied < remainder ? 1 : 0;
            applied++;
            return { ...r, weight: String(base + extra) };
        });
    }

    // Bring the total to 100%. Over 100: reduce the heaviest weights.
    // Under 100: pour the deficit into the newly-added (unset-weight) rows,
    // leaving already-weighted rows untouched.
    // Exactly 100 but with zero-weight active attributes: carve a fair share off
    // the heaviest rows so every active attribute carries some weight.
    handleFmFixWeights() {
        const info = this.fmWeightSumInfo;
        if (!info || !info.needsFix) return;
        if (info.isOver) {
            this._fixWeightsOver(info.sum - 100);
        } else if (info.isUnder) {
            this._fixWeightsUnder(100 - info.sum);
        } else if (info.hasZeroActive) {
            this._fixWeightsZeroShare();
        }
    }

    // Total is exactly 100% but one or more active attractiveness attributes sit
    // at 0. Take 1pp at a time from the heaviest rows and hand it to the zero
    // rows until each carries at least a fair floor share.
    _fixWeightsZeroShare() {
        const active = this.fmPendingList.filter(
            r => r.impactsAttractiveness && r._fmActive !== false
        );
        const zeros = active.filter(r => (parseInt(r.weight, 10) || 0) === 0);
        if (zeros.length === 0 || zeros.length === active.length) return;

        const floor = Math.max(1, Math.floor(100 / active.length));
        const need  = floor * zeros.length;
        const targets = active.map(r => ({ key: r._key, w: parseInt(r.weight, 10) || 0 }));
        const zeroKeys = new Set(zeros.map(r => r._key));

        let moved = 0;
        // Pull from the heaviest non-zero rows without dropping them below the floor.
        while (moved < need) {
            const donors = targets
                .filter(t => !zeroKeys.has(t.key) && t.w > floor)
                .sort((a, b) => b.w - a.w);
            if (donors.length === 0) break;
            donors[0].w -= 1;
            moved += 1;
        }
        // Spread what we pulled evenly across the zero rows.
        const zeroTargets = targets.filter(t => zeroKeys.has(t.key));
        const base = Math.floor(moved / zeroTargets.length);
        const rem  = moved - base * zeroTargets.length;
        zeroTargets.forEach((t, i) => { t.w = base + (i < rem ? 1 : 0); });

        this._applyFixedWeights(targets);
    }

    _fixWeightsOver(excess) {
        // Work on a mutable copy sorted descending by weight
        const targets = this.fmPendingList
            .filter(r => r.impactsAttractiveness && r._fmActive !== false)
            .map(r => ({ key: r._key, w: parseInt(r.weight, 10) || 0 }))
            .sort((a, b) => b.w - a.w);

        // Deduct 1pp at a time from the heaviest candidate until excess is gone
        while (excess > 0 && targets.some(t => t.w > 0)) {
            for (const t of targets) {
                if (excess <= 0) break;
                if (t.w > 0) { t.w -= 1; excess -= 1; }
            }
            targets.sort((a, b) => b.w - a.w);
        }
        this._applyFixedWeights(targets);
    }

    _fixWeightsUnder(deficit) {
        // Prefer the newly-added rows: active attractiveness rows with no weight yet.
        let recipients = this.fmPendingList.filter(
            r => r.impactsAttractiveness && r._fmActive !== false &&
                 (r.weight === '' || r.weight == null)
        );
        // If every attractiveness row already has a weight, add the deficit to the
        // lightest rows so we still reach 100% without touching the leaders.
        if (recipients.length === 0) {
            recipients = this.fmPendingList
                .filter(r => r.impactsAttractiveness && r._fmActive !== false)
                .sort((a, b) => (parseInt(a.weight, 10) || 0) - (parseInt(b.weight, 10) || 0));
        }
        if (recipients.length === 0) return;

        const base      = Math.floor(deficit / recipients.length);
        const remainder = deficit - base * recipients.length;
        const targets = recipients.map((r, i) => ({
            key: r._key,
            w: (parseInt(r.weight, 10) || 0) + base + (i < remainder ? 1 : 0)
        }));
        this._applyFixedWeights(targets);
    }

    // Reset every active attractiveness attribute back to 0.
    handleFmResetWeights() {
        this.fmPendingList = this.fmPendingList.map(r =>
            r.impactsAttractiveness && r._fmActive !== false
                ? { ...r, weight: '0' }
                : r
        );
    }

    _applyFixedWeights(targets) {
        const weightMap = Object.fromEntries(targets.map(t => [t.key, t.w]));
        this.fmPendingList = this.fmPendingList.map(r =>
            Object.prototype.hasOwnProperty.call(weightMap, r._key)
                ? { ...r, weight: String(weightMap[r._key]) }
                : r
        );
    }

    get fmCanSave() {
        if (this.fmPendingList.length === 0) return false;
        const attractRows = this.fmPendingList.filter(r => r.impactsAttractiveness);
        if (attractRows.some(r => r.weight === '' || r.weight == null)) return false;
        if (attractRows.length > 0) {
            const sum = attractRows.reduce((s, r) => s + (parseInt(r.weight, 10) || 0), 0);
            if (sum !== 100) return false;
        }
        return true;
    }

    get fmSaveDisabled() { return this.isSaving || !this.fmCanSave; }

    async handleFmSave() {
        if (!this.fmCanSave) return;
        this.isSaving = true;
        try {
            const rules = [];
            for (const p of this.fmPendingList) {
                const isPredefined = p.creationMethod !== 'reference' && p.valueMode === 'predefined';
                const attrRecord = {
                    Name: p._label,
                    Parameter_Type__c: p.creationMethod === 'reference' ? (p.inheritedType || 'Text') : p.Parameter_Type__c,
                    Value_Source__c: p.creationMethod === 'reference' ? 'Autopopulate' : (p.valueMode === 'predefined' ? 'Apriori' : 'Operator Defined'),
                    Attribute_Description__c: p.Attribute_Description__c || '',
                    Parameter_Help_Text__c: p.Parameter_Help_Text__c || '',
                    Default_Value__c: isPredefined ? (p.predefinedValue ?? null) : null,
                    Is_Active__c: p._fmActive !== false,
                    Is_Globally_Required__c: false
                };
                if (p._attrId) attrRecord.Id = p._attrId;
                // MERGE 2026-09-14: store picklist options in dedicated Picklist_Values__c instead of
                // appending into Parameter_Help_Text__c (which corrupted wizard help text).
                // To revert: restore the old line:
                //   attrRecord.Parameter_Help_Text__c = (attrRecord.Parameter_Help_Text__c ? attrRecord.Parameter_Help_Text__c + '\n' : '') + p.picklistValues;
                if (p.creationMethod === 'new' && p.Parameter_Type__c === 'Picklist') {
                    attrRecord.Picklist_Values__c = p.picklistValues || '';
                }
                const attrId = await saveOfferRecord({ record: attrRecord });

                let powerJson = null;
                if (p.creationMethod === 'reference' && p.inheritedType === 'Picklist'
                        && p.impactsAttractiveness && (p.refPicklistPowers || []).length) {
                    const map = {};
                    for (const row of p.refPicklistPowers) {
                        if (row.power !== '' && row.power != null) map[row.label] = Number(row.power);
                    }
                    powerJson = JSON.stringify(map);
                }
                const ruleRecord = {
                    Offer_Attribute__c: attrId,
                    Product_Family__c: this.fmFamilyId,
                    Reference_Value__c: p.creationMethod === 'reference' ? p.refValueId : null,
                    Is_Required__c: p.impactsAttractiveness ? true : (p.Is_Required__c || false),
                    Is_Visible__c: true,
                    Impacts_Attractiveness__c: p.impactsAttractiveness,
                    Attractiveness_Weight__c: p.impactsAttractiveness
                        ? parseFloat((parseInt(p.weight, 10) / 100).toFixed(4)) : null,
                    Picklist_Power_Values__c: powerJson,
                    Display_Order__c: p.Display_Order__c ?? null
                };
                if (p._ruleId) ruleRecord.Id = p._ruleId;
                rules.push(ruleRecord);
            }
            if (rules.length > 0) await saveAttributeRulesBulk({ rules });
            const newCount = this.fmPendingList.filter(p => !p._attrId).length;
            const updCount = this.fmPendingList.filter(p => p._attrId).length;
            const parts = [];
            if (newCount > 0) parts.push(`${newCount} added`);
            if (updCount > 0) parts.push(`${updCount} updated`);
            this._showToast('Success', `${parts.join(', ')} for ${this.fmFamilyName}.`, 'success');
            this.isFamilyModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (err) { this._showToast('Error', err.body?.message || 'Save failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    // ─── Delete ───────────────────────────────────────────────────────────────
    closeDeleteModal() { this.isDeleteModalOpen = false; }

    async handleConfirmDelete() {
        this.isDeleteModalOpen = false;
        this.isSaving = true;
        try {
            if (this._deleteType === 'attr') {
                await deleteDictionaryRecord({ recordId: this._deleteId });
                this._showToast('Success', 'Attribute deleted.', 'success');
                await refreshApex(this._wiredResult);
            } else if (this._deleteType === 'attrFromModal') {
                // Delete saved attribute from inside the family modal
                await deleteDictionaryRecord({ recordId: this._deleteId });
                // Also remove from pending list so modal reflects the change
                this.fmPendingList = this.fmPendingList.filter(r => r._key !== this._deleteKey);
                this._showToast('Success', 'Attribute deleted.', 'success');
                await refreshApex(this._wiredResult);
            } else if (this._deleteType === 'familyConfig') {
                // Delete all rule assignments for this family (and orphaned attributes)
                const familyId = this._deleteFamilyId;
                const ruleIds = this._rawRecords
                    .flatMap(r => r.Offer_Attribute_Rules__r || [])
                    .filter(r => r.Product_Family__c === familyId)
                    .map(r => r.Id);
                for (const ruleId of ruleIds) {
                    await deleteAttributeRule({ ruleId });
                }
                this._showToast('Success', `Removed ${ruleIds.length} attribute assignment(s) for this family.`, 'success');
                await refreshApex(this._wiredResult);
            } else if (this._deleteType === 'rule') {
                await deleteAttributeRule({ ruleId: this._deleteId });
                this._showToast('Success', 'Assignment removed.', 'success');
                await refreshApex(this._wiredResult);
            } else if (this._deleteType === 'ref') {
                await deleteReferenceValue({ recordId: this._deleteId });
                if (this._deleteRangeMaxId) await deleteReferenceValue({ recordId: this._deleteRangeMaxId });
                this._deleteRangeMaxId = null;
                this._showToast('Success', 'Reference value deleted.', 'success');
                await refreshApex(this._wiredRefResult);
            }
        } catch (e) { this._showToast('Error', e.body?.message || 'Delete failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}