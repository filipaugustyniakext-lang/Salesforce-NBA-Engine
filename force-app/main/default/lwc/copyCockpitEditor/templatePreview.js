import { expandContentBindings } from 'c/contentBindingModel';

export function renderTemplatePreview(source, blocks, device) {
    const shell = String(source?.shellHtml || '');
    if (!shell) return '';
    const definitions = new Map((source.blocks || []).map(block => [block.type, block]));
    const visible = (blocks || []).filter(block => isVisibleOnDevice(block, device, definitions.get(block.blockType)));
    const rendered = visible.map(block => {
        const definition = definitions.get(block.blockType);
        return renderBlock(block, definition?.html || '', definition);
    }).join('');
    return stripExecutableMarkup(applyPreviewActions(shell, rendered, visible, source?.bodySlotKey));
}

const PREVIEW_SCOPE = '.cc-preview';

export function scopePreviewDocument(html, options = {}) {
    const device = options.device === 'desktop' ? 'desktop' : 'mobile';
    const theme = options.theme === 'dark' ? 'dark' : 'light';
    const source = String(html || '').replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
    const styles = [];
    const withoutStyles = source.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
        const media = /media\s*=\s*(['"])(.*?)\1/i.exec(attrs || '');
        const sheet = media ? `@media ${media[2]} {${css}}` : css;
        styles.push(rewriteCss(sheet, device, theme));
        return '';
    });
    const bodyMatch = withoutStyles.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    const body = previewTokens(bodyMatch ? bodyMatch[1] : withoutStyles).replace(/<custom\b[^>]*\/?>/gi, '');
    // Page CSS such as `table { width: 100% }` stretches shrink-wrapped email tables,
    // so an image with width:100% ignores the pixel width on its cell.
    const guard = `${PREVIEW_SCOPE} table:not([width]):not([style*="width"]){width:max-content !important;max-width:100% !important;margin:0 auto;}`
        + (device === 'desktop'
            ? `${PREVIEW_SCOPE} .desktopHide{display:none !important;}`
            : `${PREVIEW_SCOPE} .mobileHide{display:none !important;}`);
    return `<div class="cc-preview"><style>${styles.join('\n')}\n${guard}</style>${body}</div>`;
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
    if (text.includes('prefers-color-scheme')) {
        if (text.includes('dark') && theme !== 'dark') return '';
        if (text.includes('light') && theme !== 'light') return '';
        if (text.includes('dark') || text.includes('light')) return rewriteCss(body, device, theme);
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
    const expanded = expandContentBindings(template, block?.contentValues || {});
    const bindings = Array.isArray(definition?.bindings) ? definition.bindings : null;
    const values = bindings ? boundValues(block, bindings) : legacyValues(block);
    Object.entries(block?.contentValues || {}).forEach(([name, value]) => {
        if (typeof value === 'string') values[name] = escapeHtml(value);
    });
    return expanded.replace(/\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g, (match, name) => (
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
    const structured = Object.values(block?.contentValues || {}).some(value => (
        Array.isArray(value) ? value.some(item => String(item?.value || item || '').trim()) : String(value || '').trim()
    ));
    return structured || ['copyText', 'imageUrl', 'altText', 'legalText'].some(field => String(block?.[field] || '').trim());
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
