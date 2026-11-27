import { createElement } from 'lwc';
import MarketingDictionaryChannelTab from 'c/marketingDictionaryChannelTab';
import { persistChannelSelection } from 'c/marketingDictionaryState';
import getChannelRecords from '@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords';
import saveBannerPlacement from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacement';
import saveBannerPlacementsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacementsBulk';
import getProductOfferingCatalogue from '@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue';

jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords', () => {
    const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
    return { default: createApexTestWireAdapter(jest.fn()) };
}, { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getPersonRecords', () => {
    const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
    return { default: createApexTestWireAdapter(jest.fn()) };
}, { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveChannelRecord', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.toggleChannelActive', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveCooldownRecord', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteCooldownRecord', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveBlackoutDayRule', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteBlackoutDayRule', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacement', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacementsBulk', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteBannerPlacement', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveIntentTarget', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteIntentTarget', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveBannerIntent', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.saveBannerIntentsBulk', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.deleteBannerIntent', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('c/marketingDictionaryRenamePrompt', () => ({ confirmDictionaryRenameIfNeeded: jest.fn().mockResolvedValue(true) }), { virtual: true });
jest.mock('c/marketingDictionaryDeleteHelper', () => ({
    runDictionaryDeleteWithDependencyCheck: jest.fn(),
    isDependencyBlockedMessage: jest.fn(),
    fetchDictionaryDeleteReport: jest.fn(),
    reportHasDependencies: jest.fn().mockReturnValue(false)
}), { virtual: true });

const CHANNELS = [{
    Id: 'ch1',
    Name: 'Banner',
    Is_Active__c: true,
    Channel_Cooldowns__r: [],
    Blackout_Day_Rules__r: [],
    Channel_Banner_Types__r: [{ Id: 'bt1', Name: 'Hero', Description__c: '', Image_URL__c: '' }],
    Channel_Banner_Intent_Targets__r: [],
    Channel_Banner_Intents__r: [],
    Channel_Banner_Placements__r: [
        { Id: 'p1', Name: 'PH_ACCOUNT_DETAILS_MAIN', App_Screen__c: 'ACCOUNT_DETAILS', Banner_Type__c: 'bt1', Banner_Type__r: { Name: 'Hero' }, Position_Description__c: 'Under Account Information', Impact_Campaign_Score_Logic__c: true, Product_Family_Dict__c: 'pf1', Product_Family_Dict__r: { Name: 'Cash Loan' } },
        { Id: 'p2', Name: 'PH_CARD_DETAILS_MAIN', App_Screen__c: 'CARD_DETAILS', Banner_Type__c: null, Position_Description__c: 'Under the card', Impact_Campaign_Score_Logic__c: false }
    ]
}];

const CATALOGUE = [
    { Id: 'pf1', Name: 'Cash Loan', Dictionary_Sub_Type__c: 'Product Family' },
    { Id: 'pf2', Name: 'Credit Card', Dictionary_Sub_Type__c: 'Product Family' },
    { Id: 'fon1', Name: 'Borrowing', Dictionary_Sub_Type__c: 'Family of Needs' }
];

const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const q = (element, selector) => element.shadowRoot.querySelector(selector);
const byLabel = (element, tag, label) => all(element, tag).find(item => item.label === label);

async function mount() {
    persistChannelSelection('ch1', 'placements');
    const element = createElement('c-marketing-dictionary-channel-tab', { is: MarketingDictionaryChannelTab });
    document.body.appendChild(element);
    getChannelRecords.emit(CHANNELS);
    await flush();
    return element;
}

describe('c-marketing-dictionary-channel-tab placeholders: Is Main Channel flag', () => {
    beforeEach(() => {
        saveBannerPlacement.mockResolvedValue('p1');
        saveBannerPlacementsBulk.mockResolvedValue(undefined);
        getProductOfferingCatalogue.mockResolvedValue(CATALOGUE);
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('shows an Is Main Channel column with the same help text idea as Topics and a check for flagged placeholders', async () => {
        const element = await mount();
        const header = q(element, '.placement-th-inline');
        expect(header.textContent).toContain('Is Main Channel');
        expect(header.textContent).not.toContain('Score Logic');
        expect(header.querySelector('lightning-helptext').content).toContain('Campaigns Associated with Placeholders');
        const rows = all(element, '.placement-table tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.placement-check-icon')).not.toBeNull();
        expect(rows[1].querySelector('.placement-check-icon')).toBeNull();
    });

    it('edits the flag of one placeholder with an Is Main Channel checkbox', async () => {
        const element = await mount();
        all(element, 'lightning-button-icon').find(item => item.title === 'Edit' && item.dataset.plid === 'p1').click();
        await flush();
        const checkbox = byLabel(element, 'lightning-input', 'Is Main Channel');
        expect(checkbox.type).toBe('checkbox');
        expect(checkbox.checked).toBe(true);
        expect(q(element, '.placement-flag-field lightning-helptext').content).toContain('Customer Propensity Recount Logic');

        checkbox.checked = false;
        checkbox.dispatchEvent(new CustomEvent('change'));
        await flush();
        byLabel(element, 'lightning-button', 'Save').click();
        await flush();
        const saved = JSON.parse(saveBannerPlacement.mock.calls[0][0].placementJson);
        expect(saved).toMatchObject({ Id: 'p1', Name: 'PH_ACCOUNT_DETAILS_MAIN', Impact_Campaign_Score_Logic__c: false });
    });

    it('edits the flag of every placeholder in Edit All and saves it with the rows', async () => {
        const element = await mount();
        byLabel(element, 'lightning-button', 'Edit All').click();
        await flush();
        const checkboxes = all(element, 'lightning-input').filter(item => item.label === 'Is Main Channel');
        expect(checkboxes.map(item => item.checked)).toEqual([true, false]);

        checkboxes[1].checked = true;
        checkboxes[1].dispatchEvent(new CustomEvent('change'));
        await flush();
        byLabel(element, 'lightning-button', 'Save 2').click();
        await flush();
        const saved = JSON.parse(saveBannerPlacementsBulk.mock.calls[0][0].placementsJson);
        expect(saved.map(item => [item.Name, item.Impact_Campaign_Score_Logic__c])).toEqual([
            ['PH_ACCOUNT_DETAILS_MAIN', true],
            ['PH_CARD_DETAILS_MAIN', true]
        ]);
    });

    it('adds new placeholders unflagged by default and lets each row be flagged', async () => {
        const element = await mount();
        byLabel(element, 'lightning-button', 'Add Placeholders').click();
        await flush();
        const checkbox = all(element, 'lightning-input').find(item => item.label === 'Is Main Channel');
        expect(checkbox.checked).toBe(false);
        expect(checkbox.fieldLevelHelp).toContain('Placeholders');

        byLabel(element, 'lightning-input', 'Placeholder ID').dispatchEvent(new CustomEvent('change', { detail: { value: 'PH_NEW' } }));
        await flush();
        checkbox.checked = true;
        checkbox.dispatchEvent(new CustomEvent('change'));
        await flush();
        all(element, 'lightning-button').find(item => item.label === 'Save').click();
        await flush();
        const saved = JSON.parse(saveBannerPlacementsBulk.mock.calls[0][0].placementsJson);
        expect(saved).toEqual([expect.objectContaining({ Name: 'PH_NEW', Impact_Campaign_Score_Logic__c: true })]);
    });
});

describe('c-marketing-dictionary-channel-tab placeholders: Product Family', () => {
    beforeEach(() => {
        saveBannerPlacement.mockResolvedValue('p1');
        saveBannerPlacementsBulk.mockResolvedValue(undefined);
        getProductOfferingCatalogue.mockResolvedValue(CATALOGUE);
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    const rowTexts = element => all(element, '.placement-table tbody tr').map(row => row.textContent);

    it('shows the product family of each placeholder and leaves it empty when there is none', async () => {
        const element = await mount();
        const headers = all(element, '.placement-table thead th').map(th => th.textContent.trim());
        expect(headers).toContain('Product Family');
        const rows = rowTexts(element);
        expect(rows[0]).toContain('Cash Loan');
        expect(rows[1]).not.toContain('Cash Loan');
        expect(rows[1]).toContain('—');
    });

    it('filters placeholders by product family and by no product family', async () => {
        const element = await mount();
        const filter = q(element, 'lightning-combobox.tab-toolbar__filter');
        expect(filter.options.map(o => o.label)).toEqual(['All product families', 'No product family', 'Cash Loan']);

        filter.dispatchEvent(new CustomEvent('change', { detail: { value: 'pf1' } }));
        await flush();
        expect(rowTexts(element)).toHaveLength(1);
        expect(rowTexts(element)[0]).toContain('PH_ACCOUNT_DETAILS_MAIN');
        expect(q(element, '.placement-table').parentElement.nextElementSibling.textContent).toContain('1 of 2');

        filter.dispatchEvent(new CustomEvent('change', { detail: { value: '__none' } }));
        await flush();
        expect(rowTexts(element)).toHaveLength(1);
        expect(rowTexts(element)[0]).toContain('PH_CARD_DETAILS_MAIN');

        filter.dispatchEvent(new CustomEvent('change', { detail: { value: '' } }));
        await flush();
        expect(rowTexts(element)).toHaveLength(2);
    });

    it('maps a product family when editing one placeholder and can clear it again', async () => {
        const element = await mount();
        all(element, 'lightning-button-icon').find(item => item.title === 'Edit' && item.dataset.plid === 'p2').click();
        await flush();
        const picker = byLabel(element, 'lightning-combobox', 'Product Family');
        expect(picker.options.map(o => o.label)).toEqual(['— None —', 'Cash Loan', 'Credit Card']);
        expect(picker.value).toBeFalsy();

        picker.dispatchEvent(new CustomEvent('change', { detail: { value: 'pf2' } }));
        await flush();
        byLabel(element, 'lightning-button', 'Save').click();
        await flush();
        expect(JSON.parse(saveBannerPlacement.mock.calls[0][0].placementJson)).toMatchObject({ Id: 'p2', Product_Family_Dict__c: 'pf2' });

        all(element, 'lightning-button-icon').find(item => item.title === 'Edit' && item.dataset.plid === 'p1').click();
        await flush();
        const second = byLabel(element, 'lightning-combobox', 'Product Family');
        expect(second.value).toBe('pf1');
        second.dispatchEvent(new CustomEvent('change', { detail: { value: '' } }));
        await flush();
        byLabel(element, 'lightning-button', 'Save').click();
        await flush();
        expect(JSON.parse(saveBannerPlacement.mock.calls[1][0].placementJson).Product_Family_Dict__c).toBeNull();
    });

    it('maps product families in Edit All and when adding rows, empty by default', async () => {
        const element = await mount();
        byLabel(element, 'lightning-button', 'Edit All').click();
        await flush();
        const pickers = all(element, 'lightning-combobox').filter(item => item.label === 'Product Family');
        expect(pickers.map(item => item.value)).toEqual(['pf1', '']);
        pickers[1].dispatchEvent(new CustomEvent('change', { detail: { value: 'pf2' } }));
        await flush();
        byLabel(element, 'lightning-button', 'Save 2').click();
        await flush();
        const saved = JSON.parse(saveBannerPlacementsBulk.mock.calls[0][0].placementsJson);
        expect(saved.map(item => [item.Name, item.Product_Family_Dict__c])).toEqual([
            ['PH_ACCOUNT_DETAILS_MAIN', 'pf1'],
            ['PH_CARD_DETAILS_MAIN', 'pf2']
        ]);
    });

    it('saves a new placeholder without a product family when none is chosen', async () => {
        const element = await mount();
        byLabel(element, 'lightning-button', 'Add Placeholders').click();
        await flush();
        byLabel(element, 'lightning-input', 'Placeholder ID').dispatchEvent(new CustomEvent('change', { detail: { value: 'PH_NEW' } }));
        await flush();
        all(element, 'lightning-button').find(item => item.label === 'Save').click();
        await flush();
        const saved = JSON.parse(saveBannerPlacementsBulk.mock.calls[0][0].placementsJson);
        expect(saved).toEqual([expect.objectContaining({ Name: 'PH_NEW', Product_Family_Dict__c: null })]);
    });
});
