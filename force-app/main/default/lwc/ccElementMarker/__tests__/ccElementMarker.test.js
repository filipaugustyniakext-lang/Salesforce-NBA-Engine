import { createElement } from 'lwc';
import CcElementMarker from 'c/ccElementMarker';
import { inspectNode } from 'c/ccElementMarking';

const HTML = '<table><tr><td><p>Open the account today</p><img src="a.png" alt="Hero"><span>x</span></td></tr></table>';
const flush = () => Promise.resolve();

function idx(selector) {
    const holder = document.createElement('div');
    holder.innerHTML = HTML;
    return Array.from(holder.querySelectorAll('*')).indexOf(holder.querySelector(selector));
}

async function mount(selector, props = {}) {
    const element = createElement('c-cc-element-marker', { is: CcElementMarker });
    Object.assign(element, { kind: 'block', existingKeys: ['taken'], info: inspectNode(HTML, idx(selector)) }, props);
    document.body.appendChild(element);
    await flush();
    return element;
}

const q = (element, selector) => element.shadowRoot.querySelector(selector);

describe('c-cc-element-marker', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('preselects the suggestion and applies it', async () => {
        const element = await mount('p');
        expect(q(element, '.cc-marker__suggestion').textContent).toContain('only contains text');
        expect(q(element, 'lightning-radio-group').value).toBe('content');
        expect(q(element, 'lightning-input[data-field="key"]').value).toBe('openTheAccount');
        const applied = [];
        element.addEventListener('apply', event => applied.push(event.detail.marking));
        const apply = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Apply marking');
        apply.click();
        expect(applied[0]).toMatchObject({ role: 'content', contentType: 'richText', key: 'openTheAccount', complexity: 'standard' });
    });

    it('warns when the element type does not fit and blocks applying', async () => {
        const element = await mount('span');
        q(element, 'lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'content' } }));
        await flush();
        q(element, 'lightning-combobox').dispatchEvent(new CustomEvent('change', { detail: { value: 'image' } }));
        await flush();
        expect(element.shadowRoot.textContent).toContain('An image must be an <img> element, but this is a <span>');
        const apply = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Apply marking');
        expect(apply.disabled).toBe(true);
    });

    it('makes suggested keys unique and flags duplicates', async () => {
        const element = await mount('img', { existingKeys: ['hero'] });
        expect(q(element, 'lightning-input[data-field="key"]').value).toBe('hero2');
        const key = q(element, 'lightning-input[data-field="key"]');
        key.value = 'hero';
        key.dispatchEvent(new CustomEvent('change', { detail: { value: 'hero' } }));
        await flush();
        expect(element.shadowRoot.textContent).toContain('already used');
    });

    it('lets the user move through the element path and children', async () => {
        const element = await mount('td');
        const picks = [];
        element.addEventListener('pick', event => picks.push(event.detail.node));
        const crumbs = Array.from(element.shadowRoot.querySelectorAll('.cc-marker__path .cc-marker__crumb'));
        expect(crumbs.map(crumb => crumb.textContent)).toEqual(['table', 'tbody', 'tr', 'td']);
        expect(crumbs[3].disabled).toBe(true);
        crumbs[0].click();
        const children = Array.from(element.shadowRoot.querySelectorAll('.cc-marker__children .cc-marker__crumb:not(.cc-marker__crumb_action)'));
        expect(children.map(child => child.textContent)).toEqual(['p', 'img', 'span']);
        children[1].click();
        expect(picks).toEqual([idx('table'), idx('img')]);
    });

    it('shows existing marks with a remove action and the validation errors', async () => {
        const marked = '<div data-cc-content="richText" data-cc-key="note">x</div>';
        const element = createElement('c-cc-element-marker', { is: CcElementMarker });
        element.info = inspectNode(marked, 0);
        element.errors = ['The key "note" is already used.'];
        document.body.appendChild(element);
        await flush();
        expect(q(element, 'lightning-input[data-field="key"]').value).toBe('note');
        expect(element.shadowRoot.querySelector('.slds-alert_error').textContent).toContain('already used');
        const removed = [];
        element.addEventListener('remove', () => removed.push(true));
        Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Remove marking').click();
        expect(removed).toEqual([true]);
        expect(Array.from(element.shadowRoot.querySelectorAll('lightning-button')).some(button => button.label === 'Update marking')).toBe(true);
    });

    it('offers the group action and the blocks zone for multi-block shells', async () => {
        const element = await mount('td', { kind: 'shell', templateMode: 'multi' });
        const events = [];
        ['groupchildren', 'zone'].forEach(name => element.addEventListener(name, event => events.push([name, event.detail])));
        q(element, '.cc-marker__crumb_action').click();
        expect(q(element, '.cc-marker__zone lightning-button').label).toBe('Insert blocks zone');
        q(element, '.cc-marker__zone lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'before' } }));
        await flush();
        Array.from(element.shadowRoot.querySelectorAll('.cc-marker__zone lightning-button')).find(button => button.label === 'Insert blocks zone').click();
        expect(events).toEqual([['groupchildren', null], ['zone', { position: 'before' }]]);
        expect(q(element, 'lightning-radio-group').options.map(option => option.value)).toEqual(['content', 'region', 'none']);
        const block = await mount('td', { kind: 'block' });
        expect(q(block, '.cc-marker__zone')).toBeNull();
    });

    it('shows a group panel that wraps selected neighbours in a region', async () => {
        const group = { count: 2, nodes: [1, 2], labels: ['table#a', 'table#b'], parentLabel: 'div#page', wrapperTag: 'div', problem: '' };
        const element = createElement('c-cc-element-marker', { is: CcElementMarker });
        element.group = group;
        element.kind = 'shell';
        document.body.appendChild(element);
        await flush();
        expect(element.shadowRoot.textContent).toContain('2 neighbouring elements selected');
        expect(element.shadowRoot.textContent).toContain('new <div>');
        const wraps = [];
        element.addEventListener('wrap', event => wraps.push(event.detail.marking));
        q(element, 'lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'fixed-edit' } }));
        q(element, 'lightning-input[data-field="id"]').dispatchEvent(new CustomEvent('change', { detail: { value: 'footer' } }));
        await flush();
        Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Wrap in region').click();
        expect(wraps).toEqual([{ regionKind: 'fixed-edit', id: 'footer' }]);

        element.group = { ...group, problem: 'The selected elements must be next to each other.' };
        await flush();
        expect(element.shadowRoot.textContent).toContain('next to each other');
        expect(Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Wrap in region').disabled).toBe(true);
    });

    it('offers regions only for multi-block shells', async () => {
        const shell = await mount('p', { kind: 'shell', templateMode: 'multi' });
        expect(q(shell, 'lightning-radio-group').options.map(option => option.value)).toContain('region');
        const block = await mount('p', { kind: 'block' });
        expect(q(block, 'lightning-radio-group').options.map(option => option.value)).not.toContain('region');
    });
});
