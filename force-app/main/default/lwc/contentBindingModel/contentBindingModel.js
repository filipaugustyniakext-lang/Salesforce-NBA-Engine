const TOKEN = /<!--[\s\S]*?-->|<\/([A-Za-z0-9:_-]+)\s*>|<([A-Za-z0-9:_-]+)([^>]*?)(\/?)>/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

const BLOCK_TOKENS = {
    'container-hide-dsk': 'hideDesktop',
    'blo-hide-dsk': 'hideDesktop',
    'container-hide-mob': 'hideMobile',
    'blo-hide-mob': 'hideMobile',
    'container-pad-dsk': 'padDesktop',
    'blo-pad-dsk': 'padDesktop',
    'container-pad-mob': 'padMobile',
    'blo-pad-mob': 'padMobile',
    'container-bg': 'background',
    'blo-bg-color': 'bgColor',
    'blo-bg-img': 'bgImage',
    'blo-bg-grd': 'bgGradient'
};

const COLUMN_TOKENS = {
    'column-hide-dsk': 'hideDesktop',
    'column-hide-mob': 'hideMobile',
    'column-pad-dsk': 'padDesktop',
    'col-pad-dsk': 'padDesktop',
    'column-pad-mob': 'padMobile',
    'col-pad-mob': 'padMobile',
    'column-bg': 'background',
    'col-bg-color': 'bgColor',
    'col-bg-image': 'bgImage',
    'col-bg-gradient': 'bgGradient'
};

const CONTENT_TOKENS = {
    'content-hide-dsk': 'hideDesktop',
    'content-hide-mob': 'hideMobile',
    'content-pad-dsk': 'padDesktop',
    'content-pad-mob': 'padMobile',
    'content-bg': 'background'
};

const CONTAINER_PLACEHOLDERS = new Set(['column-dir', ...Object.keys(BLOCK_TOKENS)]);
const COLUMN_PLACEHOLDERS = new Set(Object.keys(COLUMN_TOKENS));
const CONTENT_PLACEHOLDERS = new Set(Object.keys(CONTENT_TOKENS));

export const STRUCTURAL_PLACEHOLDERS = [
    ...CONTAINER_PLACEHOLDERS,
    ...COLUMN_PLACEHOLDERS,
    ...CONTENT_PLACEHOLDERS
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
    const regions = scanRegions(source);
    const containerHtml = regions.container ? source.slice(regions.container.start, regions.container.end) : source;
    const blockNames = placeholdersIn(containerHtml).filter(name => CONTAINER_PLACEHOLDERS.has(name));
    const block = flagsFromNames(blockNames, BLOCK_TOKENS);
    return {
        hasContainer: !!regions.container,
        usesLayout: !!regions.container || regions.columns.length > 0 || hasAny(block) || blockNames.includes('column-dir'),
        columnDirection: blockNames.includes('column-dir'),
        block: { ...block, placeholders: blockNames },
        columns: regions.columns.map((column, index) => {
            const columnHtml = source.slice(column.innerStart, column.innerEnd);
            const columnNames = placeholdersIn(columnHtml).filter(name => COLUMN_PLACEHOLDERS.has(name));
            return {
                index: index + 1,
                label: `Column ${index + 1}`,
                ...flagsFromNames(columnNames, COLUMN_TOKENS),
                placeholders: columnNames,
                contents: (column.contents || []).map((content, contentIndex) => {
                    const contentHtml = source.slice(content.innerStart, content.innerEnd);
                    const contentNames = placeholdersIn(contentHtml).filter(name => CONTENT_PLACEHOLDERS.has(name));
                    return {
                        index: contentIndex + 1,
                        label: `Content ${contentIndex + 1}`,
                        ...flagsFromNames(contentNames, CONTENT_TOKENS),
                        placeholders: contentNames
                    };
                })
            };
        })
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
        background: !!source.background,
        columns: (scan?.columns || []).map((column, index) => {
            const saved = Array.isArray(source.columns) ? source.columns[index] || {} : {};
            return {
                ...emptyColumnLayout(),
                ...saved,
                background: !!saved.background,
                hideDesktop: !!saved.hideDesktop,
                hideMobile: !!saved.hideMobile,
                backgroundColors: cleanColors(saved.backgroundColors),
                gradients: cleanGradients(saved.gradients),
                contents: (column.contents || []).map((content, contentIndex) => {
                    const savedContent = (saved.contents || [])[contentIndex] || {};
                    return {
                        padding: !!savedContent.padding,
                        background: !!savedContent.background,
                        hideDesktop: !!savedContent.hideDesktop,
                        hideMobile: !!savedContent.hideMobile,
                        backgroundColor: !!savedContent.backgroundColor,
                        backgroundColors: cleanColors(savedContent.backgroundColors),
                        backgroundImage: !!savedContent.backgroundImage,
                        backgroundGradient: !!savedContent.backgroundGradient,
                        gradients: cleanGradients(savedContent.gradients)
                    };
                })
            };
        })
    };
}

function pushLayoutPair(pairs, names, candidates, source, enabled) {
    const placeholder = (candidates || []).find(name => (names || []).includes(name));
    if (!placeholder || !enabled || pairs.some(pair => pair.placeholder === placeholder)) return;
    pairs.push({ placeholder, source });
}

export function layoutBindings(layout, scan) {
    const pairs = [];
    if (!layout || !scan) return pairs;
    const blockNames = scan.block?.placeholders || [];
    pushLayoutPair(pairs, blockNames, ['container-hide-dsk', 'blo-hide-dsk'], 'hideDesktop', layout.hideDesktop);
    pushLayoutPair(pairs, blockNames, ['container-hide-mob', 'blo-hide-mob'], 'hideMobile', layout.hideMobile);
    pushLayoutPair(pairs, blockNames, ['container-pad-dsk', 'blo-pad-dsk'], 'padDesktop', layout.padding);
    pushLayoutPair(pairs, blockNames, ['container-pad-mob', 'blo-pad-mob'], 'padMobile', layout.padding);
    pushLayoutPair(pairs, blockNames, ['container-bg'], 'background', layout.background);
    pushLayoutPair(pairs, blockNames, ['blo-bg-color'], 'bgColor', layout.backgroundColor);
    pushLayoutPair(pairs, blockNames, ['blo-bg-img'], 'bgImage', layout.backgroundImage);
    pushLayoutPair(pairs, blockNames, ['blo-bg-grd'], 'bgGradient', layout.backgroundGradient);
    pushLayoutPair(pairs, blockNames, ['column-dir'], 'columnDir', layout.columnDirection);
    (scan.columns || []).forEach((column, index) => {
        const options = layout.columns?.[index] || {};
        const names = column.placeholders || [];
        pushLayoutPair(pairs, names, ['column-hide-dsk'], 'hideDesktop', options.hideDesktop);
        pushLayoutPair(pairs, names, ['column-hide-mob'], 'hideMobile', options.hideMobile);
        pushLayoutPair(pairs, names, ['column-pad-dsk', 'col-pad-dsk'], 'colPadDesktop', options.padding);
        pushLayoutPair(pairs, names, ['column-pad-mob', 'col-pad-mob'], 'colPadMobile', options.padding);
        pushLayoutPair(pairs, names, ['column-bg'], 'background', options.background);
        pushLayoutPair(pairs, names, ['col-bg-color'], 'colBgColor', options.backgroundColor);
        pushLayoutPair(pairs, names, ['col-bg-image'], 'colBgImage', options.backgroundImage);
        pushLayoutPair(pairs, names, ['col-bg-gradient'], 'colBgGradient', options.backgroundGradient);
        (column.contents || []).forEach((content, contentIndex) => {
            const contentOptions = options.contents?.[contentIndex] || {};
            const contentNames = content.placeholders || [];
            pushLayoutPair(pairs, contentNames, ['content-hide-dsk'], 'hideDesktop', contentOptions.hideDesktop);
            pushLayoutPair(pairs, contentNames, ['content-hide-mob'], 'hideMobile', contentOptions.hideMobile);
            pushLayoutPair(pairs, contentNames, ['content-pad-dsk'], 'padDesktop', contentOptions.padding);
            pushLayoutPair(pairs, contentNames, ['content-pad-mob'], 'padMobile', contentOptions.padding);
            pushLayoutPair(pairs, contentNames, ['content-bg'], 'background', contentOptions.background);
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
    const runtime = state || {};
    let output = String(html || '');
    const regions = scanRegions(output);
    const scan = parseBlockTemplate(output);
    const layout = alignLayout(layoutJson, scan);
    const jobs = [];
    regions.columns.forEach((column, index) => {
        (column.contents || []).forEach((content, contentIndex) => {
            jobs.push({
                start: content.innerStart,
                end: content.innerEnd,
                kind: 'content',
                index,
                contentIndex
            });
        });
        jobs.push({ start: column.innerStart, end: column.innerEnd, kind: 'column', index });
    });
    jobs.sort((left, right) => right.start - left.start);
    jobs.forEach((job, jobIndex) => {
        const slice = output.slice(job.start, job.end);
        const next = job.kind === 'content'
            ? applyContentSlice(slice, layout, runtime, scan, job.index, job.contentIndex)
            : applyColumnSlice(slice, layout, runtime, scan, job.index);
        const delta = next.length - (job.end - job.start);
        output = output.slice(0, job.start) + next + output.slice(job.end);
        if (!delta) return;
        for (let later = jobIndex + 1; later < jobs.length; later += 1) {
            if (jobs[later].end > job.start) jobs[later].end += delta;
            if (jobs[later].start > job.start) jobs[later].start += delta;
        }
    });
    return applyContainerSlice(output, layout, runtime, scan);
}

export function buildBackgroundPayload(region, hints) {
    const source = region || {};
    const options = hints || {};
    const mode = options.mode || source.defaultBgMode || 'color';
    if (mode === 'gradient') {
        const preset = (source.gradients || []).find(item => item.id === options.gradientId)
            || (source.gradients || [])[0];
        if (!preset?.css) return null;
        const stops = gradientStops(preset.css);
        const fallback = preset.fallbackColor || stops.color;
        const image = String(preset.css).replace(/"/g, '\'');
        return {
            bgcolor: fallback,
            style: `background-color: ${fallback}; background-image: ${image};`,
            vml: {
                color: stops.color,
                color2: stops.color2,
                angle: String(preset.vmlAngle || '270'),
                width: options.vmlWidth || '600px'
            }
        };
    }
    if (mode === 'image') {
        const preset = (source.backgroundImagePresets || []).find(item => item.id === options.imageId)
            || (source.backgroundImagePresets || []).find(item => item.url);
        if (!preset?.url) return null;
        const mobile = options.device === 'mobile';
        const position = mobile
            ? (preset.positionMobile || preset.positionDesktop || 'center')
            : (preset.positionDesktop || 'center');
        const size = mobile
            ? (preset.sizeMobile || preset.sizeDesktop || preset.backgroundSize || 'cover')
            : (preset.sizeDesktop || preset.backgroundSize || 'cover');
        const fallback = preset.fallbackColor || '#ffffff';
        const url = String(preset.url).replace(/'/g, '');
        return {
            bgcolor: fallback,
            background: url,
            style: `background-color: ${fallback}; background-image: url('${url}'); background-repeat: no-repeat; background-size: ${size}; background-position: ${position};`
        };
    }
    const color = String(options.color || '').trim();
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return null;
    return {
        bgcolor: color,
        style: `background-color: ${color};`
    };
}

function scanRegions(html) {
    const columns = [];
    const contents = [];
    let container = null;
    const stack = [];
    const source = String(html || '');
    TOKEN.lastIndex = 0;
    let match = TOKEN.exec(source);
    while (match) {
        const tokenEnd = match.index + match[0].length;
        if (!match[0].startsWith('<!--')) {
            if (match[1]) {
                closeTag(match[1].toLowerCase(), tokenEnd, stack, columns, (frame) => {
                    if (frame.role === 'container' && !container) {
                        container = { start: frame.start, end: tokenEnd };
                    }
                    if (frame.role === 'content') {
                        contents.push({ innerStart: frame.start, innerEnd: tokenEnd });
                    }
                });
            } else openTag(match, stack);
        }
        match = TOKEN.exec(source);
    }
    columns.forEach(column => {
        column.contents = contents.filter(content =>
            content.innerStart >= column.innerStart && content.innerEnd <= column.innerEnd
        );
    });
    return { container, columns };
}

function applyColumnSlice(slice, layout, runtime, scan, index) {
    const options = layout.columns[index] || emptyColumnLayout();
    const columnState = (runtime.columns || [])[index] || {};
    const found = scan.columns[index] || {};
    const desktopPad = padString(columnState.padDesktop);
    const mobilePad = columnState.padMobileInherit === false ? padString(columnState.padMobile) : desktopPad;
    const values = {};
    assignHide(values, found.placeholders, ['column-hide-dsk'], options.hideDesktop && columnState.hideDesktop);
    assignHide(values, found.placeholders, ['column-hide-mob'], options.hideMobile && columnState.hideMobile);
    assignPad(values, found.placeholders, ['column-pad-dsk', 'col-pad-dsk'], options.padding ? desktopPad : '');
    assignPad(values, found.placeholders, ['column-pad-mob', 'col-pad-mob'], options.padding ? mobilePad : '');
    if (found.placeholders?.includes('col-bg-color')) {
        values['col-bg-color'] = options.backgroundColor ? allowedColor(columnState.bgColor, options.backgroundColors) : '';
    }
    if (found.placeholders?.includes('col-bg-image')) {
        values['col-bg-image'] = options.backgroundImage ? escapeHtml(columnState.bgImage || '') : '';
    }
    if (found.placeholders?.includes('col-bg-gradient')) {
        values['col-bg-gradient'] = options.backgroundGradient ? gradientCss(columnState.bgGradientId, options.gradients) : '';
    }
    let next = replaceTokens(slice, values);
    if (found.placeholders?.includes('column-bg')) {
        next = applyScopedBackground(next, 'column-bg', columnState.backgroundPayload || null);
    }
    return next;
}

function applyContentSlice(slice, layout, runtime, scan, index, contentIndex) {
    const options = layout.columns?.[index]?.contents?.[contentIndex] || {};
    const columnState = (runtime.columns || [])[index] || {};
    const contentState = (columnState.contents || [])[contentIndex] || {};
    const found = scan.columns?.[index]?.contents?.[contentIndex] || {};
    const desktopPad = padString(contentState.padDesktop);
    const mobilePad = contentState.padMobileInherit === false ? padString(contentState.padMobile) : desktopPad;
    const values = {};
    assignHide(values, found.placeholders, ['content-hide-dsk'], options.hideDesktop && contentState.hideDesktop);
    assignHide(values, found.placeholders, ['content-hide-mob'], options.hideMobile && contentState.hideMobile);
    assignPad(values, found.placeholders, ['content-pad-dsk'], options.padding ? desktopPad : '');
    assignPad(values, found.placeholders, ['content-pad-mob'], options.padding ? mobilePad : '');
    let next = replaceTokens(slice, values);
    if (found.placeholders?.includes('content-bg')) {
        next = applyScopedBackground(next, 'content-bg', contentState.backgroundPayload || null);
    }
    return next;
}

function applyContainerSlice(html, layout, runtime, scan) {
    const blockPad = padString(runtime.padDesktop);
    const mobilePad = runtime.padMobileInherit === false ? padString(runtime.padMobile) : blockPad;
    const names = scan.block?.placeholders || [];
    const values = {};
    assignHide(values, names, ['container-hide-dsk', 'blo-hide-dsk'], layout.hideDesktop && runtime.hideDesktop);
    assignHide(values, names, ['container-hide-mob', 'blo-hide-mob'], layout.hideMobile && runtime.hideMobile);
    assignPad(values, names, ['container-pad-dsk', 'blo-pad-dsk'], layout.padding ? blockPad : '');
    assignPad(values, names, ['container-pad-mob', 'blo-pad-mob'], layout.padding ? mobilePad : '');
    if (names.includes('blo-bg-color')) {
        values['blo-bg-color'] = layout.backgroundColor ? allowedColor(runtime.bgColor, layout.backgroundColors) : '';
    }
    if (names.includes('blo-bg-img')) {
        values['blo-bg-img'] = layout.backgroundImage ? escapeHtml(runtime.bgImage || '') : '';
    }
    if (names.includes('blo-bg-grd')) {
        values['blo-bg-grd'] = layout.backgroundGradient ? gradientCss(runtime.bgGradientId, layout.gradients) : '';
    }
    if (scan.columnDirection) {
        values['column-dir'] = layout.columnDirection ? (runtime.columnDirection === 'rtl' ? 'rtl' : 'ltr') : '';
    }
    let next = replaceTokens(html, values);
    if (names.includes('container-bg')) {
        next = applyScopedBackground(next, 'container-bg', runtime.backgroundPayload || null);
    }
    return next;
}

function assignHide(values, names, tokens, hidden) {
    tokens.forEach(token => {
        if (!(names || []).includes(token)) return;
        if (!hidden) {
            values[token] = '';
            return;
        }
        values[token] = token.includes('mob') ? 'blo-hide-mob' : 'blo-hide-dsk';
    });
}

function assignPad(values, names, tokens, pad) {
    tokens.forEach(token => {
        if ((names || []).includes(token)) values[token] = pad;
    });
}

function applyScopedBackground(html, token, payload) {
    const tokenRe = new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'i');
    if (!tokenRe.test(html)) return html;
    if (!payload) return html.replace(tokenRe, '');
    const openRe = /<([A-Za-z0-9:_-]+)(\s[^>]*?)?>/g;
    let match;
    let found = null;
    while ((match = openRe.exec(html))) {
        if (tokenRe.test(match[0])) {
            found = match;
            break;
        }
    }
    if (!found) return html.replace(tokenRe, '');
    const openStart = found.index;
    const openEnd = openRe.lastIndex;
    const closeEnd = matchingCloseEnd(html, openStart);
    const open = upsertOpenTag(found[0].replace(tokenRe, ' '), payload);
    let element = open + html.slice(openEnd, closeEnd);
    if (payload.vml) element = wrapGradientVml(element, payload.vml);
    return html.slice(0, openStart) + element + html.slice(closeEnd);
}

function matchingCloseEnd(html, openStart) {
    const source = html.slice(openStart);
    const local = new RegExp(TOKEN.source, 'g');
    const stack = [];
    let match = local.exec(source);
    while (match) {
        const tokenEnd = match.index + match[0].length;
        if (!match[0].startsWith('<!--')) {
            if (match[1]) {
                const tag = match[1].toLowerCase();
                for (let index = stack.length - 1; index >= 0; index -= 1) {
                    if (stack[index] !== tag) continue;
                    stack.splice(index);
                    if (!stack.length) return openStart + tokenEnd;
                    break;
                }
            } else if (match[2] && match[4] !== '/' && !VOID_TAGS.has(match[2].toLowerCase())) {
                stack.push(match[2].toLowerCase());
            }
        }
        match = local.exec(source);
    }
    return html.length;
}

function upsertOpenTag(openTag, payload) {
    const selfClose = /\/\s*>$/.test(openTag.trim());
    let tag = openTag.replace(/\s*\/?\s*>$/, '').replace(/\s+/g, ' ').trim();
    if (payload.bgcolor) tag = setAttribute(tag, 'bgcolor', payload.bgcolor);
    if (payload.background) tag = setAttribute(tag, 'background', payload.background);
    if (payload.style) tag = appendStyle(tag, payload.style);
    return `${tag}${selfClose ? ' />' : '>'}`;
}

function setAttribute(tag, name, value) {
    const pattern = new RegExp(`\\s${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i');
    const safe = String(value).replace(/"/g, '');
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${safe}"`);
    return `${tag} ${name}="${safe}"`;
}

function appendStyle(tag, extra) {
    const pattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;
    const addition = String(extra || '').trim().replace(/;?\s*$/, ';');
    if (pattern.test(tag)) {
        return tag.replace(pattern, (full, quote, css) => {
            const base = String(css || '').trim().replace(/;?\s*$/, '');
            return ` style=${quote}${base ? `${base}; ` : ''}${addition}${quote}`;
        });
    }
    return `${tag} style="${addition}"`;
}

function wrapGradientVml(elementHtml, vml) {
    const color = vml.color || '#ffffff';
    const color2 = vml.color2 || color;
    const angle = vml.angle || '270';
    const width = vml.width || '600px';
    return `<!--[if gte mso 9]>
<v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${width};">
<v:fill type="gradient" color="${color}" color2="${color2}" angle="${angle}" />
<v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
<![endif]-->
${elementHtml}
<!--[if gte mso 9]>
</v:textbox>
</v:rect>
<![endif]-->`;
}

function gradientStops(css) {
    const hexes = String(css || '').match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})/g) || [];
    return {
        color: hexes[0] || '#ffffff',
        color2: hexes[1] || hexes[0] || '#ffffff'
    };
}

function openTag(match, stack) {
    const tag = match[2].toLowerCase();
    const raw = match[3] || '';
        const frame = { tag, role: '', start: match.index };
    if (hasAttribute(raw, 'binding-content')) frame.role = 'content';
    else if (hasAttribute(raw, 'binding-column')) frame.role = 'column';
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

function flagsFromNames(names, tokens) {
    const found = new Set(names || []);
    const flags = {};
    Object.entries(tokens).forEach(([token, flag]) => {
        flags[flag] = !!flags[flag] || found.has(token);
    });
    return flags;
}

function flagsFrom(html, tokens) {
    return flagsFromNames(placeholdersIn(html), tokens);
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