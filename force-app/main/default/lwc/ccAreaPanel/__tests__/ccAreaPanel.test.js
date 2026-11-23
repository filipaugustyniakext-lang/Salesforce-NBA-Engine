import { createElement } from 'lwc';
import CcAreaPanel from 'c/ccAreaPanel';

const flush = () => Promise.resolve();
const AREAS = [
    { regionId: 'header', name: 'Header', kind: 'fixed-read', node: 4, wrapped: false, bindingCount: 0, contentKeys: [] },
    { regionId: 'footer', name: 'Footer', kind: 'fixed-edit', node: 9, wrapped: true, bindingCount: 2, contentKeys: ['a', 'b'] }
];
const info = (overrides = {}) => ({ node: 20, tag: 'table', text: 'Legal text', isArea: false, isZone: false, insideRegion: false, areaNode: null, areaName: null, ...overrides });

async function mount(props = {}) {
    const element = createElement('c-cc-area-panel', { is: CcAreaPanel });
    Object.assign(element, { areas: AREAS, ...props });
    document.body.appendChild(element);
    await flush();
    return element;
}

const q = (element, selector) => element.shadowRoot.querySelector(selector);
const input = (element, label) => Array.from(element.shadowRoot.querySelectorAll('lightning-input')).find(item => item.label === label);
const button = (element, label) => Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(item => item.label === label);

describe('c-cc-area-panel', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('guides the first click and offers "no fixed areas" while there are none', async () => {
        const element = await mount({ areas: [] });
        expect(element.shadowRoot.textContent).toContain('Click an element in the preview to start');
        const events = [];
        element.addEventListener('nofixed', event => events.push(event.detail.value));
        const checkbox = input(element, 'This template has no fixed areas');
        expect(checkbox).toBeDefined();
        checkbox.checked = true;
        checkbox.dispatchEvent(new CustomEvent('change'));
        expect(events).toEqual([true]);
        const withAreas = await mount();
        expect(input(withAreas, 'This template has no fixed areas')).toBeUndefined();
    });

    it('creates an area from a picked element with a name and type', async () => {
        const element = await mount({ info: info() });
        expect(button(element, 'Create area').disabled).toBe(true);
        input(element, 'Area name').dispatchEvent(new CustomEvent('change', { detail: { value: 'Legal' } }));
        q(element, 'lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'fixed-edit' } }));
        await flush();
        expect(button(element, 'Create area').disabled).toBe(false);
        const created = [];
        element.addEventListener('create', event => created.push(event.detail));
        button(element, 'Create area').click();
        expect(created).toEqual([{ name: 'Legal', kind: 'fixed-edit' }]);
    });

    it('creates an area from a group, and blocks groups that cannot be wrapped', async () => {
        const group = { count: 2, nodes: [10, 11], labels: ['a', 'b'], parentLabel: 'div#page', wrapperTag: 'div', problem: '' };
        const element = await mount({ group });
        expect(element.shadowRoot.textContent).toContain('2 neighbouring elements in div#page');
        expect(element.shadowRoot.textContent).toContain('new <div>');
        input(element, 'Area name').dispatchEvent(new CustomEvent('change', { detail: { value: 'Footer 2' } }));
        await flush();
        expect(button(element, 'Create area').disabled).toBe(false);
        element.group = { ...group, problem: 'The selected elements must be next to each other.' };
        await flush();
        expect(element.shadowRoot.textContent).toContain('next to each other');
        expect(button(element, 'Create area').disabled).toBe(true);
    });

    it('edits an existing area: rename, switch type, and warns before dropping editable content', async () => {
        const element = await mount({ info: info({ isArea: true, node: 9, tag: 'div' }) });
        expect(element.shadowRoot.textContent).toContain('Edit area "Footer"');
        expect(input(element, 'Area name').value).toBe('Footer');
        expect(q(element, 'lightning-radio-group').value).toBe('fixed-edit');
        expect(button(element, 'Save changes').disabled).toBe(true);

        q(element, 'lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'fixed-read' } }));
        await flush();
        expect(element.shadowRoot.textContent).toContain('removes its 2 editable content binding(s)');
        const updates = [];
        element.addEventListener('update', event => updates.push(event.detail));
        button(element, 'Switch and remove 2 binding(s)').click();
        expect(updates).toEqual([{ regionId: 'footer', name: 'Footer', kind: 'fixed-read', removeContent: true }]);

        input(element, 'Area name').dispatchEvent(new CustomEvent('change', { detail: { value: 'Legal footer' } }));
        q(element, 'lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'fixed-edit' } }));
        await flush();
        button(element, 'Save changes').click();
        expect(updates[1]).toEqual({ regionId: 'footer', name: 'Legal footer', kind: 'fixed-edit', removeContent: false });
    });

    it('asks before removing an area', async () => {
        const element = await mount({ info: info({ isArea: true, node: 9, tag: 'div' }) });
        const removed = [];
        element.addEventListener('remove', event => removed.push(event.detail.regionId));
        button(element, 'Remove area and 2 binding(s)').click();
        await flush();
        expect(removed).toEqual([]);
        expect(element.shadowRoot.textContent).toContain('Remove this area?');
        button(element, 'Keep').click();
        await flush();
        expect(button(element, 'Remove area and 2 binding(s)')).toBeDefined();
        button(element, 'Remove area and 2 binding(s)').click();
        await flush();
        button(element, 'Remove area and 2 binding(s)').click();
        expect(removed).toEqual(['footer']);
    });

    it('points to the enclosing area and the dropzone, and lists areas to pick', async () => {
        const inside = await mount({ info: info({ insideRegion: true, areaNode: 9, areaName: 'Footer' }) });
        expect(inside.shadowRoot.textContent).toContain('inside the area "Footer"');
        const picks = [];
        inside.addEventListener('pick', event => picks.push(event.detail.node));
        button(inside, 'Select the area').click();
        q(inside, '.cc-area__row').click();
        expect(picks).toEqual([9, 4]);
        expect(input(inside, 'Area name')).toBeUndefined();

        const zone = await mount({ info: info({ isZone: true, insideRegion: false }) });
        expect(zone.shadowRoot.textContent).toContain('This is the dropzone');
    });

    it('keeps the node selector: path and children of the picked element, with grouping', async () => {
        const picked = info({ path: [{ node: 1, label: 'div.body', marked: false }, { node: 20, label: 'table', marked: false }], children: [{ node: 21, label: 'tr', marked: false }, { node: 22, label: 'tr', marked: false }], childCount: 2 });
        const element = await mount({ info: picked });
        const path = q(element, 'c-cc-element-path');
        expect(path.info).toEqual(picked);
        expect(path.allowGroup).toBe(true);
        const events = [];
        element.addEventListener('pick', event => events.push(['pick', event.detail.node]));
        element.addEventListener('groupchildren', () => events.push(['group']));
        path.dispatchEvent(new CustomEvent('pick', { detail: { node: 1 } }));
        path.dispatchEvent(new CustomEvent('groupchildren'));
        expect(events).toEqual([['pick', 1], ['group']]);
    });

    it('shows errors and the continue action once step 1 is done', async () => {
        const element = await mount({ errors: ['The id "x" is already used.'], canContinue: true });
        expect(q(element, '.slds-alert_error').textContent).toContain('already used');
        const events = [];
        element.addEventListener('next', () => events.push('next'));
        button(element, 'Continue to the dropzone').click();
        expect(events).toEqual(['next']);
    });
});
