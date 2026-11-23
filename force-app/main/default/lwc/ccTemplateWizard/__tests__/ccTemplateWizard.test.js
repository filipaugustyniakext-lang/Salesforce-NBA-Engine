import { createElement } from 'lwc';
import CcTemplateWizard from 'c/ccTemplateWizard';
import getLocales from '@salesforce/apex/MarketingDictionaryManagerController.getLocales';
import { parseTemplate } from 'c/ccTemplateParser';
import { SHELL_EXAMPLE } from 'c/ccBindingExamples';

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
        workspace.dispatchEvent(new CustomEvent('change', { detail: { html: parsed.html, definition: parsed.definition, errors: [], warnings: [] } }));
        await flush();

        const layout = element.shadowRoot.querySelector('.cc-wizard__layout_split');
        expect(layout).not.toBeNull();
        const side = layout.querySelector('.cc-wizard__side');
        const preview = side.querySelector('c-cc-template-preview');
        expect(typeof preview.renderFn).toBe('function');
        expect(preview.renderFn('desktop', 'light')).toContain('No content blocks yet');
        expect(layout.querySelector('.cc-wizard__body').contains(side)).toBe(false);
    });

    it('links preview clicks and list selection on the shell step', async () => {
        const element = await openShellStep();
        const workspace = element.shadowRoot.querySelector('c-cc-binding-workspace');
        const parsed = parseTemplate(SHELL_EXAMPLE, { kind: 'shell', templateMode: 'multi' });
        workspace.dispatchEvent(new CustomEvent('change', { detail: { html: parsed.html, definition: parsed.definition, errors: [], warnings: [] } }));
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
        workspace.dispatchEvent(new CustomEvent('change', { detail: { html: parsed.html, definition: parsed.definition, errors: parsed.errors, warnings: [] } }));
        await flush();

        const preview = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(preview.markable).toBe(true);
        expect(preview.markMode).toBe(true);
        expect(preview.renderFn('desktop', 'light')).toContain('data-cc-node="3"');

        preview.dispatchEvent(new CustomEvent('pick', { detail: { node: 3 } }));
        await flush();
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').pickedElement).toBe(3);
        expect(element.shadowRoot.querySelector('c-cc-template-preview').pickedNode).toBe(3);

        element.shadowRoot.querySelector('c-cc-template-preview').dispatchEvent(new CustomEvent('modechange', { detail: { mark: false } }));
        await flush();
        const after = element.shadowRoot.querySelector('c-cc-template-preview');
        expect(after.markMode).toBe(false);
        expect(after.renderFn('desktop', 'light')).not.toContain('data-cc-node');
        expect(element.shadowRoot.querySelector('c-cc-binding-workspace').pickedElement).toBeNull();
    });

    it('offers delete only for saved templates', async () => {
        const element = await openShellStep();
        const labels = () => Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(button => button.label);
        expect(labels()).not.toContain('Delete template');
    });
});
