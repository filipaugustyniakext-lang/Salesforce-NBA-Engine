import { createElement } from 'lwc';
import CcBindingWorkspace from 'c/ccBindingWorkspace';
import { parseHtml } from 'c/ccTemplateParser';

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
        element.addEventListener('bindingchange', event => changes.push(event.detail));
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
        ['bindingchange', 'pick', 'select', 'stepchange'].forEach(name => element.addEventListener(name, event => events.push([name === 'bindingchange' ? 'change' : name, event.detail])));
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
        ['bindingchange', 'pick', 'select', 'stepchange'].forEach(name => element.addEventListener(name, event => events.push([name === 'bindingchange' ? 'change' : name, event.detail])));
        document.body.appendChild(element);
        await flush();
        return { element, events };
    }

    function nodeOf(element, selector) {
        const { doc } = parseHtml(element.source.html);
        return Array.from(doc.body.querySelectorAll('*')).indexOf(doc.body.querySelector(selector));
    }

    const panel = (element, tag) => element.shadowRoot.querySelector(tag);
    const cards = element => Array.from(panel(element, 'c-cc-shell-steps').shadowRoot.querySelectorAll('.cc-steps__card'));
    const lastChange = events => events.filter(([name]) => name === 'change').pop()[1];

    it('walks the three gated steps: areas, dropzone, editable content, and lets earlier steps be edited again', async () => {
        const { element, events } = await shellWorkspace();
        const steps = () => events.filter(([name]) => name === 'stepchange').map(([, detail]) => detail);
        await flush();
        expect(steps()).toEqual([{ step: 1, pickScope: 'areas' }]);
        expect(cards(element).map(card => card.disabled)).toEqual([false, true, true]);
        expect(panel(element, 'c-cc-area-panel')).not.toBeNull();

        // Step 1: a single element becomes the Header area.
        element.pickedElements = [nodeOf(element, '#top')];
        await flush();
        panel(element, 'c-cc-area-panel').dispatchEvent(new CustomEvent('create', { detail: { name: 'Header', kind: 'fixed-read' } }));
        await flush();
        expect(lastChange(events).definition.regions).toEqual([{ regionId: 'header', kind: 'fixed-read', label: 'Header' }]);
        expect(cards(element).map(card => card.disabled)).toEqual([false, false, true]);

        // Step 1: two neighbours become one editable Footer area (wrapped).
        element.pickedElements = [nodeOf(element, '#f1')];
        await flush();
        element.extendSelection(nodeOf(element, '#f2'));
        await flush();
        element.pickedElements = events.filter(([name]) => name === 'pick').pop()[1].nodes;
        await flush();
        expect(panel(element, 'c-cc-area-panel').group.count).toBe(2);
        panel(element, 'c-cc-area-panel').dispatchEvent(new CustomEvent('create', { detail: { name: 'Footer', kind: 'fixed-edit' } }));
        await flush();
        expect(lastChange(events).definition.regions.map(region => region.regionId)).toEqual(['header', 'footer']);

        // Step 3 stays locked until the dropzone exists.
        cards(element)[2].click();
        await flush();
        expect(panel(element, 'c-cc-element-marker')).toBeNull();
        expect(panel(element, 'c-cc-area-panel')).not.toBeNull();

        // Step 2: place the dropzone after the Header.
        cards(element)[1].click();
        await flush();
        await flush();
        expect(steps().pop()).toEqual({ step: 2, pickScope: 'areas' });
        expect(panel(element, 'c-cc-dropzone-panel')).not.toBeNull();
        element.pickedElements = [nodeOf(element, '[data-cc-id="header"]')];
        await flush();
        expect(panel(element, 'c-cc-dropzone-panel').info.isArea).toBe(true);
        panel(element, 'c-cc-dropzone-panel').dispatchEvent(new CustomEvent('place', { detail: { position: 'after' } }));
        await flush();
        expect(lastChange(events).definition.regions.map(region => region.kind)).toEqual(['fixed-read', 'blocks', 'fixed-edit']);
        expect(lastChange(events).errors).toEqual([]);
        expect(panel(element, 'c-cc-dropzone-panel').placement.text).toBe('After Header');
        expect(cards(element).map(card => card.disabled)).toEqual([false, false, false]);

        // Step 3: mark editable content inside the editable Footer.
        cards(element)[2].click();
        await flush();
        await flush();
        expect(steps().pop()).toEqual({ step: 3, pickScope: 'editable' });
        element.pickedElements = [nodeOf(element, '#f1 td')];
        await flush();
        const marker = panel(element, 'c-cc-element-marker');
        expect(marker.mode).toBe('content');
        expect(marker.blockedReason).toBe('');
        marker.dispatchEvent(new CustomEvent('apply', { detail: { marking: { role: 'content', contentType: 'richText', key: 'legal', label: 'Legal text' } } }));
        await flush();
        expect(lastChange(events).definition.contentSlots.map(slot => slot.bindingKey)).toEqual(['legal']);
        const summary = Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__group')).map(group => group.textContent.replace(/\s+/g, ' ').trim());
        expect(summary[0]).toContain('1 · Fixed areas');
        expect(summary[0]).toContain('Header');
        expect(summary[0]).toContain('Footer');
        expect(summary[1]).toContain('After Header');
        expect(summary[2]).toContain('Legal text');
        expect(summary[2]).toContain('in Footer');

        // Back to step 1: switch the Footer to read-only, which removes its content bindings.
        cards(element)[0].click();
        await flush();
        element.pickedElements = [nodeOf(element, '[data-cc-id="footer"]')];
        await flush();
        const areaPanel = panel(element, 'c-cc-area-panel');
        expect(areaPanel.info.isArea).toBe(true);
        areaPanel.dispatchEvent(new CustomEvent('update', { detail: { regionId: 'footer', name: 'Footer', kind: 'fixed-read', removeContent: true } }));
        await flush();
        expect(lastChange(events).definition.contentSlots).toEqual([]);
        expect(lastChange(events).definition.regions.map(region => region.kind)).toEqual(['fixed-read', 'blocks', 'fixed-read']);

        // Step 2 again: move the dropzone after the Footer.
        cards(element)[1].click();
        await flush();
        element.pickedElements = [nodeOf(element, '[data-cc-id="footer"]')];
        await flush();
        panel(element, 'c-cc-dropzone-panel').dispatchEvent(new CustomEvent('place', { detail: { position: 'after' } }));
        await flush();
        expect(panel(element, 'c-cc-dropzone-panel').placement.text).toContain('After Footer');
        panel(element, 'c-cc-dropzone-panel').dispatchEvent(new CustomEvent('removezone'));
        await flush();
        expect(lastChange(events).definition.regions.some(region => region.kind === 'blocks')).toBe(false);
        expect(cards(element).map(card => card.disabled)).toEqual([false, false, true]);
    });

    it('accepts "no fixed areas" as step 1, and opens the step the list item belongs to', async () => {
        const { element, events } = await shellWorkspace();
        panel(element, 'c-cc-area-panel').dispatchEvent(new CustomEvent('nofixed', { detail: { value: true } }));
        await flush();
        expect(lastChange(events).definition.setup).toEqual({ noFixedAreas: true });
        expect(cards(element).map(card => card.disabled)).toEqual([false, false, true]);

        element.pickedElements = [nodeOf(element, '#top')];
        await flush();
        panel(element, 'c-cc-dropzone-panel');
        cards(element)[1].click();
        await flush();
        element.pickedElements = [nodeOf(element, '#top')];
        await flush();
        panel(element, 'c-cc-dropzone-panel').dispatchEvent(new CustomEvent('place', { detail: { position: 'before' } }));
        await flush();
        const zoneItem = element.shadowRoot.querySelector('.cc-workspace__nav-item[data-key="region:content"]');
        expect(zoneItem.textContent).toContain('Before table#top');
        cards(element)[0].click();
        await flush();
        expect(panel(element, 'c-cc-area-panel')).not.toBeNull();
        zoneItem.click();
        await flush();
        expect(panel(element, 'c-cc-dropzone-panel')).not.toBeNull();
        expect(events.filter(([name]) => name === 'pick').pop()[1].nodes).toEqual([nodeOf(element, '[data-cc-region="blocks"]')]);
    });

    it('step 3 refuses elements outside editable areas and explains the empty state', async () => {
        const { element } = await shellWorkspace();
        panel(element, 'c-cc-area-panel').dispatchEvent(new CustomEvent('nofixed', { detail: { value: true } }));
        await flush();
        cards(element)[1].click();
        await flush();
        element.pickedElements = [nodeOf(element, '#top')];
        await flush();
        panel(element, 'c-cc-dropzone-panel').dispatchEvent(new CustomEvent('place', { detail: { position: 'after' } }));
        await flush();
        cards(element)[2].click();
        await flush();
        expect(element.shadowRoot.textContent).toContain('Nothing to edit yet');
        element.pickedElements = [nodeOf(element, '#copy td')];
        await flush();
        expect(panel(element, 'c-cc-element-marker').blockedReason).toContain('inside an editable area');
    });

    it('does not show the shell steps for blocks or single-block shells', async () => {
        const { element } = await shellWorkspace(PAGE, 'single');
        expect(element.shadowRoot.querySelector('c-cc-shell-steps')).toBeNull();
        expect(element.shadowRoot.querySelector('c-cc-area-panel')).toBeNull();
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
