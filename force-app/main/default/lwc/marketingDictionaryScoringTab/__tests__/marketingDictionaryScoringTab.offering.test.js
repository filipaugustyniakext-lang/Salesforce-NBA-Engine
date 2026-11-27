import { createElement } from 'lwc';
import MarketingDictionaryScoringTab from 'c/marketingDictionaryScoringTab';
import getOfferingDefinitionSettings from '@salesforce/apex/MarketingDictionaryManagerController.getOfferingDefinitionSettings';
import getProductOfferingCatalogue from '@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue';
import getProductFamilyByRecordType from '@salesforce/apex/MarketingDictionaryController.getProductFamilyByRecordType';
import getProductFamilyCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getProductFamilyCustomerTypes';

jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getOfferingDefinitionSettings', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryController.getProductFamilyByRecordType', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryController.getProductFamilyCustomerTypes', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryController.getProductFamilyDependencies', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryController.getFamilyOfNeedsCustomerTypes', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function openNewModelModal(settings) {
    getOfferingDefinitionSettings.mockResolvedValue(settings);
    getProductOfferingCatalogue.mockResolvedValue([
        { Id: 'pf-cash', Name: 'Cash Loan', Dictionary_Sub_Type__c: 'Product Family' },
        { Id: 'pf-card', Name: 'Credit Card', Dictionary_Sub_Type__c: 'Product Family' }
    ]);
    getProductFamilyByRecordType.mockResolvedValue({ Product: ['Cash Loan', 'Credit Card'] });
    getProductFamilyCustomerTypes.mockResolvedValue({ 'Cash Loan': ['Retail'], 'Credit Card': ['Retail', 'SME'] });

    const element = createElement('c-marketing-dictionary-scoring-tab', { is: MarketingDictionaryScoringTab });
    document.body.appendChild(element);
    await flush();
    const add = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(b => b.label === 'Add Model Definition');
    add.click();
    await flush();
    return element;
}

const offeringInput = (element, value) => element.shadowRoot.querySelector(`input[name="scoring-offering-type"][value="${value}"]`);
const pill = (element, value) => element.shadowRoot.querySelector(`.pf-filter-pill[data-value="${value}"]`);
const productRadios = element => Array.from(element.shadowRoot.querySelectorAll('input[name="scoring-target-product-family"]'));

describe('c-marketing-dictionary-scoring-tab offering picker', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('defaults to Product Family and disables Family of Needs until the dictionary allows it', async () => {
        const element = await openNewModelModal({ productFamilies: true, familiesOfNeeds: false });
        expect(offeringInput(element, 'Product Family').checked).toBe(true);
        expect(offeringInput(element, 'Product Family').disabled).toBe(false);
        expect(offeringInput(element, 'Family of Needs').disabled).toBe(true);
    });

    it('enables Family of Needs when the dictionary allows it', async () => {
        const element = await openNewModelModal({ productFamilies: true, familiesOfNeeds: true });
        expect(offeringInput(element, 'Family of Needs').disabled).toBe(false);
    });

    it('guides the user through one customer type, one record type, then one product family', async () => {
        const element = await openNewModelModal({ productFamilies: true, familiesOfNeeds: false });
        expect(productRadios(element)).toHaveLength(0);
        expect(element.shadowRoot.textContent).toContain('Select one customer type and one record type to see product families.');

        pill(element, 'Retail').click();
        await flush();
        expect(productRadios(element)).toHaveLength(0);

        pill(element, 'Product').click();
        await flush();
        const radios = productRadios(element);
        expect(radios).toHaveLength(2);
        expect(element.shadowRoot.textContent).not.toContain('Select one customer type and one record type to see product families.');

        radios[0].click();
        radios[0].dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(productRadios(element).filter(r => r.checked)).toHaveLength(1);

        pill(element, 'SME').click();
        await flush();
        expect(productRadios(element)).toHaveLength(1);
        expect(productRadios(element).filter(r => r.checked)).toHaveLength(0);
    });
});
