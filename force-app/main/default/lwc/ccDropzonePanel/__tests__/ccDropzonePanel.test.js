import { createElement } from 'lwc';
import CcDropzonePanel from 'c/ccDropzonePanel';

const flush = () => Promise.resolve();
const info = (overrides = {}) => ({ node: 4, tag: 'table', isArea: false, isZone: false, insideRegion: false, areaNode: null, areaName: null, ...overrides });

async function mount(props = {}) {
    const element = createElement('c-cc-dropzone-panel', { is: CcDropzonePanel });
    Object.assign(element, props);
    document.body.appendChild(element);
    await flush();
    return element;
}

const button = (element, label) => Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(item => item.label === label);

describe('c-cc-dropzone-panel', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('explains what to click when nothing is picked', async () => {
        const element = await mount();
        expect(element.shadowRoot.textContent).toContain('Click a fixed area (or any element) in the preview');
        expect(element.shadowRoot.querySelector('lightning-radio-group')).toBeNull();
    });

    it('places the dropzone before or after a picked area', async () => {
        const element = await mount({ info: info({ isArea: true, areaNode: 4, areaName: 'Header' }) });
        expect(element.shadowRoot.textContent).toContain('relative to the area "Header"');
        const radio = element.shadowRoot.querySelector('lightning-radio-group');
        expect(radio.options.map(option => option.value)).toEqual(['before', 'after']);
        const placed = [];
        element.addEventListener('place', event => placed.push(event.detail.position));
        button(element, 'Place dropzone here').click();
        radio.dispatchEvent(new CustomEvent('change', { detail: { value: 'before' } }));
        await flush();
        button(element, 'Place dropzone here').click();
        expect(placed).toEqual(['after', 'before']);
    });

    it('offers inside positions for a plain element and moves an existing dropzone', async () => {
        const element = await mount({ info: info(), placement: { text: 'After Header' } });
        expect(element.shadowRoot.textContent).toContain('Dropzone placed: After Header');
        expect(element.shadowRoot.querySelector('lightning-radio-group').options.map(option => option.value)).toEqual(['before', 'after', 'inside-start', 'inside-end']);
        expect(button(element, 'Move dropzone here')).toBeDefined();
    });

    it('does not offer a position for elements inside an area, or for the dropzone itself', async () => {
        const inside = await mount({ info: info({ insideRegion: true, areaNode: 9, areaName: 'Footer' }) });
        expect(inside.shadowRoot.textContent).toContain('cannot be inside another area');
        expect(inside.shadowRoot.querySelector('lightning-radio-group')).toBeNull();
        const picks = [];
        inside.addEventListener('pick', event => picks.push(event.detail.node));
        button(inside, 'Select the area').click();
        expect(picks).toEqual([9]);

        const zone = await mount({ info: info({ isZone: true }), placement: { text: 'After Header' } });
        expect(zone.shadowRoot.textContent).toContain('This is the dropzone');
        expect(zone.shadowRoot.querySelector('lightning-radio-group')).toBeNull();
    });

    it('asks before removing, and offers to continue', async () => {
        const element = await mount({ placement: { text: 'After Header' }, canContinue: true });
        const events = [];
        ['removezone', 'next'].forEach(name => element.addEventListener(name, () => events.push(name)));
        button(element, 'Remove dropzone').click();
        await flush();
        expect(element.shadowRoot.textContent).toContain('Remove the dropzone?');
        button(element, 'Keep').click();
        await flush();
        button(element, 'Remove dropzone').click();
        await flush();
        button(element, 'Remove dropzone').click();
        button(element, 'Continue to editable content').click();
        expect(events).toEqual(['removezone', 'next']);
    });

    it('shows errors from a refused placement', async () => {
        const element = await mount({ info: info(), errors: ['The blocks zone cannot be placed between table cells.'] });
        expect(element.shadowRoot.querySelector('.slds-alert_error').textContent).toContain('between table cells');
    });
});
