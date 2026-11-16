import { LightningElement, api } from 'lwc';

export const NUMERIC_TYPES = ['Number', 'Decimal', 'Currency', 'Percent', 'Days', 'Months'];
export const VALUE_MAP_TYPES = ['Picklist', 'Checkbox'];
const VALUE_MAP = 'Value Map';
const BANDS = 'Formula with Bands';

export function isScorableType(type) {
    return NUMERIC_TYPES.includes(type) || VALUE_MAP_TYPES.includes(type);
}

export function calculationFits(calc, type) {
    if (!calc) return false;
    if (NUMERIC_TYPES.includes(type)) return calc.calculationType !== VALUE_MAP;
    if (VALUE_MAP_TYPES.includes(type)) return calc.calculationType === VALUE_MAP;
    return false;
}

export function inputIsFilled(input) {
    if (!input) return false;
    if (input.source === 'number') return input.value !== '' && input.value !== null && input.value !== undefined && !isNaN(Number(input.value));
    if (input.source === 'reference') return !!input.id;
    if (input.source === 'attribute') return !!input.field;
    return false;
}

/** One message per gap, empty when the attribute is fully set up. */
export function calculationProblems(label, type, calc, inputs, valueRows) {
    const problems = [];
    if (!isScorableType(type)) {
        problems.push(`${label}: a ${type || 'typeless'} attribute cannot impact attractiveness.`);
        return problems;
    }
    if (!calc) {
        problems.push(`${label}: pick a calculation.`);
        return problems;
    }
    if (!calculationFits(calc, type)) {
        problems.push(`${label}: ${calc.name} does not fit a ${type} attribute.`);
        return problems;
    }
    if (calc.calculationType === VALUE_MAP) {
        const rows = valueRows || [];
        if (rows.length === 0) problems.push(`${label}: add at least one value with its strength.`);
        const seen = new Set();
        rows.forEach(r => {
            const key = (r.key || '').trim();
            const score = r.score === '' || r.score === null || r.score === undefined ? NaN : Number(r.score);
            if (!key) problems.push(`${label}: every value row needs a value.`);
            else if (seen.has(key.toLowerCase())) problems.push(`${label}: "${key}" is listed twice.`);
            else seen.add(key.toLowerCase());
            if (isNaN(score) || score < 0 || score > 1) problems.push(`${label}: strength for "${key || '?'}" must be between 0 and 1.`);
        });
        return problems;
    }
    const missing = (calc.placeholders || []).filter(p => !inputIsFilled((inputs || {})[p]));
    if (missing.length) problems.push(`${label}: fill ${missing.map(p => `{${p}}`).join(', ')}.`);
    return problems;
}

const SOURCE_OPTIONS = [
    { label: 'Reference value', value: 'reference' },
    { label: 'Typed number', value: 'number' },
    { label: 'Offer attribute', value: 'attribute' }
];

const newKey = () => Math.random().toString(36).slice(2);

export default class OfferAttributeCalculationEditor extends LightningElement {
    @api attributeType;
    @api calculations = [];
    @api calculationId;
    @api inputs;
    @api valueRows;
    @api valueLabels = [];
    @api references = [];
    @api attributes = [];

    sourceOptions = SOURCE_OPTIONS;

    get isScorable() { return isScorableType(this.attributeType); }

    get selected() {
        return (this.calculations || []).find(c => c.id === this.calculationId) || null;
    }

    get calculationOptions() {
        return (this.calculations || [])
            .filter(c => calculationFits(c, this.attributeType) && (c.isActive || c.id === this.calculationId))
            .map(c => ({ label: c.isActive ? c.name : `${c.name} (inactive)`, value: c.id }));
    }

    get hasCalculationOptions() { return this.calculationOptions.length > 0; }

    get isValueMap() { return this.selected?.calculationType === VALUE_MAP; }
    get isFormula() { return !!this.selected && !this.isValueMap; }
    get hasBands() { return this.selected?.calculationType === BANDS && (this.selected.bands || []).length > 0; }

    get formulaText() { return this.selected?.formula || ''; }
    get calcDescription() { return this.selected?.description || ''; }

    get bandChips() {
        return (this.selected?.bands || []).map((b, i) => {
            const lo = b.lower === null || b.lower === undefined ? null : b.lower;
            const hi = b.upper === null || b.upper === undefined ? null : b.upper;
            let range;
            if (lo === null && hi === null) range = 'any';
            else if (lo === null) range = `${b.upperInclusive ? '≤' : '<'} ${hi}`;
            else if (hi === null) range = `${b.lowerInclusive ? '≥' : '>'} ${lo}`;
            else range = `${b.lowerInclusive ? '[' : '('}${lo} – ${hi}${b.upperInclusive ? ']' : ')'}`;
            return { key: `b${i}`, text: `${range} → ${b.score}` };
        });
    }

    get referenceOptions() {
        return (this.references || []).map(r => ({
            label: r.value === null || r.value === undefined ? r.name : `${r.name} (${Number(r.value).toLocaleString()})`,
            value: r.id
        }));
    }

    get attributeOptions() {
        return (this.attributes || []).map(a => ({ label: a.name, value: a.field }));
    }

    get placeholderRows() {
        if (!this.isFormula) return [];
        const inputs = this.inputs || {};
        return (this.selected.placeholders || []).map(name => {
            const input = inputs[name] || { source: 'reference' };
            const filled = inputIsFilled(input);
            let resolved = '';
            if (input.source === 'reference' && input.id) {
                const ref = (this.references || []).find(r => r.id === input.id);
                resolved = ref ? `${ref.name} = ${ref.value === null || ref.value === undefined ? 'no value' : Number(ref.value).toLocaleString()}` : 'reference not found for this family';
            } else if (input.source === 'number' && filled) {
                resolved = `= ${Number(input.value).toLocaleString()}`;
            } else if (input.source === 'attribute' && input.field) {
                resolved = `the offer's ${input.name || input.field}`;
            }
            return {
                name,
                token: `{${name}}`,
                source: input.source || 'reference',
                isReference: (input.source || 'reference') === 'reference',
                isNumber: input.source === 'number',
                isAttribute: input.source === 'attribute',
                refId: input.id || null,
                numberValue: input.value ?? '',
                field: input.field || null,
                resolved,
                rowClass: filled ? 'oace-ph-row' : 'oace-ph-row oace-ph-row_missing'
            };
        });
    }

    get valueRowViews() {
        return (this.valueRows || []).map((r, i) => {
            const score = r.score === '' || r.score === null || r.score === undefined ? NaN : Number(r.score);
            const bad = isNaN(score) || score < 0 || score > 1 || !(r.key || '').trim();
            return { ...r, _key: r._key || `v${i}`, index: i, inputClass: bad ? 'oace-vm-score oace-vm-score_warn' : 'oace-vm-score' };
        });
    }

    get hasUnlistedLabels() {
        const have = new Set((this.valueRows || []).map(r => (r.key || '').trim().toLowerCase()));
        return (this.valueLabels || []).some(l => !have.has(String(l).trim().toLowerCase()));
    }

    _emit(next) {
        this.dispatchEvent(new CustomEvent('calcchange', {
            detail: {
                calculationId: next.calculationId !== undefined ? next.calculationId : this.calculationId,
                inputs: next.inputs !== undefined ? next.inputs : { ...(this.inputs || {}) },
                valueRows: next.valueRows !== undefined ? next.valueRows : [...(this.valueRows || [])]
            }
        }));
    }

    _seedRows() {
        return (this.valueLabels || []).map(label => ({ _key: newKey(), key: String(label), score: '' }));
    }

    handleCalculation(e) {
        const id = e.detail.value;
        const calc = (this.calculations || []).find(c => c.id === id);
        const next = { calculationId: id };
        if (calc && calc.calculationType === VALUE_MAP && (this.valueRows || []).length === 0) {
            next.valueRows = this._seedRows();
        }
        this._emit(next);
    }

    _setInput(name, patch) {
        const inputs = { ...(this.inputs || {}) };
        inputs[name] = { ...(inputs[name] || { source: 'reference' }), ...patch };
        this._emit({ inputs });
    }

    handleSource(e) {
        const name = e.currentTarget.dataset.name;
        this._setInput(name, { source: e.detail.value, id: null, value: null, field: null, name: null });
    }

    handleReference(e) {
        const name = e.currentTarget.dataset.name;
        const ref = (this.references || []).find(r => r.id === e.detail.value);
        this._setInput(name, { source: 'reference', id: e.detail.value, name: ref ? ref.name : null });
    }

    handleNumber(e) {
        const name = e.currentTarget.dataset.name;
        const raw = e.detail.value;
        this._setInput(name, { source: 'number', value: raw === '' || raw === null ? null : Number(raw) });
    }

    handleAttribute(e) {
        const name = e.currentTarget.dataset.name;
        const attr = (this.attributes || []).find(a => a.field === e.detail.value);
        this._setInput(name, { source: 'attribute', field: e.detail.value, name: attr ? attr.name : null });
    }

    handleValueKey(e) {
        const i = Number(e.currentTarget.dataset.index);
        const rows = (this.valueRows || []).map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r));
        this._emit({ valueRows: rows });
    }

    handleValueScore(e) {
        const i = Number(e.currentTarget.dataset.index);
        const rows = (this.valueRows || []).map((r, idx) => (idx === i ? { ...r, score: e.target.value } : r));
        this._emit({ valueRows: rows });
    }

    handleAddValue() {
        this._emit({ valueRows: [...(this.valueRows || []), { _key: newKey(), key: '', score: '' }] });
    }

    handleRemoveValue(e) {
        const i = Number(e.currentTarget.dataset.index);
        this._emit({ valueRows: (this.valueRows || []).filter((r, idx) => idx !== i) });
    }

    handleFillLabels() {
        const rows = [...(this.valueRows || [])];
        const have = new Set(rows.map(r => (r.key || '').trim().toLowerCase()));
        (this.valueLabels || []).forEach(label => {
            if (!have.has(String(label).trim().toLowerCase())) rows.push({ _key: newKey(), key: String(label), score: '' });
        });
        this._emit({ valueRows: rows });
    }
}