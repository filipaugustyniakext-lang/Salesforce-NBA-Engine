import { applyBlockTemplate } from 'c/contentBindingModel';

const CC_PREVIEW_OPEN = /<cc-preview\b([^>]*)>/gi;
const CC_PREVIEW_CLOSE = /<\/cc-preview\s*>/gi;
const EMPTY_BLOCKS_PLACEHOLDER = '<div class="cc-preview-blocks-empty" style="border:1px dashed #939393;padding:48px 24px;text-align:center;color:#444444;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;max-width:100%;box-sizing:border-box;">No content blocks yet. Start adding content blocks using the editor canvas.</div>';

export const PREVIEW_PANEL_PADDING_PX = 20;
export const PREVIEW_MOBILE_FRAME_WIDTH_PX = 288;
export const PREVIEW_MOBILE_FRAME_HEIGHT_PX = 600;
/** Browser chrome above the email canvas on desktop mockups. */
export const PREVIEW_DESKTOP_FRAME_CHROME_PX = 48;
export const PREVIEW_DESKTOP_BODY_MAX_PX = 600;

export function normalizeCcPreviewType(rawType) {
    const value = String(rawType || '').trim().toLowerCase();
    if (value === 'fixed' || value === 'fixed-read' || value === 'preview-fixed') return 'fixed-read';
    if (value === 'fixed-edit' || value === 'preview-edit') return 'fixed-edit';
    if (value === 'blocks') return 'blocks';
    return '';
}

export function renderTemplatePreview(source, blocks, device) {
    const shell = unwrapTemplateStartWrapper(String(source?.shellHtml || ''));
    if (!shell) return '';
    const definitions = new Map((source.blocks || []).map(block => [block.type, block]));
    const visible = (blocks || []).filter(block => isVisibleOnDevice(block, device, definitions.get(block.blockType)));
    const rendered = visible.map(block => {
        const definition = definitions.get(block.blockType);
        return renderBlock(block, definition?.html || '', definition);
    }).join('');
    const ccApplied = applyCcPreviewRegions(shell, rendered);
    const merged = ccApplied != null
        ? ccApplied
        : applyPreviewActions(shell, rendered, visible, source?.bodySlotKey);
    return stripExecutableMarkup(merged);
}

const PREVIEW_SCOPE = '.cc-preview';

const PREFERS_DARK_MEDIA_PATTERN =
    /@media[^{]*\(\s*prefers-color-scheme\s*:\s*dark\s*\)[^{]*\{/gi;

function extractBalancedCssBlock(source, openBraceIndex) {
    let depth = 1;
    let index = openBraceIndex + 1;
    while (index < source.length && depth > 0) {
        const char = source[index];
        if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
        index += 1;
    }
    return {
        start: openBraceIndex,
        end: index,
        inner: source.slice(openBraceIndex + 1, index - 1)
    };
}

/** Removes dark-scheme @media blocks so OS dark mode cannot override the preview toggle. */
function stripPrefersColorSchemeDarkRules(css) {
    let result = String(css ?? '');
    let match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
    while (match) {
        const braceIndex = match.index + match[0].length - 1;
        const block = extractBalancedCssBlock(result, braceIndex);
        result = result.slice(0, match.index) + result.slice(block.end);
        PREFERS_DARK_MEDIA_PATTERN.lastIndex = match.index;
        match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
    }
    PREFERS_DARK_MEDIA_PATTERN.lastIndex = 0;
    return result;
}

/** Promotes dark-scheme @media rules to unconditional CSS for forced dark preview. */
function flattenPrefersColorSchemeDarkRules(css) {
    let result = String(css ?? '');
    let match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
    while (match) {
        const braceIndex = match.index + match[0].length - 1;
        const block = extractBalancedCssBlock(result, braceIndex);
        const flattened = `\n/* cc-preview: forced dark */\n${block.inner.trim()}\n`;
        result = result.slice(0, match.index) + flattened + result.slice(block.end);
        PREFERS_DARK_MEDIA_PATTERN.lastIndex = match.index + flattened.length;
        match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
    }
    PREFERS_DARK_MEDIA_PATTERN.lastIndex = 0;
    return result;
}

function applyPreviewColorModeToCss(css, theme) {
    return theme === 'dark'
        ? flattenPrefersColorSchemeDarkRules(css)
        : stripPrefersColorSchemeDarkRules(css);
}

function previewColorModeCss(theme) {
    const s = PREVIEW_SCOPE;
    if (theme === 'dark') {
        return `${s}{color-scheme:dark only!important;background-color:#262626!important;}`;
    }
    return `${s}{color-scheme:light only!important;background-color:#ffffff!important;}`
        + `${s} .dark-mode-background{background-color:#ffffff!important;}`
        + `${s} .footer-product-text,${s} .footer-product-text p,${s} .footer-product-text li,${s} .footer-product-text a,${s} .footer-product-text span,`
        + `${s} .footer-legal-text,${s} .footer-legal-text p,${s} .footer-legal-text li,${s} .footer-legal-text a,${s} .footer-legal-text span{color:#333333!important;}`;
}

/**
 * Outlook conditional comments use nested <!-- … <![endif]--> closers.
 * A naive strip can match from `<!--[if !mso]><!-->` through the inner `<!--<![endif]-->`
 * and drop the opening <td>, leaving list text as orphan nodes outside the table.
 */
export function normalizeEmailConditionalComments(html) {
    let result = String(html || '');
    result = result.replace(/<!--\[if\s+mso[^>]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
    result = result.replace(/<!--\[if\s+!mso\]><!-->/gi, '');
    result = result.replace(/<!--<!\[endif\]-->/gi, '');
    result = result.replace(/<!--\[if\s+!IE\]><!-->/gi, '');
    result = result.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
    return result;
}

/** Shell HTML mobile rules when the preview frame is narrower than SFMC desktop (288px). */
function mobileShellPreviewCss() {
    const s = PREVIEW_SCOPE;
    return `${s}{width:100%!important;max-width:100%!important;box-sizing:border-box!important;overflow-x:hidden!important;}`
        + `${s} table.mobile-full,${s} table.mobile-full-td{width:100%!important;max-width:100%!important;box-sizing:border-box!important;}`
        + `${s} table[width="600"],${s} table[style*="width:600px"],${s} table[style*="width: 600px"]{width:100%!important;max-width:100%!important;}`
        + `${s} .padding-mobile{padding:11px 10px!important;box-sizing:border-box!important;}`
        + `${s} div[style*="max-width:600px"],${s} div[style*="max-width: 600px"]{max-width:100%!important;width:100%!important;box-sizing:border-box!important;}`
        + `${s} .padding-mobile div,${s} .padding-mobile a,${s} .padding-mobile p{word-break:break-word!important;overflow-wrap:anywhere!important;white-space:normal!important;}`
        + `${s} .desktop-img{display:none!important;max-height:0!important;overflow:hidden!important;}`
        + `${s} .mobile-img{display:block!important;width:100%!important;height:auto!important;max-height:none!important;overflow:visible!important;}`;
}

function mjColumnPreviewCss(device) {
    const columns = [
        ['mj-column-per-100', 100],
        ['mj-column-per-60', 60],
        ['mj-column-per-50', 50],
        ['mj-column-per-40', 40],
        ['mj-column-per-32', 32],
        ['mj-column-per-2', 2]
    ];
    if (device === 'mobile') {
        return columns.map(([cls]) => (
            `${PREVIEW_SCOPE} .${cls}{width:100%!important;max-width:100%!important;}`
        )).join('');
    }
    return columns.map(([cls, pct]) => (
        `${PREVIEW_SCOPE} .${cls}{width:${pct}%!important;max-width:${pct}%;}`
    )).join('');
}

export function scopePreviewDocument(html, options = {}) {
    const device = options.device === 'desktop' ? 'desktop' : 'mobile';
    const theme = options.theme === 'dark' ? 'dark' : 'light';
    const source = normalizeEmailConditionalComments(html);
    const styles = [];
    const withoutStyles = source.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
        const media = /media\s*=\s*(['"])(.*?)\1/i.exec(attrs || '');
        const sheet = media ? `@media ${media[2]} {${css}}` : css;
        styles.push(rewriteCss(applyPreviewColorModeToCss(sheet, theme), device, theme));
        return '';
    });
    const bodyMatch = withoutStyles.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    const body = previewTokens(bodyMatch ? bodyMatch[1] : withoutStyles).replace(/<custom\b[^>]*\/?>/gi, '');
    // Shrink-wrap only presentation tables (e.g. image wrappers), not MJML bullet/list tables.
    const guard = `${PREVIEW_SCOPE} table[role="presentation"]:not([width]):not([style*="width"]){width:max-content !important;max-width:100% !important;margin:0 auto;}`
        + mjColumnPreviewCss(device)
        + (device === 'desktop'
            ? `${PREVIEW_SCOPE} .desktopHide{display:none !important;}`
            : `${PREVIEW_SCOPE} .mobileHide{display:none !important;}`)
        + (device === 'mobile'
            ? mobileShellPreviewCss()
                + `${PREVIEW_SCOPE} td[style*="direction: rtl"],${PREVIEW_SCOPE} td[style*="direction:rtl"]{direction:ltr!important;text-align:center!important;}`
            : '')
        + previewColorModeCss(theme);
    return `<div class="cc-preview cc-preview--theme-${theme}"><style>${styles.join('\n')}\n${guard}</style>${body}</div>`;
}

function previewTokens(html) {
    const year = String(new Date().getFullYear());
    return String(html)
        .replace(/%%xtyear%%/gi, year)
        .replace(/%%view_email_url%%/gi, '#');
}

function rewriteCss(css, device, theme) {
    const source = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
    let result = '';
    let index = 0;
    while (index < source.length) {
        while (index < source.length && /\s/.test(source[index])) index += 1;
        if (index >= source.length) break;
        if (source.startsWith('@media', index)) {
            const open = source.indexOf('{', index);
            const close = matchingBrace(source, open);
            const condition = source.slice(index, open).trim();
            const body = source.slice(open + 1, close);
            result += rewriteMedia(condition, body, device, theme);
            index = close + 1;
            continue;
        }
        if (source[index] === '@') {
            const open = source.indexOf('{', index);
            const close = matchingBrace(source, open);
            result += source.slice(index, close + 1);
            index = close + 1;
            continue;
        }
        const open = source.indexOf('{', index);
        if (open < 0) break;
        const close = matchingBrace(source, open);
        const selector = source.slice(index, open).trim();
        if (selector) result += `${scopeSelectorList(selector)} ${source.slice(open, close + 1)}`;
        index = close + 1;
    }
    return result;
}

function rewriteMedia(condition, body, device, theme) {
    const text = condition.toLowerCase();
    const prefersDark = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.test(text);
    const prefersLight = /\(\s*prefers-color-scheme\s*:\s*light\s*\)/.test(text);
    if (prefersDark || prefersLight) {
        if (prefersDark && theme !== 'dark') return '';
        if (prefersLight && theme !== 'light') return '';
        return rewriteCss(body, device, theme);
    }
    const maxWidth = /max-width\s*:\s*(\d+)/.exec(text);
    const minWidth = /min-width\s*:\s*(\d+)/.exec(text);
    if (maxWidth && !minWidth) {
        return device === 'mobile' ? rewriteCss(body, device, theme) : '';
    }
    if (minWidth && !maxWidth) {
        return device === 'desktop' ? rewriteCss(body, device, theme) : '';
    }
    return `${condition}{${rewriteCss(body, device, theme)}}`;
}

function scopeSelectorList(selector) {
    return selector.split(',').map(part => {
        let rule = part.trim().replace(/\bhtml\b/gi, PREVIEW_SCOPE).replace(/\bbody\b/gi, PREVIEW_SCOPE).replace(/:root\b/gi, PREVIEW_SCOPE);
        if (!rule) return '';
        if (
            rule === PREVIEW_SCOPE
            || rule.startsWith(PREVIEW_SCOPE + ' ')
            || rule.startsWith(PREVIEW_SCOPE + '>')
            || rule.startsWith(PREVIEW_SCOPE + '.')
            || rule.startsWith(PREVIEW_SCOPE + ':')
            || rule.startsWith(PREVIEW_SCOPE + '[')
            || rule.startsWith(PREVIEW_SCOPE + '#')
        ) {
            return rule;
        }
        return `${PREVIEW_SCOPE} ${rule}`;
    }).filter(Boolean).join(', ');
}

function matchingBrace(source, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return source.length - 1;
}

function isVisibleOnDevice(block, device, definition) {
    const source = device === 'mobile' ? 'viewMobile' : device === 'desktop' ? 'viewDesktop' : '';
    if (!source) return true;
    const bindings = Array.isArray(definition?.bindings) ? definition.bindings : null;
    if (bindings && bindings.some(item => item?.source === source)) return true;
    const settings = Array.isArray(definition?.blockSettings) ? definition.blockSettings : null;
    if (settings && !settings.includes(source)) return true;
    if (device === 'mobile') return block.visMobile !== 'hide';
    if (device === 'desktop') return block.visDesktop !== 'hide';
    return true;
}

function renderBlock(block, template, definition) {
    if (!template) return '';
    const prepared = applyBlockTemplate(template, block?.layoutState, definition?.layoutJson);
    const bindings = Array.isArray(definition?.bindings) ? definition.bindings : null;
    const blockSettings = Array.isArray(definition?.blockSettings) ? definition.blockSettings : null;
    if ((!bindings || bindings.length === 0) && (!blockSettings || blockSettings.length === 0)) {
        return prepared;
    }
    const values = bindings?.length ? boundValues(block, bindings) : legacyValues(block);
    return prepared.replace(/\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(values, name) ? values[name] : ''
    ));
}

function boundValues(block, bindings) {
    const values = {};
    bindings.forEach(binding => {
        const name = String(binding?.placeholder || '').replace(/[{}]/g, '').trim();
        if (name) values[name] = bindingOutput(binding.source, block);
    });
    return values;
}

function bindingOutput(source, block) {
    const padding = `${number(block.padTop, 0)}px ${number(block.padRight, 0)}px ${number(block.padBottom, 0)}px ${number(block.padLeft, 0)}px`;
    if (source === 'copy') return richText(block.copyText || '');
    if (source === 'imageUrl') return safeUrl(block.imageUrl);
    if (source === 'altText') return escapeHtml(block.altText || '');
    if (source === 'legal') return richText(block.legalText || '');
    if (source === 'viewDesktop') return block.visDesktop === 'hide' ? 'desktopHide' : '';
    if (source === 'viewMobile') return block.visMobile === 'hide' ? 'mobileHide' : '';
    if (source === 'padding') return padding;
    if (source === 'background') return escapeHtml(block.bgValue || '');
    if (source === 'columnLayout') return block.imageLayout === 'image-left' ? 'rtl' : 'ltr';
    if (source === 'heightDesktop') return pixelValue(block.heightDesktop);
    if (source === 'heightMobile') return pixelValue(block.heightMobile);
    return '';
}

function legacyValues(block) {
    const padding = `${number(block.padTop, 20)}px ${number(block.padRight, 40)}px ${number(block.padBottom, 20)}px ${number(block.padLeft, 40)}px`;
    const text = richText(block.copyText || block.label || '');
    const legal = richText(block.legalText || '');
    const alt = escapeHtml(block.altText || '');
    const image = safeUrl(block.imageUrl);
    const imageHtml = image
        ? `<img src="${image}" alt="${alt}" style="display:block;max-width:100%;height:auto;border:0;">`
        : '';
    const textColumn = `<div class="mj-column-per-50 mj-outlook-group-fix" style="font-size:0;display:inline-block;vertical-align:top;width:50%;"><table role="presentation" width="100%"><tr><td style="font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#262626;">${text}</td></tr></table></div>`;
    const imageColumn = `<div class="mj-column-per-50 mj-outlook-group-fix" style="font-size:0;display:inline-block;vertical-align:top;width:50%;"><table role="presentation" width="100%"><tr><td>${imageHtml}</td></tr></table></div>`;
    const columns = block.imageLayout === 'image-left'
        ? imageColumn + textColumn
        : textColumn + imageColumn;
    return {
        CELL_PADDING_STYLE: `padding:${padding};`,
        CELL_ALIGN: block.imageLayout === 'image-left' ? 'left' : 'center',
        RICH_TEXT_ROWS: `<tr><td style="font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#262626;">${text}</td></tr>`,
        DESKTOP_IMAGE_HTML: imageHtml,
        MOBILE_IMAGE_HTML: imageHtml,
        COLUMNS_HTML: columns,
        PREFOOTER_PRODUCT_HTML: text,
        PREFOOTER_LEGAL_HTML: legal,
        DESKTOP_SPACER_HTML: `<div style="height:${number(block.spacerHeight, 20)}px;line-height:${number(block.spacerHeight, 20)}px;">&nbsp;</div>`,
        MOBILE_SPACER_HTML: `<div style="height:${number(block.spacerHeight, 20)}px;line-height:${number(block.spacerHeight, 20)}px;">&nbsp;</div>`,
        VML_HEIGHT: '240',
        VML_FILL_SRC: image,
        VML_TEXTBOX_INSET: '20px,20px,20px,20px',
        BG_IMAGE_URL: image,
        MOBILE_BG_CLASS: '',
        INNER_CELL_PADDING: `padding:${padding};`,
        MSO_FIRST_COLUMN_OPEN: ''
    };
}

function pixelValue(value) {
    if (value === '' || value == null) return '';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed}px` : '';
}

const PREVIEW_ACTION = /<div\b[^>]*\bdata-preview-action\s*=\s*(['"])(preload|expectBlocks|expectContent)\1[^>]*>/gi;

const CC_PREVIEW_TOKEN = /<cc-preview\b([^>]*)>|<\/cc-preview\s*>/gi;

function findCcPreviewRegions(html) {
    const regions = [];
    const source = String(html || '');
    const stack = [];
    CC_PREVIEW_TOKEN.lastIndex = 0;
    let match = CC_PREVIEW_TOKEN.exec(source);
    while (match) {
        if (match[0].startsWith('</')) {
            const open = stack.pop();
            if (!open) {
                match = CC_PREVIEW_TOKEN.exec(source);
                continue;
            }
            regions.push({
                type: open.type,
                attrs: open.attrs,
                dataAction: open.dataAction,
                openStart: open.openStart,
                openEnd: open.openEnd,
                closeStart: match.index,
                closeEnd: match.index + match[0].length,
                innerHtml: source.slice(open.openEnd, match.index)
            });
        } else {
            const attrs = match[1];
            stack.push({
                attrs,
                type: normalizeCcPreviewType(parseCcPreviewRegionAttr(attrs)),
                dataAction: parseCcPreviewDataAction(attrs),
                openStart: match.index,
                openEnd: match.index + match[0].length
            });
        }
        match = CC_PREVIEW_TOKEN.exec(source);
    }
    CC_PREVIEW_TOKEN.lastIndex = 0;
    return regions;
}

/** Region type labels in document order (excludes template-start wrapper). */
export function scanCcPreviewRegionLabelsInOrder(html) {
    return findCcPreviewRegions(html)
        .filter(region => region.dataAction !== 'template-start' && region.type)
        .map(region => region.type);
}

function parseCcPreviewAttr(attrs, name) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(['"])([^'"]+)\\1`, 'i');
    const match = pattern.exec(String(attrs || ''));
    return match ? match[2] : '';
}

export function parseCcPreviewDataAction(attrs) {
    return parseCcPreviewAttr(attrs, 'data-action').trim().toLowerCase();
}

function clampPreviewDimension(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

/** Reads desktop-width / mobile-width from the template-start cc-preview wrapper. */
export function parsePreviewLayoutFromShell(shellHtml) {
    const fallback = {
        desktopWidth: PREVIEW_DESKTOP_BODY_MAX_PX,
        mobileWidth: PREVIEW_MOBILE_FRAME_WIDTH_PX
    };
    const regions = findCcPreviewRegions(String(shellHtml || ''));
    const wrapper = regions.find(region => region.dataAction === 'template-start');
    if (!wrapper) return fallback;
    return {
        desktopWidth: clampPreviewDimension(
            parseCcPreviewAttr(wrapper.attrs, 'desktop-width'),
            320,
            PREVIEW_DESKTOP_BODY_MAX_PX,
            PREVIEW_DESKTOP_BODY_MAX_PX
        ),
        mobileWidth: clampPreviewDimension(
            parseCcPreviewAttr(wrapper.attrs, 'mobile-width'),
            240,
            400,
            PREVIEW_MOBILE_FRAME_WIDTH_PX
        )
    };
}

export function previewFrameWidthPx(device, layout) {
    const config = layout || {
        desktopWidth: PREVIEW_DESKTOP_BODY_MAX_PX,
        mobileWidth: PREVIEW_MOBILE_FRAME_WIDTH_PX
    };
    if (device === 'mobile') return PREVIEW_MOBILE_FRAME_WIDTH_PX;
    const chrome = PREVIEW_DESKTOP_FRAME_CHROME_PX;
    return Math.min(config.desktopWidth + chrome, PREVIEW_DESKTOP_BODY_MAX_PX + chrome);
}

export function previewPanelWidthPx(device, layout) {
    return previewFrameWidthPx(device, layout) + (PREVIEW_PANEL_PADDING_PX * 2);
}

function unwrapTemplateStartWrapper(shell) {
    const source = String(shell || '');
    if (!source) return '';
    const regions = findCcPreviewRegions(source);
    const wrapper = regions.find(region => region.dataAction === 'template-start');
    if (!wrapper) return source;
    return source.slice(0, wrapper.openStart) + wrapper.innerHtml + source.slice(wrapper.closeEnd);
}

/** Reads region kind from `region` (preferred) or legacy `type`. */
function parseCcPreviewRegionAttr(attrs) {
    const value = parseCcPreviewAttr(attrs, 'region') || parseCcPreviewAttr(attrs, 'type');
    return value;
}

function applyCcPreviewRegions(shell, blockHtml) {
    const regions = findCcPreviewRegions(shell);
    if (!regions.length) return null;
    let html = shell;
    const ordered = regions.slice().sort((left, right) => right.openStart - left.openStart);
    let blocksPlaced = false;
    ordered.forEach(region => {
        if (region.dataAction === 'template-start') return;
        let inner = region.innerHtml;
        if (region.type === 'blocks') {
            const trimmed = String(blockHtml || '').trim();
            inner = blocksPlaced ? '' : (trimmed || EMPTY_BLOCKS_PLACEHOLDER);
            blocksPlaced = true;
        } else if (region.type === 'fixed-read' || region.type === 'fixed-edit') {
            inner = region.innerHtml;
        }
        html = html.slice(0, region.openStart) + inner + html.slice(region.closeEnd);
    });
    return html;
}

function applyPreviewActions(shell, blockHtml, blocks, slotKey) {
    const regions = findPreviewRegions(shell);
    if (!regions.length) return injectBody(shell, blockHtml, slotKey);
    const hasExpectBlocks = regions.some(region => region.action === 'expectBlocks');
    const customized = (blocks || []).some(block => hasCustomContent(block));
    let html = shell;
    let blocksPlaced = false;
    const ordered = regions.slice().sort((left, right) => right.openStart - left.openStart);
    ordered.forEach(region => {
        if (region.action === 'preload') return;
        if (region.action === 'expectBlocks') {
            const inner = blocksPlaced ? '' : blockHtml;
            blocksPlaced = true;
            html = replaceRegionInner(html, region, inner);
            return;
        }
        if (region.action === 'expectContent' && !hasExpectBlocks && customized && region === regions.find(item => item.action === 'expectContent')) {
            const template = html.slice(region.openEnd, region.closeStart);
            const filled = (blocks || []).map(block => fillExpectContent(template, block)).join('');
            html = replaceRegionInner(html, region, filled);
        }
    });
    return html;
}

function findPreviewRegions(html) {
    const regions = [];
    PREVIEW_ACTION.lastIndex = 0;
    let match = PREVIEW_ACTION.exec(html);
    while (match) {
        const openEnd = match.index + match[0].length;
        const closeStart = matchingDivClose(html, openEnd);
        if (closeStart >= 0) {
            regions.push({
                action: match[2],
                openStart: match.index,
                openEnd,
                closeStart
            });
        }
        match = PREVIEW_ACTION.exec(html);
    }
    PREVIEW_ACTION.lastIndex = 0;
    return regions;
}

function matchingDivClose(html, from) {
    let depth = 1;
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = from;
    let match = tags.exec(html);
    while (match) {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (depth === 0) return match.index;
        match = tags.exec(html);
    }
    return -1;
}

function replaceRegionInner(html, region, inner) {
    return html.slice(0, region.openEnd) + inner + html.slice(region.closeStart);
}

function hasCustomContent(block) {
    return ['copyText', 'imageUrl', 'altText', 'legalText'].some(field => String(block?.[field] || '').trim());
}

function fillExpectContent(template, block) {
    let html = /\{\{[A-Za-z0-9_.:-]+\}\}/.test(template) ? renderBlock(block, template) : template;
    const copy = richText(block.copyText || '');
    const legal = richText(block.legalText || '');
    const image = safeUrl(block.imageUrl);
    const alt = escapeHtml(block.altText || '');
    if (copy && /data-preview-field\s*=\s*(['"])copy\1/i.test(html)) {
        html = replacePreviewField(html, 'copy', copy);
    } else if (copy && !/\{\{RICH_TEXT_ROWS\}\}/.test(template)) {
        html = html.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/i, `$1${copy}$3`);
    }
    if (legal && /data-preview-field\s*=\s*(['"])legal\1/i.test(html)) {
        html = replacePreviewField(html, 'legal', legal);
    }
    if (image && /data-preview-field\s*=\s*(['"])image\1/i.test(html)) {
        html = html.replace(/<img\b[^>]*data-preview-field\s*=\s*(['"])image\1[^>]*>/i, (tag) => {
            let next = /\ssrc\s*=/i.test(tag)
                ? tag.replace(/\ssrc\s*=\s*(['"])[^'"]*\1/i, ` src="${image}"`)
                : tag.replace(/<img\b/i, `<img src="${image}"`);
            if (alt) {
                next = /\salt\s*=/i.test(next)
                    ? next.replace(/\salt\s*=\s*(['"])[^'"]*\1/i, ` alt="${alt}"`)
                    : next.replace(/<img\b/i, `<img alt="${alt}"`);
            }
            return next;
        });
    }
    return html;
}

function replacePreviewField(html, field, value) {
    const pattern = new RegExp(
        `(data-preview-field\\s*=\\s*(['"])${field}\\2[^>]*>)([\\s\\S]*?)(</)`,
        'i'
    );
    return html.replace(pattern, `$1${value}$4`);
}

function injectBody(shell, content, slotKey) {
    if (shell.includes('{{CONTENT}}')) return shell.replace('{{CONTENT}}', content);
    const key = slotKey || '49fwfqshzd9';
    const marker = `data-key="${key}"`;
    const markerAt = shell.indexOf(marker);
    if (markerAt < 0) return `${shell}${content}`;
    const openEnd = shell.indexOf('>', markerAt);
    const closeAt = shell.indexOf('</div>', openEnd);
    if (openEnd < 0 || closeAt < 0) return `${shell}${content}`;
    return `${shell.slice(0, openEnd + 1)}${content}${shell.slice(closeAt)}`;
}

function stripExecutableMarkup(html) {
    return String(html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
        .replace(/javascript\s*:/gi, '');
}

function richText(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeUrl(value) {
    const url = String(value || '').trim();
    return /^https:\/\//i.test(url) ? escapeHtml(url) : '';
}

function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function emptyPreviewLayoutState() {
    return {
        hideDesktop: false,
        hideMobile: false,
        padDesktop: { top: '0', right: '0', bottom: '0', left: '0' },
        padMobile: { top: '0', right: '0', bottom: '0', left: '0' },
        padMobileInherit: true,
        bgColor: '',
        bgImage: '',
        bgGradientId: '',
        columnDirection: 'ltr',
        columns: []
    };
}

function normalizeStudioBlockLookupKey(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    const base = text.replace(/^.*[/\\]/, '');
    return base.endsWith('.html') ? base.slice(0, -5) : base;
}

function studioPreviewCatalog(renderSource) {
    const studio = renderSource?.studioBlocks;
    if (Array.isArray(studio) && studio.length) return studio;
    return renderSource?.blocks || [];
}

/** Template Studio: one focused block in the shell (upload, summary tile, or edit form). */
export function buildStudioPreviewBlocks(renderSource, blockKey) {
    const lookup = normalizeStudioBlockLookupKey(blockKey);
    if (!lookup) return [];
    const catalog = studioPreviewCatalog(renderSource).filter(block => block.html);
    const def = catalog.find(block => {
        const typeKey = normalizeStudioBlockLookupKey(block.type);
        const fileKey = normalizeStudioBlockLookupKey(block.fileName);
        const fileFull = String(block.fileName || '').trim().toLowerCase();
        return typeKey === lookup
            || fileKey === lookup
            || fileFull === lookup
            || fileFull === `${lookup}.html`;
    });
    if (!def) return [];
    const blockType = def.type || def.fileName;
    return [{
        instanceId: 'studio_focus_0',
        blockType,
        blockOrder: 0,
        visDesktop: 'show',
        visMobile: 'show',
        padTop: '0',
        padRight: '0',
        padBottom: '0',
        padLeft: '0',
        copyText: '',
        imageUrl: '',
        altText: '',
        legalText: '',
        imageLayout: 'text-left',
        heightDesktop: '',
        heightMobile: '',
        spacerHeight: '0',
        bgValue: '',
        layoutState: emptyPreviewLayoutState()
    }];
}

/** Studio block step: render uploaded block HTML inside the shell without sample copy. */
export function buildCatalogPreviewBlocks(renderSource) {
    const catalog = (renderSource?.blocks || []).filter(block => block.html);
    return catalog.map((def, index) => ({
        instanceId: `studio_catalog_${index}`,
        blockType: def.type,
        blockOrder: index,
        visDesktop: 'show',
        visMobile: 'show',
        padTop: '0',
        padRight: '0',
        padBottom: '0',
        padLeft: '0',
        copyText: '',
        imageUrl: '',
        altText: '',
        legalText: '',
        imageLayout: 'text-left',
        heightDesktop: '',
        heightMobile: '',
        spacerHeight: '0',
        bgValue: '',
        layoutState: emptyPreviewLayoutState()
    }));
}

/** Sample canvas blocks for dictionary template preview (same shape as Copy Center editor). */
export function buildSamplePreviewBlocks(renderSource) {
    const catalog = (renderSource?.blocks || []).filter(block => block.html);
    if (!catalog.length) return [];
    return catalog.slice(0, 8).map((def, index) => ({
        instanceId: `preview_sample_${index}`,
        blockType: def.type,
        blockOrder: index,
        visDesktop: 'show',
        visMobile: 'show',
        padTop: '20',
        padRight: '40',
        padBottom: '20',
        padLeft: '40',
        copyText: `Sample copy — ${def.label || def.type}. This preview uses the same render path as Copy Center.`,
        imageUrl: 'https://www.lightningdesignsystem.com/assets/images/carousel/carousel-01.jpg',
        altText: 'Sample image alt text',
        legalText: 'Sample legal disclaimer text.',
        imageLayout: 'text-left',
        heightDesktop: '',
        heightMobile: '',
        spacerHeight: '32',
        bgValue: '',
        layoutState: emptyPreviewLayoutState()
    }));
}

export function pinPreviewWidths(root, options = {}) {
    if (!root) return;
    const mobile = options.device === 'mobile';
    root.querySelectorAll('table[width], td[width], th[width]').forEach(el => {
        if (mobile) {
            const table = el.tagName === 'TABLE' ? el : el.closest('table');
            if (table?.classList?.contains('mobile-full')) {
                return;
            }
            const tableWidth = table?.getAttribute('width');
            if (tableWidth === '600' || tableWidth === 600) {
                return;
            }
        }
        if (el.style.width) return;
        const raw = String(el.getAttribute('width') || '').trim();
        if (/^\d+$/.test(raw)) el.style.width = `${raw}px`;
        else if (/^\d+%$/.test(raw)) el.style.width = raw;
    });
}