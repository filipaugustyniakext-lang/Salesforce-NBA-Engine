import { createElement } from 'lwc';
import CcTemplateWizard from 'c/ccTemplateWizard';
import getLocales from '@salesforce/apex/MarketingDictionaryManagerController.getLocales';
import { parseTemplate } from 'c/ccTemplateParser';
import { SHELL_EXAMPLE } from 'c/ccBindingExamples';
import { buildBlockConfig } from 'c/ccTemplateSchema';

jest.mock('@salesforce/apex/CcTemplateDefinitionController.getTemplateDetail', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.saveTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.saveBlock', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.setBlockStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.deleteBlock', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.deleteTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.validateTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.activateTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/MarketingDictionaryManagerController.getLocales', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('lightning/confirm', () => ({ default: { open: jest.fn() } }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function openShellStep() {
    getLocales.mockResolvedValue([{ Id: 'l1', Name: 'pl_PL', Is_Active__c: true, Is_Default__c: true }]);
    const element = createElement('c-cc-template-wizard', { is: CcTemplateWizard });
    element.channelId = 'a01';
    document.body.appendChild(element);
    await flush();
    const slug = element.shadowRoot.querySelector('lightning-input[data-field="slug"]');
    slug.dispatchEvent(new CustomEvent('change', { detail: { value: 'Spring' } }));
    await flush();
    const next = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(button => button.label === 'Next');
    next.click();
    await flush();
    return element;
}

describe('c-cc-template-wizard layout', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('shows no preview until a shell is uploaded, then docks it on the right', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        expect(workspace.kind).toBe('shell');
        expect(element.shadowRoot.querySelector('.cc-wizard__side')).toBeNull();
        expect(element.shadowRoot.querySelector('.cc-wizard__layout_split')).toBeNull();

        const parsed = parseTemplate(SHELL_EXAMPLE, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('bindingchange', { detail: { html: parsed.html, definition: parsed.definition, errors: [], warnings: [] } }));
        await flush();

        const layout = element.shadowRoot.querySelector('.cc-wizard__layout_split');
        expect(layout).not.toBeNull();
        const side = layout.querySelector('.cc-wizard__side');
        const preview = side.querySelector('c-cc-template-preview');
        expect(typeof preview.renderFn).toBe('function');
        expect(preview.renderFn('desktop', 'light')).toContain('Content blocks dropzone');
        expect(layout.querySelector('.cc-wizard__body').contains(side)).toBe(false);
    });

    it('links preview clicks and list selection on the shell step', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        const parsed = parseTemplate(SHELL_EXAMPLE, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('bindingchange', { detail: { html: parsed.html, definition: parsed.definition, errors: [], warnings: [] } }));
        await flush();

        const preview = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(preview.inspectable).toBe(true);
        expect(preview.inspectScope).toBe('all');

        preview.dispatchEvent(new CustomEvent('select', { detail: { key: 'region:footer' } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').activeKey).toBe('region:footer');
        expect(element.shadowRoot.querySelector('c-cc-template-preview').selectedKey).toBe('region:footer');

        element.shadowRoot.querySelector('c-cc-binding-workspace').dispatchEvent(new CustomEvent('select', { detail: { key: 'slot:footerNote' } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-template-preview').selectedKey).toBe('slot:footerNote');
    });

    it('switches to guided mark mode for a raw upload and routes picks to the workspace', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        const raw = '<div><table><tr><td><p>Hello</p></td></tr></table></div>';
        const parsed = parseTemplate(raw, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('bindingchange', { detail: { html: parsed.html, definition: parsed.definition, errors: parsed.errors, warnings: [] } }));
        await flush();

        const preview = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(preview.markable).toBe(true);
        expect(preview.markMode).toBe(true);
        expect(preview.renderFn('desktop', 'light')).toContain('data-cc-node="3"');

        preview.dispatchEvent(new CustomEvent('pick', { detail: { node: 3, extend: false } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').pickedElements).toEqual([3]);
        expect(element.shadowRoot.querySelector('c-cc-template-preview').pickedNodes).toEqual([3]);

        element.shadowRoot.querySelector('c-cc-binding-workspace').extendSelection = jest.fn();
        element.shadowRoot.querySelector('c-cc-template-preview').dispatchEvent(new CustomEvent('pick', { detail: { node: 5, extend: true } }));
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').extendSelection).toHaveBeenCalledWith(5);
        element.shadowRoot.querySelector('c-cc-binding-workspace').dispatchEvent(new CustomEvent('pick', { detail: { nodes: [3, 5] } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-template-preview').pickedNodes).toEqual([3, 5]);

        expect(preview.pickScope).toBe('areas');
        element.shadowRoot.querySelector('c-cc-binding-workspace').dispatchEvent(new CustomEvent('stepchange', { detail: { step: 3, pickScope: 'editable' } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-template-preview').pickScope).toBe('editable');
        element.shadowRoot.querySelector('c-cc-template-preview').dispatchEvent(new CustomEvent('modechange', { detail: { mark: false } }));
        await flush();
        const after = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(after.markMode).toBe(false);
        expect(after.renderFn('desktop', 'light')).not.toContain('data-cc-node');
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').pickedElements).toEqual([]);
    });

    it('turns marking off and lets the preview only select marked items in the inspect step', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        const raw = '<div><table><tr><td><p>Hello</p></td></tr></table></div>';
        const parsed = parseTemplate(raw, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('bindingchange', { detail: { html: parsed.html, definition: parsed.definition, errors: [], warnings: [] } }));
        await flush();
        workspace.dispatchEvent(new CustomEvent('stepchange', { detail: { step: 3, pickScope: 'inspect' } }));
        await flush();
        const preview = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(preview.markMode).toBe(false);
        expect(preview.pickScope).toBe('any');
        workspace.dispatchEvent(new CustomEvent('stepchange', { detail: { step: 2, pickScope: 'any' } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-template-preview').markMode).toBe(true);
    });

    it('renders the preview with the values tried out in Test bindings, and stops when testing ends', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        const html = '<table data-cc-region="fixed-edit"><tr><td><div data-cc-content="richText" data-cc-key="intro">Default text</div></td></tr></table><div data-cc-region="blocks"></div>';
        const parsed = parseTemplate(html, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('bindingchange', { detail: { html: parsed.html, definition: parsed.definition, errors: [], warnings: [] } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-template-preview').inspectable).toBe(true);

        const config = buildBlockConfig(parsed.definition);
        config.rows[0].columns[0].content[0].html = '<b>Typed by the admin</b>';
        workspace.dispatchEvent(new CustomEvent('testchange', { detail: { config } }));
        await flush();
        const testing = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(testing.inspectable).toBe(false);
        expect(testing.renderFn('mobile', 'light')).toContain('Typed by the admin');

        workspace.dispatchEvent(new CustomEvent('testchange', { detail: { config: null } }));
        await flush();
        const done = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(done.inspectable).toBe(true);
        expect(done.renderFn('mobile', 'light')).not.toContain('Typed by the admin');
    });

    it('is not wiped by change events that bubble out of inputs inside the marker panel', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        const raw = '<div><table><tr><td><p>Hello</p></td></tr></table></div>';
        const parsed = parseTemplate(raw, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('bindingchange', { detail: { html: parsed.html, definition: parsed.definition, errors: parsed.errors, warnings: [] } }));
        await flush();
        element.shadowRoot.querySelector('c-cc-template-preview').dispatchEvent(new CustomEvent('pick', { detail: { node: 3, extend: false } }));
        await flush();

        const areaPanel = element.shadowRoot.querySelector('c-cc-binding-workspace').shadowRoot.querySelector('c-cc-area-panel');
        const radios = areaPanel.shadowRoot.querySelectorAll('lightning-radio-group');
        expect(radios.length).toBe(1);
        // lightning base components fire a bubbling, composed change event.
        radios[0].dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value: 'fixed-edit' } }));
        Array.from(areaPanel.shadowRoot.querySelectorAll('lightning-input')).forEach(input => {
            input.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value: 'x' } }));
        });
        await flush();

        expect(element.shadowRoot.querySelector('c-cc-template-preview')).not.toBeNull();
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').source.html).toContain('<p>Hello</p>');
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').pickedElements).toEqual([3]);
    });

    it('offers delete only for saved templates', async () => {
        const element = await openShellStep();
        const labels = () => Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(button => button.label);
        expect(labels()).not.toContain('Delete template');
    });
});
