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

const last = list => list[list.length - 1];
const blockCards = element => Array.from(element.shadowRoot.querySelector('c-cc-shell-steps').shadowRoot.querySelectorAll('.cc-steps__card'));

describe('c-cc-binding-workspace', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('lists containers and content, opens settings first when placeholders are missing, and edits presets', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: BLOCK_HTML, definition: null };
        const changes = [];
        const events = [];
        element.addEventListener('bindingchange', event => changes.push(event.detail));
        element.addEventListener('stepchange', event => events.push(event.detail));
        document.body.appendChild(element);
        await flush();
        await flush();

        const items = Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__nav-item'));
        expect(items.map(item => item.dataset.key)).toEqual(['section:block', 'section:column-1', 'slot:note', 'slot:cta']);
        // The container binds padding, background and hide but has no placeholders yet: settings is the first open step.
        expect(events[0]).toEqual({ step: 2, pickScope: 'inspect' });
        const settings = () => element.shadowRoot.querySelector('c-cc-section-settings-panel');
        expect(settings().section.sectionId).toBe('block');
        expect(settings().pendingCount).toBe(2);
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, false, true]);

        // Placing the placeholders writes them into the HTML and records the fallback.
        settings().dispatchEvent(new CustomEvent('place', { detail: { target: 'padding', fallback: '4px' } }));
        await flush();
        expect(last(changes).html).toContain('padding: {{cc-padding}}');
        expect(last(changes).definition.sections[0].targets.padding).toEqual({ fallback: '4px' });
        expect(settings().pendingCount).toBe(1);
        settings().dispatchEvent(new CustomEvent('place', { detail: { target: 'bgColor', fallback: '#ffffff' } }));
        await flush();
        expect(settings().pendingCount).toBe(0);
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, false, false]);

        const updated = { ...settings().section, presets: { colors: [{ id: 'red', label: 'Red', hex: '#e2001a' }], gradients: [] } };
        settings().dispatchEvent(new CustomEvent('sectionchange', { detail: { section: updated } }));
        await flush();
        expect(last(changes).definition.sections[0].presets.colors[0].hex).toBe('#e2001a');
        expect(last(changes).errors).toEqual([]);

        // Choosing a content item opens the content step with its editor.
        const refreshed = Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__nav-item'));
        refreshed[3].click();
        await flush();
        await flush();
        expect(events.pop()).toEqual({ step: 3, pickScope: 'any' });
        expect(element.shadowRoot.querySelector('c-cc-content-binding-editor').binding.bindingKey).toBe('cta');
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

        // Content cannot be marked before the layout step is done.
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, true, true]);
        element.shadowRoot.querySelector('c-cc-section-panel').dispatchEvent(new CustomEvent('nosections', { detail: { value: true } }));
        await flush();
        blockCards(element)[2].click();
        await flush();
        await flush();
        expect(events.filter(([name]) => name === 'stepchange').pop()[1]).toEqual({ step: 3, pickScope: 'any' });

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
        element.shadowRoot.querySelector('c-cc-section-panel').dispatchEvent(new CustomEvent('nosections', { detail: { value: true } }));
        await flush();
        blockCards(element)[2].click();
        await flush();
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

    it('guides a content block: containers, settings with placeholders, then content, gated like the shell steps', async () => {
        const html = '<div id="box" style="padding: 10px 20px"><div id="row"><p id="txt">Hello</p></div></div>';
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html, definition: null };
        const events = [];
        ['bindingchange', 'pick', 'select', 'stepchange'].forEach(name => element.addEventListener(name, event => events.push([name === 'bindingchange' ? 'change' : name, event.detail])));
        document.body.appendChild(element);
        await flush();
        const nodeIn = selector => {
            const { doc } = parseHtml(element.source.html);
            return Array.from(doc.body.querySelectorAll('*')).indexOf(doc.body.querySelector(selector));
        };
        const steps = () => events.filter(([name]) => name === 'stepchange').map(([, detail]) => detail);
        const sectionPanel = () => panel(element, 'c-cc-section-panel');
        const settings = () => panel(element, 'c-cc-section-settings-panel');
        const mark = marking => sectionPanel().dispatchEvent(new CustomEvent('apply', { detail: { marking } }));

        expect(steps()).toEqual([{ step: 1, pickScope: 'any' }]);
        expect(panel(element, 'c-cc-area-panel')).toBeNull();
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, true, true]);
        expect(sectionPanel().progress.stage).toBe('container');

        // Locked steps cannot be opened.
        blockCards(element)[1].click();
        await flush();
        expect(sectionPanel()).not.toBeNull();

        // Step 1: the parent container, then a row, which needs columns or the "row as column" flag.
        element.pickedElements = [nodeIn('#box')];
        await flush();
        mark({ role: 'section', level: 'container', id: 'box' });
        await flush();
        expect(lastChange(events).definition.sections.map(section => section.sectionId)).toEqual(['box']);
        expect(sectionPanel().progress.stage).toBe('rows');
        element.pickedElements = [nodeIn('#row')];
        await flush();
        mark({ role: 'section', level: 'row', id: 'row' });
        await flush();
        expect(sectionPanel().progress.stage).toBe('columns');
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, true, true]);
        element.pickedElements = [nodeIn('#row')];
        await flush();
        sectionPanel().dispatchEvent(new CustomEvent('ascolumn', { detail: { value: true } }));
        await flush();
        expect(lastChange(events).definition.sections.find(section => section.sectionId === 'row').asColumn).toBe(true);
        expect(lastChange(events).html).toContain('data-cc-as-column="true"');
        expect(sectionPanel().progress.stage).toBe('done');
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, false, false]);

        // Step 2: bind padding on the container, place the placeholder over the existing declaration.
        blockCards(element)[1].click();
        await flush();
        await flush();
        expect(steps().pop()).toEqual({ step: 2, pickScope: 'inspect' });
        // The row that was edited last stays selected; choose the container in the list.
        expect(settings().section.sectionId).toBe('row');
        Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__nav-item'))[0].click();
        await flush();
        expect(settings().section.sectionId).toBe('box');
        expect(events.filter(([name]) => name === 'select').pop()[1]).toEqual({ key: 'section:box' });
        expect(settings().info.styleInfo.padding).toBe('10px 20px');
        settings().dispatchEvent(new CustomEvent('bindschange', { detail: { binds: ['padding'] } }));
        await flush();
        expect(settings().pendingCount).toBe(1);
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, false, true]);
        settings().dispatchEvent(new CustomEvent('place', { detail: { target: 'padding', fallback: '' } }));
        await flush();
        const placed = lastChange(events);
        expect(placed.html).toContain('padding: {{cc-padding}}');
        const box = placed.definition.sections.find(section => section.sectionId === 'box');
        expect(box.targets.padding).toEqual({ fallback: '10px 20px' });
        expect(box.defaults.padding.desktop).toMatchObject({ top: 10, right: 20, bottom: 10, left: 20 });
        expect(blockCards(element).map(card => card.disabled)).toEqual([false, false, false]);

        settings().dispatchEvent(new CustomEvent('fallbackchange', { detail: { target: 'padding', fallback: '0px' } }));
        await flush();
        expect(lastChange(events).definition.sections.find(section => section.sectionId === 'box').targets.padding.fallback).toBe('0px');

        // Step 3: content cannot be a container.
        blockCards(element)[2].click();
        await flush();
        await flush();
        expect(steps().pop()).toEqual({ step: 3, pickScope: 'any' });
        element.pickedElements = [nodeIn('#box')];
        await flush();
        expect(panel(element, 'c-cc-element-marker').blockedReason).toContain('container');
        element.pickedElements = [nodeIn('#txt')];
        await flush();
        expect(panel(element, 'c-cc-element-marker').blockedReason).toBe('');
        panel(element, 'c-cc-element-marker').dispatchEvent(new CustomEvent('apply', { detail: { marking: { role: 'content', contentType: 'richText', key: 'body' } } }));
        await flush();
        expect(lastChange(events).definition.contentSlots.map(slot => slot.bindingKey)).toEqual(['body']);
        expect(panel(element, 'c-cc-content-binding-editor').binding.bindingKey).toBe('body');

        // The summary groups follow the steps; choosing a container from the content step opens its settings.
        const keys = Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__nav-item')).map(item => item.dataset.key);
        expect(keys).toEqual(['section:box', 'section:row', 'slot:body']);
        Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__nav-item'))[0].click();
        await flush();
        await flush();
        expect(steps().pop()).toEqual({ step: 2, pickScope: 'inspect' });
        expect(settings().section.sectionId).toBe('box');

        // Removing the placeholder puts the fallback back into the style.
        settings().dispatchEvent(new CustomEvent('unplace', { detail: { target: 'padding' } }));
        await flush();
        expect(lastChange(events).html).toContain('padding: 0px');
        expect(lastChange(events).html).not.toContain('{{cc-padding}}');
    });

    it('goes to the content step when a content item is chosen', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: '<table data-cc-section="container"><tr><td data-cc-section="column"><div data-cc-content="richText" data-cc-key="note">x</div></td></tr></table>', definition: null };
        document.body.appendChild(element);
        await flush();
        element.activeKey = 'slot:note';
        await flush();
        await flush();
        expect(blockCards(element)[2].classList.contains('cc-steps__card_active')).toBe(true);
    });

    it('uses the block steps for single-block shells and not the shell areas', async () => {
        const { element } = await shellWorkspace(PAGE, 'single');
        expect(panel(element, 'c-cc-shell-steps').variant).toBe('block');
        expect(panel(element, 'c-cc-section-panel')).not.toBeNull();
        expect(panel(element, 'c-cc-area-panel')).toBeNull();
    });

    it('lets the admin test the bindings: starts from the defaults, reports every change, and ends cleanly', async () => {
        const element = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        element.kind = 'block';
        element.source = { html: BLOCK_HTML, definition: null };
        const tests = [];
        const bindingChanges = [];
        element.addEventListener('testchange', event => tests.push(event.detail.config));
        element.addEventListener('bindingchange', event => bindingChanges.push(event.detail));
        document.body.appendChild(element);
        await flush();
        const modeButton = label => Array.from(element.shadowRoot.querySelectorAll('.cc-workspace__modes lightning-button')).find(button => button.label === label);
        expect(modeButton('Test bindings').disabled).toBe(false);

        modeButton('Test bindings').click();
        await flush();
        expect(tests).toHaveLength(1);
        expect(tests[0].rows[0].columns[0].content.map(item => item.bindingKey)).toEqual(['note', 'cta']);
        const playground = element.shadowRoot.querySelector('c-cc-binding-playground');
        expect(playground.definition.sections.length).toBeGreaterThan(0);
        expect(element.shadowRoot.querySelector('c-cc-shell-steps')).toBeNull();

        const changed = { ...tests[0], blockSettings: { ...tests[0].blockSettings, marker: true } };
        playground.dispatchEvent(new CustomEvent('configchange', { detail: { config: changed } }));
        await flush();
        expect(tests[1].blockSettings.marker).toBe(true);
        expect(element.shadowRoot.querySelector('c-cc-binding-playground').config.blockSettings.marker).toBe(true);

        playground.dispatchEvent(new CustomEvent('resetconfig'));
        await flush();
        expect(tests[2].blockSettings.marker).toBeUndefined();

        modeButton('Set up bindings').click();
        await flush();
        expect(tests[3]).toBeNull();
        expect(element.shadowRoot.querySelector('c-cc-binding-playground')).toBeNull();
        expect(element.shadowRoot.querySelector('c-cc-shell-steps')).not.toBeNull();
        // Testing never changes the template itself.
        expect(bindingChanges).toHaveLength(0);
    });

    it('does not allow testing before anything is marked or while the file has errors', async () => {
        const raw = createElement('c-cc-binding-workspace', { is: CcBindingWorkspace });
        raw.kind = 'block';
        raw.source = { html: '<table><tr><td>Hi</td></tr></table>', definition: null };
        document.body.appendChild(raw);
        await flush();
        const button = Array.from(raw.shadowRoot.querySelectorAll('.cc-workspace__modes lightning-button')).find(item => item.label === 'Test bindings');
        expect(button.disabled).toBe(true);
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
