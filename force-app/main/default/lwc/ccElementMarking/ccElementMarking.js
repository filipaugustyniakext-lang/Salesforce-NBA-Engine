import { parseHtml, serializeHtml } from 'c/ccTemplateParser';
import { CONTENT_TYPES, SECTION_LEVELS, SECTION_BINDS, REGION_KINDS, isBindingKey } from 'c/ccTemplateSchema';

/**
 * Guided marking of raw HTML: elements are addressed by their index among the descendants of <body>
 * (document order). `annotateNodes` stamps those indexes on a preview copy; `inspectNode` describes one
 * element; `applyMarking` writes the data-cc-* attributes into the clean HTML.
 */
const MARK_ATTRS = ['data-cc-section', 'data-cc-id', 'data-cc-bind', 'data-cc-content', 'data-cc-key', 'data-cc-label', 'data-cc-complexity', 'data-cc-region'];
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

/** What the element most likely is, so the panel can pre-select it. */
export function suggestMarking(element) {
    const tag = element.tagName.toLowerCase();
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
export function inspectNode(html, index) {
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
        marks,
        parentLevel: nearestSectionLevel(element),
        suggestion: suggestMarking(element),
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
    } else if (role !== 'none') {
        errors.push('Choose what this element is.');
    }
    if (errors.length) return { html: null, markedNode: null, errors };

    clearMarks(target);
    if (role === 'section') {
        target.setAttribute('data-cc-section', marking.level);
        const id = slugify(marking.id);
        if (id) target.setAttribute('data-cc-id', id);
        const binds = (marking.binds || []).filter(bind => SECTION_BINDS.includes(bind));
        if (binds.length) target.setAttribute('data-cc-bind', binds.join(' '));
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
        const id = slugify(marking.id);
        if (id) target.setAttribute('data-cc-id', id);
    }
    const markedNode = bodyElements(doc).indexOf(target);
    return { html: serializeHtml(doc, isDocument), markedNode, errors: [] };
}

/** Node index of the element carrying `data-cc-node`-independent marks, found by attribute after a re-parse. */
export function nodeElement(html, index) {
    const { doc } = parseHtml(html);
    return bodyElements(doc)[index] || null;
}
