export function renderTemplatePreview(source, blocks, device) {
    const shell = String(source?.shellHtml || '');
    if (!shell) return '';
    const templates = new Map((source.blocks || []).map(block => [block.type, block.html || '']));
    const visible = (blocks || []).filter(block => isVisibleOnDevice(block, device));
    const rendered = visible.map(block => renderBlock(block, templates.get(block.blockType) || '')).join('');
    return stripExecutableMarkup(fitPreviewWidth(injectBody(shell, rendered, source.bodySlotKey)));
}

export function previewFragment(html) {
    const source = String(html || '');
    const styles = [];
    const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let match = stylePattern.exec(source);
    while (match) {
        styles.push(match[1]);
        match = stylePattern.exec(source);
    }
    const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : source;
    return `<style>${styles.join('\n')}</style>${body}`;
}

function fitPreviewWidth(html) {
    const fit = '<style>html,body{margin:0;background:#fff;}img{max-width:100%;height:auto;}table{max-width:100%!important;}</style>';
    const head = html.toLowerCase().indexOf('</head>');
    if (head >= 0) return html.slice(0, head) + fit + html.slice(head);
    return fit + html;
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
