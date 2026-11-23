import { createElement } from 'lwc';
import CcBindingGuide from 'c/ccBindingGuide';
import { SHELL_EXAMPLE, BLOCK_EXAMPLE } from 'c/ccBindingExamples';
import { parseTemplate } from 'c/ccTemplateParser';

describe('binding examples', () => {
    it('parse without errors or warnings', () => {
        const shell = parseTemplate(SHELL_EXAMPLE, { kind: 'shell', templateMode: 'multi' });
        expect(shell.errors).toEqual([]);
        expect(shell.warnings).toEqual([]);
        expect(shell.definition.regions.map(region => region.kind)).toEqual(['fixed-read', 'blocks', 'fixed-edit']);
        const block = parseTemplate(BLOCK_EXAMPLE, { kind: 'block' });
        expect(block.errors).toEqual([]);
        expect(block.warnings).toEqual(['block: Background is bound but no color or gradient presets are configured.']);
        expect(block.definition.contentSlots.map(slot => slot.type)).toEqual(['richText', 'bulletList', 'divider', 'button', 'image']);
        expect(parseTemplate(BLOCK_EXAMPLE, { kind: 'shell', templateMode: 'single' }).errors).toEqual([]);
    });
});

describe('c-cc-binding-guide', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('shows shell instructions with regions and a downloadable example', async () => {
        const element = createElement('c-cc-binding-guide', { is: CcBindingGuide });
        element.kind = 'shell';
        element.templateMode = 'multi';
        element.open = true;
        document.body.appendChild(element);
        await Promise.resolve();
        const text = element.shadowRoot.textContent;
        expect(text).toContain('How to prepare the template shell');
        expect(text).toContain('data-cc-region="blocks"');
        const link = element.shadowRoot.querySelector('a[download]');
        expect(link.download).toBe('template-shell-example.html');
        expect(decodeURIComponent(link.href)).toContain('data-cc-region="fixed-read"');
    });

    it('omits regions for blocks', async () => {
        const element = createElement('c-cc-binding-guide', { is: CcBindingGuide });
        element.kind = 'block';
        document.body.appendChild(element);
        await Promise.resolve();
        expect(element.shadowRoot.textContent).not.toContain('fixed-edit');
        expect(element.shadowRoot.querySelector('a[download]').download).toBe('content-block-example.html');
    });
});
