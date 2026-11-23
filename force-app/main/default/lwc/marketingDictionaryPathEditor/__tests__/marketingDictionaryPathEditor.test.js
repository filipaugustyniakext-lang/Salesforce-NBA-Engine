import { createElement } from 'lwc';
import MarketingDictionaryPathEditor from 'c/marketingDictionaryPathEditor';
import LightningAlert from 'lightning/alert';

jest.mock('lightning/alert', () => ({ __esModule: true, default: { open: jest.fn().mockResolvedValue(undefined) } }), { virtual: true });

const PATHS = [
    { Id: 'p3', Name: 'Legacy', Is_Active__c: false, Distribution_Percent__c: 0 },
    { Id: 'p2', Name: 'Random', Is_Active__c: true, Distribution_Percent__c: 35 },
    { Id: 'p1', Name: 'ML', Is_Active__c: true, Distribution_Percent__c: 65 }
];

const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const field = (element, role, id) => all(element, `lightning-input[data-role="${role}"]`).find(item => item.dataset.id === id);
const button = (element, label) => all(element, 'lightning-button').find(item => item.label === label);
const rowOrder = element => all(element, 'tbody tr').map(row => row.querySelector('lightning-input[data-role="name"]').value);
const totalText = element => element.shadowRoot.querySelector('.path-total').textContent;

async function mount(paths = PATHS, props = {}) {
    const element = createElement('c-marketing-dictionary-path-editor', { is: MarketingDictionaryPathEditor });
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
        expect(rowOrder(element)).toEqual(['ML', 'Random', 'Legacy']);
        expect(all(element, 'tbody tr .slds-badge').map(badge => badge.textContent)).toEqual(['Active', 'Active', 'Inactive']);
        expect(field(element, 'percent', 'p3').disabled).toBe(true);
        expect(field(element, 'percent', 'p1').value).toBe('65');
        expect(totalText(element)).toBe('100%');
        expect(button(element, 'Save').disabled).toBe(true);
    });

    it('keeps the order stable while paths are switched on and off', async () => {
        const { element } = await mount();
        await setActive(element, 'p1', false);
        expect(rowOrder(element)).toEqual(['ML', 'Random', 'Legacy']);
    });

    it('checks that active allocations add up to 100% on every change', async () => {
        const { element } = await mount();
        await setPercent(element, 'p1', 50);
        expect(totalText(element)).toBe('85%');
        expect(element.shadowRoot.textContent).toContain('15% still to allocate');
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p1', 80);
        expect(totalText(element)).toBe('115%');
        expect(element.shadowRoot.textContent).toContain('15% over');
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p1', 60);
        await setPercent(element, 'p2', 40);
        expect(totalText(element)).toBe('100%');
        expect(element.shadowRoot.textContent).toContain('Active paths add up to 100%.');
        expect(button(element, 'Save').disabled).toBe(false);
    });

    it('keeps typed allocations within 0 to 100, rounded to two decimals', async () => {
        const { element } = await mount();
        await setPercent(element, 'p1', 250);
        expect(totalText(element)).toBe('135%');
        await setPercent(element, 'p1', -5);
        expect(totalText(element)).toBe('35%');
        await setPercent(element, 'p1', 64.999);
        expect(field(element, 'percent', 'p1').value).toBe('65');
        expect(totalText(element)).toBe('100%');
    });

    it('allocates equally across active paths and gives the leftover cents to the first rows', async () => {
        const { element, events } = await mount([
            { Id: 'a', Name: 'A', Is_Active__c: true, Distribution_Percent__c: 10 },
            { Id: 'b', Name: 'B', Is_Active__c: true, Distribution_Percent__c: 10 },
            { Id: 'c', Name: 'C', Is_Active__c: true, Distribution_Percent__c: 10 },
            { Id: 'd', Name: 'D', Is_Active__c: false, Distribution_Percent__c: 0 }
        ]);
        button(element, 'Allocate equally').click();
        await flush();
        expect(['a', 'b', 'c'].map(id => field(element, 'percent', id).value)).toEqual(['33.34', '33.33', '33.33']);
        expect(field(element, 'percent', 'd').value).toBe('0');
        expect(totalText(element)).toBe('100%');
        button(element, 'Save').click();
        await flush();
        expect(events[0][1].map(record => record.Distribution_Percent__c)).toEqual([33.34, 33.33, 33.33]);
    });

    it('needs a new allocation after a path is switched off, and zeroes the switched-off path', async () => {
        const { element, events } = await mount();
        await setActive(element, 'p1', false);
        expect(field(element, 'percent', 'p1').disabled).toBe(true);
        expect(field(element, 'percent', 'p1').value).toBe('0');
        expect(totalText(element)).toBe('35%');
        expect(element.shadowRoot.textContent).toContain('65% still to allocate');
        expect(button(element, 'Save').disabled).toBe(true);

        await setPercent(element, 'p2', 100);
        expect(button(element, 'Save').disabled).toBe(false);
        button(element, 'Save').click();
        await flush();
        expect(events[0][1]).toEqual([
            { Id: 'p2', Name: 'Random', Is_Active__c: true, Distribution_Percent__c: 100 },
            { Id: 'p1', Name: 'ML', Is_Active__c: false, Distribution_Percent__c: 0 }
        ].sort((a, b) => ['p1', 'p2'].indexOf(a.Id) - ['p1', 'p2'].indexOf(b.Id)));
    });

    it('starts a newly activated path at 0%, says what that means, and lets allocate equally include it', async () => {
        const { element } = await mount();
        await setActive(element, 'p3', true);
        expect(field(element, 'percent', 'p3').disabled).toBe(false);
        expect(field(element, 'percent', 'p3').value).toBe('0');
        expect(element.shadowRoot.textContent).toContain('0% works like inactive');
        expect(totalText(element)).toBe('100%');
        expect(button(element, 'Save').disabled).toBe(false);

        button(element, 'Allocate equally').click();
        await flush();
        expect(['p1', 'p2', 'p3'].map(id => field(element, 'percent', id).value)).toEqual(['33.34', '33.33', '33.33']);
    });

    it('requires at least one active path', async () => {
        const { element } = await mount();
        await setActive(element, 'p1', false);
        await setActive(element, 'p2', false);
        expect(element.shadowRoot.textContent).toContain('At least one path must be active.');
        expect(button(element, 'Save').disabled).toBe(true);
        expect(button(element, 'Allocate equally').disabled).toBe(true);
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

    it('does not warn about allocation or status changes', async () => {
        const { element } = await mount();
        await setPercent(element, 'p1', 60);
        await setActive(element, 'p3', true);
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

    it('saves only what changed, with trimmed names, and warns first about a rename not yet confirmed', async () => {
        const { element, events } = await mount();
        field(element, 'name', 'p2').dispatchEvent(new CustomEvent('change', { detail: { value: '  Random B  ' } }));
        await flush();
        expect(LightningAlert.open).not.toHaveBeenCalled();
        button(element, 'Save').click();
        await flush();
        expect(LightningAlert.open).toHaveBeenCalledTimes(1);
        expect(events).toEqual([['save', [{ Id: 'p2', Name: 'Random B', Is_Active__c: true, Distribution_Percent__c: 35 }]]]);
    });

    it('closes without saving and shows a server error', async () => {
        const { element, events } = await mount(PATHS, { errorMessage: 'The active paths add up to 99%. They must add up to exactly 100%.' });
        expect(element.shadowRoot.querySelector('.slds-alert_error').textContent).toContain('exactly 100%');
        button(element, 'Cancel').click();
        element.shadowRoot.querySelector('button.slds-modal__close').click();
        expect(events).toEqual([['close'], ['close']]);
    });

    it('does not allow saving again while a save is running', async () => {
        const { element } = await mount(PATHS, { saving: true });
        await setPercent(element, 'p1', 60);
        await setPercent(element, 'p2', 40);
        expect(button(element, 'Save').disabled).toBe(true);
    });
});
