export function renderTemplatePreview(source, blocks, device) {
    const shell = String(source?.shellHtml || '');
    if (!shell) return '';
    const templates = new Map((source.blocks || []).map(block => [block.type, block.html || '']));
    const visible = (blocks || []).filter(block => isVisibleOnDevice(block, device));
    const rendered = visible.map(block => renderBlock(block, templates.get(block.blockType) || '')).join('');
    return stripExecutableMarkup(injectBody(shell, rendered, source.bodySlotKey));
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
    return `<div class="cc-preview"><style>${styles.join('\n')}</style>${body}</div>`;
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
