import { createElement } from 'lwc';
import MarketingDictionaryDmoFilterBuilder from 'c/marketingDictionaryDmoFilterBuilder';
import getData360DmoFields from '@salesforce/apex/MarketingDictionaryManagerController.getData360DmoFields';
import previewSql from '@salesforce/apex/PersonFilterCountController.previewSql';
import getFilterCount from '@salesforce/apex/PersonFilterCountController.getFilterCount';
import getTotalCount from '@salesforce/apex/PersonFilterCountController.getTotalCount';

jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getData360DmoFields', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonFilterCountController.previewSql', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonFilterCountController.getFilterCount', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonFilterCountController.getTotalCount', () => ({ default: jest.fn() }), { virtual: true });

const COLUMNS = [
    { label: 'Profile_Type__c · VARCHAR', value: 'Profile_Type__c', dataType: 'VARCHAR' },
    { label: 'age__c · BIGINT', value: 'age__c', dataType: 'BIGINT' },
    { label: 'active__c · BOOLEAN', value: 'active__c', dataType: 'BOOLEAN' },
    { label: 'ssot__CreatedDate__c · TIMESTAMP WITH TIME ZONE', value: 'ssot__CreatedDate__c', dataType: 'TIMESTAMP WITH TIME ZONE' }
];

const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};
const q = (element, selector) => element.shadowRoot.querySelector(selector);
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const button = (element, label) => all(element, '.dmo-filter__actions lightning-button, .dmo-filter__test lightning-button').find(item => item.label === label);
const field = (root, tag, label) => Array.from(root.querySelectorAll(tag)).find(item => item.label === label);
const inShadow = (element, tag, label) => field(element.shadowRoot, tag, label);

async function mount(value) {
    const element = createElement('c-marketing-dictionary-dmo-filter-builder', { is: MarketingDictionaryDmoFilterBuilder });
    if (value !== undefined) element.value = value;
    const events = [];
    element.addEventListener('filterchange', event => events.push(['filter', event.detail.value]));
    element.addEventListener('validitychange', event => events.push(['valid', event.detail.error]));
    document.body.appendChild(element);
    await flush();
    return { element, events };
}

const lastFilter = events => JSON.parse(events.filter(([kind]) => kind === 'filter').pop()[1]);

describe('c-marketing-dictionary-dmo-filter-builder', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        getData360DmoFields.mockResolvedValue(COLUMNS);
        previewSql.mockImplementation(({ filterJson }) => Promise.resolve(`SELECT COUNT(*) AS cnt FROM UnifiedIndividual__dlm WHERE /* ${filterJson.length} */`));
        getFilterCount.mockResolvedValue(1234);
        getTotalCount.mockResolvedValue(10000);
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it('loads the DMO columns and starts without conditions', async () => {
        const { element, events } = await mount();
        expect(getData360DmoFields).toHaveBeenCalledWith({ dmoApiName: 'UnifiedIndividual__dlm' });
        expect(all(element, '.dmo-filter__condition')).toHaveLength(0);
        expect(button(element, 'Add condition').disabled).toBe(false);
        expect(button(element, 'Test count')).toBeUndefined();
        expect(events).toEqual([]);
    });

    it('reports a column load failure and blocks adding conditions', async () => {
        getData360DmoFields.mockRejectedValue({ body: { message: 'No Data360 access' } });
        const { element } = await mount();
        expect(element.shadowRoot.textContent).toContain('No Data360 access');
        expect(button(element, 'Add condition').disabled).toBe(true);
    });

    it('adds a condition, adapts operators to the column type and emits the filter JSON', async () => {
        const { element, events } = await mount();
        button(element, 'Add condition').click();
        await flush();
        expect(all(element, '.dmo-filter__condition')).toHaveLength(1);

        const column = inShadow(element, 'lightning-combobox', 'Column');
        expect(column.options.map(option => option.value)).toEqual(COLUMNS.map(item => item.value));
        column.dispatchEvent(new CustomEvent('change', { detail: { value: 'age__c' } }));
        await flush();
        const operator = inShadow(element, 'lightning-combobox', 'Operator');
        expect(operator.options.map(option => option.value)).toContain('between');
        expect(operator.options.map(option => option.value)).not.toContain('contains');
        expect(inShadow(element, 'lightning-input', 'Value').type).toBe('number');

        inShadow(element, 'lightning-input', 'Value').dispatchEvent(new CustomEvent('change', { detail: { value: '18' } }));
        operator.dispatchEvent(new CustomEvent('change', { detail: { value: 'gte' } }));
        await flush();
        expect(lastFilter(events)).toEqual({
            version: 1,
            dmo: 'UnifiedIndividual__dlm',
            logic: 'AND',
            conditions: [{ field: 'age__c', type: 'number', operator: 'gte', value: '18' }]
        });
    });

    it('shows the inputs each operator needs', async () => {
        const { element } = await mount(JSON.stringify({
            conditions: [
                { field: 'age__c', type: 'number', operator: 'between', value: '1', value2: '5' },
                { field: 'Profile_Type__c', type: 'text', operator: 'in', values: ['a', 'b'] },
                { field: 'active__c', type: 'boolean', operator: 'eq', value: 'true' },
                { field: 'brand__c', type: 'text', operator: 'isNull' },
                { field: 'ssot__CreatedDate__c', type: 'timestamp', operator: 'gte', value: '2026-10-01' }
            ]
        }));
        const rows = all(element, '.dmo-filter__condition');
        expect(rows).toHaveLength(5);
        const labels = row => Array.from(row.querySelectorAll('lightning-input, lightning-combobox')).map(item => item.label);
        expect(labels(rows[0])).toEqual(['Column', 'Operator', 'Value', 'And']);
        expect(labels(rows[1])).toEqual(['Column', 'Operator', 'Values (comma separated)']);
        expect(labels(rows[2])).toEqual(['Column', 'Operator', 'Value']);
        expect(field(rows[2], 'lightning-combobox', 'Value').options.map(item => item.value)).toEqual(['true', 'false']);
        expect(labels(rows[3])).toEqual(['Column', 'Operator']);
        expect(field(rows[4], 'lightning-input', 'Value').type).toBe('date');
        expect(element.shadowRoot.textContent).toContain('Dates are compared by whole days.');
        expect(rows[1].querySelector('lightning-input').value).toBe('a, b');
    });

    it('keeps a column that is no longer in the DMO visible', async () => {
        const { element } = await mount(JSON.stringify({ conditions: [{ field: 'gone__c', type: 'text', operator: 'eq', value: 'x' }] }));
        const column = inShadow(element, 'lightning-combobox', 'Column');
        expect(column.options[0].value).toBe('gone__c');
        expect(column.value).toBe('gone__c');
    });

    it('supports OR groups and removing conditions and groups', async () => {
        const { element, events } = await mount();
        button(element, 'Add condition').click();
        button(element, 'Add group').click();
        await flush();
        expect(all(element, '.dmo-filter__row_group')).toHaveLength(1);
        expect(all(element, '.dmo-filter__row_nested')).toHaveLength(1);
        let filter = lastFilter(events);
        expect(filter.conditions[1].logic).toBe('OR');
        expect(filter.conditions[1].conditions).toHaveLength(1);

        button(element, 'Add condition').click();
        await flush();
        const addToGroup = all(element, '.dmo-filter__group-head lightning-button').find(item => item.label === 'Add condition');
        addToGroup.click();
        await flush();
        expect(all(element, '.dmo-filter__row_nested')).toHaveLength(2);

        const topLogic = q(element, '.dmo-filter__top-logic');
        topLogic.dispatchEvent(new CustomEvent('change', { detail: { value: 'OR' } }));
        q(element, '.dmo-filter__group-head lightning-combobox').dispatchEvent(new CustomEvent('change', { detail: { value: 'AND' } }));
        await flush();
        filter = lastFilter(events);
        expect(filter.logic).toBe('OR');
        expect(filter.conditions.find(item => item.conditions).logic).toBe('AND');

        const removeNested = all(element, '.dmo-filter__row_nested lightning-button-icon');
        removeNested[0].click();
        removeNested[1].click();
        await flush();
        expect(all(element, '.dmo-filter__row_group')).toHaveLength(0);

        all(element, '.dmo-filter__row lightning-button-icon').forEach(item => item.click());
        await flush();
        expect(events.filter(([kind]) => kind === 'filter').pop()[1]).toBe('');
        expect(q(element, '.dmo-filter__top-logic')).toBeNull();
    });

    it('limits the number of conditions', async () => {
        const conditions = Array.from({ length: 25 }, (_, index) => ({ field: `c${index}__c`, type: 'text', operator: 'eq', value: 'x' }));
        const { element } = await mount(JSON.stringify({ conditions }));
        expect(button(element, 'Add condition').disabled).toBe(true);
        expect(button(element, 'Add group').disabled).toBe(true);
    });

    it('asks to choose a column without calling the server, then previews the SQL when complete', async () => {
        const { element, events } = await mount();
        button(element, 'Add condition').click();
        await flush();
        jest.advanceTimersByTime(500);
        await flush();
        expect(previewSql).not.toHaveBeenCalled();
        expect(element.shadowRoot.textContent).toContain('Choose a column for every condition.');
        expect(events.filter(([kind]) => kind === 'valid').pop()).toEqual(['valid', 'Choose a column for every condition.']);

        inShadow(element, 'lightning-combobox', 'Column').dispatchEvent(new CustomEvent('change', { detail: { value: 'Profile_Type__c' } }));
        inShadow(element, 'lightning-input', 'Value').dispatchEvent(new CustomEvent('change', { detail: { value: 'B2C' } }));
        await flush();
        jest.advanceTimersByTime(500);
        await flush();
        expect(previewSql).toHaveBeenCalledTimes(1);
        expect(q(element, '.dmo-filter__sql').textContent).toContain('SELECT COUNT(*)');
        expect(events.filter(([kind]) => kind === 'valid').pop()).toEqual(['valid', '']);
    });

    it('shows the server validation error and does not allow a count', async () => {
        previewSql.mockRejectedValue({ body: { message: '"x" is not a number (column age__c).' } });
        const { element, events } = await mount(JSON.stringify({ conditions: [{ field: 'age__c', type: 'number', operator: 'eq', value: 'x' }] }));
        jest.advanceTimersByTime(500);
        await flush();
        expect(element.shadowRoot.textContent).toContain('is not a number');
        expect(button(element, 'Test count').disabled).toBe(true);
        expect(events.filter(([kind]) => kind === 'valid').pop()[1]).toContain('is not a number');
    });

    it('tests the count and shows it with its share of the total', async () => {
        const json = JSON.stringify({ version: 1, dmo: 'UnifiedIndividual__dlm', logic: 'AND', conditions: [{ field: 'Profile_Type__c', type: 'text', operator: 'eq', value: 'B2C' }] });
        const { element } = await mount(json);
        jest.advanceTimersByTime(500);
        await flush();
        button(element, 'Test count').click();
        await flush();
        expect(JSON.parse(getFilterCount.mock.calls[0][0].filterJson)).toEqual(JSON.parse(json));
        expect(element.shadowRoot.textContent).toContain('1,234 of 10,000 individuals match (12.3%)');

        getFilterCount.mockRejectedValue({ body: { message: "unknown column 'nope__c'" } });
        button(element, 'Test count').click();
        await flush();
        expect(element.shadowRoot.textContent).toContain("unknown column 'nope__c'");
        expect(getTotalCount).toHaveBeenCalledTimes(1);
    });

    it('forgets a count when the filter changes and adopts a new value from the parent', async () => {
        const json = JSON.stringify({ conditions: [{ field: 'Profile_Type__c', type: 'text', operator: 'eq', value: 'B2C' }] });
        const { element } = await mount(json);
        jest.advanceTimersByTime(500);
        await flush();
        button(element, 'Test count').click();
        await flush();
        expect(element.shadowRoot.textContent).toContain('individuals match');
        inShadow(element, 'lightning-input', 'Value').dispatchEvent(new CustomEvent('change', { detail: { value: 'B2B' } }));
        await flush();
        expect(element.shadowRoot.textContent).not.toContain('individuals match');

        element.value = '';
        await flush();
        expect(all(element, '.dmo-filter__condition')).toHaveLength(0);
    });
});
