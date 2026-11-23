import { createElement } from 'lwc';
import CcSectionPanel from 'c/ccSectionPanel';
import { inspectNode, listBindings } from 'c/ccElementMarking';

const HTML = `<table id="outer"><tr><td id="row"><table><tr><td id="col1"><p id="copy">Hello</p></td><td id="col2">B</td></tr></table></td></tr></table>`;
const flush = () => Promise.resolve();

function nodeOf(html, selector) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return Array.from(holder.querySelectorAll('*')).indexOf(holder.querySelector(selector));
}

async function mount(html, selector, props = {}) {
    const element = createElement('c-cc-section-panel', { is: CcSectionPanel });
    if (selector) element.info = inspectNode(html, nodeOf(html, selector));
    element.sections = listBindings(html).sections;
    Object.assign(element, props);
    document.body.appendChild(element);
    await flush();
    return element;
}

const q = (element, selector) => element.shadowRoot.querySelector(selector);
const button = (element, label) => Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(item => item.label === label);
const input = (element, label) => Array.from(element.shadowRoot.querySelectorAll('lightning-input')).find(item => item.label === label);

describe('c-cc-section-panel', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('tells what to click first and offers "no layout settings" while there are no sections', async () => {
        const element = await mount(HTML, null);
        expect(element.shadowRoot.textContent).toContain('Click the outermost layout element');
        const events = [];
        element.addEventListener('nosections', event => events.push(event.detail.value));
        const checkbox = input(element, 'This block needs no layout settings');
        checkbox.checked = true;
        checkbox.dispatchEvent(new CustomEvent('change'));
        expect(events).toEqual([true]);
    });

    it('suggests the level that fits and applies a section marking', async () => {
        const element = await mount(HTML, '#outer');
        expect(q(element, 'lightning-combobox').value).toBe('container');
        const applied = [];
        element.addEventListener('apply', event => applied.push(event.detail.marking));
        q(element, 'lightning-checkbox-group').dispatchEvent(new CustomEvent('change', { detail: { value: ['padding', 'hide'] } }));
        input(element, 'Label (optional)').dispatchEvent(new CustomEvent('change', { detail: { value: 'Main' } }));
        await flush();
        button(element, 'Mark as section').click();
        expect(applied).toEqual([{ role: 'section', level: 'container', binds: ['padding', 'hide'], id: '', label: 'Main' }]);
    });

    it('offers column order only for rows and suggests row / column by nesting', async () => {
        const marked = HTML.replace('<table id="outer">', '<table id="outer" data-cc-section="container" data-cc-id="block">');
        const row = await mount(marked, '#row');
        expect(q(row, 'lightning-combobox').value).toBe('row');
        expect(q(row, 'lightning-checkbox-group').options.map(option => option.value)).toContain('column-direction');
        q(row, 'lightning-combobox').dispatchEvent(new CustomEvent('change', { detail: { value: 'column' } }));
        await flush();
        expect(q(row, 'lightning-checkbox-group').options.map(option => option.value)).toEqual(['padding', 'margin', 'background', 'hide']);
    });

    it('edits and removes an existing section, asking before removal', async () => {
        const marked = HTML.replace('<td id="col1">', '<td id="col1" data-cc-section="column" data-cc-id="main-col" data-cc-bind="padding" data-cc-label="Text">');
        const element = await mount(marked, '#col1');
        expect(element.shadowRoot.textContent).toContain('Edit the column <td>');
        expect(q(element, 'lightning-combobox').value).toBe('column');
        expect(input(element, 'Label (optional)').value).toBe('Text');
        expect(button(element, 'Update section')).toBeDefined();
        const events = [];
        element.addEventListener('remove', () => events.push('remove'));
        button(element, 'Remove marking').click();
        await flush();
        expect(element.shadowRoot.textContent).toContain('Remove this section marking?');
        button(element, 'Keep').click();
        await flush();
        button(element, 'Remove marking').click();
        await flush();
        button(element, 'Remove marking').click();
        expect(events).toEqual(['remove']);
    });

    it('does not mark content elements as sections, lists sections, and picks from path and list', async () => {
        const marked = HTML.replace('<p id="copy">', '<p id="copy" data-cc-content="richText" data-cc-key="copy">').replace('<td id="row">', '<td id="row" data-cc-section="row" data-cc-id="main">');
        const content = await mount(marked, '#copy');
        expect(content.shadowRoot.textContent).toContain('This element is content (richText)');
        expect(q(content, 'lightning-combobox')).toBeNull();

        const element = await mount(marked, '#col1', { canContinue: true });
        const picks = [];
        const events = [];
        element.addEventListener('pick', event => picks.push(event.detail.node));
        element.addEventListener('next', () => events.push('next'));
        q(element, 'c-cc-element-path').dispatchEvent(new CustomEvent('pick', { detail: { node: 1 } }));
        q(element, '.cc-sections__row').click();
        button(element, 'Continue to content').click();
        expect(picks).toEqual([1, nodeOf(marked, '#row')]);
        expect(events).toEqual(['next']);
        expect(q(element, '.cc-sections__row').textContent).toContain('main');
    });

    it('shows the errors of a refused marking', async () => {
        const element = await mount(HTML, '#outer', { errors: ['The id "block" is already used.'] });
        expect(q(element, '.slds-alert_error').textContent).toContain('already used');
    });
});
