import { parseHtml, serializeHtml } from 'c/ccTemplateParser';
import {
    CONTENT_TYPES,
    SECTION_LEVELS,
    SECTION_BINDS,
    REGION_KINDS,
    TARGET_TOKENS,
    TARGET_BINDS,
    isBindingKey,
    sidesFromCss
} from 'c/ccTemplateSchema';

/**
 * Guided marking of raw HTML: elements are addressed by their index among the descendants of <body>
 * (document order). `annotateNodes` stamps those indexes on a preview copy; `inspectNode` describes one
 * element; `applyMarking` writes the data-cc-* attributes into the clean HTML.
 */
const MARK_ATTRS = ['data-cc-section', 'data-cc-id', 'data-cc-bind', 'data-cc-content', 'data-cc-key', 'data-cc-label', 'data-cc-complexity', 'data-cc-region', 'data-cc-as-column'];
const BLOCK_TAGS = new Set(['table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'div', 'section', 'article', 'header', 'footer', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'a', 'center', 'body']);
const INLINE_TEXT_TAGS = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'sup', 'sub', 'font', 'small']);

function bodyElements(doc) {
    return Array.from(doc.body.querySelectorAll('*'));
}

export function annotateNodes(html) {
    const { doc, isDocument } = parseHtml(html);
    bodyElements(doc).forEach((element, index) => element.setAttribute('data-cc-node', String(index)));
    return serializeHtml(doc, isDocument);
}

/** True when the parsed definition has no markings at all (a raw upload). */
export function isUnmarked(definition) {
    if (!definition) return false;
    return !(definition.sections || []).length && !(definition.contentSlots || []).length && !(definition.regions || []).length;
}

function ownText(element) {
    return String(element.textContent || '').replace(/\s+/g, ' ').trim();
}

export function elementLabel(element) {
    const tag = element.tagName.toLowerCase();
    const cls = String(element.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
    const id = element.getAttribute('id');
    return `${tag}${id ? `#${id}` : cls ? `.${cls}` : ''}`;
}

function camel(text, fallback) {
    const words = String(text || '').replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (!words.length) return fallback;
    const value = words.map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word.charAt(0).toLowerCase() + word.slice(1))).join('');
    return /^[A-Za-z]/.test(value) ? value.slice(0, 40) : `${fallback}${value}`;
}

/** Splits a style attribute into declarations, keeping ';' inside quotes and parentheses (url(), gradients). */
function splitStyle(text) {
    const items = [];
    let depth = 0;
    let quote = null;
    let current = '';
    String(text || '').split('').forEach(character => {
        if (quote) {
            if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '(') {
            depth += 1;
        } else if (character === ')') {
            depth = Math.max(0, depth - 1);
        } else if (character === ';' && depth === 0) {
            if (current.trim()) items.push(current.trim());
            current = '';
            return;
        }
        current += character;
    });
    if (current.trim()) items.push(current.trim());
    return items.map(raw => {
        const colon = raw.indexOf(':');
        const isToken = raw.startsWith('{{');
        if (colon < 0 || isToken) return { name: null, value: null, raw };
        return { name: raw.slice(0, colon).trim().toLowerCase(), value: raw.slice(colon + 1).trim(), raw };
    });
}

function joinStyle(items) {
    return items.map(item => (item.name ? `${item.name}: ${item.value}` : item.raw)).join('; ');
}

function setStyleAttribute(element, items) {
    const text = joinStyle(items);
    if (text) element.setAttribute('style', `${text};`);
    else element.removeAttribute('style');
}

const isBackgroundDeclaration = item => !!item.name && (item.name === 'background' || item.name.startsWith('background-'));

function placedTargets(element) {
    const placed = {};
    Object.keys(TARGET_TOKENS).forEach(key => {
        placed[key] = Array.from(element.attributes).some(attribute => attribute.value.includes(TARGET_TOKENS[key]));
    });
    return placed;
}

/** What the element's inline style already says about spacing and background, and which placeholders are placed. */
function readStyleInfo(element) {
    const items = splitStyle(element.getAttribute('style'));
    const find = name => items.find(item => item.name === name)?.value || null;
    const background = items.filter(isBackgroundDeclaration);
    return {
        style: String(element.getAttribute('style') || ''),
        padding: find('padding'),
        margin: find('margin'),
        backgroundColor: find('background-color'),
        bgcolorAttribute: element.getAttribute('bgcolor'),
        backgroundDeclarations: background.map(item => `${item.name}: ${item.value}`).join('; '),
        placed: placedTargets(element)
    };
}

function readMarks(element) {
    const get = name => element.getAttribute(name);
    const binds = String(get('data-cc-bind') || '').split(/\s+/).filter(Boolean);
    let role = 'none';
    if (get('data-cc-content')) role = 'content';
    else if (get('data-cc-section')) role = 'section';
    else if (get('data-cc-region')) role = 'region';
    return {
        role,
        level: get('data-cc-section'),
        id: get('data-cc-id'),
        binds,
        contentType: get('data-cc-content'),
        key: get('data-cc-key'),
        label: get('data-cc-label'),
        complexity: get('data-cc-complexity'),
        regionKind: get('data-cc-region')
    };
}

function nearestSectionLevel(element) {
    let current = element.parentElement;
    while (current) {
        if (current.hasAttribute('data-cc-section')) return current.getAttribute('data-cc-section');
        current = current.parentElement;
    }
    return null;
}

function regionAncestor(element, kinds) {
    let current = element.parentElement;
    while (current) {
        const kind = current.getAttribute('data-cc-region');
        if (kind && (!kinds || kinds.includes(kind))) return current;
        current = current.parentElement;
    }
    return null;
}

/** In a multi-block shell layout areas are regions; sections only exist in blocks and single-block templates. */
function isMultiShell({ kind, templateMode } = {}) {
    return kind === 'shell' && templateMode !== 'single';
}

/** What the element most likely is, so the panel can pre-select it. */
export function suggestMarking(element, options = {}) {
    const tag = element.tagName.toLowerCase();
    if (isMultiShell(options) && !regionAncestor(element, ['fixed-edit'])) {
        return {
            role: 'region',
            regionKind: 'fixed-read',
            reason: 'In a multi-block shell, layout areas are regions: read-only, editable, or the blocks zone. To group several neighbouring elements, Shift-click the others.'
        };
    }
    const parentLevel = nearestSectionLevel(element);
    if (tag === 'img') {
        return { role: 'content', contentType: 'image', key: camel(element.getAttribute('alt') || element.getAttribute('id'), 'image'), reason: 'An <img> element is an image.' };
    }
    if (tag === 'a') {
        return { role: 'content', contentType: 'button', key: camel(ownText(element), 'button'), reason: 'A link is usually a button.' };
    }
    if (tag === 'hr') {
        return { role: 'content', contentType: 'divider', key: 'divider', reason: 'A horizontal rule is a divider.' };
    }
    if (tag === 'ul' || tag === 'ol') {
        return { role: 'content', contentType: 'bulletList', key: camel(element.getAttribute('id'), 'list'), reason: 'A list with repeated items.' };
    }
    const children = Array.from(element.children);
    const onlyInline = children.every(child => INLINE_TEXT_TAGS.has(child.tagName.toLowerCase()));
    if (ownText(element) && onlyInline && !['table', 'tr', 'tbody'].includes(tag)) {
        return { role: 'content', contentType: 'richText', key: camel(ownText(element), 'text'), reason: 'It only contains text and inline formatting.' };
    }
    if (isMultiShell(options)) {
        return { role: 'content', contentType: 'richText', key: camel(ownText(element), 'text'), reason: 'It sits inside an editable region, so it is likely editable content.' };
    }
    if (!parentLevel) {
        return { role: 'section', level: 'container', reason: 'It is the outermost layout element, so it is likely the container.' };
    }
    if (parentLevel === 'container') {
        return { role: 'section', level: 'row', reason: 'It sits directly in the container, so it is likely a row.' };
    }
    if (parentLevel === 'row') {
        return { role: 'section', level: 'column', reason: 'It sits in a row, so it is likely a column.' };
    }
    return { role: 'content', contentType: 'richText', key: camel(ownText(element), 'text'), reason: 'It sits inside a column, so it is likely content.' };
}

/** Describes the element at `index`: path, children, current marks and a suggestion. */
export function inspectNode(html, index, options = {}) {
    const { doc } = parseHtml(html);
    const elements = bodyElements(doc);
    const element = elements[index];
    if (!element) return null;
    const indexOf = new Map(elements.map((item, position) => [item, position]));
    const summary = item => {
        const marks = readMarks(item);
        return { node: indexOf.get(item), label: elementLabel(item), marked: marks.role !== 'none' };
    };
    const path = [];
    for (let current = element; current && current !== doc.body; current = current.parentElement) path.unshift(summary(current));
    const marks = readMarks(element);
    return {
        node: index,
        tag: element.tagName.toLowerCase(),
        label: elementLabel(element),
        text: ownText(element).slice(0, 80),
        path,
        children: Array.from(element.children)
            .filter(child => child.tagName.toLowerCase() !== 'style')
            .slice(0, 12)
            .map(summary),
        childCount: Array.from(element.children).filter(child => child.tagName.toLowerCase() !== 'style').length,
        firstChild: element.firstElementChild ? indexOf.get(element.firstElementChild) : null,
        lastChild: element.lastElementChild ? indexOf.get(element.lastElementChild) : null,
        marks,
        parentLevel: nearestSectionLevel(element),
        inEditableRegion: !!regionAncestor(element, ['fixed-edit']),
        inReadOnlyRegion: !!regionAncestor(element, ['fixed-read']),
        insideRegion: !!regionAncestor(element),
        isArea: ['fixed-read', 'fixed-edit'].includes(element.getAttribute('data-cc-region')),
        isZone: element.getAttribute('data-cc-region') === 'blocks',
        areaNode: (() => {
            if (['fixed-read', 'fixed-edit'].includes(element.getAttribute('data-cc-region'))) return index;
            const area = regionAncestor(element, ['fixed-read', 'fixed-edit']);
            return area ? indexOf.get(area) : null;
        })(),
        areaName: (() => {
            const area = ['fixed-read', 'fixed-edit'].includes(element.getAttribute('data-cc-region')) ? element : regionAncestor(element, ['fixed-read', 'fixed-edit']);
            return area ? area.getAttribute('data-cc-label') || area.getAttribute('data-cc-id') || null : null;
        })(),
        hasBlocksZone: elements.some(item => item.getAttribute('data-cc-region') === 'blocks'),
        suggestion: suggestMarking(element, options),
        styleInfo: readStyleInfo(element),
        asColumn: element.getAttribute('data-cc-as-column') === 'true',
        isBlockish: BLOCK_TAGS.has(element.tagName.toLowerCase())
    };
}

function clearMarks(element) {
    const previousType = element.getAttribute('data-cc-content');
    MARK_ATTRS.forEach(name => element.removeAttribute(name));
    if (previousType === 'bulletList' || previousType === 'divider') {
        element.querySelectorAll('[data-cc-loop], [data-cc-slot]').forEach(child => {
            child.removeAttribute('data-cc-loop');
            child.removeAttribute('data-cc-slot');
        });
    }
}

function slugify(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function wrapChildren(element, doc) {
    const span = doc.createElement('span');
    while (element.firstChild) span.appendChild(element.firstChild);
    element.appendChild(span);
    return span;
}

function prepareBulletList(element, doc) {
    if (element.querySelector('[data-cc-loop="item"]')) return null;
    const tag = element.tagName.toLowerCase();
    let item;
    if (tag === 'ul' || tag === 'ol') item = element.querySelector(':scope > li');
    else if (tag === 'table' || tag === 'tbody') item = element.querySelector('tr');
    else item = element.firstElementChild;
    if (!item) return 'Select the element that contains the list items.';
    item.setAttribute('data-cc-loop', 'item');
    if (item.querySelector('[data-cc-slot="text"]')) return null;
    const icon = item.querySelector('img');
    if (item.tagName.toLowerCase() === 'tr') {
        const cells = Array.from(item.children);
        const iconCell = icon ? cells.find(cell => cell.contains(icon)) : null;
        const textCell = [...cells].reverse().find(cell => cell !== iconCell) || cells[cells.length - 1];
        if (iconCell) {
            iconCell.setAttribute('data-cc-slot', 'icon-cell');
            icon.setAttribute('data-cc-slot', 'icon');
        }
        if (textCell) textCell.setAttribute('data-cc-slot', 'text');
        return textCell ? null : 'The list item needs a cell or element for its text.';
    }
    if (icon) {
        icon.setAttribute('data-cc-slot', 'icon');
        const span = doc.createElement('span');
        Array.from(item.childNodes).filter(node => node !== icon).forEach(node => span.appendChild(node));
        item.appendChild(span);
        span.setAttribute('data-cc-slot', 'text');
    } else {
        wrapChildren(item, doc).setAttribute('data-cc-slot', 'text');
    }
    return null;
}

/**
 * Applies a marking to the element at `index`.
 * marking: { role: 'section'|'content'|'region'|'none', level, id, binds, contentType, key, label, complexity, regionKind }
 * Returns { html, markedNode, errors }; html is null when there are errors.
 */
export function applyMarking(html, index, marking, { kind = 'block' } = {}) {
    const { doc, isDocument } = parseHtml(html);
    const elements = bodyElements(doc);
    let target = elements[index];
    if (!target) return { html: null, markedNode: null, errors: ['That element no longer exists. Pick it again.'] };
    const errors = [];
    const others = elements.filter(item => item !== target);
    const role = marking?.role || 'none';
    const tag = target.tagName.toLowerCase();

    if (role === 'section') {
        if (!SECTION_LEVELS.includes(marking.level)) errors.push('Choose container, row or column.');
        const id = slugify(marking.id);
        if (id && others.some(item => item.getAttribute('data-cc-id') === id)) errors.push(`The id "${id}" is already used.`);
        const binds = (marking.binds || []).filter(bind => SECTION_BINDS.includes(bind));
        if (binds.includes('column-direction') && marking.level !== 'row') errors.push('Column order can only be bound on a row.');
    } else if (role === 'content') {
        if (!CONTENT_TYPES.includes(marking.contentType)) errors.push('Choose a content type.');
        const key = String(marking.key || '').trim();
        if (!key) errors.push('Enter a binding key.');
        else if (!isBindingKey(key)) errors.push('The key must start with a letter and use letters, digits, "_" or "-".');
        else if (others.some(item => item.getAttribute('data-cc-key') === key)) errors.push(`The key "${key}" is already used.`);
        if (marking.contentType === 'image' && tag !== 'img') errors.push(`An image must be an <img> element, but this is a <${tag}>. Select the image element.`);
        if (marking.contentType === 'button' && tag !== 'a') errors.push(`A button must be an <a> element, but this is a <${tag}>. Select the link element.`);
    } else if (role === 'region') {
        if (kind !== 'shell') errors.push('Regions can only be set in the template shell.');
        if (!REGION_KINDS.includes(marking.regionKind)) errors.push('Choose read-only, editable or blocks region.');
        if (marking.regionKind === 'blocks' && others.some(item => item.getAttribute('data-cc-region') === 'blocks')) {
            errors.push('The shell already has a blocks region. Remove it first.');
        }
        const id = slugify(marking.id);
        if (id && others.some(item => item.getAttribute('data-cc-id') === id)) errors.push(`The id "${id}" is already used.`);
        if (regionAncestor(target)) errors.push('This element is already inside a region. Regions cannot be nested.');
        if (target.querySelector('[data-cc-region]')) errors.push('This element contains another region. Regions cannot be nested; pick the region or remove it first.');
    } else if (role !== 'none') {
        errors.push('Choose what this element is.');
    }
    if (errors.length) return { html: null, markedNode: null, errors };

    const keptBinds = String(target.getAttribute('data-cc-bind') || '').split(/\s+/).filter(Boolean);
    const keptAsColumn = target.getAttribute('data-cc-as-column') === 'true';
    clearMarks(target);
    if (role === 'section') {
        target.setAttribute('data-cc-section', marking.level);
        const id = slugify(marking.id);
        if (id) target.setAttribute('data-cc-id', id);
        const wanted = marking.binds === undefined ? keptBinds : marking.binds;
        const binds = wanted.filter(bind => SECTION_BINDS.includes(bind) && (bind !== 'column-direction' || marking.level === 'row'));
        if (binds.length) target.setAttribute('data-cc-bind', binds.join(' '));
        if (keptAsColumn && marking.level === 'row') target.setAttribute('data-cc-as-column', 'true');
        if (marking.label) target.setAttribute('data-cc-label', String(marking.label).trim());
    } else if (role === 'content') {
        if (marking.contentType === 'divider' && tag === 'hr') {
            const wrapper = doc.createElement('div');
            target.replaceWith(wrapper);
            wrapper.appendChild(target);
            target.setAttribute('data-cc-slot', 'line');
            target = wrapper;
        } else if (marking.contentType === 'divider') {
            const line = target.querySelector('hr');
            if (line) line.setAttribute('data-cc-slot', 'line');
        }
        if (marking.contentType === 'bulletList') {
            const problem = prepareBulletList(target, doc);
            if (problem) return { html: null, markedNode: null, errors: [problem] };
        }
        target.setAttribute('data-cc-content', marking.contentType);
        target.setAttribute('data-cc-key', String(marking.key).trim());
        if (marking.label) target.setAttribute('data-cc-label', String(marking.label).trim());
        if (['richText', 'bulletList'].includes(marking.contentType) && marking.complexity) {
            target.setAttribute('data-cc-complexity', marking.complexity);
        }
    } else if (role === 'region') {
        target.setAttribute('data-cc-region', marking.regionKind);
        const id = slugify(marking.id) || (marking.name ? freeId(others, slugify(marking.name) || 'area') : '');
        if (id) target.setAttribute('data-cc-id', id);
        if (marking.name) target.setAttribute('data-cc-label', String(marking.name).trim());
    }
    const markedNode = bodyElements(doc).indexOf(target);
    return { html: serializeHtml(doc, isDocument), markedNode, errors: [] };
}

/** Node index of the element carrying `data-cc-node`-independent marks, found by attribute after a re-parse. */
export function nodeElement(html, index) {
    const { doc } = parseHtml(html);
    return bodyElements(doc)[index] || null;
}

// ─── Groups of siblings and the blocks zone ──────────────────────────────────

const DATA_TABLE_PARENTS = new Set(['tbody', 'thead', 'tfoot']);

function describeParent(parent) {
    return elementLabel(parent);
}

/** How a run of siblings under `parent` can be wrapped while keeping the HTML valid. */
function wrapperPlan(parent) {
    const tag = parent.tagName.toLowerCase();
    if (tag === 'tr') return { problem: 'Cells of one table row cannot be grouped without changing the layout. Select the whole row (a parent in the path) instead.' };
    if (tag === 'ul' || tag === 'ol') return { problem: 'List items cannot be grouped. Select the whole list instead.' };
    if (tag === 'table') return { problem: 'Select the rows inside the table body, or the whole table, instead.' };
    if (DATA_TABLE_PARENTS.has(tag)) return { tag, wrapperTag: tag, splitsRows: true };
    return { tag, wrapperTag: 'div' };
}

/**
 * Siblings between `a` and `b` (inclusive, in document order of their shared parent).
 * Returns { nodes, error }; used by Shift-click.
 */
export function rangeBetween(html, a, b) {
    const { doc } = parseHtml(html);
    const elements = bodyElements(doc);
    const first = elements[a];
    const second = elements[b];
    if (!first || !second) return { nodes: [], error: 'That element no longer exists. Pick it again.' };
    if (first === second) return { nodes: [a], error: null };
    if (first.parentElement !== second.parentElement) {
        return { nodes: [a], error: 'Shift-click selects neighbouring elements inside the same parent. Select their common parent from the path, or click elements next to each other.' };
    }
    const siblings = Array.from(first.parentElement.children);
    const from = Math.min(siblings.indexOf(first), siblings.indexOf(second));
    const to = Math.max(siblings.indexOf(first), siblings.indexOf(second));
    return { nodes: siblings.slice(from, to + 1).map(item => elements.indexOf(item)), error: null };
}

/** Describes a selected run of siblings for the group panel. */
export function inspectGroup(html, nodes) {
    const { doc } = parseHtml(html);
    const elements = bodyElements(doc);
    const selected = nodes.map(node => elements[node]).filter(Boolean);
    if (selected.length < 2) return null;
    const parent = selected[0].parentElement;
    const plan = wrapperPlan(parent);
    const children = Array.from(parent.children);
    const positions = selected.map(item => children.indexOf(item));
    const contiguous = Math.max(...positions) - Math.min(...positions) + 1 === selected.length;
    let problem = '';
    if (selected.some(item => item.parentElement !== parent)) problem = 'The selected elements must share one parent.';
    else if (!contiguous) problem = 'The selected elements must be next to each other.';
    else if (plan.problem) problem = plan.problem;
    else if (regionAncestor(selected[0])) problem = 'These elements are already inside a region. Regions cannot be nested.';
    else if (selected.some(item => item.hasAttribute('data-cc-region') || item.querySelector('[data-cc-region]'))) problem = 'The selection contains a region. Regions cannot be nested.';
    return {
        count: selected.length,
        nodes,
        labels: selected.map(elementLabel),
        parentLabel: describeParent(parent),
        wrapperTag: plan.wrapperTag || null,
        problem
    };
}

/**
 * Wraps a run of sibling elements in a new region wrapper (`<div>`, or `<tbody>` for table rows).
 * marking: { regionKind: 'fixed-read'|'fixed-edit', id }. Returns { html, markedNode, errors }.
 */
export function wrapElements(html, nodes, marking, { kind = 'shell' } = {}) {
    const { doc, isDocument } = parseHtml(html);
    const elements = bodyElements(doc);
    const targets = (nodes || []).map(node => elements[node]);
    const fail = errors => ({ html: null, markedNode: null, errors });
    if (!targets.length || targets.some(item => !item)) return fail(['An element no longer exists. Pick it again.']);
    if (kind !== 'shell') return fail(['Regions can only be set in the template shell.']);
    if (!['fixed-read', 'fixed-edit'].includes(marking?.regionKind)) return fail(['Choose a read-only or editable region. The blocks zone is inserted, not wrapped.']);
    const parent = targets[0].parentElement;
    if (targets.some(item => item.parentElement !== parent)) return fail(['The selected elements must share one parent.']);
    const children = Array.from(parent.children);
    const lo = Math.min(...targets.map(item => children.indexOf(item)));
    const hi = Math.max(...targets.map(item => children.indexOf(item)));
    const range = children.slice(lo, hi + 1);
    if (range.length === 1) return applyMarking(html, nodes[0], { role: 'region', regionKind: marking.regionKind, id: marking.id, name: marking.name }, { kind });
    const id = slugify(marking.id);
    if (id && elements.some(item => item.getAttribute('data-cc-id') === id)) return fail([`The id "${id}" is already used.`]);
    if (regionAncestor(range[0])) return fail(['These elements are already inside a region. Regions cannot be nested.']);
    if (range.some(item => item.hasAttribute('data-cc-region') || item.querySelector('[data-cc-region]'))) {
        return fail(['The selection contains a region. Regions cannot be nested; remove it first.']);
    }
    const plan = wrapperPlan(parent);
    if (plan.problem) return fail([plan.problem]);

    // All nodes from the first to the last selected element move together, so comments between them
    // (for example Outlook conditional comments) stay with the group.
    const moving = [];
    for (let node = range[0]; node; node = node.nextSibling) {
        moving.push(node);
        if (node === range[range.length - 1]) break;
    }
    let wrapper;
    if (plan.splitsRows) {
        const tail = [];
        for (let node = range[range.length - 1].nextSibling; node; node = node.nextSibling) tail.push(node);
        wrapper = doc.createElement(plan.wrapperTag);
        parent.parentNode.insertBefore(wrapper, parent.nextSibling);
        moving.forEach(node => wrapper.appendChild(node));
        if (tail.length) {
            const rest = doc.createElement(plan.wrapperTag);
            tail.forEach(node => rest.appendChild(node));
            parent.parentNode.insertBefore(rest, wrapper.nextSibling);
        }
        if (!Array.from(parent.children).length) parent.remove();
    } else {
        wrapper = doc.createElement(plan.wrapperTag);
        parent.insertBefore(wrapper, range[0]);
        moving.forEach(node => wrapper.appendChild(node));
    }
    wrapper.setAttribute('data-cc-region', marking.regionKind);
    wrapper.setAttribute('data-cc-wrapper', 'area');
    const wrapperId = id || (marking.name ? freeId(elements, slugify(marking.name) || 'area') : '');
    if (wrapperId) wrapper.setAttribute('data-cc-id', wrapperId);
    if (marking.name) wrapper.setAttribute('data-cc-label', String(marking.name).trim());
    return { html: serializeHtml(doc, isDocument), markedNode: bodyElements(doc).indexOf(wrapper), errors: [] };
}

function freeId(elements, base) {
    let id = base;
    let counter = 2;
    while (elements.some(item => item.getAttribute('data-cc-id') === id)) {
        id = `${base}-${counter}`;
        counter += 1;
    }
    return id;
}

/**
 * Inserts the blocks zone relative to an element: position is 'before', 'after', 'inside-start' or 'inside-end'.
 * An existing blocks zone is moved. Returns { html, markedNode, errors }.
 */
export function insertBlocksZone(html, node, position, { kind = 'shell', templateMode = 'multi' } = {}) {
    const { doc, isDocument } = parseHtml(html);
    const elements = bodyElements(doc);
    const anchor = elements[node];
    const fail = errors => ({ html: null, markedNode: null, errors });
    if (kind !== 'shell' || templateMode === 'single') return fail(['The blocks zone only exists in multi-block shells.']);
    if (!anchor) return fail(['That element no longer exists. Pick it again.']);
    if (!['before', 'after', 'inside-start', 'inside-end'].includes(position)) return fail(['Choose where to place the blocks zone.']);
    const existing = elements.find(item => item.getAttribute('data-cc-region') === 'blocks');
    if (existing && (existing === anchor || existing.contains(anchor))) {
        return fail(['Pick an element outside the current blocks zone to move it.']);
    }
    let container = position.startsWith('inside') ? anchor : anchor.parentElement;
    if (!container) return fail(['The blocks zone cannot be placed here.']);
    if (container.tagName.toLowerCase() === 'table' && position.startsWith('inside')) {
        container = container.querySelector('tbody') || container;
    }
    if (container.hasAttribute('data-cc-region') || regionAncestor(container)) {
        return fail(['The blocks zone cannot be inside another region. Place it before or after that region.']);
    }
    const containerTag = container.tagName.toLowerCase();
    if (containerTag === 'tr') return fail(['The blocks zone cannot be placed between table cells. Select the table row and place it before or after the row.']);
    if (containerTag === 'ul' || containerTag === 'ol') return fail(['The blocks zone cannot be placed inside a list.']);

    const zoneId = freeId(elements.filter(item => item !== existing), 'content');
    let zone;
    let inserted;
    if (['table', 'tbody', 'thead', 'tfoot'].includes(containerTag)) {
        inserted = doc.createElement('tr');
        zone = doc.createElement('td');
        inserted.appendChild(zone);
    } else {
        inserted = doc.createElement('div');
        zone = inserted;
    }
    zone.setAttribute('data-cc-region', 'blocks');
    zone.setAttribute('data-cc-id', zoneId);

    if (existing) {
        const empty = !existing.children.length && !ownText(existing);
        if (empty) {
            const row = existing.parentElement && existing.parentElement.tagName.toLowerCase() === 'tr' && existing.parentElement.children.length === 1
                ? existing.parentElement : null;
            (row || existing).remove();
        } else {
            clearMarks(existing);
        }
    }
    if (position === 'before') anchor.parentNode.insertBefore(inserted, anchor);
    else if (position === 'after') anchor.parentNode.insertBefore(inserted, anchor.nextSibling);
    else if (position === 'inside-start') container.insertBefore(inserted, container.firstChild);
    else container.appendChild(inserted);
    return { html: serializeHtml(doc, isDocument), markedNode: bodyElements(doc).indexOf(zone), errors: [] };
}

// ─── Fixed areas, dropzone and setup progress (multi-block shells) ───────────

const AREA_KINDS = ['fixed-read', 'fixed-edit'];
const HELPER_ATTRS = ['data-cc-loop', 'data-cc-slot'];

function areaElement(elements, regionId) {
    return elements.find(item => AREA_KINDS.includes(item.getAttribute('data-cc-region')) && item.getAttribute('data-cc-id') === regionId) || null;
}

function stripContent(area) {
    const contents = Array.from(area.querySelectorAll('[data-cc-content]'));
    contents.forEach(item => {
        clearMarks(item);
        HELPER_ATTRS.forEach(name => item.removeAttribute(name));
    });
    return contents.length;
}

function areaName(element) {
    return element.getAttribute('data-cc-label') || element.getAttribute('data-cc-id') || elementLabel(element);
}

/** Read-only and editable areas of a shell: [{ regionId, name, kind, node, wrapped, bindingCount, contentKeys }]. */
export function listAreas(html) {
    const { doc } = parseHtml(html);
    return bodyElements(doc)
        .map((element, node) => ({ element, node }))
        .filter(({ element }) => AREA_KINDS.includes(element.getAttribute('data-cc-region')))
        .map(({ element, node }) => {
            const content = Array.from(element.querySelectorAll('[data-cc-content]'));
            return {
                regionId: element.getAttribute('data-cc-id') || '',
                name: areaName(element),
                kind: element.getAttribute('data-cc-region'),
                node,
                wrapped: element.getAttribute('data-cc-wrapper') === 'area',
                bindingCount: content.length,
                contentKeys: content.map(item => item.getAttribute('data-cc-key'))
            };
        });
}

/** Renames an area and/or switches it between read-only and editable. */
export function updateArea(html, regionId, { kind, name, removeContent = false } = {}) {
    const { doc, isDocument } = parseHtml(html);
    const elements = bodyElements(doc);
    const area = areaElement(elements, regionId);
    const fail = errors => ({ html: null, markedNode: null, errors });
    if (!area) return fail(['That area no longer exists.']);
    if (kind && !AREA_KINDS.includes(kind)) return fail(['Choose read-only or editable.']);
    if (name !== undefined && !String(name).trim()) return fail(['Enter a name for the area.']);
    const target = kind || area.getAttribute('data-cc-region');
    if (target === 'fixed-read') {
        const bindings = area.querySelectorAll('[data-cc-content]').length;
        if (bindings && !removeContent) {
            return fail([`This area contains ${bindings} editable content binding(s). Remove them to make it read-only.`]);
        }
        stripContent(area);
    }
    area.setAttribute('data-cc-region', target);
    if (name !== undefined) area.setAttribute('data-cc-label', String(name).trim());
    return { html: serializeHtml(doc, isDocument), markedNode: bodyElements(doc).indexOf(area), errors: [] };
}

/** Removes the content bindings inside an area, keeping the HTML structure. */
export function removeContentIn(html, regionId) {
    const { doc, isDocument } = parseHtml(html);
    const area = areaElement(bodyElements(doc), regionId);
    if (!area) return { html: null, errors: ['That area no longer exists.'] };
    stripContent(area);
    return { html: serializeHtml(doc, isDocument), errors: [] };
}

/**
 * Removes an area and the content bindings inside it. A wrapper the wizard added around a group is
 * unwrapped again (table-body wrappers only lose their markings, which keeps the table valid).
 */
export function removeArea(html, regionId) {
    const { doc, isDocument } = parseHtml(html);
    const area = areaElement(bodyElements(doc), regionId);
    if (!area) return { html: null, errors: ['That area no longer exists.'] };
    stripContent(area);
    const wrapped = area.getAttribute('data-cc-wrapper') === 'area';
    const isTableBody = ['tbody', 'thead', 'tfoot'].includes(area.tagName.toLowerCase());
    ['data-cc-region', 'data-cc-id', 'data-cc-label', 'data-cc-wrapper'].forEach(name => area.removeAttribute(name));
    if (wrapped && !isTableBody) {
        while (area.firstChild) area.parentNode.insertBefore(area.firstChild, area);
        area.remove();
    }
    return { html: serializeHtml(doc, isDocument), errors: [] };
}

function placementLabel(element) {
    return AREA_KINDS.includes(element.getAttribute('data-cc-region')) ? areaName(element) : elementLabel(element);
}

/** Where the blocks zone currently sits: { zoneId, node, position, relativeNode, text } or null. */
export function zonePlacement(html) {
    const { doc } = parseHtml(html);
    const elements = bodyElements(doc);
    const zone = elements.find(item => item.getAttribute('data-cc-region') === 'blocks');
    if (!zone) return null;
    const row = zone.parentElement && zone.parentElement.tagName.toLowerCase() === 'tr' && zone.parentElement.children.length === 1
        ? zone.parentElement : zone;
    const info = { zoneId: zone.getAttribute('data-cc-id') || '', node: elements.indexOf(zone) };
    const previous = row.previousElementSibling;
    const next = row.nextElementSibling;
    if (previous) return { ...info, position: 'after', relativeNode: elements.indexOf(previous), text: `After ${placementLabel(previous)}` };
    if (next) return { ...info, position: 'before', relativeNode: elements.indexOf(next), text: `Before ${placementLabel(next)}` };
    const parent = row.parentElement;
    return { ...info, position: 'inside', relativeNode: parent ? elements.indexOf(parent) : null, text: `Inside ${parent ? elementLabel(parent) : 'the page'}` };
}

export function removeBlocksZone(html) {
    const { doc, isDocument } = parseHtml(html);
    const zone = bodyElements(doc).find(item => item.getAttribute('data-cc-region') === 'blocks');
    if (!zone) return { html: null, errors: ['The shell has no dropzone.'] };
    const row = zone.parentElement && zone.parentElement.tagName.toLowerCase() === 'tr' && zone.parentElement.children.length === 1
        ? zone.parentElement : zone;
    if (zone.children.length || ownText(zone)) {
        ['data-cc-region', 'data-cc-id', 'data-cc-label'].forEach(name => zone.removeAttribute(name));
    } else {
        row.remove();
    }
    return { html: serializeHtml(doc, isDocument), errors: [] };
}

/** Progress of the three shell setup steps, from a parsed definition. */
export function shellProgress(definition) {
    const regions = definition?.regions || [];
    const areas = regions.filter(region => AREA_KINDS.includes(region.kind));
    const hasZone = regions.some(region => region.kind === 'blocks');
    const noFixedAreas = !!definition?.setup?.noFixedAreas;
    const step1Done = areas.length > 0 || noFixedAreas;
    const step2Done = hasZone;
    const slotCount = (definition?.contentSlots || []).length;
    const editableCount = areas.filter(region => region.kind === 'fixed-edit').length;
    const steps = [
        { step: 1, done: step1Done, unlocked: true },
        { step: 2, done: step2Done, unlocked: step1Done },
        { step: 3, done: slotCount > 0, unlocked: step1Done && step2Done }
    ];
    return {
        steps,
        areaCount: areas.length,
        editableCount,
        hasZone,
        noFixedAreas,
        slotCount,
        firstOpenStep: !step1Done ? 1 : !step2Done ? 2 : 1
    };
}

// ─── Content blocks and single-block templates ───────────────────────────────

/** Sections and content bindings of a block with their node indexes, for the summary list and the step panels. */
export function listBindings(html) {
    const { doc } = parseHtml(html);
    const elements = bodyElements(doc);
    const depthOf = element => {
        let depth = 0;
        for (let current = element.parentElement; current; current = current.parentElement) {
            if (current.hasAttribute('data-cc-section')) depth += 1;
        }
        return depth;
    };
    const sections = [];
    const content = [];
    elements.forEach((element, node) => {
        if (element.hasAttribute('data-cc-section')) {
            sections.push({
                sectionId: element.getAttribute('data-cc-id') || '',
                level: element.getAttribute('data-cc-section'),
                label: element.getAttribute('data-cc-label') || '',
                binds: String(element.getAttribute('data-cc-bind') || '').split(/\s+/).filter(Boolean),
                asColumn: element.getAttribute('data-cc-as-column') === 'true',
                hasColumns: !!element.querySelector('[data-cc-section="column"]'),
                node,
                depth: depthOf(element)
            });
        } else if (element.hasAttribute('data-cc-content')) {
            content.push({
                key: element.getAttribute('data-cc-key') || '',
                type: element.getAttribute('data-cc-content'),
                label: element.getAttribute('data-cc-label') || '',
                node
            });
        }
    });
    return { sections, content };
}

/** Row without inner columns: treat the row itself as the one column. */
export function setRowAsColumn(html, index, on) {
    const { doc, isDocument } = parseHtml(html);
    const element = bodyElements(doc)[index];
    if (!element || element.getAttribute('data-cc-section') !== 'row') return { html: null, errors: ['Select a row first.'] };
    if (on && element.querySelector('[data-cc-section="column"]')) {
        return { html: null, errors: ['This row already has columns marked. Remove them first, or leave the row as it is.'] };
    }
    if (on) element.setAttribute('data-cc-as-column', 'true');
    else element.removeAttribute('data-cc-as-column');
    return { html: serializeHtml(doc, isDocument), errors: [] };
}

/** Sets which settings a section exposes (data-cc-bind). Placeholders of settings that are switched off are removed. */
export function setSectionBinds(html, index, binds, fallbacks = {}) {
    const { doc, isDocument } = parseHtml(html);
    const element = bodyElements(doc)[index];
    if (!element || !element.hasAttribute('data-cc-section')) return { html: null, errors: ['Select a container, row or column first.'], removed: [] };
    const level = element.getAttribute('data-cc-section');
    const next = (binds || []).filter(bind => SECTION_BINDS.includes(bind) && (bind !== 'column-direction' || level === 'row'));
    const removed = Object.keys(TARGET_TOKENS).filter(key => !next.includes(TARGET_BINDS[key]) && placedTargets(element)[key]);
    removed.forEach(key => restoreTarget(element, key, fallbacks[key] || ''));
    if (next.length) element.setAttribute('data-cc-bind', next.join(' '));
    else element.removeAttribute('data-cc-bind');
    return { html: serializeHtml(doc, isDocument), errors: [], removed };
}

function replaceTokenInAttributes(element, token, replacement) {
    Array.from(element.attributes).forEach(attribute => {
        if (attribute.name === 'style' || !attribute.value.includes(token)) return;
        const value = attribute.value.split(token).join(replacement);
        if (value.trim()) element.setAttribute(attribute.name, value);
        else element.removeAttribute(attribute.name);
    });
}

const DECLARATION_TARGETS = { padding: 'padding', margin: 'margin', bgColor: 'background-color' };

/**
 * Writes a placeholder for one setting into the element's markup and returns what it replaced.
 * padding / margin / bgColor: the existing declaration's value becomes the placeholder (that value is the fallback);
 * without one, a declaration is added. bgGradient / bgImage: the existing background declarations are moved into the
 * fallback and the placeholder (which renders complete declarations) takes their place.
 * Returns { html, errors, fallback, captured, sides }.
 */
export function placeTarget(html, index, key, { fallback: typed } = {}) {
    const token = TARGET_TOKENS[key];
    if (!token) return { html: null, errors: ['Unknown setting.'] };
    const { doc, isDocument } = parseHtml(html);
    const element = bodyElements(doc)[index];
    if (!element || !element.hasAttribute('data-cc-section')) return { html: null, errors: ['Mark the element as a container, row or column first.'] };
    if (placedTargets(element)[key]) return { html: null, errors: ['This setting already has a placeholder.'] };
    const items = splitStyle(element.getAttribute('style'));
    let fallback = typed || '';
    let captured = false;

    const property = DECLARATION_TARGETS[key];
    if (property) {
        const existing = items.find(item => item.name === property);
        if (existing) {
            fallback = existing.value;
            captured = true;
            existing.value = token;
        } else if (key === 'bgColor' && element.getAttribute('bgcolor') && !isTokenValue(element.getAttribute('bgcolor'))) {
            fallback = element.getAttribute('bgcolor');
            captured = true;
        } else {
            items.push({ name: property, value: token, raw: `${property}: ${token}` });
        }
        if (key === 'bgColor' && element.hasAttribute('bgcolor')) element.setAttribute('bgcolor', token);
    } else {
        const capturable = item => isBackgroundDeclaration(item) && !isTokenValue(item.value);
        const firstIndex = items.findIndex(capturable);
        const run = items.filter(capturable);
        const placed = placedTargets(element);
        const alreadyTokenised = ['bgGradient', 'bgImage'].some(other => other !== key && placed[other]);
        if (run.length && !alreadyTokenised) {
            fallback = joinStyle(run);
            captured = true;
        }
        const rest = items.filter(item => !capturable(item) || alreadyTokenised);
        const insertAt = firstIndex < 0 ? rest.length : Math.min(firstIndex, rest.length);
        rest.splice(insertAt, 0, { name: null, value: null, raw: token });
        items.length = 0;
        items.push(...rest);
    }
    setStyleAttribute(element, items);
    const binds = new Set(String(element.getAttribute('data-cc-bind') || '').split(/\s+/).filter(Boolean));
    binds.add(TARGET_BINDS[key]);
    element.setAttribute('data-cc-bind', Array.from(binds).join(' '));
    return {
        html: serializeHtml(doc, isDocument),
        errors: [],
        fallback,
        captured,
        sides: key === 'padding' || key === 'margin' ? sidesFromCss(fallback) : null
    };
}

function isTokenValue(value) {
    return Object.values(TARGET_TOKENS).some(token => String(value).includes(token));
}

/** Puts `fallback` back where the placeholder was (removes the declaration when there is nothing to restore). */
function restoreTarget(element, key, fallback) {
    const token = TARGET_TOKENS[key];
    const items = splitStyle(element.getAttribute('style'));
    const next = [];
    items.forEach(item => {
        if (item.name && item.value.includes(token)) {
            const value = item.value.split(token).join(fallback).trim();
            if (value) next.push({ ...item, value });
        } else if (!item.name && item.raw.includes(token)) {
            const text = item.raw.split(token).join(fallback).trim();
            if (text) next.push(...splitStyle(text));
        } else {
            next.push(item);
        }
    });
    setStyleAttribute(element, next);
    replaceTokenInAttributes(element, token, fallback);
}

/** Removes one placeholder and restores its fallback value into the markup. */
export function removeTarget(html, index, key, fallback = '') {
    const { doc, isDocument } = parseHtml(html);
    const element = bodyElements(doc)[index];
    if (!element || !TARGET_TOKENS[key] || !placedTargets(element)[key]) return { html: null, errors: ['This setting has no placeholder.'] };
    restoreTarget(element, key, fallback);
    return { html: serializeHtml(doc, isDocument), errors: [] };
}

/** Settings that need a placeholder before marketers can use them: padding, margin and background. */
export function pendingTargets(definition) {
    const pending = [];
    (definition?.sections || []).forEach(section => {
        const targets = section.targets || {};
        const binds = section.binds || [];
        if (binds.includes('padding') && !targets.padding) pending.push({ sectionId: section.sectionId, bind: 'padding' });
        if (binds.includes('margin') && !targets.margin) pending.push({ sectionId: section.sectionId, bind: 'margin' });
        if (binds.includes('background') && !(targets.bgColor || targets.bgGradient || targets.bgImage)) {
            pending.push({ sectionId: section.sectionId, bind: 'background' });
        }
    });
    return pending;
}

/**
 * Progress of the three block setup steps: containers, settings (placeholders), content.
 * `stage` tells the container step what to identify next: the parent container, rows, or the columns of a row.
 */
export function blockProgress(definition) {
    const sections = definition?.sections || [];
    const slotCount = (definition?.contentSlots || []).length;
    const noSections = !!definition?.setup?.noSections;
    const rows = sections.filter(section => section.level === 'row');
    const unresolvedRows = rows.filter(row => !row.asColumn && !sections.some(section => section.level === 'column' && section.parentId === row.sectionId));
    const hasContainer = sections.some(section => section.level === 'container');
    const step1Done = noSections || (sections.length > 0 && unresolvedRows.length === 0);
    const pending = noSections ? [] : pendingTargets(definition);
    const step2Done = step1Done && pending.length === 0;
    const step3Done = slotCount > 0;
    let stage = 'done';
    if (!noSections) {
        if (!hasContainer) stage = 'container';
        else if (!rows.length) stage = 'rows';
        else if (unresolvedRows.length) stage = 'columns';
    }
    return {
        steps: [
            { step: 1, done: step1Done, unlocked: true },
            { step: 2, done: step2Done, unlocked: step1Done },
            { step: 3, done: step3Done && step2Done, unlocked: step2Done }
        ],
        sectionCount: sections.length,
        rowCount: rows.length,
        columnCount: sections.filter(section => section.level === 'column').length,
        unresolvedRowCount: unresolvedRows.length,
        pendingCount: pending.length,
        slotCount,
        noSections,
        stage,
        firstOpenStep: !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 1
    };
}
