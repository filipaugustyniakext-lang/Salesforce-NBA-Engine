import { createElement } from 'lwc';
import CcBindingWorkspace from 'c/ccBindingWorkspace';

const BLOCK_HTML = `<style>.cc-hide-dsk{} .cc-hide-mob{}</style>
<table data-cc-section="container" data-cc-bind="padding background hide">
  <tr><td data-cc-section="column"><div data-cc-content="richText" data-cc-key="note">x</div>
  <a data-cc-content="button" data-cc-key="cta" href="#">Go</a></td></tr>
</table>`;

function flush() {
    return Promise.resolve();
}

describe('c-cc-binding-workspace', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('lists sections and content bindings and edits section presets', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: BLOCK_HTML, definition: null };
        const changes = [];
        element.addEventListener('change', event => changes.push(event.detail));
        document.body.appendChild(element);
        await flush();

        const items = Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__nav-item'));
        expect(items.map(item => item.dataset.key)).toEqual(['section:block', 'section:column-1', 'slot:note', 'slot:cta']);

        items[0].click();
        await flush();
        const editor = element.shadowRoot.querySelector('c-cc-section-settings-editor');
        expect(editor.section.sectionId).toBe('block');
        expect(editor.mode).toBe('definition');

        const updated = { ...editor.section, presets: { colors: [{ id: 'red', label: 'Red', hex: '#e2001a' }], gradients: [] } };
        editor.dispatchEvent(new CustomEvent('change', { detail: { section: updated } }));
        await flush();
        const last = changes[changes.length - 1];
        expect(last.definition.sections[0].presets.colors[0].hex).toBe('#e2001a');
        expect(last.errors).toEqual([]);

        items[3].click();
        await flush();
        const bindingEditor = element.shadowRoot.querySelector('c-cc-content-binding-editor');
        expect(bindingEditor.binding.bindingKey).toBe('cta');
    });

    it('shows the preparation guide, open until HTML is loaded', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'shell';
        document.body.appendChild(element);
        await flush();
        const guide = element.shadowRoot.querySelector('c-cc-binding-guide');
        expect(guide.kind).toBe('shell');
        expect(guide.open).toBe(true);
        expect(element.shadowRoot.querySelector('c-cc-template-preview')).toBeNull();
    });

    it('guides marking of raw HTML: pick, apply, and the lists update', async () => {
        const raw = '<table><tr><td><p>Hello world</p><img src="a.png" alt="Hero"></td></tr></table>';
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: raw, definition: null };
        const events = [];
        ['change', 'pick', 'select'].forEach(name => element.addEventListener(name, event => events.push([name, event.detail])));
        document.body.appendChild(element);
        await flush();
        expect(element.shadowRoot.textContent).toContain('No bindings were found in this file');

        element.pickedElement = 5;
        await flush();
        const marker = element.shadowRoot.querySelector('c-cc-element-marker');
        expect(marker.info.tag).toBe('img');

        marker.dispatchEvent(new CustomEvent('apply', { detail: { marking: { role: 'content', contentType: 'image', key: 'hero' } } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-element-marker')).toBeNull();
        expect(element.shadowRoot.textContent).not.toContain('No bindings were found in this file');
        const change = events.filter(([name]) => name === 'change').pop()[1];
        expect(change.html).toContain('data-cc-content="image"');
        expect(change.definition.contentSlots.map(slot => slot.bindingKey)).toEqual(['hero']);
        expect(events.filter(([name]) => name === 'select').pop()[1]).toEqual({ key: 'slot:hero' });
        expect(events.filter(([name]) => name === 'pick').pop()[1]).toEqual({ node: null });
        expect(element.activeKey).toBe('slot:hero');
    });

    it('keeps the panel open and shows the problem when a marking is invalid', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: '<table><tr><td><p>Hello</p></td></tr></table>', definition: null };
        document.body.appendChild(element);
        await flush();
        element.pickedElement = 4;
        await flush();
        const marker = element.shadowRoot.querySelector('c-cc-element-marker');
        marker.dispatchEvent(new CustomEvent('apply', { detail: { marking: { role: 'content', contentType: 'image', key: 'pic' } } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-element-marker').errors[0]).toContain('must be an <img>');

        element.shadowRoot.querySelector('c-cc-element-marker').dispatchEvent(new CustomEvent('close'));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-element-marker')).toBeNull();
    });

    it('shows parse errors for invalid HTML', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: '<div data-cc-section="row"><span data-cc-content="image" data-cc-key="x"></span></div>', definition: null };
        document.body.appendChild(element);
        await flush();
        const alert = element.shadowRoot.querySelector('.slds-alert_error');
        expect(alert.textContent).toContain('Image binding "x" must be an <img> element.');
    });
});
