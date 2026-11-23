import { createElement } from 'lwc';
import CcBindingPlayground from 'c/ccBindingPlayground';
import { parseTemplate } from 'c/ccTemplateParser';
import { buildBlockConfig } from 'c/ccTemplateSchema';

const HTML = `<table data-cc-section="container" data-cc-bind="padding background hide">
  <tr><td data-cc-section="column"><div data-cc-content="richText" data-cc-key="note">x</div>
  <a data-cc-content="button" data-cc-key="cta" href="#">Go</a></td></tr>
</table>`;

const flush = () => Promise.resolve();

async function make(html = HTML) {
    const { definition } = parseTemplate(html, { kind: 'block', templateMode: 'single' });
    const element = createElement('c-cc-binding-playground', { is: CcBindingPlayground });
    element.definition = definition;
    element.config = buildBlockConfig(definition);
    const events = [];
    element.addEventListener('configchange', event => events.push(event.detail.config));
    element.addEventListener('resetconfig', () => events.push('reset'));
    document.body.appendChild(element);
    await flush();
    return { element, events, definition };
}

describe('c-cc-binding-playground', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('offers the section settings and every content binding', async () => {
        const { element } = await make();
        const settings = element.shadowRoot.querySelector('c-cc-section-settings-editor');
        expect(settings.section.sectionId).toBe('block');
        expect(settings.mode).toBe('content');
        const items = Array.from(element.shadowRoot.querySelectorAll('c-cc-content-item-editor'));
        expect(items.map(item => item.binding.bindingKey)).toEqual(['note', 'cta']);
    });

    it('emits a changed copy of the configuration when a section setting is edited', async () => {
        const { element, events } = await make();
        const settings = element.shadowRoot.querySelector('c-cc-section-settings-editor');
        const value = { ...settings.value, padding: { ...settings.value.padding } };
        value.padding = { mode: 'all', all: 40, top: 40, right: 40, bottom: 40, left: 40 };
        settings.dispatchEvent(new CustomEvent('change', { detail: { value } }));
        await flush();
        expect(events).toHaveLength(1);
        expect(events[0].blockSettings.padding.all).toBe(40);
        expect(element.config.blockSettings.padding.all).not.toBe(40);
    });

    it('emits the edited content item in the right column', async () => {
        const { element, events } = await make();
        const editor = element.shadowRoot.querySelector('c-cc-content-item-editor');
        const item = { ...editor.item, html: '<p>Hello</p>' };
        editor.dispatchEvent(new CustomEvent('change', { detail: { item } }));
        await flush();
        expect(events[0].rows[0].columns[0].content[0].html).toBe('<p>Hello</p>');
    });

    it('can be reset and explains when there is nothing to try', async () => {
        const { element, events } = await make();
        Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Reset to defaults').click();
        expect(events).toEqual(['reset']);

        const empty = await make('<table><tr><td>Hi</td></tr></table>');
        expect(empty.element.shadowRoot.textContent).toContain('no bindings that marketers can change');
    });
});
