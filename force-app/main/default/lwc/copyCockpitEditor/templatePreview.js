export function renderTemplatePreview(source, blocks, device) {
    const shell = String(source?.shellHtml || '');
    if (!shell) return '';
    const templates = new Map((source.blocks || []).map(block => [block.type, block.html || '']));
    const visible = (blocks || []).filter(block => isVisibleOnDevice(block, device));
    const rendered = visible.map(block => renderBlock(block, templates.get(block.blockType) || '')).join('');
    return stripExecutableMarkup(injectBody(shell, rendered, source.bodySlotKey));
}

const PREFERS_DARK_MEDIA = /@media\s*(?:only\s+)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/gi;

/**
 * Full HTML document for a sandboxed iframe. The shell's inline styles and
 * presentational attributes must survive unchanged. Rendering that markup in
 * the editor page lets Salesforce CSS, including table { width: 100% },
 * stretch cells whose images use width: 100% beside a pixel width attribute.
 */
export function buildPreviewSrcdoc(html, options = {}) {
    const theme = options.theme === 'dark' ? 'dark' : 'light';
    let doc = previewTokens(stripExecutableMarkup(String(html || ''))).replace(/<custom\b[^>]*\/?>/gi, '');
    if (!doc.trim()) return '';
    doc = relocateMarkupBeforeHead(doc);
    doc = theme === 'dark' ? flattenPrefersColorSchemeDarkRules(doc) : stripPrefersColorSchemeDarkRules(doc);
    return injectPreviewHead(doc);
}

function relocateMarkupBeforeHead(html) {
    const match = html.match(/(<html[^>]*>\s*)([\s\S]*?)(\s*<head\b)/i);
    if (!match || !match[2].trim()) return html;
    const stray = match[2].trim();
    const doc = html.replace(match[0], `${match[1]}${match[3]}`);
    if (/<body(\b[^>]*)>/i.test(doc)) {
        return doc.replace(/<body(\b[^>]*)>/i, `<body$1>\n${stray}\n`);
    }
    return doc.replace(/<\/head>/i, `</head>\n<body>\n${stray}\n`);
}

function injectPreviewHead(html) {
    const csp = /Content-Security-Policy/i.test(html)
        ? ''
        : '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\';">';
    if (!csp) return html;
    if (/<head(\b[^>]*)>/i.test(html)) {
        return html.replace(/<head(\b[^>]*)>/i, `<head$1>\n${csp}`);
    }
    if (/<html(\b[^>]*)>/i.test(html)) {
        return html.replace(/<html(\b[^>]*)>/i, `<html$1>\n<head>\n${csp}\n</head>`);
    }
    return `<!DOCTYPE html><html><head>${csp}</head><body>${html}</body></html>`;
}

function stripPrefersColorSchemeDarkRules(html) {
    return rewritePrefersColorSchemeDarkRules(html, () => '');
}

function flattenPrefersColorSchemeDarkRules(html) {
    return rewritePrefersColorSchemeDarkRules(html, (inner) => `\n${inner.trim()}\n`);
}

function rewritePrefersColorSchemeDarkRules(html, replaceBlock) {
    let result = String(html || '');
    PREFERS_DARK_MEDIA.lastIndex = 0;
    let match = PREFERS_DARK_MEDIA.exec(result);
    while (match) {
        const block = balancedBlock(result, match.index + match[0].length - 1);
        const replacement = replaceBlock(block.inner);
        result = result.slice(0, match.index) + replacement + result.slice(block.end);
        PREFERS_DARK_MEDIA.lastIndex = match.index + replacement.length;
        match = PREFERS_DARK_MEDIA.exec(result);
    }
    PREFERS_DARK_MEDIA.lastIndex = 0;
    return result;
}

function balancedBlock(source, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                return { end: index + 1, inner: source.slice(openIndex + 1, index) };
            }
        }
    }
    return { end: source.length, inner: source.slice(openIndex + 1) };
}

function previewTokens(html) {
    const year = String(new Date().getFullYear());
    return String(html)
        .replace(/%%xtyear%%/gi, year)
        .replace(/%%view_email_url%%/gi, '#');
}

function isVisibleOnDevice(block, device) {
    if (device === 'mobile') return block.visMobile !== 'hide';
    if (device === 'desktop') return block.visDesktop !== 'hide';
    return true;
}

function renderBlock(block, template) {
    if (!template) return '';
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
    const values = {
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
    return template.replace(/\{\{([A-Za-z0-9_.:-]+)\}\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(values, name) ? values[name] : ''
    ));
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
