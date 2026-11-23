import { createElement } from 'lwc';
import MarketingDictionaryPathEditor from 'c/marketingDictionaryPathEditor';
import LightningAlert from 'lightning/alert';

jest.mock('lightning/alert', () => ({ __esModule: true, default: { open: jest.fn().mockResolvedValue(undefined) } }), { virtual: true });

const AUDIENCES = [
    { Id: 'aud-prospect', Name: 'Prospect' },
    { Id: 'aud-customer', Name: 'Customer' }
];
const PATHS = [
    { Id: 'p3', Name: 'Legacy', Is_Active__c: false, Distribution_Percent__c: 0, Audience_Type_Dict__c: 'aud-customer' },
    { Id: 'p2', Name: 'Random', Is_Active__c: true, Distribution_Percent__c: 35, Audience_Type_Dict__c: 'aud-customer', Path_Description__c: 'Random assignment' },
    { Id: 'p1', Name: 'ML', Is_Active__c: true, Distribution_Percent__c: 65, Audience_Type_Dict__c: 'aud-customer' },
    { Id: 'p4', Name: 'Prospect ML', Is_Active__c: true, Distribution_Percent__c: 100, Audience_Type_Dict__c: 'aud-prospect' }
];

const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const field = (element, role, id) => all(element, `[data-role="${role}"]`).find(item => item.dataset.id === id);
const button = (element, label) => all(element, 'lightning-button').find(item => item.label === label);
const rowOrder = element => all(element, 'tbody tr').map(row => row.querySelector('lightning-input[data-role="name"]').value);
const groupTotals = element => Object.fromEntries(all(element, '[data-role="group-total"]').map(row => [
    row.querySelector('strong').textContent.replace('Total of active paths: ', ''),
    row.querySelector('.path-total').textContent
]));

async function mount(paths = PATHS, props = {}) {
    const element = createElement('c-marketing-dictionary-path-editor', { is: MarketingDictionaryPathEditor });
    element.audienceTypes = AUDIENCES;
    element.paths = paths;
    Object.assign(element, props);
    const events = [];
    element.addEventListener('save', event => events.push(['save', event.detail.records]));
    element.addEventListener('close', () => events.push(['close']));
    document.body.appendChild(element);
    await flush();
    return { element, events };
}

const setPercent = async (element, id, value) => {
    field(element, 'percent', id).dispatchEvent(new CustomEvent('change', { detail: { value: String(value) } }));
    await flush();
};
const setActive = async (element, id, checked) => {
    const toggle = field(element, 'active', id);
    toggle.checked = checked;
    toggle.dispatchEvent(new CustomEvent('change'));
    await flush();
};
const setAudience = async (element, id, audienceId) => {
    field(element, 'audience', id).dispatchEvent(new CustomEvent('change', { detail: { value: audienceId } }));
    await flush();
};
const rename = async (element, id, name) => {
    const input = field(element, 'name', id);
    input.dispatchEvent(new CustomEvent('change', { detail: { value: name } }));
    await flush();
    input.dispatchEvent(new CustomEvent('commit'));
    await flush();
};

describe('c-marketing-dictionary-path-editor', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('lists active paths first, then inactive ones, each sorted by name', async () => {
        const { element } = await mount();
        expect(rowOrder(element)).toEqual(['ML', 'Prospect ML', 'Random', 'Legacy']);
        expect(all(element, 'tbody tr .slds-badge').map(badge => badge.textContent)).toEqual(['Active', 'Active', 'Active', 'Inactive']);
        expect(field(element, 'percent', 'p3').disabled).toBe(true);
        expect(field(element, 'percent', 'p1').value).toBe('65');
        expect(button(element, 'Save').disabled).toBe(true);
    });

    it('offers a required radio group with the audience types by id, showing their labels', async () => {
        const { element } = await mount();
        const radio = field(element, 'audience', 'p1');
        expect(radio.required).toBe(true);
        expect(radio.options).toEqual([
            { label: 'Customer', value: 'aud-customer' },
            { label: 'Prospect', value: 'aud-prospect' }
        ]);
        expect(radio.value).toBe('aud-customer');
        expect(field(element, 'audience', 'p4').value).toBe('aud-prospect');
        expect(field(element, 'audience', 'p1').name).not.toBe(field(element, 'audience', 'p2').name);
    });

    it('keeps the order stable while paths are switched on and off', async () => {
        const { element } = await mount();
        await setActive(element, 'p1', false);
        expect(rowOrder(element)).toEqual(['ML', 'Prospect ML', 'Random', 'Legacy']);
    });

    it('checks, per audience type, that active allocations add up to 100%', async () => {
        const { element } = await mount();
        expect(groupTotals(element)).toEqual({ Customer: '100%', Prospect: '100%' });
        await setPercent(element, 'p1', 50);
        expect(groupTotals(element)).toEqual({ Customer: '85%', Prospect: '100%' });
        expect(element.shadowRoot.textContent).toContain('Customer: 15% still to allocate');
        expect(element.shadowRoot.textContent).not.toContain('Prospect: ');
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p1', 80);
        expect(element.shadowRoot.textContent).toContain('Customer: 15% over');
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p1', 60);
        await setPercent(element, 'p2', 40);
        expect(groupTotals(element).Customer).toBe('100%');
        expect(button(element, 'Save').disabled).toBe(false);
    });

    it('keeps typed allocations within 0 to 100, rounded to two decimals', async () => {
        const { element } = await mount();
        await setPercent(element, 'p1', 250);
        expect(groupTotals(element).Customer).toBe('135%');
        await setPercent(element, 'p1', -5);
        expect(groupTotals(element).Customer).toBe('35%');
        await setPercent(element, 'p1', 64.999);
        expect(field(element, 'percent', 'p1').value).toBe('65');
        expect(groupTotals(element).Customer).toBe('100%');
    });

    it('moves a path to another audience type and checks both audience types again', async () => {
        const { element, events } = await mount();
        await setAudience(element, 'p2', 'aud-prospect');
        expect(groupTotals(element)).toEqual({ Customer: '65%', Prospect: '135%' });
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p2', 50);
        await setPercent(element, 'p4', 50);
        await setPercent(element, 'p1', 100);
        expect(groupTotals(element)).toEqual({ Customer: '100%', Prospect: '100%' });
        button(element, 'Save').click();
        await flush();
        const ids = events[0][1].map(record => record.Id).sort();
        expect(ids).toEqual(['p1', 'p2', 'p4']);
        expect(events[0][1].find(record => record.Id === 'p2').Audience_Type_Dict__c).toBe('aud-prospect');
    });

    it('requires an audience type for every path', async () => {
        const { element } = await mount([
            { Id: 'a', Name: 'Old path', Is_Active__c: true, Distribution_Percent__c: 100, Audience_Type_Dict__c: null }
        ]);
        expect(element.shadowRoot.textContent).toContain('Select an audience type for every path.');
        expect(button(element, 'Save').disabled).toBe(true);
        await setAudience(element, 'a', 'aud-customer');
        expect(element.shadowRoot.textContent).not.toContain('Select an audience type for every path.');
        expect(button(element, 'Save').disabled).toBe(false);
    });

    it('asks to add audience types when there are none', async () => {
        const { element } = await mount(PATHS, { audienceTypes: [] });
        expect(element.shadowRoot.textContent).toContain('No audience types exist yet');
        expect(button(element, 'Save').disabled).toBe(true);
    });

    it('splits equally within each audience type, with the leftover cents on the first rows', async () => {
        const { element, events } = await mount([
            { Id: 'a', Name: 'A', Is_Active__c: true, Distribution_Percent__c: 10, Audience_Type_Dict__c: 'aud-customer' },
            { Id: 'b', Name: 'B', Is_Active__c: true, Distribution_Percent__c: 10, Audience_Type_Dict__c: 'aud-customer' },
            { Id: 'c', Name: 'C', Is_Active__c: true, Distribution_Percent__c: 10, Audience_Type_Dict__c: 'aud-customer' },
            { Id: 'd', Name: 'D', Is_Active__c: false, Distribution_Percent__c: 0, Audience_Type_Dict__c: 'aud-customer' },
            { Id: 'e', Name: 'E', Is_Active__c: true, Distribution_Percent__c: 10, Audience_Type_Dict__c: 'aud-prospect' },
            { Id: 'f', Name: 'F', Is_Active__c: true, Distribution_Percent__c: 10, Audience_Type_Dict__c: 'aud-prospect' }
        ]);
        button(element, 'Allocate equally').click();
        await flush();
        expect(['a', 'b', 'c'].map(id => field(element, 'percent', id).value)).toEqual(['33.34', '33.33', '33.33']);
        expect(['e', 'f'].map(id => field(element, 'percent', id).value)).toEqual(['50', '50']);
        expect(field(element, 'percent', 'd').value).toBe('0');
        expect(groupTotals(element)).toEqual({ Customer: '100%', Prospect: '100%' });
        button(element, 'Save').click();
        await flush();
        expect(events[0][1].map(record => record.Distribution_Percent__c)).toEqual([33.34, 33.33, 33.33, 50, 50]);
    });

    it('splits equally for one audience type only with the Equal split button of that group', async () => {
        const { element } = await mount();
        await setPercent(element, 'p1', 10);
        await setPercent(element, 'p4', 20);
        const customerRow = all(element, '[data-role="group-total"]').find(row => row.textContent.includes('Customer'));
        customerRow.querySelector('lightning-button').click();
        await flush();
        expect(['p1', 'p2'].map(id => field(element, 'percent', id).value)).toEqual(['50', '50']);
        expect(field(element, 'percent', 'p4').value).toBe('20');
    });

    it('needs a new allocation after a path is switched off, and zeroes the switched-off path', async () => {
        const { element, events } = await mount();
        await setActive(element, 'p1', false);
        expect(field(element, 'percent', 'p1').disabled).toBe(true);
        expect(field(element, 'percent', 'p1').value).toBe('0');
        expect(groupTotals(element).Customer).toBe('35%');
        expect(element.shadowRoot.textContent).toContain('Customer: 65% still to allocate');
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p2', 100);
        expect(button(element, 'Save').disabled).toBe(false);
        button(element, 'Save').click();
        await flush();
        const byId = Object.fromEntries(events[0][1].map(record => [record.Id, record]));
        expect(byId.p1).toEqual({ Id: 'p1', Name: 'ML', Path_Description__c: '', Audience_Type_Dict__c: 'aud-customer', Is_Active__c: false, Distribution_Percent__c: 0 });
        expect(byId.p2.Distribution_Percent__c).toBe(100);
        expect(byId.p4).toBeUndefined();
    });

    it('starts a newly activated path at 0%, says what that means, and lets an equal split include it', async () => {
        const { element } = await mount();
        await setActive(element, 'p3', true);
        expect(field(element, 'percent', 'p3').disabled).toBe(false);
        expect(field(element, 'percent', 'p3').value).toBe('0');
        expect(element.shadowRoot.textContent).toContain('0% works like inactive');
        expect(groupTotals(element).Customer).toBe('100%');
        expect(button(element, 'Save').disabled).toBe(false);

        button(element, 'Allocate equally').click();
        await flush();
        expect(['p1', 'p2', 'p3'].map(id => field(element, 'percent', id).value)).toEqual(['33.34', '33.33', '33.33']);
    });

    it('requires at least one active path for every audience type that has paths', async () => {
        const { element } = await mount();
        await setActive(element, 'p4', false);
        expect(element.shadowRoot.textContent).toContain('Prospect: Activate at least one path.');
        expect(button(element, 'Save').disabled).toBe(true);
    });

    it('warns about the effect of a rename once per path, and lists the renames', async () => {
        const { element } = await mount();
        await rename(element, 'p1', 'ML v2');
        expect(LightningAlert.open).toHaveBeenCalledTimes(1);
        const options = LightningAlert.open.mock.calls[0][0];
        expect(options.theme).toBe('warning');
        expect(options.message).toContain('refers to the path label rather than the path label ID');
        expect(options.message).toContain('Data360');
        expect(element.shadowRoot.querySelector('.slds-alert_warning').textContent).toContain('"ML" becomes "ML v2"');

        await rename(element, 'p1', 'ML v3');
        expect(LightningAlert.open).toHaveBeenCalledTimes(1);
        await rename(element, 'p2', 'Random 2');
        expect(LightningAlert.open).toHaveBeenCalledTimes(2);

        await rename(element, 'p1', 'ML');
        expect(element.shadowRoot.querySelector('.slds-alert_warning').textContent).not.toContain('"ML" becomes');
    });

    it('does not warn about allocation, audience or status changes', async () => {
        const { element } = await mount();
        await setPercent(element, 'p1', 60);
        await setActive(element, 'p3', true);
        await setAudience(element, 'p3', 'aud-prospect');
        expect(LightningAlert.open).not.toHaveBeenCalled();
        expect(element.shadowRoot.querySelector('.slds-alert_warning')).toBeNull();
    });

    it('refuses empty and duplicate names', async () => {
        const { element } = await mount();
        await rename(element, 'p1', '  ');
        expect(element.shadowRoot.textContent).toContain('Enter a name.');
        expect(LightningAlert.open).not.toHaveBeenCalled();
        expect(button(element, 'Save').disabled).toBe(true);

        await rename(element, 'p1', ' random ');
        expect(element.shadowRoot.textContent).toContain('Another path already has this name.');
        expect(element.shadowRoot.textContent).toContain('Every path needs a unique name.');
        expect(button(element, 'Save').disabled).toBe(true);
    });

    it('saves only what changed, with trimmed names and audience ids, and warns first about an unconfirmed rename', async () => {
        const { element, events } = await mount();
        field(element, 'name', 'p2').dispatchEvent(new CustomEvent('change', { detail: { value: '  Random B  ' } }));
        await flush();
        expect(LightningAlert.open).not.toHaveBeenCalled();
        button(element, 'Save').click();
        await flush();
        expect(LightningAlert.open).toHaveBeenCalledTimes(1);
        expect(events).toEqual([['save', [{
            Id: 'p2', Name: 'Random B', Path_Description__c: 'Random assignment', Audience_Type_Dict__c: 'aud-customer', Is_Active__c: true, Distribution_Percent__c: 35
        }]]]);
    });

    it('shows the description of every path and saves an edited one, trimmed, without any warning', async () => {
        const { element, events } = await mount();
        expect(field(element, 'description', 'p2').value).toBe('Random assignment');
        expect(field(element, 'description', 'p1').value).toBe('');
        expect(Number(field(element, 'description', 'p1').maxLength)).toBe(255);
        expect(button(element, 'Save').disabled).toBe(true);

        field(element, 'description', 'p1').dispatchEvent(new CustomEvent('change', { detail: { value: '  Scores customers with the ML model  ' } }));
        await flush();
        expect(LightningAlert.open).not.toHaveBeenCalled();
        expect(button(element, 'Save').disabled).toBe(false);
        button(element, 'Save').click();
        await flush();
        expect(events[0][1]).toEqual([{
            Id: 'p1', Name: 'ML', Path_Description__c: 'Scores customers with the ML model',
            Audience_Type_Dict__c: 'aud-customer', Is_Active__c: true, Distribution_Percent__c: 65
        }]);
    });

    it('closes without saving and shows a server error', async () => {
        const { element, events } = await mount(PATHS, { errorMessage: 'The active paths of audience type "Customer" add up to 99%.' });
        expect(element.shadowRoot.querySelector('.slds-alert_error').textContent).toContain('add up to 99%');
        button(element, 'Cancel').click();
        element.shadowRoot.querySelector('button.slds-modal__close').click();
        expect(events).toEqual([['close'], ['close']]);
    });

    it('does not allow saving while a save is running', async () => {
        const { element } = await mount(PATHS, { saving: true });
        await setPercent(element, 'p1', 60);
        await setPercent(element, 'p2', 40);
        expect(button(element, 'Save').disabled).toBe(true);
    });
});
