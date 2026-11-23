/** Pure helpers for the Data360 filter builder: filter model, JSON (de)serialisation and column types. */
export const DMO_API_NAME = 'UnifiedIndividual__dlm';
export const MAX_CONDITIONS = 25;

export const OPERATOR_LABELS = {
    eq: 'equals',
    neq: 'does not equal',
    gt: 'is greater than',
    gte: 'is greater than or equal to',
    lt: 'is less than',
    lte: 'is less than or equal to',
    between: 'is between',
    in: 'is one of',
    notIn: 'is not one of',
    contains: 'contains',
    startsWith: 'starts with',
    endsWith: 'ends with',
    isNull: 'is empty',
    isNotNull: 'is not empty'
};
export const OPERATORS_BY_TYPE = {
    text: ['eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'isNull', 'isNotNull'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isNull', 'isNotNull'],
    date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'],
    timestamp: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'],
    boolean: ['eq', 'isNull', 'isNotNull']
};
export const LOGIC_OPTIONS = [
    { label: 'all of these (AND)', value: 'AND' },
    { label: 'any of these (OR)', value: 'OR' }
];
export const BOOLEAN_OPTIONS = [
    { label: 'true', value: 'true' },
    { label: 'false', value: 'false' }
];

let sequence = 0;
export const nextId = () => `n${++sequence}`;

/** Maps a Data360 column type (VARCHAR, BIGINT, TIMESTAMP WITH TIME ZONE ...) to a filter type. */
export function filterTypeOf(dataType) {
    const type = String(dataType || '').toUpperCase();
    if (/TIMESTAMP|DATETIME/.test(type)) return 'timestamp';
    if (/^DATE/.test(type)) return 'date';
    if (/BOOL/.test(type)) return 'boolean';
    if (/INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|NUMBER|LONG/.test(type)) return 'number';
    return 'text';
}

export function newCondition(overrides = {}) {
    return {
        id: nextId(),
        kind: 'condition',
        field: '',
        type: 'text',
        operator: 'eq',
        value: '',
        value2: '',
        valuesText: '',
        ...overrides
    };
}

function conditionFromJson(node) {
    const values = Array.isArray(node.values) ? node.values.join(', ') : '';
    return newCondition({
        field: node.field || '',
        type: OPERATORS_BY_TYPE[node.type] ? node.type : 'text',
        operator: node.operator || 'eq',
        value: node.value === undefined || node.value === null ? '' : String(node.value),
        value2: node.value2 === undefined || node.value2 === null ? '' : String(node.value2),
        valuesText: values || (['in', 'notIn'].includes(node.operator) && node.value ? String(node.value) : '')
    });
}

export function newGroup(conditions) {
    return { id: nextId(), kind: 'group', logic: 'OR', items: conditions };
}

function groupFromJson(node) {
    return {
        id: nextId(),
        kind: 'group',
        logic: String(node.logic || 'OR').toUpperCase() === 'AND' ? 'AND' : 'OR',
        items: (node.conditions || []).filter(item => !item.conditions).map(conditionFromJson)
    };
}

export function modelFromJson(json) {
    if (!json) return { logic: 'AND', items: [] };
    try {
        const parsed = JSON.parse(json);
        return {
            logic: String(parsed.logic || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND',
            items: (parsed.conditions || []).map(node => (node.conditions ? groupFromJson(node) : conditionFromJson(node)))
        };
    } catch (e) {
        return { logic: 'AND', items: [] };
    }
}

function conditionToJson(condition) {
    const node = { field: condition.field, type: condition.type, operator: condition.operator };
    if (['isNull', 'isNotNull'].includes(condition.operator)) return node;
    if (['in', 'notIn'].includes(condition.operator)) {
        node.values = String(condition.valuesText || '')
            .split(/[,\n]/)
            .map(entry => entry.trim())
            .filter(Boolean);
        return node;
    }
    node.value = condition.value;
    if (condition.operator === 'between') node.value2 = condition.value2;
    return node;
}

export function modelToJson(model) {
    if (!model.items.length) return '';
    return JSON.stringify({
        version: 1,
        dmo: DMO_API_NAME,
        logic: model.logic,
        conditions: model.items.map(item => (item.kind === 'group'
            ? { logic: item.logic, conditions: item.items.map(conditionToJson) }
            : conditionToJson(item)))
    });
}

export function countConditions(model) {
    return model.items.reduce((total, item) => total + (item.kind === 'group' ? item.items.length : 1), 0);
}

