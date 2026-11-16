import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getCalculations from '@salesforce/apex/OfferCalculationController.getCalculations';
import saveCalculation from '@salesforce/apex/OfferCalculationController.saveCalculation';
import deleteCalculation from '@salesforce/apex/OfferCalculationController.deleteCalculation';
import checkFormula from '@salesforce/apex/OfferCalculationController.checkFormula';
import previewCalculation from '@salesforce/apex/OfferCalculationController.previewCalculation';

const FORMULA = 'Formula';
const BANDS = 'Formula with Bands';
const VALUE_MAP = 'Value Map';

const TYPE_OPTIONS = [
    { label: 'Formula', value: FORMULA },
    { label: 'Formula with bands', value: BANDS },
    { label: 'Value map', value: VALUE_MAP }
];

const TYPE_HELP = {
    [FORMULA]: 'The formula result is the strength, from 0 to 1. Results below 0 count as 0 and above 1 count as 1. Fits Number, Currency and Percent attributes.',
    [BANDS]: 'The formula result is looked up in the bands below, and the matching band gives the strength. Fits Number, Currency and Percent attributes.',
    [VALUE_MAP]: 'Each family attribute lists its own values with a strength from 0 to 1. Fits Picklist and Checkbox attributes.'
};

const newKey = () => Math.random().toString(36).slice(2);
const emptyBand = () => ({ _key: newKey(), lower: null, upper: null, lowerInclusive: false, upperInclusive: true, score: null });
const emptyDraft = () => ({
    id: null, name: '', description: '', calculationType: FORMULA,
    formula: '({Value} - {Floor}) / ({Ceiling} - {Floor})', isActive: true, bands: [emptyBand()]
});

export default class OfferCalculationManager extends LightningElement {
    @track calculations = [];
    @track isLoading = true;
    @track isModalOpen = false;
    @track draft = emptyDraft();
    @track formulaCheck = null;
    @track previewVars = {};
    @track previewResult = null;
    @track previewError = null;
    @track isSaving = false;
    @track deleteTarget = null;

    typeOptions = TYPE_OPTIONS;
    _checkTimer;

    connectedCallback() {
        this.load();
    }

    @api
    async load() {
        this.isLoading = true;
        try {
            this.calculations = await getCalculations();
            this.dispatchEvent(new CustomEvent('calculationschange', { detail: { calculations: this.calculations } }));
        } catch (e) {
            this._toast('Error', e?.body?.message || 'Failed to load calculations.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    get hasCalculations() { return this.calculations.length > 0; }
    get isEmpty() { return !this.isLoading && this.calculations.length === 0; }

    get cards() {
        return this.calculations.map(c => ({
            ...c,
            typeLabel: c.calculationType === BANDS ? 'Formula with bands' : c.calculationType === VALUE_MAP ? 'Value map' : 'Formula',
            hasFormula: c.calculationType !== VALUE_MAP && !!c.formula,
            placeholderTokens: (c.placeholders || []).map(p => ({ key: p, text: `{${p}}` })),
            hasPlaceholders: (c.placeholders || []).length > 0,
            bandCount: (c.bands || []).length,
            hasBands: c.calculationType === BANDS,
            usedByCount: (c.usedBy || []).length,
            usedByText: (c.usedBy || []).join(', '),
            isUsed: (c.usedBy || []).length > 0,
            statusClass: c.isActive ? 'slds-badge oa-badge-active' : 'slds-badge oa-badge-inactive',
            statusLabel: c.isActive ? 'Active' : 'Inactive'
        }));
    }

    // ── Modal ────────────────────────────────────────────────────────────────
    get modalTitle() { return this.draft.id ? `Edit calculation — ${this.draft.name}` : 'New calculation'; }
    get typeHelp() { return TYPE_HELP[this.draft.calculationType]; }
    get isFormulaType() { return this.draft.calculationType !== VALUE_MAP; }
    get isBandsType() { return this.draft.calculationType === BANDS; }
    get draftUsedBy() {
        const c = this.calculations.find(x => x.id === this.draft.id);
        return c && (c.usedBy || []).length ? c.usedBy.join(', ') : '';
    }

    get formulaOk() { return this.formulaCheck && this.formulaCheck.ok; }
    get formulaError() { return this.formulaCheck && !this.formulaCheck.ok ? this.formulaCheck.message : ''; }
    get formulaPlaceholders() {
        return (this.formulaCheck?.placeholders || []).map(p => ({ key: p, text: `{${p}}` }));
    }
    get formulaUsesValue() { return !!this.formulaCheck?.usesValue; }
    get formulaMissesValue() { return this.formulaOk && !this.formulaCheck.usesValue; }

    get bandRows() {
        return (this.draft.bands || []).map((b, i) => {
            const s = b.score === null || b.score === '' || b.score === undefined ? NaN : Number(b.score);
            return { ...b, index: i, scoreClass: isNaN(s) || s < 0 || s > 1 ? 'ocm-band-input ocm-band-input_warn' : 'ocm-band-input' };
        });
    }

    get previewFields() {
        if (!this.formulaOk) return [];
        const names = [...(this.formulaCheck.usesValue ? ['Value'] : []), ...(this.formulaCheck.placeholders || [])];
        return names.map(n => ({ name: n, token: `{${n}}`, value: this.previewVars[n] ?? '' }));
    }
    get hasPreview() { return this.previewFields.length > 0; }
    get previewText() {
        if (this.previewError) return this.previewError;
        if (this.previewResult === null || this.previewResult === undefined) return 'Fill the test values to see the strength.';
        return `Strength ${Number(this.previewResult).toFixed(4)}`;
    }

    get saveDisabled() { return this.isSaving; }

    handleNew() {
        this.draft = emptyDraft();
        this.previewVars = {};
        this.previewResult = null;
        this.previewError = null;
        this.isModalOpen = true;
        this._checkNow();
    }

    handleEdit(e) {
        const c = this.calculations.find(x => x.id === e.currentTarget.dataset.id);
        if (!c) return;
        this.draft = {
            id: c.id,
            name: c.name,
            description: c.description || '',
            calculationType: c.calculationType,
            formula: c.formula || '',
            isActive: c.isActive,
            bands: (c.bands || []).length ? c.bands.map(b => ({ ...b, _key: newKey() })) : [emptyBand()]
        };
        this.previewVars = {};
        this.previewResult = null;
        this.previewError = null;
        this.isModalOpen = true;
        this._checkNow();
    }

    handleClose() { this.isModalOpen = false; }

    handleField(e) {
        const field = e.currentTarget.dataset.field;
        const value = field === 'isActive' ? e.detail.checked : e.detail.value;
        this.draft = { ...this.draft, [field]: value };
        if (field === 'formula' || field === 'calculationType') {
            window.clearTimeout(this._checkTimer);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this._checkTimer = window.setTimeout(() => this._checkNow(), 300);
        }
    }

    async _checkNow() {
        if (!this.isFormulaType) { this.formulaCheck = null; return; }
        try {
            this.formulaCheck = await checkFormula({ formula: this.draft.formula });
        } catch (e) {
            this.formulaCheck = { ok: false, message: e?.body?.message || 'Could not check the formula.' };
        }
        this._runPreview();
    }

    handleBandField(e) {
        const i = Number(e.currentTarget.dataset.index);
        const field = e.currentTarget.dataset.field;
        let value;
        if (field === 'lowerInclusive' || field === 'upperInclusive') value = e.target.checked;
        else value = e.target.value === '' ? null : Number(e.target.value);
        const bands = this.draft.bands.map((b, idx) => (idx === i ? { ...b, [field]: value } : b));
        this.draft = { ...this.draft, bands };
        this._runPreview();
    }

    handleAddBand() {
        this.draft = { ...this.draft, bands: [...this.draft.bands, emptyBand()] };
    }

    handleRemoveBand(e) {
        const i = Number(e.currentTarget.dataset.index);
        this.draft = { ...this.draft, bands: this.draft.bands.filter((b, idx) => idx !== i) };
        this._runPreview();
    }

    handlePreviewVar(e) {
        const name = e.currentTarget.dataset.name;
        this.previewVars = { ...this.previewVars, [name]: e.detail.value };
        this._runPreview();
    }

    _bandPayload() {
        return (this.draft.bands || []).map(b => ({
            lower: b.lower, upper: b.upper,
            lowerInclusive: !!b.lowerInclusive, upperInclusive: !!b.upperInclusive,
            score: b.score
        }));
    }

    async _runPreview() {
        if (!this.formulaOk) { this.previewResult = null; this.previewError = null; return; }
        const vars = {};
        for (const f of this.previewFields) {
            if (f.value === '' || f.value === null || isNaN(Number(f.value))) {
                this.previewResult = null;
                this.previewError = null;
                return;
            }
            vars[f.name] = Number(f.value);
        }
        try {
            this.previewResult = await previewCalculation({
                calculationType: this.draft.calculationType,
                formula: this.draft.formula,
                bands: this._bandPayload(),
                vars
            });
            this.previewError = null;
        } catch (e) {
            this.previewResult = null;
            this.previewError = e?.body?.message || 'Could not work out the strength.';
        }
    }

    async handleSave() {
        if (!this.draft.name || !this.draft.name.trim()) {
            this._toast('Validation', 'Give the calculation a name.', 'warning');
            return;
        }
        if (this.isFormulaType && !this.formulaOk) {
            this._toast('Validation', this.formulaError || 'Fix the formula first.', 'warning');
            return;
        }
        this.isSaving = true;
        try {
            const calculation = {
                sobjectType: 'Offer_Attribute_Calculation__c',
                Name: this.draft.name.trim(),
                Description__c: this.draft.description || null,
                Calculation_Type__c: this.draft.calculationType,
                Formula__c: this.isFormulaType ? this.draft.formula : null,
                Is_Active__c: this.draft.isActive
            };
            if (this.draft.id) calculation.Id = this.draft.id;
            await saveCalculation({ calculation, bands: this.isBandsType ? this._bandPayload() : [] });
            this._toast('Saved', `${calculation.Name} saved.`, 'success');
            this.isModalOpen = false;
            await this.load();
        } catch (e) {
            this._toast('Cannot save', e?.body?.message || 'Save failed.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleAskDelete(e) {
        const c = this.calculations.find(x => x.id === e.currentTarget.dataset.id);
        if (c) this.deleteTarget = c;
    }

    handleCancelDelete() { this.deleteTarget = null; }

    async handleConfirmDelete() {
        const target = this.deleteTarget;
        this.deleteTarget = null;
        if (!target) return;
        try {
            await deleteCalculation({ calculationId: target.id });
            this._toast('Deleted', `${target.name} deleted.`, 'success');
            await this.load();
        } catch (e) {
            this._toast('Cannot delete', e?.body?.message || 'Delete failed.', 'error');
        }
    }

    get deleteName() { return this.deleteTarget ? this.deleteTarget.name : ''; }
    get isDeleteOpen() { return !!this.deleteTarget; }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}