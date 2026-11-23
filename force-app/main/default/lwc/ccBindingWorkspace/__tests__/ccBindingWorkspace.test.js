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

        element.pickedElements = [5];
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
        expect(events.filter(([name]) => name === 'pick').pop()[1]).toEqual({ nodes: [] });
        expect(element.activeKey).toBe('slot:hero');
    });

    it('keeps the panel open and shows the problem when a marking is invalid', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: '<table><tr><td><p>Hello</p></td></tr></table>', definition: null };
        document.body.appendChild(element);
        await flush();
        element.pickedElements = [4];
        await flush();
        const marker = element.shadowRoot.querySelector('c-cc-element-marker');
        marker.dispatchEvent(new CustomEvent('apply', { detail: { marking: { role: 'content', contentType: 'image', key: 'pic' } } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-element-marker').errors[0]).toContain('must be an <img>');

        element.shadowRoot.querySelector('c-cc-element-marker').dispatchEvent(new CustomEvent('close'));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-element-marker')).toBeNull();
    });

    const PAGE = '<div id="page"><table id="top"><tr><td>Logo</td></tr></table><table id="copy"><tr><td>Copy</td></tr></table><table id="f1"><tr><td>A</td></tr></table><table id="f2"><tr><td>B</td></tr></table></div>';
    // body elements: div0 table1 tbody2 tr3 td4 | table5 ... | f1=9 | f2=13

    async function shellWorkspace(html = PAGE, templateMode = 'multi') {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'shell';
        element.templateMode = templateMode;
        element.source = { html, definition: null };
        const events = [];
        ['change', 'pick', 'select'].forEach(name => element.addEventListener(name, event => events.push([name, event.detail])));
        document.body.appendChild(element);
        await flush();
        return { element, events };
    }

    it('groups neighbouring elements into one region and walks the shell checklist', async () => {
        const { element, events } = await shellWorkspace();
        const todos = () => Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__todo')).map(item => item.classList.contains('cc-workspace__todo_done'));
        expect(todos()).toEqual([false, false, false]);

        element.pickedElements = [9];
        await flush();
        element.extendSelection(13);
        await flush();
        expect(events.filter(([name]) => name === 'pick').pop()[1]).toEqual({ nodes: [9, 13] });
        element.pickedElements = [9, 13];
        await flush();
        const marker = element.shadowRoot.querySelector('c-cc-element-marker');
        expect(marker.group).toMatchObject({ count: 2, wrapperTag: 'div', problem: '' });

        marker.dispatchEvent(new CustomEvent('wrap', { detail: { marking: { regionKind: 'fixed-read', id: 'footer' } } }));
        await flush();
        const change = events.filter(([name]) => name === 'change').pop()[1];
        expect(change.definition.regions).toEqual([{ regionId: 'footer', kind: 'fixed-read' }]);
        expect(events.filter(([name]) => name === 'select').pop()[1]).toEqual({ key: 'region:footer' });
        expect(todos()).toEqual([true, false, false]);

        element.pickedElements = [1];
        await flush();
        element.shadowRoot.querySelector('c-cc-element-marker').dispatchEvent(new CustomEvent('zone', { detail: { position: 'after' } }));
        await flush();
        const placed = events.filter(([name]) => name === 'change').pop()[1];
        expect(placed.definition.regions.map(region => region.kind)).toEqual(['blocks', 'fixed-read']);
        expect(placed.errors).toEqual([]);
        expect(todos()).toEqual([true, true, false]);
    });

    it('reports problems for groups from different parents and groups all children', async () => {
        const { element, events } = await shellWorkspace();
        element.pickedElements = [9];
        await flush();
        element.extendSelection(10);
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-element-marker').errors[0]).toContain('same parent');

        element.pickedElements = [0];
        await flush();
        element.shadowRoot.querySelector('c-cc-element-marker').dispatchEvent(new CustomEvent('groupchildren'));
        await flush();
        expect(events.filter(([name]) => name === 'pick').pop()[1].nodes).toEqual([1, 5, 9, 13]);
    });

    it('does not show the checklist for blocks or single-block shells', async () => {
        const { element } = await shellWorkspace(PAGE, 'single');
        expect(element.shadowRoot.querySelector('.cc-workspace__todos')).toBeNull();
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
