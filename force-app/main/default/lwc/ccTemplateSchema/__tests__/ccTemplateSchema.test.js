import {
    normalizeSpacing,
    normalizeBackground,
    normalizeSectionSettings,
    defaultContent,
    validateBlockContent,
    validateDefinition,
    migrateLegacyBlock,
    normalizeBlock,
    splitJson,
    joinJson,
    SCHEMA_VERSION
} from 'c/ccTemplateSchema';

describe('ccTemplateSchema spacing and background', () => {
    it('chains all sides to the top value and lets mobile inherit desktop', () => {
        const spacing = normalizeSpacing({ desktop: { top: 8, right: 1, chained: true }, mobile: { inheritFromDesktop: true, top: 99 } });
        expect(spacing.desktop).toEqual({ top: 8, right: 8, bottom: 8, left: 8, chained: true });
        expect(spacing.mobile).toEqual({ inheritFromDesktop: true, top: 8, right: 8, bottom: 8, left: 8, chained: true });
    });

    it('keeps independent sides and mobile overrides', () => {
        const spacing = normalizeSpacing({
            desktop: { top: 1, right: 2, bottom: 3, left: 4, chained: false },
            mobile: { inheritFromDesktop: false, top: 5, chained: true }
        });
        expect(spacing.desktop).toEqual({ top: 1, right: 2, bottom: 3, left: 4, chained: false });
        expect(spacing.mobile.top).toBe(5);
        expect(spacing.mobile.left).toBe(5);
    });

    it('drops invalid colors and falls back to desktop background image on mobile', () => {
        const background = normalizeBackground({ mode: 'image', color: 'red', image: { desktop: { url: 'https://x/a.png' } } });
        expect(background.color).toBeNull();
        expect(background.image.mobile.url).toBe('https://x/a.png');
        expect(background.image.mobile.inheritFromDesktop).toBe(true);
    });

    it('keeps unbound settings null and column direction on rows only', () => {
        const defaults = { padding: null, margin: null, background: null, visibility: {}, columnDirection: { desktop: 'ltr', mobile: 'stack' } };
        const row = normalizeSectionSettings({ columnDirection: { desktop: 'rtl', mobile: 'bogus' } }, 'row', defaults);
        expect(row.padding).toBeNull();
        expect(row.columnDirection).toEqual({ desktop: 'rtl', mobile: 'stack' });
        expect(normalizeSectionSettings({}, 'column', defaults).columnDirection).toBeUndefined();
    });
});

describe('ccTemplateSchema validation', () => {
    const definition = {
        schemaVersion: SCHEMA_VERSION,
        kind: 'block',
        sections: [{ sectionId: 'block', level: 'container', binds: ['background'], presets: { colors: [{ id: 'x', hex: 'nope' }], gradients: [] } }],
        contentSlots: [
            { bindingKey: 'cta', type: 'button', sectionId: 'block' },
            { bindingKey: 'hero', type: 'image', sectionId: 'block' },
            { bindingKey: 'list', type: 'bulletList', sectionId: 'block', iconPresets: [], allowNoIcon: false }
        ],
        regions: []
    };

    it('flags invalid presets and icon rules', () => {
        const { errors } = validateDefinition(definition);
        expect(errors).toEqual(expect.arrayContaining([
            'block: Color preset "x" is not a hex color.',
            'list: Add at least one bullet icon or allow lists without icons.'
        ]));
    });

    it('validates block content against the definition', () => {
        const button = { ...defaultContent('button', { bindingKey: 'cta' }), url: 'example.com' };
        const image = defaultContent('image', { bindingKey: 'hero' });
        const block = { blockConfig: { rows: [{ columns: [{ content: [button, image, { type: 'richText', bindingKey: 'x' }] }] }] } };
        const errors = validateBlockContent(block, definition);
        expect(errors).toEqual([
            'Row 1 / Column 1 / Button 1: Button label is required.',
            'Row 1 / Column 1 / Button 1: Web URLs must start with http:// or https://.',
            'Row 1 / Column 1 / Image 2: Desktop image is required.',
            'Row 1 / Column 1 / Rich Text 3: Rich Text is not supported by this block.'
        ]);
    });
});

describe('ccTemplateSchema legacy blocks and storage', () => {
    it('wraps flat legacy block JSON and keeps the original payload', () => {
        const block = migrateLegacyBlock('{"type":"PushContent","title":"Hi","body":"Text","imageUrl":"https://x/p.png","deepLink":"app://x"}', { order: 2 });
        expect(block.blockTemplateDefinitionName).toBe('PushContent');
        expect(block.blockOrderNumber).toBe(2);
        expect(block.legacy.deepLink).toBe('app://x');
        const content = block.blockConfig.rows[0].columns[0].content;
        expect(content.map(item => `${item.type}:${item.bindingKey}`)).toEqual(['richText:title', 'richText:body', 'image:imageUrl']);
    });

    it('passes v1 blocks through normalizeBlock', () => {
        const v1 = { blockConfig: { rows: [] }, blockOrderNumber: '3', contentTypes: ['image', 'bogus'] };
        expect(normalizeBlock(JSON.stringify(v1))).toMatchObject({ blockOrderNumber: 3, contentTypes: ['image'] });
        expect(normalizeBlock('not json')).toBeNull();
    });

    it('splits and joins JSON over two fields', () => {
        const text = 'a'.repeat(15);
        const { part1, part2 } = splitJson(text, 10);
        expect(part1).toHaveLength(10);
        expect(joinJson(part1, part2)).toBe(text);
        expect(() => splitJson('a'.repeat(21), 10)).toThrow('too large');
    });
});
