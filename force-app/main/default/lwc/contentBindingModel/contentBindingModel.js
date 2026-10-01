const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g;
const TOKEN = /<!--[\s\S]*?-->|<\/([A-Za-z0-9:_-]+)\s*>|<([A-Za-z0-9:_-]+)([^>]*?)(\/?)>/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

export function emptyContentStructure() {
    return {
        hasColumns: false,
        columns: [],
        parts: [],
        loose: [],
        sources: {},
        placeholders: [],
        repeatables: []
    };
}

export function parseContentBindings(html) {
    const source = String(html || '');
    const root = { parts: [], loose: [] };
    const columns = [];
    const sources = {};
    const placeholders = [];
    const repeatables = [];
    const stack = [];
    let columnCount = 0;
    let partCount = 0;
    TOKEN.lastIndex = 0;
    let cursor = 0;
    let match = TOKEN.exec(source);
    while (match) {
        assignPlaceholders(source.slice(cursor, match.index), stack, root, sources, placeholders);
        cursor = match.index + match[0].length;
        if (match[0].startsWith('<!--')) {
            match = TOKEN.exec(source);
            continue;
        }
        if (match[1]) {
            closeTag(match[1].toLowerCase(), cursor, stack, repeatables);
        } else {
            openTag(match, stack, root, columns, sources, placeholders, () => {
                columnCount += 1;
                return columnCount;
            }, () => {
                partCount += 1;
                return partCount;
            });
        }
        match = TOKEN.exec(source);
    }
    assignPlaceholders(source.slice(cursor), stack, root, sources, placeholders);
    return {
        hasColumns: columns.length > 0,
        columns,
        parts: root.parts,
        loose: root.loose,
        sources,
        placeholders,
        repeatables
    };
}

export function expandContentBindings(html, contentValues) {
    const parsed = parseContentBindings(html);
    const ranges = parsed.repeatables.slice().sort((left, right) => right.start - left.start);
    let output = String(html || '');
    ranges.forEach(range => {
        const template = output.slice(range.start, range.end);
        const lines = lineValues(contentValues, range.itemPlaceholder);
        const icon = iconValue(contentValues, range);
        const clones = lines.map(line => {
            let clone = template.replace(/\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g, (token, name) => {
                if (name === range.itemPlaceholder) return escapeHtml(line);
                if (range.listIconPlaceholder && name === range.listIconPlaceholder) return escapeHtml(icon);
                return token;
            });
            if (!range.listIconPlaceholder && range.listIconLiteral && icon && icon !== range.listIconLiteral) {
                clone = clone.replace(range.listIconLiteral, escapeHtml(icon));
            }
            return clone;
        });
        output = output.slice(0, range.start) + clones.join('') + output.slice(range.end);
    });
    return output;
}

export function dictionarySections(structure) {
    const parsed = structure || emptyContentStructure();
    if (parsed.hasColumns) {
        return {
            hasColumnSections: true,
            sections: parsed.columns.map(column => ({
                key: column.id,
                label: column.label,
                showLabel: true,
                sectionClass: 'content-column',
                parts: column.parts.map(describePart),
                looseNames: column.loose
            }))
        };
    }
    if (parsed.parts.length) {
        return {
            hasColumnSections: false,
            sections: [{
                key: 'block',
                label: '',
                showLabel: false,
                sectionClass: 'content-bindings',
                parts: parsed.parts.map(describePart),
                looseNames: []
            }]
        };
    }
    return { hasColumnSections: false, sections: [] };
}

export function editorSections(structure, contentValues, instanceId) {
    const parsed = structure || emptyContentStructure();
    const values = contentValues || {};
    const groups = parsed.hasColumns
        ? parsed.columns
        : [{ id: 'block', label: '', parts: parsed.parts }];
    return groups.filter(group => group.parts && group.parts.length).map(group => ({
        key: `${instanceId}:${group.id}`,
        label: group.label,
        showLabel: parsed.hasColumns,
        parts: group.parts.map(part => editorPart(part, values, instanceId))
    }));
}

function openTag(match, stack, root, columns, sources, placeholders, nextColumn, nextPart) {
    const tag = match[2].toLowerCase();
    const attrs = parseAttributes(match[3] || '');
    const binding = (attrs['content-binding'] || '').toLowerCase();
    const frame = {
        tag,
        binding,
        start: match.index,
        part: null,
        column: null
    };
    if (binding === 'column') {
        const column = {
            id: `column-${nextColumn()}`,
            label: `Column ${columns.length + 1}`,
            parts: [],
            loose: []
        };
        columns.push(column);
        frame.column = column;
    } else if (binding === 'icon-list') {
        const owner = currentColumn(stack);
        const part = makeIconList(attrs, `${owner ? owner.id : 'block'}-icon-list-${nextPart()}`);
        (owner ? owner.parts : root.parts).push(part);
        frame.part = part;
        if (part.listIconPlaceholder) claim(sources, placeholders, part, part.listIconPlaceholder, 'iconListIcon');
    } else if (binding === 'image') {
        const owner = currentColumn(stack);
        const part = {
            kind: 'image',
            id: `${owner ? owner.id : 'block'}-image-${nextPart()}`,
            fields: [],
            placeholders: []
        };
        (owner ? owner.parts : root.parts).push(part);
        frame.part = part;
    } else if (binding === 'icon-list-header' || binding === 'icon-list-items' || binding === 'list-item' || binding === 'icon-list-item') {
        frame.part = currentPart(stack, 'icon-list');
    }
    const selfClosing = match[4] === '/' || VOID_TAGS.has(tag);
    if (!selfClosing) stack.push(frame);
    assignPlaceholders(Object.values(attrs).join(' '), stack.concat(selfClosing ? [frame] : []), root, sources, placeholders);
}

function closeTag(tag, end, stack, repeatables) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag !== tag) continue;
        const frame = stack[index];
        if ((frame.binding === 'list-item' || frame.binding === 'icon-list-item') && frame.part && frame.part.itemPlaceholder) {
            repeatables.push({
                start: frame.start,
                end,
                itemPlaceholder: frame.part.itemPlaceholder,
                listIconPlaceholder: frame.part.listIconPlaceholder,
                listIconLiteral: frame.part.listIconLiteral,
                iconKey: frame.part.listIconPlaceholder || `${frame.part.id}:icon`
            });
        }
        stack.splice(index);
        return;
    }
}

function assignPlaceholders(text, stack, root, sources, placeholders) {
    placeholdersIn(text).forEach(name => {
        const listItem = findFrame(stack, ['list-item', 'icon-list-item']);
        const header = findFrame(stack, ['icon-list-header']);
        const image = findFrame(stack, ['image']);
        const iconList = findFrame(stack, ['icon-list']);
        const column = findFrame(stack, ['column']);
        if (listItem && listItem.part) {
            const part = listItem.part;
            if (part.listIconPlaceholder && name === part.listIconPlaceholder) {
                claim(sources, placeholders, part, name, 'iconListIcon');
                return;
            }
            if (!part.itemPlaceholder) part.itemPlaceholder = name;
            if (name === part.itemPlaceholder) {
                claim(sources, placeholders, part, name, 'iconListItem');
                return;
            }
        }
        if (header && header.part) {
            if (!header.part.headerPlaceholder) header.part.headerPlaceholder = name;
            if (name === header.part.headerPlaceholder) {
                claim(sources, placeholders, header.part, name, 'iconListHeader');
                return;
            }
        }
        if (image && image.part) {
            const role = imageRole(name);
            if (!image.part.fields.some(field => field.placeholder === name)) {
                image.part.fields.push({ placeholder: name, ...role });
            }
            claim(sources, placeholders, image.part, name, role.source);
            return;
        }
        if (iconList && iconList.part && name === iconList.part.listIconPlaceholder) {
            claim(sources, placeholders, iconList.part, name, 'iconListIcon');
            return;
        }
        const bucket = column && column.column ? column.column : root;
        if (!sources[name] && !bucket.loose.includes(name)) bucket.loose.push(name);
        if (!placeholders.includes(name)) placeholders.push(name);
    });
}

function makeIconList(attrs, id) {
    const listIcon = attrs['list-icon'] || '';
    const iconNames = placeholdersIn(listIcon);
    return {
        kind: 'icon-list',
        id,
        listIcon,
        listIconPlaceholder: iconNames[0] || '',
        listIconLiteral: iconNames.length ? '' : listIcon,
        headerPlaceholder: '',
        itemPlaceholder: '',
        placeholders: []
    };
}

function imageRole(name) {
    const key = name.toLowerCase();
    if (key.includes('alt')) return { role: 'alt', label: 'Alt text', source: 'imageAlt' };
    if (key.includes('target-url') || key.includes('href') || key.endsWith('-url')) {
        return { role: 'href', label: 'Link URL', source: 'imageHref' };
    }
    if (key.includes('target')) return { role: 'target', label: 'Link target', source: 'imageTarget' };
    if (key.includes('width') && key.includes('desktop')) {
        return { role: 'widthDesktop', label: 'Width on desktop', source: 'imageWidthDesktop' };
    }
    if (key.includes('width') && key.includes('mobile')) {
        return { role: 'widthMobile', label: 'Width on mobile', source: 'imageWidthMobile' };
    }
    if (key.includes('padding') && key.includes('desktop')) {
        return { role: 'paddingDesktop', label: 'Padding on desktop', source: 'imagePaddingDesktop' };
    }
    if (key.includes('padding') && key.includes('mobile')) {
        return { role: 'paddingMobile', label: 'Padding on mobile', source: 'imagePaddingMobile' };
    }
    if (key.includes('src') || key.includes('image')) return { role: 'src', label: 'Image URL', source: 'imageSrc' };
    return { role: 'field', label: name, source: 'contentValue' };
}

function describePart(part) {
    if (part.kind === 'icon-list') {
        const iconToken = part.listIconPlaceholder
            ? `{{${part.listIconPlaceholder}}}`
            : (part.listIconLiteral || 'None');
        return {
            key: part.id,
            title: 'Icon list',
            summary: 'Authors set the heading, the icon, and one or more lines. Each line repeats the list item markup.',
            rows: [
                part.headerPlaceholder ? {
                    key: `${part.id}:header`,
                    label: 'List header',
                    token: `{{${part.headerPlaceholder}}}`,
                    detail: 'Heading above the lines.'
                } : null,
                {
                    key: `${part.id}:icon`,
                    label: 'List icon',
                    token: iconToken,
                    detail: part.listIconPlaceholder
                        ? 'Placeholder for the icon inherited by every line.'
                        : 'Fixed icon inherited by every line.'
                },
                part.itemPlaceholder ? {
                    key: `${part.id}:item`,
                    label: 'List line',
                    token: `{{${part.itemPlaceholder}}}`,
                    detail: 'Repeated once for each line the author adds.'
                } : null
            ].filter(Boolean)
        };
    }
    return {
        key: part.id,
        title: 'Image',
        summary: 'Authors fill the image fields found in this container.',
        rows: (part.fields || []).map(field => ({
            key: `${part.id}:${field.placeholder}`,
            label: field.label,
            token: `{{${field.placeholder}}}`,
            detail: 'Bound from this image container.'
        }))
    };
}

function editorPart(part, values, instanceId) {
    if (part.kind === 'icon-list') {
        const iconKey = part.listIconPlaceholder || `${part.id}:icon`;
        const stored = values[part.itemPlaceholder];
        const rows = Array.isArray(stored) && stored.length
            ? stored.map(item => ({
                key: `${instanceId}:${item.id}`,
                id: item.id,
                value: item.value || ''
            }))
            : [{
                key: `${instanceId}:${part.id}:line:1`,
                id: `${part.id}:line:1`,
                value: ''
            }];
        return {
            key: `${instanceId}:${part.id}`,
            isIconList: true,
            isImage: false,
            title: 'Icon list',
            showHeader: !!part.headerPlaceholder,
            headerPlaceholder: part.headerPlaceholder,
            headerValue: values[part.headerPlaceholder] || '',
            iconKey,
            iconLiteral: part.listIconLiteral || '',
            showItems: !!part.itemPlaceholder,
            itemPlaceholder: part.itemPlaceholder,
            seedId: `${part.id}:line:1`,
            rows
        };
    }
    return {
        key: `${instanceId}:${part.id}`,
        isIconList: false,
        isImage: true,
        title: 'Image',
        showHeader: false,
        showItems: false,
        rows: [],
        fields: (part.fields || []).map(field => ({
            key: `${instanceId}:${field.placeholder}`,
            placeholder: field.placeholder,
            label: field.label
        }))
    };
}

function claim(sources, placeholders, part, name, source) {
    if (!name) return;
    if (!sources[name]) sources[name] = source;
    if (part && !part.placeholders.includes(name)) part.placeholders.push(name);
    if (!placeholders.includes(name)) placeholders.push(name);
}

function currentColumn(stack) {
    const frame = findFrame(stack, ['column']);
    return frame ? frame.column : null;
}

function currentPart(stack, kind) {
    const frame = findFrame(stack, [kind]);
    return frame ? frame.part : null;
}

function findFrame(stack, bindings) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (bindings.includes(stack[index].binding)) return stack[index];
    }
    return null;
}

function parseAttributes(raw) {
    const attrs = {};
    const pattern = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match = pattern.exec(raw);
    while (match) {
        attrs[match[1].toLowerCase()] = match[2] != null ? match[2] : match[3];
        match = pattern.exec(raw);
    }
    return attrs;
}

function placeholdersIn(text) {
    const names = [];
    const pattern = /\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g;
    let match = pattern.exec(String(text || ''));
    while (match) {
        names.push(match[1]);
        match = pattern.exec(String(text || ''));
    }
    return names;
}

function lineValues(contentValues, name) {
    const raw = contentValues ? contentValues[name] : null;
    if (!Array.isArray(raw) || !raw.length) return [''];
    return raw.map(item => {
        if (item && typeof item === 'object') return item.value || '';
        return item == null ? '' : String(item);
    });
}

function iconValue(contentValues, range) {
    const typed = range.iconKey && contentValues ? contentValues[range.iconKey] : '';
    if (typed == null || typed === '') return range.listIconLiteral || '';
    return String(typed);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
