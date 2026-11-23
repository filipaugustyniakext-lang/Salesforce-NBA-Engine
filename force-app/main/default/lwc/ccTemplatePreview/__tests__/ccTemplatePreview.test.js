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
