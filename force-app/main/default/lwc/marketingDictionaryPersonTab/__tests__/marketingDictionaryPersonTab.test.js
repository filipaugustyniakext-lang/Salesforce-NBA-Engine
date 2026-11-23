import { createElement } from 'lwc';
import MarketingDictionaryPersonTab from 'c/marketingDictionaryPersonTab';
import getPersonRecords from '@salesforce/apex/MarketingDictionaryManagerController.getPersonRecords';
import saveProductRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveProductRecord';
import getData360DmoFields from '@salesforce/apex/MarketingDictionaryManagerController.getData360DmoFields';
import previewSql from '@salesforce/apex/PersonFilterCountController.previewSql';
import getFilterCount from '@salesforce/apex/PersonFilterCountController.getFilterCount';
import getTotalCount from '@salesforce/apex/PersonFilterCountController.getTotalCount';

jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getPersonRecords', () => {
    const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
    return { default: createApexTestWireAdapter(jest.fn()) };
}, { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveProductRecord', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveProductRecordsBulk', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getData360DmoFields', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonFilterCountController.getFilterCount', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonFilterCountController.getTotalCount', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonFilterCountController.previewSql', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('c/marketingDictionaryRenamePrompt', () => ({ confirmDictionaryRenameIfNeeded: jest.fn().mockResolvedValue(true) }), { virtual: true });
jest.mock('c/marketingDictionaryDeleteHelper', () => ({
    runDictionaryDeleteWithDependencyCheck: jest.fn(),
    isDependencyBlockedMessage: jest.fn(),
    fetchDictionaryDeleteReport: jest.fn(),
    reportHasDependencies: jest.fn().mockReturnValue(false)
}), { virtual: true });

const filterFor = value => JSON.stringify({ version: 1, dmo: 'ssot__Individual__dlm', logic: 'AND', conditions: [{ field: 'Profile_Type__c', type: 'text', operator: 'eq', value }] });
const record = (id, name, subType, filter) => ({ Id: id, Name: name, Dictionary_Sub_Type__c: subType, Data360_Filter_JSON__c: filter || null });

const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const q = (element, selector) => element.shadowRoot.querySelector(selector);
const rowOf = (element, name) => all(element, 'li').find(item => item.textContent.includes(name));

async function mount(records) {
    const element = createElement('c-marketing-dictionary-person-tab', { is: MarketingDictionaryPersonTab });
    document.body.appendChild(element);
    getPersonRecords.emit(records);
    await flush();
    return element;
}

describe('c-marketing-dictionary-person-tab counts', () => {
    beforeEach(() => {
        getTotalCount.mockResolvedValue(10000);
        getFilterCount.mockResolvedValue(1234);
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('counts every value with a filter and shows the count, the share and the total', async () => {
        const element = await mount([
            record('1', 'Retail', 'Customer Type', filterFor('B2C')),
            record('2', 'Unfiltered', 'Customer Type')
        ]);
        expect(getFilterCount).toHaveBeenCalledTimes(1);
        expect(getFilterCount).toHaveBeenCalledWith({ filterJson: filterFor('B2C') });
        expect(rowOf(element, 'Retail').textContent).toContain('1,234');
        expect(rowOf(element, 'Retail').textContent).toContain('12.3%');
        expect(rowOf(element, 'Unfiltered').textContent).toContain('No filter');
        expect(element.shadowRoot.textContent).toContain('10,000 individuals in total');
    });

    it('runs at most four counts at a time and fills rows in as they finish', async () => {
        const pending = [];
        getFilterCount.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
        const records = Array.from({ length: 6 }, (_, index) => record(String(index), `Type ${index}`, 'Customer Type', filterFor(`v${index}`)));
        const element = await mount(records);
        expect(getFilterCount).toHaveBeenCalledTimes(4);
        expect(all(element, 'li lightning-spinner')).toHaveLength(6);
        expect(all(element, 'lightning-button').find(item => item.label === 'Refresh counts').disabled).toBe(true);

        pending[0](10);
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(5);
        expect(rowOf(element, 'Type 0').textContent).toContain('10');
        expect(all(element, 'li lightning-spinner')).toHaveLength(5);

        pending.slice(1).forEach(resolve => resolve(1));
        await flush();
        pending.slice(5).forEach(resolve => resolve(1));
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(6);
        expect(all(element, 'li lightning-spinner')).toHaveLength(0);
        expect(all(element, 'lightning-button').find(item => item.label === 'Refresh counts').disabled).toBe(false);
    });

    it('shows a failed count on its row only', async () => {
        getFilterCount.mockImplementation(({ filterJson }) => (filterJson === filterFor('bad')
            ? Promise.reject({ body: { message: "unknown column 'nope__c'" } })
            : Promise.resolve(5)));
        const element = await mount([
            record('1', 'Broken', 'Customer Type', filterFor('bad')),
            record('2', 'Fine', 'Customer Type', filterFor('good'))
        ]);
        const broken = rowOf(element, 'Broken');
        expect(broken.textContent).toContain('Count failed');
        expect(broken.querySelector('lightning-icon').title).toBe("unknown column 'nope__c'");
        expect(rowOf(element, 'Fine').textContent).toContain('5');
    });

    it('counts again on Refresh counts and ignores results of a superseded run', async () => {
        const first = [];
        getFilterCount.mockImplementationOnce(() => new Promise(resolve => first.push(resolve)));
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        expect(getFilterCount).toHaveBeenCalledTimes(1);

        getFilterCount.mockResolvedValue(77);
        all(element, 'lightning-button').find(item => item.label === 'Refresh counts').click();
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(2);
        expect(rowOf(element, 'Retail').textContent).toContain('77');

        first[0](999999);
        await flush();
        expect(rowOf(element, 'Retail').textContent).toContain('77');
        expect(rowOf(element, 'Retail').textContent).not.toContain('999,999');
    });

    it('recounts when the tab is opened again, but not twice in a row', async () => {
        const now = jest.spyOn(Date, 'now');
        now.mockReturnValue(1000000);
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        expect(getFilterCount).toHaveBeenCalledTimes(1);
        element.refreshCounts();
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(1);
        now.mockReturnValue(1000000 + 5000);
        element.refreshCounts();
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(2);
        now.mockRestore();
    });

    it('does not query Data360 when no value has a filter', async () => {
        const element = await mount([record('1', 'Retail', 'Customer Type')]);
        expect(getFilterCount).not.toHaveBeenCalled();
        expect(getTotalCount).not.toHaveBeenCalled();
        expect(rowOf(element, 'Retail').textContent).toContain('No filter');
        expect(element.shadowRoot.textContent).not.toContain('individuals in total');
    });

    it('keeps counting without a total when the total fails', async () => {
        getTotalCount.mockRejectedValue(new Error('no'));
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        expect(rowOf(element, 'Retail').textContent).toContain('1,234');
        expect(rowOf(element, 'Retail').textContent).not.toContain('%');
    });

    it('counts audience types too', async () => {
        const element = await mount([record('9', 'Prospect', 'Audience Type', filterFor('P'))]);
        all(element, 'button[role="tab"]').find(item => item.textContent.includes('Audience Types')).click();
        await flush();
        expect(rowOf(element, 'Prospect').textContent).toContain('1,234');
    });
});

describe('c-marketing-dictionary-person-tab filter editing', () => {
    beforeEach(() => {
        getTotalCount.mockResolvedValue(10000);
        getFilterCount.mockResolvedValue(1);
        saveProductRecord.mockResolvedValue('1');
        getData360DmoFields.mockResolvedValue([]);
        previewSql.mockResolvedValue('SELECT 1');
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    const openEdit = async (element, name) => {
        rowOf(element, name).querySelector('lightning-button-icon[title="Edit"]').click();
        await flush();
    };
    const saveButton = element => all(element, '.slds-modal__footer lightning-button').find(item => item.label === 'Save');

    it('shows the filter builder only when editing and hands it the saved filter', async () => {
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        expect(q(element, 'c-marketing-dictionary-dmo-filter-builder')).toBeNull();
        await openEdit(element, 'Retail');
        const builder = q(element, 'c-marketing-dictionary-dmo-filter-builder');
        expect(builder).not.toBeNull();
        expect(builder.value).toBe(filterFor('B2C'));
        expect(q(element, 'section.slds-modal').classList.contains('slds-modal_medium')).toBe(true);
    });

    it('does not offer a filter while adding values', async () => {
        const element = await mount([]);
        all(element, 'lightning-button').find(item => item.label === 'Add').click();
        await flush();
        expect(q(element, 'c-marketing-dictionary-dmo-filter-builder')).toBeNull();
    });

    it('saves the edited filter with the record, and clears it when emptied', async () => {
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        await openEdit(element, 'Retail');
        const builder = q(element, 'c-marketing-dictionary-dmo-filter-builder');
        builder.dispatchEvent(new CustomEvent('filterchange', { detail: { value: filterFor('B2B') } }));
        await flush();
        saveButton(element).click();
        await flush();
        expect(saveProductRecord).toHaveBeenCalledTimes(1);
        expect(saveProductRecord.mock.calls[0][0].record).toMatchObject({ Id: '1', Name: 'Retail', Data360_Filter_JSON__c: filterFor('B2B') });

        await openEdit(element, 'Retail');
        q(element, 'c-marketing-dictionary-dmo-filter-builder').dispatchEvent(new CustomEvent('filterchange', { detail: { value: '' } }));
        await flush();
        saveButton(element).click();
        await flush();
        expect(saveProductRecord.mock.calls[1][0].record.Data360_Filter_JSON__c).toBe('');
    });

    it('does not save while the filter is invalid', async () => {
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        const toasts = [];
        element.addEventListener('lightning__showtoast', event => toasts.push(event.detail));
        await openEdit(element, 'Retail');
        q(element, 'c-marketing-dictionary-dmo-filter-builder').dispatchEvent(new CustomEvent('validitychange', { detail: { error: 'Choose a column for every condition.' } }));
        await flush();
        saveButton(element).click();
        await flush();
        expect(saveProductRecord).not.toHaveBeenCalled();
        expect(toasts[0].message).toContain('Choose a column for every condition.');

        q(element, 'c-marketing-dictionary-dmo-filter-builder').dispatchEvent(new CustomEvent('validitychange', { detail: { error: '' } }));
        await flush();
        saveButton(element).click();
        await flush();
        expect(saveProductRecord).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh validity state each time a value is opened for editing', async () => {
        const element = await mount([record('1', 'Retail', 'Customer Type', filterFor('B2C'))]);
        await openEdit(element, 'Retail');
        q(element, 'c-marketing-dictionary-dmo-filter-builder').dispatchEvent(new CustomEvent('validitychange', { detail: { error: 'bad' } }));
        all(element, '.slds-modal__footer lightning-button').find(item => item.label === 'Cancel').click();
        await flush();
        await openEdit(element, 'Retail');
        saveButton(element).click();
        await flush();
        expect(saveProductRecord).toHaveBeenCalledTimes(1);
    });
});
