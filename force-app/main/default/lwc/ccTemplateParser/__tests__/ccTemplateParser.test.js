import { parseTemplate, upgradeLegacyHtml, hasLegacyMarkers } from 'c/ccTemplateParser';
import { buildBlockConfig, validateDefinition } from 'c/ccTemplateSchema';

export const BLOCK_HTML = `
<style>.cc-hide-dsk{} .cc-hide-mob{} .cc-stack-mob{}</style>
<table data-cc-section="container" data-cc-bind="padding background hide">
  <tr data-cc-section="row" data-cc-id="main" data-cc-bind="column-direction margin">
    <td data-cc-section="column" data-cc-bind="padding">
      <div data-cc-content="richText" data-cc-key="marketingNote" data-cc-label="Marketing note">Hello</div>
      <div data-cc-content="richText" data-cc-key="legalNote" data-cc-complexity="basic">Legal</div>
      <table data-cc-content="bulletList" data-cc-key="benefits">
        <tr data-cc-loop="item"><td data-cc-slot="icon-cell"><img data-cc-slot="icon" src="" /></td><td data-cc-slot="text">Item</td></tr>
      </table>
    </td>
    <td data-cc-section="column" data-cc-bind="background">
      <img data-cc-content="image" data-cc-key="hero" width="300" height="200" alt="Hero" />
      <div data-cc-content="divider" data-cc-key="divider"><hr data-cc-slot="line" /></div>
      <a data-cc-content="button" data-cc-key="cta" href="#">Open</a>
    </td>
  </tr>
</table>`;

export const SHELL_HTML = `<!DOCTYPE html><html><head><style>.cc-hide-dsk{} .cc-hide-mob{}</style></head><body>
<div data-cc-region="fixed-read" data-cc-id="header"><img src="https://example.com/logo.png" /></div>
<div data-cc-region="blocks"></div>
<div data-cc-region="fixed-edit" data-cc-id="footer"><p data-cc-content="richText" data-cc-key="footerNote">Footer</p></div>
</body></html>`;

describe('ccTemplateParser.parseTemplate', () => {
    it('builds sections, generated ids and content slots for a block', () => {
        const result = parseTemplate(BLOCK_HTML, { kind: 'block' });
        expect(result.errors).toEqual([]);
        const { sections, contentSlots } = result.definition;
        expect(sections.map(section => section.sectionId)).toEqual(['block', 'main', 'main-col-1', 'main-col-2']);
        expect(sections[1].binds).toEqual(['column-direction', 'margin']);
        expect(sections[2].parentId).toBe('main');
        expect(contentSlots.map(slot => `${slot.type}:${slot.bindingKey}:${slot.sectionId}`)).toEqual([
            'richText:marketingNote:main-col-1',
            'richText:legalNote:main-col-1',
            'bulletList:benefits:main-col-1',
            'image:hero:main-col-2',
            'divider:divider:main-col-2',
            'button:cta:main-col-2'
        ]);
        expect(contentSlots[1].complexity).toBe('basic');
        expect(contentSlots[3].defaults).toEqual({ altText: 'Hero', width: 300, height: 200 });
        expect(result.html).toContain('data-cc-id="main-col-2"');
    });

    it('reports structural errors', () => {
        const html = `<div data-cc-section="column" data-cc-bind="column-direction">
            <span data-cc-content="image" data-cc-key="pic"></span>
            <a data-cc-content="button" data-cc-key="pic">x</a>
            <div data-cc-content="bulletList" data-cc-key="list"></div>
            <script>alert(1)</script></div>`;
        const { errors } = parseTemplate(html, { kind: 'block' });
        expect(errors).toEqual(expect.arrayContaining([
            'Scripts are not allowed in templates.',
            'Image binding "pic" must be an <img> element.',
            'Binding key "pic" is used more than once.',
            'Bullet list "list" needs one child with data-cc-loop="item".',
            'column-1: Column direction can only be bound on rows.'
        ]));
    });

    it('requires exactly one blocks region for multi-block shells', () => {
        expect(parseTemplate(SHELL_HTML, { kind: 'shell', templateMode: 'multi' }).errors).toEqual([]);
        const missing = parseTemplate('<div data-cc-region="fixed-read">x</div>', { kind: 'shell', templateMode: 'multi' });
        expect(missing.errors.join(' ')).toContain('exactly one blocks region');
        const single = parseTemplate(SHELL_HTML, { kind: 'shell', templateMode: 'single' });
        expect(single.errors.join(' ')).toContain('cannot contain a blocks region');
    });

    it('marks fixed region membership on sections and slots', () => {
        const { definition } = parseTemplate(SHELL_HTML, { kind: 'shell', templateMode: 'multi' });
        expect(definition.regions).toEqual([
            { regionId: 'header', kind: 'fixed-read' },
            { regionId: 'blocks-2', kind: 'blocks' },
            { regionId: 'footer', kind: 'fixed-edit' }
        ]);
        expect(definition.contentSlots[0].regionKind).toBe('fixed-edit');
    });

    it('keeps presets and defaults configured on a previous definition', () => {
        const first = parseTemplate(BLOCK_HTML, { kind: 'block' }).definition;
        first.sections[0].presets.colors = [{ id: 'red', label: 'Red', hex: '#ff0000' }];
        first.contentSlots[2].iconPresets = [{ id: 'check', label: 'Check', url: 'https://x/check.png' }];
        const second = parseTemplate(BLOCK_HTML, { kind: 'block', previous: first }).definition;
        expect(second.sections[0].presets.colors).toHaveLength(1);
        expect(second.contentSlots[2].iconPresets[0].id).toBe('check');
    });

    it('warns when hide is bound without CSS classes', () => {
        const { warnings } = parseTemplate('<div data-cc-section="container" data-cc-bind="hide"><p data-cc-content="richText" data-cc-key="t">x</p></div>');
        expect(warnings.join(' ')).toContain('.cc-hide-dsk');
    });
});

describe('legacy markers', () => {
    const LEGACY = `<table binding-container style="padding:{{blo-pad-dsk}};">
        <tr><td binding-column style="background:{{col-bg-color}}">
            <div binding-content><span data-editor="text" data-variant="legalNote" data-variant-label="Legal">{{legalNote}}</span></div>
            <img data-editor="image" src="{{imageUrl}}" />
            <a data-editor="action" href="{{primaryUrl}}">{{primaryLabel}}</a>
        </td></tr></table>
        <cc-preview region="blocks"></cc-preview>`;

    it('detects and upgrades legacy markers', () => {
        expect(hasLegacyMarkers(LEGACY)).toBe(true);
        const upgraded = upgradeLegacyHtml(LEGACY);
        expect(upgraded).toContain('data-cc-section="container"');
        expect(upgraded).toContain('data-cc-bind="padding"');
        expect(upgraded).toContain('data-cc-section="column"');
        expect(upgraded).toContain('data-cc-content="richText" data-cc-key="legalNote" data-cc-label="Legal"');
        expect(upgraded).toContain('data-cc-key="imageUrl"');
        expect(upgraded).toContain('data-cc-key="primaryLabel"');
        expect(upgraded).toContain('data-cc-region="blocks"');
        expect(upgraded).not.toContain('{{blo-pad-dsk}}');
        expect(hasLegacyMarkers(upgraded)).toBe(false);
    });

    it('parses legacy templates with a warning', () => {
        const result = parseTemplate(LEGACY.replace('<cc-preview region="blocks"></cc-preview>', ''), { kind: 'block' });
        expect(result.legacy).toBe(true);
        expect(result.warnings[0]).toContain('Legacy binding markers');
        expect(result.definition.contentSlots.map(slot => slot.type)).toEqual(['richText', 'image', 'button']);
    });
});

describe('ccTemplateSchema with parsed definitions', () => {
    it('builds a block config that mirrors the definition', () => {
        const { definition } = parseTemplate(BLOCK_HTML, { kind: 'block' });
        expect(validateDefinition(definition).errors).toEqual([]);
        const config = buildBlockConfig(definition);
        expect(config.sectionId).toBe('block');
        expect(config.rows).toHaveLength(1);
        expect(config.rows[0].rowSettings.columnDirection).toEqual({ desktop: 'ltr', mobile: 'stack' });
        expect(config.rows[0].columns.map(column => column.content.map(item => item.type))).toEqual([
            ['richText', 'richText', 'bulletList'],
            ['image', 'divider', 'button']
        ]);
        expect(config.rows[0].columns[1].content[0].desktop.light.width).toBe(300);
    });
});
