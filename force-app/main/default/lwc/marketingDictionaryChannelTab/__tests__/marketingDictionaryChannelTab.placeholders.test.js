import { createElement } from 'lwc';
import MarketingDictionaryChannelTab from 'c/marketingDictionaryChannelTab';
import { persistChannelSelection } from 'c/marketingDictionaryState';
import getChannelRecords from '@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords';
import saveBannerPlacement from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacement';
import saveBannerPlacementsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacementsBulk';

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
        { Id: 'p1', Name: 'PH_ACCOUNT_DETAILS_MAIN', App_Screen__c: 'ACCOUNT_DETAILS', Banner_Type__c: 'bt1', Banner_Type__r: { Name: 'Hero' }, Position_Description__c: 'Under Account Information', Impact_Campaign_Score_Logic__c: true },
        { Id: 'p2', Name: 'PH_CARD_DETAILS_MAIN', App_Screen__c: 'CARD_DETAILS', Banner_Type__c: null, Position_Description__c: 'Under the card', Impact_Campaign_Score_Logic__c: false }
    ]
}];

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

describe('c-marketing-dictionary-channel-tab placeholders: Impact Campaign Score Logic', () => {
    beforeEach(() => {
        saveBannerPlacement.mockResolvedValue('p1');
        saveBannerPlacementsBulk.mockResolvedValue(undefined);
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('shows a Score Logic column with the same help text idea as Topics and a check for flagged placeholders', async () => {
        const element = await mount();
        const header = q(element, '.placement-th-inline');
        expect(header.textContent).toContain('Score Logic');
        expect(header.querySelector('lightning-helptext').content).toContain('Campaigns Associated with Placeholders');
        const rows = all(element, '.placement-table tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.placement-check-icon')).not.toBeNull();
        expect(rows[1].querySelector('.placement-check-icon')).toBeNull();
    });

    it('edits the flag of one placeholder with the same checkbox and label as a topic', async () => {
        const element = await mount();
        all(element, 'lightning-button-icon').find(item => item.title === 'Edit' && item.dataset.plid === 'p1').click();
        await flush();
        const checkbox = byLabel(element, 'lightning-input', 'Impact Campaign Score Logic');
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
        const checkboxes = all(element, 'lightning-input').filter(item => item.label === 'Score Logic');
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
        const checkbox = all(element, 'lightning-input').find(item => item.label === 'Score Logic');
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
