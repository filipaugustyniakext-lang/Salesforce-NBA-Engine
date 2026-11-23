import { renderTemplatePreview } from 'c/copyTemplatePreview';
import { parseTemplate } from 'c/ccTemplateParser';
import { newMessageBlock, SCHEMA_VERSION } from 'c/ccTemplateSchema';

describe('renderTemplatePreview with schema v1 sources', () => {
    it('delegates to the v1 renderer and skips blocks without a definition', () => {
        const shell = parseTemplate('<div data-cc-region="blocks"></div>', { kind: 'shell', templateMode: 'multi' });
        const block = parseTemplate('<div data-cc-section="container"><p data-cc-content="richText" data-cc-key="t">x</p></div>');
        const known = newMessageBlock({ id: 'def1' }, block.definition, 1);
        known.blockConfig.rows[0].columns[0].content[0].html = 'Rendered';
        const unknown = { ...known, blockTemplateDefinitionId: 'missing' };
        const html = renderTemplatePreview({
            schemaVersion: SCHEMA_VERSION,
            shellHtml: shell.html,
            shellDefinition: shell.definition,
            blockDefinitions: { def1: { html: block.html, definition: block.definition } }
        }, [known, unknown], 'desktop');
        expect(html.match(/Rendered/g)).toHaveLength(1);
    });
});
