const TOKEN = /<!--[\s\S]*?-->|<\/([A-Za-z0-9:_-]+)\s*>|<([A-Za-z0-9:_-]+)([^>]*?)(\/?)>/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

const BLOCK_TOKENS = {
    'blo-hide-dsk': 'hideDesktop',
    'blo-hide-mob': 'hideMobile',
    'blo-pad-dsk': 'padDesktop',
    'blo-pad-mob': 'padMobile',
    'blo-bg-color': 'bgColor',
    'blo-bg-img': 'bgImage',
    'blo-bg-grd': 'bgGradient'
};

const COLUMN_TOKENS = {
    'col-pad-dsk': 'padDesktop',
    'col-pad-mob': 'padMobile',
    'col-bg-color': 'bgColor',
    'col-bg-image': 'bgImage',
    'col-bg-gradient': 'bgGradient'
};

export const STRUCTURAL_PLACEHOLDERS = [
    ...Object.keys(BLOCK_TOKENS),
    'column-dir',
    ...Object.keys(COLUMN_TOKENS)
];

export function emptyColumnLayout() {
    return {
        padding: false,
        backgroundColor: false,
        backgroundColors: [],
        backgroundImage: false,
        backgroundGradient: false,
        gradients: []
    };
}

export function parseBlockTemplate(html) {
    const source = String(html || '');
    const columns = [];
    let container = null;
    const stack = [];
    TOKEN.lastIndex = 0;
    let match = TOKEN.exec(source);
    while (match) {
        const tokenEnd = match.index + match[0].length;
        if (!match[0].startsWith('<!--')) {
            if (match[1]) closeTag(match[1].toLowerCase(), tokenEnd, stack, columns, (frame) => {
                if (frame.role === 'container' && !container) {
                    container = { start: frame.start, end: tokenEnd };
                }
            });
            else openTag(match, stack);
        }
        match = TOKEN.exec(source);
    }
    const containerHtml = container ? source.slice(container.start, container.end) : source;
    const block = flagsFrom(containerHtml, BLOCK_TOKENS);
    return {
        hasContainer: !!container,
        usesLayout: !!container || columns.length > 0 || hasAny(block) || containerHtml.includes('{{column-dir}}') || containerHtml.includes('{{ column-dir }}'),
        columnDirection: placeholdersIn(containerHtml).includes('column-dir'),
        block,
        columns: columns.map((column, index) => ({
            index: index + 1,
            label: `Column ${index + 1}`,
            ...flagsFrom(source.slice(column.innerStart, column.innerEnd), COLUMN_TOKENS)
        }))
    };
}

export function alignLayout(layout, scan) {
    let source = layout && typeof layout === 'object' ? layout : {};
    if (typeof layout === 'string' && layout.trim()) {
        try {
            source = JSON.parse(layout);
        } catch (error) {
            source = {};
        }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};
    return {
        usesLayout: !!scan?.usesLayout,
        hideDesktop: !!source.hideDesktop,
        hideMobile: !!source.hideMobile,
        padding: !!source.padding,
        backgroundColor: !!source.backgroundColor,
        backgroundColors: cleanColors(source.backgroundColors),
        backgroundImage: !!source.backgroundImage,
        backgroundGradient: !!source.backgroundGradient,
        gradients: cleanGradients(source.gradients),
        columnDirection: !!source.columnDirection,
        columns: (scan?.columns || []).map((column, index) => ({
            ...emptyColumnLayout(),
            ...(Array.isArray(source.columns) ? source.columns[index] : {})
        })).map(column => ({
            ...emptyColumnLayout(),
            ...column,
            backgroundColors: cleanColors(column.backgroundColors),
            gradients: cleanGradients(column.gradients)
        }))
    };
}

export function layoutBindings(layout, scan) {
    const pairs = [];
    if (!layout || !scan) return pairs;
    const blockPairs = [
        ['hideDesktop', 'blo-hide-dsk', 'hideDesktop', scan.block.hideDesktop],
        ['hideMobile', 'blo-hide-mob', 'hideMobile', scan.block.hideMobile],
        ['padding', 'blo-pad-dsk', 'padDesktop', scan.block.padDesktop],
        ['padding', 'blo-pad-mob', 'padMobile', scan.block.padMobile],
        ['backgroundColor', 'blo-bg-color', 'bgColor', scan.block.bgColor],
        ['backgroundImage', 'blo-bg-img', 'bgImage', scan.block.bgImage],
        ['backgroundGradient', 'blo-bg-grd', 'bgGradient', scan.block.bgGradient],
        ['columnDirection', 'column-dir', 'columnDir', scan.columnDirection]
    ];
    blockPairs.forEach(([flag, placeholder, source, present]) => {
        if (present && layout[flag]) pairs.push({ placeholder, source });
    });
    (scan.columns || []).forEach((column, index) => {
        const options = layout.columns?.[index] || {};
        const columnPairs = [
            ['padding', 'col-pad-dsk', 'colPadDesktop', column.padDesktop],
            ['padding', 'col-pad-mob', 'colPadMobile', column.padMobile],
            ['backgroundColor', 'col-bg-color', 'colBgColor', column.bgColor],
            ['backgroundImage', 'col-bg-image', 'colBgImage', column.bgImage],
            ['backgroundGradient', 'col-bg-gradient', 'colBgGradient', column.bgGradient]
        ];
        columnPairs.forEach(([flag, placeholder, source, present]) => {
            if (present && options[flag] && !pairs.some(pair => pair.placeholder === placeholder)) {
                pairs.push({ placeholder, source });
            }
        });
    });
    return pairs;
}

export function layoutErrors(layout, scan) {
    const errors = [];
    if (!layout || !scan) return errors;
    if (layout.backgroundColor && scan.block.bgColor && !layout.backgroundColors.length) {
        errors.push('Add at least one background color hex code.');
    }
    if (layout.backgroundGradient && scan.block.bgGradient && !layout.gradients.some(item => item.css)) {
        errors.push('Add at least one background gradient.');
    }
    (scan.columns || []).forEach((column, index) => {
        const options = layout.columns?.[index] || {};
        if (options.backgroundColor && column.bgColor && !options.backgroundColors.length) {
            errors.push(`Add at least one background color for Column ${index + 1}.`);
        }
        if (options.backgroundGradient && column.bgGradient && !(options.gradients || []).some(item => item.css)) {
            errors.push(`Add at least one background gradient for Column ${index + 1}.`);
        }
    });
    return errors;
}

export function applyBlockTemplate(html, state, layoutJson) {
    const scan = parseBlockTemplate(html);
    const layout = alignLayout(layoutJson, scan);
    const runtime = state || {};
    let output = String(html || '');
    const ranges = scanColumns(output);
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
        const range = ranges[index];
        const options = layout.columns[index] || emptyColumnLayout();
        const columnState = (runtime.columns || [])[index] || {};
        const found = scan.columns[index] || {};
        const desktopPad = padString(columnState.padDesktop);
        const values = {};
        if (found.padDesktop) values['col-pad-dsk'] = options.padding ? desktopPad : '';
        if (found.padMobile) {
            values['col-pad-mob'] = options.padding
                ? (columnState.padMobileInherit === false ? padString(columnState.padMobile) : desktopPad)
                : '';
        }
        if (found.bgColor) values['col-bg-color'] = options.backgroundColor ? allowedColor(columnState.bgColor, options.backgroundColors) : '';
        if (found.bgImage) values['col-bg-image'] = options.backgroundImage ? escapeHtml(columnState.bgImage || '') : '';
        if (found.bgGradient) values['col-bg-gradient'] = options.backgroundGradient ? gradientCss(columnState.bgGradientId, options.gradients) : '';
        output = output.slice(0, range.innerStart) + replaceTokens(output.slice(range.innerStart, range.innerEnd), values) + output.slice(range.innerEnd);
    }
    const blockPad = padString(runtime.padDesktop);
    const blockValues = {};
    if (scan.block.hideDesktop) blockValues['blo-hide-dsk'] = layout.hideDesktop && runtime.hideDesktop ? 'blo-hide-dsk' : '';
    if (scan.block.hideMobile) blockValues['blo-hide-mob'] = layout.hideMobile && runtime.hideMobile ? 'blo-hide-mob' : '';
    if (scan.block.padDesktop) blockValues['blo-pad-dsk'] = layout.padding ? blockPad : '';
    if (scan.block.padMobile) {
        blockValues['blo-pad-mob'] = layout.padding
            ? (runtime.padMobileInherit === false ? padString(runtime.padMobile) : blockPad)
            : '';
    }
    if (scan.block.bgColor) blockValues['blo-bg-color'] = layout.backgroundColor ? allowedColor(runtime.bgColor, layout.backgroundColors) : '';
    if (scan.block.bgImage) blockValues['blo-bg-img'] = layout.backgroundImage ? escapeHtml(runtime.bgImage || '') : '';
    if (scan.block.bgGradient) blockValues['blo-bg-grd'] = layout.backgroundGradient ? gradientCss(runtime.bgGradientId, layout.gradients) : '';
    if (scan.columnDirection) blockValues['column-dir'] = layout.columnDirection ? (runtime.columnDirection === 'rtl' ? 'rtl' : 'ltr') : '';
    return replaceTokens(output, blockValues);
}

function openTag(match, stack) {
    const tag = match[2].toLowerCase();
    const raw = match[3] || '';
        const frame = { tag, role: '', start: match.index };
    if (hasAttribute(raw, 'binding-column')) frame.role = 'column';
    else if (hasAttribute(raw, 'binding-container')) frame.role = 'container';
    if (match[4] === '/' || VOID_TAGS.has(tag)) return;
    stack.push(frame);
}

function closeTag(tag, end, stack, columns, onClose) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag !== tag) continue;
        const frame = stack[index];
        if (frame.role === 'column') {
            columns.push({ innerStart: frame.start, innerEnd: end });
        }
        onClose(frame);
        stack.splice(index);
        return;
    }
}

function scanColumns(html) {
    const columns = [];
    const stack = [];
    const source = String(html || '');
    TOKEN.lastIndex = 0;
    let match = TOKEN.exec(source);
    while (match) {
        const tokenEnd = match.index + match[0].length;
        if (!match[0].startsWith('<!--')) {
            if (match[1]) closeTag(match[1].toLowerCase(), tokenEnd, stack, columns, () => {});
            else openTag(match, stack);
        }
        match = TOKEN.exec(source);
    }
    return columns;
}

function flagsFrom(html, tokens) {
    const found = new Set(placeholdersIn(html));
    return Object.fromEntries(Object.entries(tokens).map(([token, flag]) => [flag, found.has(token)]));
}

function hasAny(flags) {
    return Object.values(flags).some(Boolean);
}

function hasAttribute(raw, name) {
    return new RegExp('(?:^|[\\s"\'`])' + name + '(?:\\s*=|[\\s"\'`]|$)', 'i').test(raw);
}

function placeholdersIn(html) {
    const names = [];
    const pattern = /\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g;
    let match = pattern.exec(String(html || ''));
    while (match) {
        if (!names.includes(match[1])) names.push(match[1]);
        match = pattern.exec(String(html || ''));
    }
    return names;
}

function replaceTokens(html, values) {
    return String(html || '').replace(/\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g, (token, name) => (
        Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token
    ));
}

function padString(pad) {
    const side = (value) => `${Math.max(0, Number(value) || 0)}px`;
    const source = pad || {};
    return `${side(source.top)} ${side(source.right)} ${side(source.bottom)} ${side(source.left)}`;
}

function allowedColor(value, colors) {
    const color = String(value || '').trim();
    return (colors || []).some(item => item.toLowerCase() === color.toLowerCase()) ? color : '';
}

function gradientCss(id, gradients) {
    const preset = (gradients || []).find(item => item.id === id);
    return preset ? escapeHtml(preset.css || '') : '';
}

function cleanColors(values) {
    return (Array.isArray(values) ? values : [])
        .map(value => String(value || '').trim())
        .filter(value => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value));
}

function cleanGradients(values) {
    return (Array.isArray(values) ? values : []).map((item, index) => ({
        id: String(item?.id || `gradient-${index + 1}`),
        label: String(item?.label || `Gradient ${index + 1}`),
        css: String(item?.css || '')
    })).filter(item => item.label || item.css);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
