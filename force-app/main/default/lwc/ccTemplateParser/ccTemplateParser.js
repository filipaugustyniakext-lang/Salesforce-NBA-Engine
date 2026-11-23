import {
    SCHEMA_VERSION,
    CONTENT_TYPES,
    SECTION_LEVELS,
    SECTION_BINDS,
    REGION_KINDS,
    defaultSectionSettings,
    validateDefinition
} from 'c/ccTemplateSchema';

const LEGACY_TOKEN_BINDS = [
    [/^(container|blo|column|col|content)-pad-/, 'padding'],
    [/^(container|blo|column|col|content)-(bg|bg-color|bg-img|bg-image|bg-grd|bg-gradient)$/, 'background'],
    [/^(container|blo|column|content)-hide-/, 'hide'],
    [/^column-dir$/, 'column-direction']
];
const LEGACY_EDITOR_TYPES = { text: 'richText', richtext: 'richText', image: 'image', action: 'button' };
const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g;

export function parseHtml(html) {
    const source = String(html || '');
    const isDocument = /<html[\s>]/i.test(source) || /<!doctype/i.test(source);
    const parser = new DOMParser();
    const doc = parser.parseFromString(isDocument ? source : `<!DOCTYPE html><html><head></head><body>${source}</body></html>`, 'text/html');
    return { doc, isDocument };
}

export function serializeHtml(doc, isDocument) {
    if (isDocument) {
        const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
        return `${doctype}\n${doc.documentElement.outerHTML}`;
    }
    return doc.body.innerHTML;
}

export function hasLegacyMarkers(html) {
    const source = String(html || '');
    return /\bbinding-(container|column|content)\b/i.test(source)
        || /<cc-preview\b/i.test(source)
        || /\bdata-editor\s*=/i.test(source)
        || /\{\{\s*(container|blo|column|col|content)-[a-z-]+\s*\}\}/i.test(source);
}

function legacyBindsFromTokens(element) {
    const binds = new Set();
    Array.from(element.attributes).forEach(attribute => {
        let match;
        TOKEN_PATTERN.lastIndex = 0;
        let value = attribute.value;
        while ((match = TOKEN_PATTERN.exec(attribute.value))) {
            const name = match[1];
            const rule = LEGACY_TOKEN_BINDS.find(([pattern]) => pattern.test(name));
            if (rule) {
                binds.add(rule[1]);
                value = value.replace(match[0], '');
            }
        }
        if (value !== attribute.value) {
            const cleaned = value.replace(/;\s*;/g, ';').replace(/\s{2,}/g, ' ').trim();
            if (cleaned) element.setAttribute(attribute.name, cleaned);
            else element.removeAttribute(attribute.name);
        }
    });
    return binds;
}

function addBinds(element, binds) {
    if (!element || !binds.size) return;
    const existing = new Set(String(element.getAttribute('data-cc-bind') || '').split(/\s+/).filter(Boolean));
    binds.forEach(bind => existing.add(bind));
    element.setAttribute('data-cc-bind', Array.from(existing).join(' '));
}

/** Upgrades pre-v1 markers (binding-*, {{blo-*}} tokens, cc-preview, data-editor) to v1 attributes. */
export function upgradeLegacyHtml(html) {
    const { doc, isDocument } = parseHtml(html);
    const all = Array.from(doc.querySelectorAll('*'));
    all.forEach(element => {
        if (element.hasAttribute('binding-container')) {
            element.setAttribute('data-cc-section', 'container');
            element.removeAttribute('binding-container');
        } else if (element.hasAttribute('binding-column')) {
            element.setAttribute('data-cc-section', 'column');
            element.removeAttribute('binding-column');
        } else if (element.hasAttribute('binding-content')) {
            element.removeAttribute('binding-content');
            element.setAttribute('data-cc-legacy-content', '');
        }
    });
    all.forEach(element => {
        const binds = legacyBindsFromTokens(element);
        if (!binds.size) return;
        const section = element.closest('[data-cc-section]') || element;
        if (!section.hasAttribute('data-cc-section')) section.setAttribute('data-cc-section', 'container');
        if (binds.has('column-direction')) {
            section.setAttribute('data-cc-section', 'row');
        }
        addBinds(section, binds);
    });
    Array.from(doc.querySelectorAll('cc-preview')).forEach(wrapper => {
        const region = String(wrapper.getAttribute('region') || wrapper.getAttribute('type') || '').toLowerCase();
        const kind = region === 'fixed' || region === 'preview-fixed' ? 'fixed-read'
            : region === 'preview-edit' ? 'fixed-edit'
                : region;
        const replacement = doc.createElement('div');
        if (REGION_KINDS.includes(kind)) replacement.setAttribute('data-cc-region', kind);
        while (wrapper.firstChild) replacement.appendChild(wrapper.firstChild);
        wrapper.replaceWith(replacement);
        if (!REGION_KINDS.includes(kind)) {
            while (replacement.firstChild) replacement.parentNode.insertBefore(replacement.firstChild, replacement);
            replacement.remove();
        }
    });
    Array.from(doc.querySelectorAll('[data-editor]')).forEach((element, index) => {
        const type = LEGACY_EDITOR_TYPES[String(element.getAttribute('data-editor')).toLowerCase()];
        if (!type) return;
        const tokenMatch = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/.exec(
            type === 'image' ? element.getAttribute('src') || '' : element.innerHTML || element.getAttribute('href') || ''
        );
        const key = element.getAttribute('data-variant') || tokenMatch?.[1] || `${type}${index + 1}`;
        element.setAttribute('data-cc-content', type);
        element.setAttribute('data-cc-key', key);
        const label = element.getAttribute('data-variant-label');
        if (label) element.setAttribute('data-cc-label', label);
        element.removeAttribute('data-editor');
    });
    return serializeHtml(doc, isDocument);
}

function slugify(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function sectionAncestor(element) {
    let current = element.parentElement;
    while (current) {
        if (current.hasAttribute('data-cc-section')) return current;
        current = current.parentElement;
    }
    return null;
}

function regionAncestor(element) {
    const region = element.closest('[data-cc-region]');
    return region ? region.getAttribute('data-cc-region') : null;
}

function cssText(doc) {
    return Array.from(doc.querySelectorAll('style')).map(style => style.textContent || '').join('\n');
}

/**
 * Parses template HTML into a schema v1 definition.
 * kind: 'shell' (master template) or 'block' (content block template).
 * templateMode: 'single' | 'multi' (only used for shells).
 * Returns { definition, html, errors, warnings, legacy }.
 */
export function parseTemplate(html, { kind = 'block', templateMode = 'multi', previous } = {}) {
    const errors = [];
    const warnings = [];
    const legacy = hasLegacyMarkers(html);
    const source = legacy ? upgradeLegacyHtml(html) : String(html || '');
    if (legacy) warnings.push('Legacy binding markers were found and converted. Re-upload the HTML with data-cc-* attributes when possible.');
    if (!source.trim()) {
        return { definition: null, html: source, errors: ['The HTML file is empty.'], warnings, legacy };
    }
    const { doc } = parseHtml(source);
    if (doc.querySelector('script')) errors.push('Scripts are not allowed in templates.');
    if (doc.querySelector('link[rel="stylesheet"]')) errors.push('External stylesheets are not supported. Inline the CSS into the HTML file.');

    const previousSections = new Map((previous?.sections || []).map(section => [section.sectionId, section]));
    const previousSlots = new Map((previous?.contentSlots || []).map(slot => [slot.bindingKey, slot]));
    const sections = [];
    const counters = new Map();
    const usedIds = new Set();
    Array.from(doc.querySelectorAll('[data-cc-section]')).forEach(element => {
        const level = String(element.getAttribute('data-cc-section')).toLowerCase();
        if (!SECTION_LEVELS.includes(level)) {
            errors.push(`Unknown data-cc-section "${level}".`);
            return;
        }
        const parent = sectionAncestor(element);
        const parentId = parent ? parent.getAttribute('data-cc-id') : null;
        let sectionId = slugify(element.getAttribute('data-cc-id'));
        if (!sectionId) {
            const scope = parentId || 'root';
            const count = (counters.get(`${scope}:${level}`) || 0) + 1;
            counters.set(`${scope}:${level}`, count);
            sectionId = level === 'container' ? (count === 1 ? 'block' : `container-${count}`)
                : parentId && parentId !== 'block' ? `${parentId}-${level === 'column' ? 'col' : level}-${count}`
                    : `${level}-${count}`;
        }
        if (usedIds.has(sectionId)) {
            errors.push(`Section id "${sectionId}" is used more than once.`);
            return;
        }
        usedIds.add(sectionId);
        element.setAttribute('data-cc-id', sectionId);
        const binds = String(element.getAttribute('data-cc-bind') || '').split(/\s+/).filter(Boolean);
        binds.forEach(bind => {
            if (!SECTION_BINDS.includes(bind)) errors.push(`Section "${sectionId}" has unknown binding "${bind}".`);
        });
        if (parent) {
            const parentLevel = parent.getAttribute('data-cc-section');
            if (level === 'container' && parentLevel !== 'container') errors.push(`Container "${sectionId}" cannot be nested in a ${parentLevel}.`);
            if (level === 'row' && parentLevel === 'column') errors.push(`Row "${sectionId}" cannot be nested in a column.`);
            if (level === 'column' && parentLevel === 'column') errors.push(`Column "${sectionId}" cannot be nested in a column.`);
        }
        const prior = previousSections.get(sectionId);
        sections.push({
            sectionId,
            level,
            parentId,
            label: element.getAttribute('data-cc-label') || null,
            regionKind: regionAncestor(element),
            binds: binds.filter(bind => SECTION_BINDS.includes(bind)),
            defaults: prior?.defaults || defaultSectionSettings(level, binds),
            presets: prior?.presets || { colors: [], gradients: [] }
        });
    });

    const contentSlots = [];
    const keys = new Set();
    Array.from(doc.querySelectorAll('[data-cc-content]')).forEach(element => {
        const type = element.getAttribute('data-cc-content');
        const key = element.getAttribute('data-cc-key') || '';
        if (!CONTENT_TYPES.includes(type)) {
            errors.push(`Unknown content type "${type}" on data-cc-key "${key}".`);
            return;
        }
        if (!key) {
            errors.push(`A ${type} binding is missing data-cc-key.`);
            return;
        }
        if (keys.has(key)) {
            errors.push(`Binding key "${key}" is used more than once.`);
            return;
        }
        keys.add(key);
        const tag = element.tagName.toLowerCase();
        if (type === 'image' && tag !== 'img') errors.push(`Image binding "${key}" must be an <img> element.`);
        if (type === 'button' && tag !== 'a') errors.push(`Button binding "${key}" must be an <a> element.`);
        if (type === 'bulletList') {
            const item = element.querySelector('[data-cc-loop="item"]');
            if (!item) errors.push(`Bullet list "${key}" needs one child with data-cc-loop="item".`);
            else if (!item.querySelector('[data-cc-slot="text"]')) errors.push(`Bullet list "${key}" item needs a data-cc-slot="text" element.`);
        }
        const section = element.closest('[data-cc-section="column"], [data-cc-section="row"]');
        const owner = section || element.closest('[data-cc-section]');
        if (!owner && kind === 'block') warnings.push(`Content "${key}" is not inside a section; it is treated as a single column.`);
        const prior = previousSlots.get(key);
        contentSlots.push({
            bindingKey: key,
            type,
            sectionId: owner ? owner.getAttribute('data-cc-id') : 'implicit-column',
            label: element.getAttribute('data-cc-label') || prior?.label || key,
            regionKind: regionAncestor(element),
            complexity: element.getAttribute('data-cc-complexity') || prior?.complexity
                || (type === 'richText' ? 'standard' : type === 'bulletList' ? 'basic' : null),
            iconPresets: prior?.iconPresets || [],
            allowNoIcon: prior?.allowNoIcon !== false,
            defaults: prior?.defaults || defaultsFromElement(element, type)
        });
    });

    const regions = Array.from(doc.querySelectorAll('[data-cc-region]')).map((element, index) => {
        const regionKind = element.getAttribute('data-cc-region');
        if (!REGION_KINDS.includes(regionKind)) errors.push(`Unknown data-cc-region "${regionKind}".`);
        const regionId = slugify(element.getAttribute('data-cc-id')) || `${regionKind}-${index + 1}`;
        element.setAttribute('data-cc-id', regionId);
        return { regionId, kind: regionKind };
    });

    const css = cssText(doc);
    if (sections.some(section => section.binds.includes('hide'))
        && !(/\.cc-hide-dsk/.test(css) && /\.cc-hide-mob/.test(css))) {
        warnings.push('Hide on desktop/mobile is bound but the CSS has no .cc-hide-dsk / .cc-hide-mob rules.');
    }
    if (sections.some(section => section.binds.includes('column-direction')) && !/\.cc-stack-mob/.test(css)) {
        warnings.push('Column direction is bound but the CSS has no .cc-stack-mob rule.');
    }

    const definition = {
        schemaVersion: SCHEMA_VERSION,
        kind,
        templateMode: kind === 'shell' ? templateMode : 'single',
        regions,
        sections,
        contentSlots
    };
    const validation = validateDefinition(definition);
    return {
        definition,
        html: serializeHtml(doc, /<html[\s>]/i.test(source) || /<!doctype/i.test(source)),
        errors: [...errors, ...validation.errors.filter(message => !errors.includes(message))],
        warnings: [...warnings, ...validation.warnings],
        legacy
    };
}

function defaultsFromElement(element, type) {
    if (type === 'richText') return { html: element.innerHTML.trim() };
    if (type === 'image') {
        return {
            altText: element.getAttribute('alt') || '',
            width: parseInt(element.getAttribute('width'), 10) || null,
            height: parseInt(element.getAttribute('height'), 10) || null
        };
    }
    if (type === 'button') return { label: element.textContent.trim(), visible: true };
    if (type === 'divider') {
        return { showLine: !!element.querySelector('[data-cc-slot="line"]'), paddingTop: 12, paddingBottom: 12 };
    }
    return {};
}

/** Counts bindings for summaries, e.g. { sections: 4, content: 3, regions: 2 }. */
export function definitionStats(definition) {
    return {
        sections: (definition?.sections || []).length,
        content: (definition?.contentSlots || []).length,
        regions: (definition?.regions || []).length
    };
}

const SECTION_LABELS = { container: 'Container', row: 'Row', column: 'Column' };
const CONTENT_LABELS = { richText: 'Rich text', image: 'Image', bulletList: 'Bullet list', divider: 'Divider', button: 'Button' };
const REGION_LABELS = { 'fixed-read': 'Read-only region', 'fixed-edit': 'Editable region', blocks: 'Blocks zone' };

/**
 * Names a marked element of parsed or rendered HTML the way c/ccBindingWorkspace names its list items
 * (section:id, slot:key, region:id). Returns { kind, key, label } or null for unmarked elements.
 */
export function describeMarked(element) {
    if (!element || !element.getAttribute) return null;
    if (element.hasAttribute('data-cc-content')) {
        const key = element.getAttribute('data-cc-key') || '';
        const type = element.getAttribute('data-cc-content');
        return { kind: 'content', key: `slot:${key}`, label: `${CONTENT_LABELS[type] || type} · ${key}` };
    }
    if (element.hasAttribute('data-cc-section')) {
        const id = element.getAttribute('data-cc-id') || '';
        const level = element.getAttribute('data-cc-section');
        return { kind: 'section', key: `section:${id}`, label: `${SECTION_LABELS[level] || level} · ${id}` };
    }
    if (element.hasAttribute('data-cc-region')) {
        const id = element.getAttribute('data-cc-id') || '';
        const kind = element.getAttribute('data-cc-region');
        return { kind: 'region', key: `region:${id}`, label: `${REGION_LABELS[kind] || kind} · ${id}` };
    }
    return null;
}
