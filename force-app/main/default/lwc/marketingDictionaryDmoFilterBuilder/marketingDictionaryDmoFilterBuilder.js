import { LightningElement, api, track } from 'lwc';
import getData360DmoFields from '@salesforce/apex/MarketingDictionaryManagerController.getData360DmoFields';
import previewSql from '@salesforce/apex/PersonFilterCountController.previewSql';
import getFilterCount from '@salesforce/apex/PersonFilterCountController.getFilterCount';
import getTotalCount from '@salesforce/apex/PersonFilterCountController.getTotalCount';
import {
    DMO_API_NAME,
    MAX_CONDITIONS,
    OPERATOR_LABELS,
    OPERATORS_BY_TYPE,
    LOGIC_OPTIONS,
    BOOLEAN_OPTIONS,
    filterTypeOf,
    newCondition,
    newGroup,
    modelFromJson,
    modelToJson,
    countConditions
} from 'c/marketingDictionaryDmoFilterModel';

const PREVIEW_DELAY_MS = 400;

/**
 * Builds the filter that defines a Customer Type / Audience Type value on the Data360 Individual DMO.
 * value is the filter JSON (empty = no filter). Emits filterchange { value } on every edit and
 * validitychange { error } once the server has checked it ('' when valid).
 */
export default class MarketingDictionaryDmoFilterBuilder extends LightningElement {
    @track model = { logic: 'AND', items: [] };
    columns = [];
    columnTypes = {};
    isLoadingColumns = true;
    columnError = '';
    sqlPreview = '';
    validationError = '';
    isCounting = false;
    countResult = null;
    countError = '';
    logicOptions = LOGIC_OPTIONS;
    booleanOptions = BOOLEAN_OPTIONS;
    _lastEmitted;
    _previewTimer;
    _previewToken = 0;
    _total = null;

    @api
    get value() {
        return this._lastEmitted;
    }
    set value(next) {
        const json = next || '';
        if (json === this._lastEmitted) return;
        this._lastEmitted = json;
        this.model = modelFromJson(json);
        this.countResult = null;
        this.countError = '';
        this.schedulePreview();
    }

    connectedCallback() {
        this.loadColumns();
    }

    disconnectedCallback() {
        clearTimeout(this._previewTimer);
    }

    loadColumns() {
        this.isLoadingColumns = true;
        this.columnError = '';
        getData360DmoFields({ dmoApiName: DMO_API_NAME })
            .then(rows => {
                this.columns = (rows || []).map(row => ({ label: row.label, value: row.value }));
                this.columnTypes = {};
                (rows || []).forEach(row => {
                    this.columnTypes[row.value] = filterTypeOf(row.dataType);
                });
                if (!this.columns.length) this.columnError = `No columns were returned for ${DMO_API_NAME}.`;
            })
            .catch(error => {
                this.columns = [];
                this.columnError = error?.body?.message || `Could not load the columns of ${DMO_API_NAME}.`;
            })
            .finally(() => {
                this.isLoadingColumns = false;
            });
    }

    // ─── View model ──────────────────────────────────────────────────────────

    get dmoName() {
        return DMO_API_NAME;
    }

    get topLogic() {
        return this.model.logic;
    }

    get hasItems() {
        return this.model.items.length > 0;
    }

    get canAdd() {
        return !this.isLoadingColumns && !this.columnError && countConditions(this.model) < MAX_CONDITIONS;
    }

    get addDisabled() {
        return !this.canAdd;
    }

    get hasColumnError() {
        return !!this.columnError;
    }

    get rows() {
        const rows = [];
        this.model.items.forEach(item => {
            if (item.kind === 'group') {
                rows.push({
                    key: item.id,
                    id: item.id,
                    isGroup: true,
                    isCondition: false,
                    logic: item.logic,
                    className: 'dmo-filter__row dmo-filter__row_group'
                });
                item.items.forEach(condition => rows.push(this.conditionRow(condition, true)));
            } else {
                rows.push(this.conditionRow(item, false));
            }
        });
        return rows;
    }

    conditionRow(condition, inGroup) {
        const type = condition.type;
        const operator = condition.operator;
        const noValue = operator === 'isNull' || operator === 'isNotNull';
        const isList = operator === 'in' || operator === 'notIn';
        const known = this.columns.some(column => column.value === condition.field);
        const columnOptions = known || !condition.field
            ? this.columns
            : [{ label: condition.field, value: condition.field }, ...this.columns];
        const inputType = type === 'number' ? 'number' : type === 'date' || type === 'timestamp' ? 'date' : 'text';
        return {
            key: condition.id,
            id: condition.id,
            isGroup: false,
            isCondition: true,
            className: `dmo-filter__row${inGroup ? ' dmo-filter__row_nested' : ''}`,
            field: condition.field,
            columnOptions,
            typeLabel: type,
            operator,
            operatorOptions: OPERATORS_BY_TYPE[type].map(code => ({ label: OPERATOR_LABELS[code], value: code })),
            isBoolean: type === 'boolean' && !noValue,
            showSingle: !noValue && !isList && type !== 'boolean',
            showSecond: operator === 'between',
            showList: isList,
            inputType,
            step: type === 'number' ? 'any' : null,
            value: condition.value,
            value2: condition.value2,
            valuesText: condition.valuesText,
            dayHint: type === 'timestamp' && !noValue
        };
    }

    // ─── Editing ─────────────────────────────────────────────────────────────

    findCondition(id) {
        for (const item of this.model.items) {
            if (item.kind === 'condition' && item.id === id) return item;
            if (item.kind === 'group') {
                const found = item.items.find(condition => condition.id === id);
                if (found) return found;
            }
        }
        return null;
    }

    commit() {
        this.countResult = null;
        this.countError = '';
        const json = modelToJson(this.model);
        this._lastEmitted = json;
        this.dispatchEvent(new CustomEvent('filterchange', { detail: { value: json } }));
        this.schedulePreview();
    }

    handleTopLogic(event) {
        this.model.logic = event.detail.value;
        this.commit();
    }

    handleGroupLogic(event) {
        const group = this.model.items.find(item => item.id === event.currentTarget.dataset.id);
        if (group) group.logic = event.detail.value;
        this.commit();
    }

    handleAddCondition() {
        this.model.items = [...this.model.items, newCondition()];
        this.commit();
    }

    handleAddGroup() {
        this.model.items = [...this.model.items, newGroup([newCondition()])];
        this.commit();
    }

    handleAddToGroup(event) {
        const group = this.model.items.find(item => item.id === event.currentTarget.dataset.id);
        if (group) group.items = [...group.items, newCondition()];
        this.commit();
    }

    handleRemoveGroup(event) {
        this.model.items = this.model.items.filter(item => item.id !== event.currentTarget.dataset.id);
        this.commit();
    }

    handleRemoveCondition(event) {
        const id = event.currentTarget.dataset.id;
        this.model.items = this.model.items
            .map(item => (item.kind === 'group' ? { ...item, items: item.items.filter(condition => condition.id !== id) } : item))
            .filter(item => (item.kind === 'group' ? item.items.length > 0 : item.id !== id));
        this.commit();
    }

    handleField(event) {
        const condition = this.findCondition(event.currentTarget.dataset.id);
        if (!condition) return;
        condition.field = event.detail.value;
        const type = this.columnTypes[condition.field] || 'text';
        if (type !== condition.type) {
            condition.type = type;
            condition.value = '';
            condition.value2 = '';
            condition.valuesText = '';
        }
        if (!OPERATORS_BY_TYPE[type].includes(condition.operator)) condition.operator = OPERATORS_BY_TYPE[type][0];
        if (type === 'boolean' && !condition.value) condition.value = 'true';
        this.commit();
    }

    handleOperator(event) {
        const condition = this.findCondition(event.currentTarget.dataset.id);
        if (!condition) return;
        condition.operator = event.detail.value;
        if (condition.type === 'boolean' && !condition.value) condition.value = 'true';
        this.commit();
    }

    handleValue(event) {
        const condition = this.findCondition(event.currentTarget.dataset.id);
        if (!condition) return;
        condition[event.currentTarget.dataset.prop] = event.detail.value === undefined || event.detail.value === null ? '' : event.detail.value;
        this.commit();
    }

    // ─── Validation, preview, test count ─────────────────────────────────────

    schedulePreview() {
        clearTimeout(this._previewTimer);
        this.sqlPreview = '';
        this.validationError = '';
        const json = modelToJson(this.model);
        if (!json) {
            this.dispatchEvent(new CustomEvent('validitychange', { detail: { error: '' } }));
            return;
        }
        if (this.hasIncompleteCondition()) {
            this.validationError = 'Choose a column for every condition.';
            this.dispatchEvent(new CustomEvent('validitychange', { detail: { error: this.validationError } }));
            return;
        }
        const token = ++this._previewToken;
        this._previewTimer = setTimeout(() => {
            previewSql({ filterJson: json })
                .then(sql => {
                    if (token !== this._previewToken) return;
                    this.sqlPreview = sql;
                    this.validationError = '';
                    this.dispatchEvent(new CustomEvent('validitychange', { detail: { error: '' } }));
                })
                .catch(error => {
                    if (token !== this._previewToken) return;
                    this.sqlPreview = '';
                    this.validationError = error?.body?.message || 'The filter is not valid.';
                    this.dispatchEvent(new CustomEvent('validitychange', { detail: { error: this.validationError } }));
                });
        }, PREVIEW_DELAY_MS);
    }

    hasIncompleteCondition() {
        return this.model.items.some(item => (item.kind === 'group'
            ? item.items.some(condition => !condition.field)
            : !item.field));
    }

    get hasSql() {
        return !!this.sqlPreview;
    }

    get hasValidationError() {
        return !!this.validationError;
    }

    get canTest() {
        return this.hasItems && !this.hasValidationError && !this.isCounting && !!this.sqlPreview;
    }

    get testDisabled() {
        return !this.canTest;
    }

    get hasCountResult() {
        return this.countResult !== null;
    }

    get countText() {
        const result = this.countResult;
        if (!result) return '';
        const formatted = new Intl.NumberFormat().format(result.count);
        if (!result.total) return `${formatted} unified individuals match`;
        const share = (result.count / result.total) * 100;
        return `${formatted} of ${new Intl.NumberFormat().format(result.total)} unified individuals match (${share < 0.1 && result.count > 0 ? '<0.1' : share.toFixed(1)}%)`;
    }

    get hasCountError() {
        return !!this.countError;
    }

    async handleTest() {
        const json = modelToJson(this.model);
        if (!json) return;
        this.isCounting = true;
        this.countResult = null;
        this.countError = '';
        try {
            const [count, total] = await Promise.all([
                getFilterCount({ filterJson: json }),
                this._total === null ? getTotalCount().catch(() => null) : Promise.resolve(this._total)
            ]);
            this._total = total;
            this.countResult = { count, total };
        } catch (error) {
            this.countError = error?.body?.message || 'The count failed.';
        } finally {
            this.isCounting = false;
        }
    }
}
