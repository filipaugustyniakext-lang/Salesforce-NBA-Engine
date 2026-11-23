import { createElement } from 'lwc';
import CcTemplatePreview from 'c/ccTemplatePreview';
import { describeMarked } from 'c/ccTemplateParser';

const HTML = `<div data-cc-region="blocks" data-cc-id="zone">
  <table data-cc-section="container" data-cc-id="block"><tr><td data-cc-section="column" data-cc-id="col-1">
    <p data-cc-content="richText" data-cc-key="headline">Hello <a href="https://example.com">link</a></p>
  </td></tr></table>
</div>
<div data-cc-region="fixed-read" data-cc-id="header"><p>Header</p></div>`;

function flush() {
    return new Promise(resolve => setTimeout(resolve, 50));
}

async function mount(props = {}) {
    const element = createElement('c-cc-template-preview', { is: CcTemplatePreview });
    Object.assign(element, { renderFn: () => HTML, inspectable: true }, props);
    document.body.appendChild(element);
    await flush();
    await flush();
    return element;
}

const host = element => element.shadowRoot.querySelector('[data-preview-host]');
const boxes = (element, layer) => Array.from(element.shadowRoot.querySelectorAll(`[data-inspect-layer="${layer}"] > div`));

describe('describeMarked', () => {
    it('names sections, content and regions like the binding list', () => {
        const holder = document.createElement('div');
        holder.innerHTML = HTML;
        expect(describeMarked(holder.querySelector('[data-cc-key]'))).toEqual({ kind: 'content', key: 'slot:headline', label: 'Rich text · headline' });
        expect(describeMarked(holder.querySelector('[data-cc-id="col-1"]'))).toEqual({ kind: 'section', key: 'section:col-1', label: 'Column · col-1' });
        expect(describeMarked(holder.querySelector('[data-cc-id="zone"]'))).toEqual({ kind: 'region', key: 'region:zone', label: 'Blocks zone · zone' });
        expect(describeMarked(holder.querySelector('a'))).toBeNull();
    });
});

describe('c-cc-template-preview chrome', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    const frame = element => element.shadowRoot.querySelector('.cc-preview-frame');
    const button = (element, title) => element.shadowRoot.querySelector(`button[title="${title}"]`);

    it('renders the mobile mockup by default and switches device and theme with icon buttons', async () => {
        const calls = [];
        const element = await mount({ inspectable: false, renderFn: (device, theme) => { calls.push(`${device}/${theme}`); return HTML; } });
        expect(frame(element).className).toContain('cc-preview-frame_mobile');
        expect(frame(element).className).toContain('cc-preview-frame_light');
        expect(element.shadowRoot.querySelector('.cc-preview-frame__browser-bar')).toBeNull();
        expect(calls[0]).toBe('mobile/light');
        expect(button(element, 'Mobile preview').className).toContain('slds-is-selected');
        expect(button(element, 'Mobile preview').querySelector('lightning-icon').iconName).toBe('utility:phone_portrait');
        expect(button(element, 'Dark mode').querySelector('lightning-icon').iconName).toBe('custom:custom10');
        expect(element.shadowRoot.querySelector('lightning-radio-group')).toBeNull();

        button(element, 'Desktop preview').click();
        await flush();
        expect(frame(element).className).toContain('cc-preview-frame_desktop');
        expect(element.shadowRoot.querySelector('.cc-preview-frame__browser-bar')).not.toBeNull();
        expect(button(element, 'Desktop preview').getAttribute('aria-pressed')).toBe('true');
        expect(calls[calls.length - 1]).toBe('desktop/light');

        button(element, 'Dark mode').click();
        await flush();
        expect(frame(element).className).toContain('cc-preview-frame_dark');
        expect(calls[calls.length - 1]).toBe('desktop/dark');
    });
});

describe('c-cc-template-preview mark mode', () => {
    let original;
    const NODE_HTML = '<div data-cc-node="0"><p data-cc-node="1">Hello <b data-cc-node="2">there</b></p><img data-cc-node="3" src="a.png"><i data-cc-node="4" data-cc-content="richText" data-cc-key="n">n</i></div>';
    beforeEach(() => {
        original = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = () => ({ left: 10, top: 40, width: 120, height: 30, right: 130, bottom: 70 });
        Element.prototype.scrollIntoView = jest.fn();
    });
    afterEach(() => {
        Element.prototype.getBoundingClientRect = original;
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    async function mountMark(props = {}) {
        return mount({ renderFn: () => NODE_HTML, markable: true, markMode: true, ...props });
    }

    it('hovers and picks any element with a node id, not only marked ones', async () => {
        const element = await mountMark();
        const picks = [];
        element.addEventListener('pick', event => picks.push(event.detail));
        const bold = host(element).querySelector('b');
        bold.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        expect(boxes(element, 'hover')[0].textContent).toBe('<b> · click to mark');

        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        bold.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(picks).toEqual([{ node: 2, extend: false }]);
        host(element).querySelector('i').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        expect(boxes(element, 'hover')[0].textContent).toBe('<i> · Rich text · n');
    });

    it('redraws the highlight as soon as the parent changes the selection, without waiting for a re-render', async () => {
        const element = await mountMark({ pickedNodes: [1] });
        const frames = jest.spyOn(window, 'requestAnimationFrame');
        element.pickedNodes = [3];
        expect(frames).toHaveBeenCalledTimes(1);
        await new Promise(resolve => setTimeout(resolve, 50));
        const solid = boxes(element, 'marks').filter(box => box.style.border.includes('solid'));
        expect(solid).toHaveLength(1);
        element.selectedKey = 'slot:n';
        expect(frames.mock.calls.length).toBeGreaterThanOrEqual(1);
        frames.mockRestore();
    });

    it('reports Shift-click as an extension of the selection', async () => {
        const element = await mountMark();
        const picks = [];
        element.addEventListener('pick', event => picks.push(event.detail));
        host(element).querySelector('p').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        host(element).querySelector('img').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
        expect(picks).toEqual([{ node: 1, extend: false }, { node: 3, extend: true }]);
        expect(element.pickedNodes).toEqual([1]);
        expect(host(element).style.userSelect).toBe('none');
    });

    it('does not emit select in mark mode and highlights the picked node', async () => {
        const element = await mountMark({ pickedNodes: [3] });
        const selects = [];
        element.addEventListener('select', event => selects.push(event.detail));
        host(element).querySelector('i').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(selects).toEqual([]);
        expect(element.shadowRoot.textContent).toContain('Selected');
        element.pickedNodes = [1, 2];
        await new Promise(resolve => setTimeout(resolve, 50));
        const solid = boxes(element, 'marks').filter(box => box.style.border.includes('solid'));
        expect(solid).toHaveLength(2);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('reports the mark toggle and falls back to inspect behaviour when off', async () => {
        const element = await mountMark({ markMode: false });
        const modes = [];
        element.addEventListener('modechange', event => modes.push(event.detail.mark));
        const toggles = element.shadowRoot.querySelectorAll('lightning-input');
        const markToggle = Array.from(toggles).find(toggle => toggle.label === 'Mark elements');
        markToggle.checked = true;
        markToggle.dispatchEvent(new CustomEvent('change'));
        expect(modes).toEqual([true]);

        const picks = [];
        const selects = [];
        element.addEventListener('pick', event => picks.push(event.detail.node));
        element.addEventListener('select', event => selects.push(event.detail.key));
        host(element).querySelector('b').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        host(element).querySelector('i').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(picks).toEqual([]);
        expect(selects).toEqual(['slot:n']);
    });

    const AREA_HTML = '<div data-cc-node="0"><div data-cc-node="1" data-cc-region="fixed-read" data-cc-id="header"><p data-cc-node="2">Header text</p></div>'
        + '<div data-cc-node="3"><p data-cc-node="4">Loose copy</p></div>'
        + '<div data-cc-node="5" data-cc-region="fixed-edit" data-cc-id="footer"><p data-cc-node="6">Footer <b data-cc-node="7">text</b></p></div></div>';

    it('areas scope picks fixed areas as a whole and layout elements outside them', async () => {
        const element = await mountMark({ renderFn: () => AREA_HTML, pickScope: 'areas' });
        const picks = [];
        element.addEventListener('pick', event => picks.push(event.detail.node));
        host(element).querySelector('[data-cc-node="2"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        expect(boxes(element, 'hover')[0].textContent).toBe('<div> · Read-only region · header');
        host(element).querySelector('[data-cc-node="2"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        host(element).querySelector('[data-cc-node="7"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        host(element).querySelector('[data-cc-node="4"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(picks).toEqual([1, 5, 4]);
    });

    it('editable scope only picks elements inside editable areas', async () => {
        const element = await mountMark({ renderFn: () => AREA_HTML, pickScope: 'editable' });
        const picks = [];
        element.addEventListener('pick', event => picks.push(event.detail.node));
        ['2', '4', '5', '0'].forEach(node => host(element).querySelector(`[data-cc-node="${node}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        host(element).querySelector('[data-cc-node="7"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        host(element).querySelector('[data-cc-node="6"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        expect(picks).toEqual([7]);
        expect(boxes(element, 'hover')[0].textContent).toBe('<p> · click to mark');
    });

    it('hides the mark toggle when the content is not markable', async () => {
        const element = await mountMark({ markable: false });
        expect(Array.from(element.shadowRoot.querySelectorAll('lightning-input')).some(toggle => toggle.label === 'Mark elements')).toBe(false);
    });
});

describe('c-cc-template-preview inspect mode', () => {
    let original;
    const scrolled = [];
    beforeEach(() => {
        scrolled.length = 0;
        Element.prototype.scrollIntoView = function scroll() {
            scrolled.push(this.getAttribute('data-cc-id'));
        };
        original = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = () => ({ left: 10, top: 40, width: 120, height: 30, right: 130, bottom: 70 });
    });
    afterEach(() => {
        Element.prototype.getBoundingClientRect = original;
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('outlines marked elements and keeps the HTML attributes through scoping', async () => {
        const element = await mount();
        expect(host(element).querySelector('[data-cc-key="headline"]')).not.toBeNull();
        expect(boxes(element, 'marks')).toHaveLength(5);
    });

    it('highlights the hovered element with its name and reports clicks by key', async () => {
        const element = await mount();
        const selections = [];
        element.addEventListener('select', event => selections.push(event.detail.key));
        const text = host(element).querySelector('[data-cc-key="headline"]');

        text.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        const hover = boxes(element, 'hover');
        expect(hover).toHaveLength(1);
        expect(hover[0].textContent).toBe('Rich text · headline');

        const link = host(element).querySelector('a');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(selections).toEqual(['slot:headline']);

        host(element).querySelector('[data-cc-id="col-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(selections).toEqual(['slot:headline', 'section:col-1']);
    });

    it('ignores unmarked areas', async () => {
        const element = await mount();
        const selections = [];
        element.addEventListener('select', event => selections.push(event.detail.key));
        const plain = document.createElement('span');
        host(element).appendChild(plain);
        plain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(selections).toEqual([]);
    });

    it('limits inspection to the blocks region when scoped', async () => {
        const element = await mount({ inspectScope: 'blocks' });
        expect(boxes(element, 'marks')).toHaveLength(4);
        const selections = [];
        element.addEventListener('select', event => selections.push(event.detail.key));
        host(element).querySelector('[data-cc-id="header"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(selections).toEqual([]);
    });

    it('highlights the selected key and can be switched off', async () => {
        const element = await mount({ selectedKey: 'section:col-1' });
        const solid = boxes(element, 'marks').filter(box => box.style.border.includes('solid'));
        expect(solid).toHaveLength(1);
        expect(scrolled).toEqual(['col-1']);

        const toggle = element.shadowRoot.querySelector('lightning-input');
        toggle.checked = false;
        toggle.dispatchEvent(new CustomEvent('change'));
        await flush();
        await flush();
        expect(boxes(element, 'marks')).toHaveLength(0);
        const selections = [];
        element.addEventListener('select', event => selections.push(event.detail.key));
        host(element).querySelector('[data-cc-key="headline"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(selections).toEqual([]);
    });

    it('does nothing when not inspectable', async () => {
        const element = await mount({ inspectable: false });
        expect(element.shadowRoot.querySelector('lightning-input')).toBeNull();
        expect(boxes(element, 'marks')).toHaveLength(0);
    });
});
