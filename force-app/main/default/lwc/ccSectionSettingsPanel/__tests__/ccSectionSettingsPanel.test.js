import { createElement } from 'lwc';
import CcSectionSettingsPanel from 'c/ccSectionSettingsPanel';
import { inspectNode, placeTarget } from 'c/ccElementMarking';
import { parseTemplate } from 'c/ccTemplateParser';

const flush = () => Promise.resolve();
const BOX = '<div data-cc-section="container" data-cc-id="box" data-cc-bind="padding background hide" style="padding: 10px 20px; background-color: #112233"><p>x</p></div>';

async function mount(html, props = {}) {
    const definition = parseTemplate(html, { kind: 'block' }).definition;
    const element = createElement('c-cc-section-settings-panel', { is: CcSectionSettingsPanel });
    element.section = definition.sections[0];
    element.info = inspectNode(html, 0);
    Object.assign(element, props);
    document.body.appendChild(element);
    await flush();
    return { element, definition };
}

const q = (element, selector) => element.shadowRoot.querySelector(selector);
const all = (element, selector) => Array.from(element.shadowRoot.querySelectorAll(selector));
const button = (element, label, index = 0) => all(element, 'lightning-button').filter(item => item.label === label)[index];

describe('c-cc-section-settings-panel', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('asks to select a section first', async () => {
        const element = createElement('c-cc-section-settings-panel', { is: CcSectionSettingsPanel });
        document.body.appendChild(element);
        await flush();
        expect(element.shadowRoot.textContent).toContain('Select a container, row or column');
    });

    it('offers the settings of the level and a placeholder card for each that needs one', async () => {
        const { element } = await mount(BOX, { pendingCount: 2 });
        const group = q(element, 'lightning-checkbox-group');
        expect(group.options.map(option => option.value)).toEqual(['padding', 'margin', 'background', 'hide']);
        expect(group.value).toEqual(['padding', 'background', 'hide']);
        const titles = all(element, '.cc-settings__card .slds-text-title_bold').map(item => item.textContent);
        expect(titles).toEqual(['Padding', 'Background color', 'Background gradient', 'Background image']);
        expect(element.shadowRoot.textContent).toContain('cc-hide-dsk');
        expect(element.shadowRoot.textContent).toContain('2 placeholders still to place');
    });

    it('shows what will be captured from the existing style', async () => {
        const { element } = await mount(BOX);
        const text = element.shadowRoot.textContent;
        expect(text).toContain('Found "padding: 10px 20px"');
        expect(text).toContain('Found the color "#112233"');
        expect(text).toContain('move into the fallback and {{cc-bg-gradient}} takes their place');
    });

    it('asks to place, remove and edit the fallback of a placeholder', async () => {
        const placedHtml = placeTarget(BOX, 0, 'padding').html;
        const definition = parseTemplate(placedHtml, { kind: 'block', previous: { sections: [{ sectionId: 'box', targets: { padding: { fallback: '10px 20px' } } }] } }).definition;
        const element = createElement('c-cc-section-settings-panel', { is: CcSectionSettingsPanel });
        element.section = definition.sections[0];
        element.info = inspectNode(placedHtml, 0);
        document.body.appendChild(element);
        await flush();
        const events = [];
        ['place', 'unplace', 'fallbackchange', 'bindschange'].forEach(name => element.addEventListener(name, event => events.push([name, event.detail])));

        expect(element.shadowRoot.textContent).toContain('Placed');
        const fallback = all(element, 'lightning-input').find(item => item.label === 'Fallback (rendered when nothing is provided)');
        expect(fallback.value).toBe('10px 20px');
        fallback.value = '0px 0px 0px 0px';
        fallback.dispatchEvent(new CustomEvent('change'));
        button(element, 'Remove placeholder').click();
        button(element, 'Place placeholder', 0).click();
        q(element, 'lightning-checkbox-group').dispatchEvent(new CustomEvent('change', { detail: { value: ['padding'] } }));
        expect(events).toEqual([
            ['fallbackchange', { target: 'padding', fallback: '0px 0px 0px 0px' }],
            ['unplace', { target: 'padding' }],
            ['place', { target: 'bgColor', fallback: '' }],
            ['bindschange', { binds: ['padding'] }]
        ]);
    });

    it('passes typed fallbacks along when placing, and forwards defaults and presets edits', async () => {
        const { element } = await mount('<div data-cc-section="container" data-cc-id="box" data-cc-bind="margin"><p>x</p></div>');
        const events = [];
        element.addEventListener('place', event => events.push(event.detail));
        element.addEventListener('sectionchange', event => events.push(event.detail.section.sectionId));
        const fallback = all(element, 'lightning-input').find(item => item.label === 'Fallback (rendered when nothing is provided)');
        fallback.value = '0 0 24px 0';
        fallback.dispatchEvent(new CustomEvent('change'));
        await flush();
        button(element, 'Place placeholder').click();
        const editor = q(element, 'c-cc-section-settings-editor');
        expect(editor.mode).toBe('definition');
        editor.dispatchEvent(new CustomEvent('change', { detail: { section: { ...editor.section } } }));
        expect(events).toEqual([{ target: 'margin', fallback: '0 0 24px 0' }, 'box']);
    });

    it('offers to continue when every placeholder is placed', async () => {
        const { element } = await mount(BOX, { canContinue: true, pendingCount: 0 });
        const events = [];
        element.addEventListener('next', () => events.push('next'));
        button(element, 'Continue to content').click();
        expect(events).toEqual(['next']);
        expect(element.shadowRoot.textContent).toContain('Every setting has a placeholder.');
    });
});
