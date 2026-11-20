import { renderBlock, renderMessage, isV1Template } from 'c/ccTemplateRenderer';
import { parseTemplate } from 'c/ccTemplateParser';
import { buildBlockConfig, newMessageBlock } from 'c/ccTemplateSchema';

const BLOCK_HTML = `
<table data-cc-section="container" data-cc-bind="padding background hide">
  <tr data-cc-section="row" data-cc-id="main" data-cc-bind="column-direction">
    <td data-cc-section="column" data-cc-bind="padding hide">
      <div data-cc-content="richText" data-cc-key="note">Default</div>
      <table data-cc-content="bulletList" data-cc-key="benefits">
        <tr data-cc-loop="item"><td data-cc-slot="icon-cell"><img data-cc-slot="icon" /></td><td data-cc-slot="text">x</td></tr>
      </table>
    </td>
    <td data-cc-section="column">
      <img data-cc-content="image" data-cc-key="hero" />
      <div data-cc-content="divider" data-cc-key="divider"><hr data-cc-slot="line" /></div>
      <a data-cc-content="button" data-cc-key="cta" href="#">Label</a>
    </td>
  </tr>
</table>`;

function setup() {
    const { definition, html } = parseTemplate(BLOCK_HTML, { kind: 'block' });
    definition.sections[0].presets.gradients = [{ id: 'sun', label: 'Sun', css: 'linear-gradient(90deg, #ff0000 0%, #00ff00 100%)', fallbackColor: '#ff0000' }];
    definition.contentSlots[1].iconPresets = [{ id: 'check', label: 'Check', url: 'https://example.com/check.png' }];
    const block = newMessageBlock({ id: 'a0Y1', name: 'TextImage' }, definition, 1);
    return { definition, html, block };
}

function fragment(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
}

describe('ccTemplateRenderer.renderBlock', () => {
    it('writes section settings and content onto bound elements', () => {
        const { definition, html, block } = setup();
        const config = block.blockConfig;
        config.blockSettings.padding.desktop = { top: 10, right: 20, bottom: 30, left: 40, chained: false };
        config.blockSettings.background = { ...config.blockSettings.background, mode: 'gradient', gradientPresetId: 'sun' };
        config.rows[0].rowSettings.columnDirection = { desktop: 'rtl', mobile: 'stack' };
        const [left, right] = config.rows[0].columns;
        left.content[0].html = '<p onclick="x()">Hi <a href="javascript:alert(1)">there</a></p>';
        left.content[1].items = [{ itemId: '1', html: 'One' }, { itemId: '2', html: 'Two' }, { itemId: '3', html: '' }];
        right.content[0].desktop.light.url = 'https://example.com/hero.png';
        right.content[0].altText = 'Hero';
        right.content[1].showLine = false;
        Object.assign(right.content[2], { label: 'Open', url: 'https://example.com', behavior: 'sameTab', alias: 'cta1' });

        const out = fragment(renderBlock(html, definition, block));
        const container = out.querySelector('[data-cc-id="block"]');
        expect(container.style.padding).toBe('10px 20px 30px 40px');
        expect(container.getAttribute('bgcolor')).toBe('#ff0000');
        expect(container.getAttribute('style')).toContain('background-image: linear-gradient(90deg, #ff0000 0%, #00ff00 100%)');
        expect(container.getAttribute('style')).toContain('background-color: #ff0000');
        expect(out.querySelector('[data-cc-id="main"]').getAttribute('dir')).toBe('rtl');
        expect(out.querySelector('[data-cc-id="main"]').classList.contains('cc-stack-mob')).toBe(true);
        const note = out.querySelector('[data-cc-key="note"]');
        expect(note.innerHTML).toBe('<p>Hi <a>there</a></p>');
        const items = out.querySelectorAll('[data-cc-slot="text"]');
        expect(Array.from(items).map(item => item.textContent)).toEqual(['One', 'Two']);
        expect(out.querySelector('[data-cc-slot="icon"]').getAttribute('src')).toBe('https://example.com/check.png');
        expect(out.querySelector('img[data-cc-key="hero"]').getAttribute('src')).toBe('https://example.com/hero.png');
        expect(out.querySelector('[data-cc-slot="line"]')).toBeNull();
        const button = out.querySelector('a[data-cc-key="cta"]');
        expect(button.textContent).toBe('Open');
        expect(button.getAttribute('target')).toBe('_self');
        expect(button.getAttribute('data-alias')).toBe('cta1');
    });

    it('removes icons when the list does not use them and hides sections per device', () => {
        const { definition, html, block } = setup();
        const left = block.blockConfig.rows[0].columns[0];
        left.content[1].useIcons = false;
        left.content[1].items = [{ itemId: '1', html: 'One' }];
        left.columnSettings.visibility.hideMobile = true;
        const desktop = fragment(renderBlock(html, definition, block, { device: 'desktop' }));
        expect(desktop.querySelector('[data-cc-slot="icon-cell"]')).toBeNull();
        expect(desktop.querySelector('[data-cc-key="note"]')).not.toBeNull();
        const mobile = fragment(renderBlock(html, definition, block, { device: 'mobile' }));
        expect(mobile.querySelector('[data-cc-key="note"]')).toBeNull();
    });

    it('repeats bound elements for multiple items with the same key and drops unused ones', () => {
        const { definition, html } = setup();
        const config = buildBlockConfig(definition);
        const left = config.rows[0].columns[0];
        left.content = [
            { ...left.content[0], contentId: 'a', html: 'First' },
            { ...left.content[0], contentId: 'b', html: 'Second' }
        ];
        config.rows[0].columns[1].content = [];
        const out = fragment(renderBlock(html, definition, { blockConfig: config }));
        expect(Array.from(out.querySelectorAll('[data-cc-key="note"]')).map(node => node.textContent)).toEqual(['First', 'Second']);
        expect(out.querySelector('[data-cc-key="hero"]')).toBeNull();
        expect(out.querySelector('[data-cc-key="benefits"]')).toBeNull();
    });

    it('uses the mobile image and dark image when configured', () => {
        const { definition, html, block } = setup();
        const image = block.blockConfig.rows[0].columns[1].content[0];
        image.desktop.light.url = 'https://x/desktop.png';
        image.desktop.dark = { inheritFromLight: false, url: 'https://x/desktop-dark.png' };
        image.mobile = { inheritFromDesktop: false, light: { url: 'https://x/mobile.png' }, dark: { inheritFromLight: true } };
        const src = (device, theme) => fragment(renderBlock(html, definition, block, { device, theme }))
            .querySelector('img[data-cc-key="hero"]').getAttribute('src');
        expect(src('desktop', 'light')).toBe('https://x/desktop.png');
        expect(src('desktop', 'dark')).toBe('https://x/desktop-dark.png');
        expect(src('mobile', 'light')).toBe('https://x/mobile.png');
    });
});

describe('ccTemplateRenderer.renderMessage', () => {
    const SHELL = `<!DOCTYPE html><html><head></head><body>
        <div data-cc-region="fixed-read" data-cc-id="header">Logo</div>
        <div data-cc-region="blocks"></div>
        <div data-cc-region="fixed-edit" data-cc-id="footer"><p data-cc-content="richText" data-cc-key="footer">Default footer</p></div>
        <script>bad()</script></body></html>`;

    it('places ordered blocks into the blocks region and keeps fixed regions', () => {
        const shell = parseTemplate(SHELL, { kind: 'shell', templateMode: 'multi' });
        const { definition, html } = setup();
        const first = newMessageBlock({}, definition, 2);
        first.blockConfig.rows[0].columns[0].content[0].html = 'Second block';
        const second = newMessageBlock({}, definition, 1);
        second.blockConfig.rows[0].columns[0].content[0].html = 'First block';
        const out = renderMessage({
            shell: { html: shell.html, definition: shell.definition },
            blocks: [{ html, definition, block: first }, { html, definition, block: second }]
        });
        expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(out.indexOf('First block')).toBeLessThan(out.indexOf('Second block'));
        expect(out).toContain('Logo');
        expect(out).toContain('Default footer');
        expect(out).not.toContain('bad()');
    });

    it('shows a placeholder when no blocks were added', () => {
        const shell = parseTemplate(SHELL, { kind: 'shell', templateMode: 'multi' });
        const out = renderMessage({ shell: { html: shell.html, definition: shell.definition }, blocks: [] });
        expect(out).toContain('No content blocks yet');
    });

    it('detects v1 templates', () => {
        expect(isV1Template(SHELL)).toBe(true);
        expect(isV1Template('<div binding-container></div>')).toBe(false);
    });
});
