import { createElement } from 'lwc';
import MarketingDictionaryPathChart from 'c/marketingDictionaryPathChart';
import getFilterCount from '@salesforce/apex/PersonFilterCountController.getFilterCount';

jest.mock('@salesforce/apex/PersonFilterCountController.getFilterCount', () => ({ default: jest.fn() }), { virtual: true });

const FILTER = JSON.stringify({ version: 1, conditions: [{ field: 'brand__c', type: 'text', operator: 'eq', value: 'X' }] });
const AUDIENCES = [
    { Id: 'aud-prospect', Name: 'Prospect', Data360_Filter_JSON__c: null },
    { Id: 'aud-customer', Name: 'Customer', Data360_Filter_JSON__c: FILTER }
];
const PATHS = [
    { Id: 'p1', Name: 'ML', Is_Active__c: true, Distribution_Percent__c: 65, Audience_Type_Dict__c: 'aud-customer' },
    { Id: 'p2', Name: 'Random', Is_Active__c: true, Distribution_Percent__c: 35, Audience_Type_Dict__c: 'aud-customer' },
    { Id: 'p3', Name: 'Legacy', Is_Active__c: false, Distribution_Percent__c: 0, Audience_Type_Dict__c: 'aud-customer' },
    { Id: 'p4', Name: 'Prospect ML', Is_Active__c: true, Distribution_Percent__c: 100, Audience_Type_Dict__c: 'aud-prospect' }
];

const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const q = (element, selector) => element.shadowRoot.querySelector(selector);

async function mount(props = {}) {
    const element = createElement('c-marketing-dictionary-path-chart', { is: MarketingDictionaryPathChart });
    element.audienceTypes = AUDIENCES;
    element.paths = PATHS;
    Object.assign(element, props);
    document.body.appendChild(element);
    await flush();
    return element;
}

describe('c-marketing-dictionary-path-chart', () => {
    beforeEach(() => {
        getFilterCount.mockResolvedValue(10000);
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('draws one stacked bar per audience type with a segment per active path as wide as its allocation', async () => {
        const element = await mount();
        const rows = all(element, '[data-role="chart-row"]');
        expect(rows.map(row => row.querySelector('.path-chart__label span').textContent)).toEqual(['Customer', 'Prospect']);
        const customer = Array.from(rows[0].querySelectorAll('.path-chart__segment')).filter(item => !item.classList.contains('path-chart__segment_gap'));
        expect(customer).toHaveLength(2);
        expect(customer.map(item => item.style.flexGrow)).toEqual(['65', '35']);
        expect(customer.map(item => item.textContent.trim())).toEqual(['65%', '35%']);
        expect(rows[1].querySelectorAll('.path-chart__segment')).toHaveLength(1);
        expect(all(element, '.path-chart__legend li').map(item => item.textContent.trim())).toEqual(['ML', 'Prospect ML', 'Random']);
    });

    it('leaves out inactive paths and shows what is not allocated yet', async () => {
        const element = await mount({
            paths: [
                { Id: 'p1', Name: 'ML', Is_Active__c: true, Distribution_Percent__c: 60, Audience_Type_Dict__c: 'aud-customer' },
                { Id: 'p3', Name: 'Legacy', Is_Active__c: false, Distribution_Percent__c: 0, Audience_Type_Dict__c: 'aud-customer' }
            ]
        });
        const rows = all(element, '[data-role="chart-row"]');
        expect(rows[0].querySelectorAll('.path-chart__segment')).toHaveLength(2);
        expect(rows[0].querySelector('.path-chart__segment_gap').style.flexGrow).toBe('40');
        expect(rows[1].textContent).toContain('No active path');
        expect(all(element, '.path-chart__legend li').map(item => item.textContent.trim())).toEqual(['ML']);
    });

    it('counts only audience types that have a Data360 filter and shows their size', async () => {
        const element = await mount();
        expect(getFilterCount).toHaveBeenCalledTimes(1);
        expect(getFilterCount).toHaveBeenCalledWith({ filterJson: FILTER });
        const rows = all(element, '[data-role="chart-row"]');
        expect(rows[0].textContent).toContain('10,000 unified individuals');
        expect(rows[1].textContent).not.toContain('individuals');
    });

    it('shows the path, its allocation and the approximate population when hovering a segment', async () => {
        const element = await mount();
        const segment = all(element, '.path-chart__segment').find(item => item.dataset.path === 'p2');
        segment.dispatchEvent(new CustomEvent('mouseenter'));
        await flush();
        const tip = q(element, '[role="tooltip"]');
        expect(tip.textContent).toContain('Random');
        expect(tip.textContent).toContain('35% of Customer');
        expect(tip.textContent).toContain('≈ 3,500 unified individuals');
        expect(tip.textContent).toContain('Customer audience: 10,000 unified individuals');
        segment.dispatchEvent(new CustomEvent('mouseleave'));
        await flush();
        expect(q(element, '[role="tooltip"]')).toBeNull();
    });

    it('works with keyboard focus too', async () => {
        const element = await mount();
        const segment = all(element, '.path-chart__segment').find(item => item.dataset.path === 'p1');
        expect(segment.getAttribute('tabindex')).toBe('0');
        expect(segment.getAttribute('aria-label')).toBe('ML: 65% of Customer');
        segment.dispatchEvent(new CustomEvent('focus'));
        await flush();
        expect(q(element, '[role="tooltip"]').textContent).toContain('≈ 6,500 unified individuals');
        segment.dispatchEvent(new CustomEvent('blur'));
        await flush();
        expect(q(element, '[role="tooltip"]')).toBeNull();
    });

    it('explains why the population is missing', async () => {
        const element = await mount();
        const prospect = all(element, '.path-chart__segment').find(item => item.dataset.path === 'p4');
        prospect.dispatchEvent(new CustomEvent('mouseenter'));
        await flush();
        expect(q(element, '[role="tooltip"]').textContent).toContain('define a Data360 filter for this audience type');

        getFilterCount.mockRejectedValue({ body: { message: "unknown column 'nope__c'" } });
        const failing = await mount({ audienceTypes: [{ Id: 'aud-customer', Name: 'Customer', Data360_Filter_JSON__c: '{"x":1}' }] });
        const segment = all(failing, '.path-chart__segment').find(item => item.dataset.path === 'p1');
        segment.dispatchEvent(new CustomEvent('mouseenter'));
        await flush();
        expect(q(failing, '[role="tooltip"]').textContent).toContain("Population unavailable: unknown column 'nope__c'");
    });

    it('counts again only when an audience filter changes', async () => {
        const element = await mount();
        element.paths = [...PATHS];
        element.audienceTypes = [...AUDIENCES];
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(1);
        element.audienceTypes = [AUDIENCES[0], { ...AUDIENCES[1], Data360_Filter_JSON__c: JSON.stringify({ conditions: [] }) }];
        await flush();
        expect(getFilterCount).toHaveBeenCalledTimes(2);
    });

    it('asks to add audience types when there are none', async () => {
        const element = await mount({ audienceTypes: [] });
        expect(element.shadowRoot.textContent).toContain('Add audience types in the Person section');
    });
});
