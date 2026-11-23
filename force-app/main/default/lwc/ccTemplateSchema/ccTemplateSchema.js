export const SCHEMA_VERSION = '1.0';

export const CONTENT_TYPES = ['richText', 'image', 'bulletList', 'divider', 'button'];
export const CONTENT_TYPE_LABELS = {
    richText: 'Rich Text',
    image: 'Image',
    bulletList: 'Bullet List',
    divider: 'Divider',
    button: 'Button'
};
export const SECTION_LEVELS = ['container', 'row', 'column'];
export const SECTION_BINDS = ['padding', 'margin', 'background', 'hide', 'column-direction'];
export const REGION_KINDS = ['fixed-read', 'fixed-edit', 'blocks'];
export const RICH_TEXT_COMPLEXITY = {
    basic: ['bold', 'italic', 'underline', 'link'],
    standard: ['bold', 'italic', 'underline', 'strike', 'list', 'link', 'clean'],
    full: [
        'font', 'size', 'bold', 'italic', 'underline', 'strike', 'list', 'indent',
        'align', 'link', 'image', 'clean', 'table', 'header', 'color', 'background', 'code', 'code-block', 'script'
    ]
};
export const COMPLEXITY_OPTIONS = [
    { label: 'Basic (bold, italic, underline, link)', value: 'basic' },
    { label: 'Standard (adds lists and strike-through)', value: 'standard' },
    { label: 'Full (all rich text formats)', value: 'full' }
];
export const BUTTON_TARGET_TYPES = ['WebURL', 'AppURL'];
export const BUTTON_BEHAVIORS = ['newTab', 'sameTab'];
export const IMAGE_SOURCES = ['url', 'upload', 'cms'];
export const COLUMN_DIRECTIONS = ['ltr', 'rtl', 'stack', 'stack-reverse'];
export const BACKGROUND_MODES = ['none', 'color', 'gradient', 'image'];
/**
 * Placeholders written into the HTML where a section setting is rendered. They replace the value of a CSS
 * declaration (or a whole run of declarations for gradients and images) and are substituted when rendering.
 */
export const TARGET_TOKENS = {
    padding: '{{cc-padding}}',
    margin: '{{cc-margin}}',
    bgColor: '{{cc-bg-color}}',
    bgGradient: '{{cc-bg-gradient}}',
    bgImage: '{{cc-bg-image}}'
};
export const TARGET_KEYS = Object.keys(TARGET_TOKENS);
/** The data-cc-bind value each placeholder belongs to. */
export const TARGET_BINDS = { padding: 'padding', margin: 'margin', bgColor: 'background', bgGradient: 'background', bgImage: 'background' };
export const TARGET_LABELS = { padding: 'Padding', margin: 'Margin', bgColor: 'Background color', bgGradient: 'Background gradient', bgImage: 'Background image' };
export const TEMPLATE_MODES = { single: 'Single Block', multi: 'Multi Block' };

export const JSON_FIELD_LIMIT = 131072;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

export function isHexColor(value) {
    return HEX.test(String(value || '').trim());
}

export function isBindingKey(value) {
    return KEY.test(String(value || ''));
}

export function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const random = (Math.random() * 16) | 0;
        return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    });
}

export function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function defaultSides(value = 0) {
    return { top: value, right: value, bottom: value, left: value, chained: true };
}

export function defaultSpacing(value = 0) {
    return {
        desktop: defaultSides(value),
        mobile: { inheritFromDesktop: true, ...defaultSides(value) }
    };
}

export function normalizeSides(source, fallback) {
    const base = fallback || defaultSides(0);
    const input = source && typeof source === 'object' ? source : {};
    const chained = input.chained !== undefined ? !!input.chained : base.chained;
    const top = toInt(input.top, base.top);
    if (chained) return { top, right: top, bottom: top, left: top, chained: true };
    return {
        top,
        right: toInt(input.right, base.right),
        bottom: toInt(input.bottom, base.bottom),
        left: toInt(input.left, base.left),
        chained: false
    };
}

export function normalizeSpacing(source, fallback) {
    if (source === null) return null;
    const base = fallback || defaultSpacing(0);
    const input = source && typeof source === 'object' ? source : {};
    const desktop = normalizeSides(input.desktop, base.desktop);
    const inherit = input.mobile?.inheritFromDesktop !== undefined
        ? !!input.mobile.inheritFromDesktop
        : base.mobile.inheritFromDesktop !== false;
    const mobile = inherit ? { ...desktop } : normalizeSides(input.mobile, base.mobile);
    return { desktop, mobile: { inheritFromDesktop: inherit, ...mobile } };
}

/** Reads a CSS box shorthand ("10px", "10px 20px", "1px 2px 3px 4px") into sides; null when it is not plain pixels. */
export function sidesFromCss(text) {
    const parts = String(text || '').trim().split(/[\s,]+/).filter(Boolean);
    if (!parts.length || parts.length > 4) return null;
    const numbers = parts.map(part => (/^\d+(\.\d+)?(px)?$/i.test(part) ? Math.round(parseFloat(part)) : null));
    if (numbers.some(value => value === null)) return null;
    const [top, right = top, bottom = top, left = right] = numbers;
    const chained = top === right && right === bottom && bottom === left;
    return { top, right, bottom, left, chained };
}

export function defaultImageSource() {
    return { source: 'url', url: null, contentId: null, size: 'cover', repeat: 'no-repeat', position: 'center' };
}

export function defaultBackground() {
    return {
        mode: 'none',
        color: null,
        colorPresetId: null,
        gradientPresetId: null,
        gradient: { css: null, fallbackColor: null },
        image: {
            desktop: defaultImageSource(),
            mobile: { inheritFromDesktop: true, ...defaultImageSource() },
            dark: {
                inheritFromLight: true,
                desktop: defaultImageSource(),
                mobile: { inheritFromDesktop: true, ...defaultImageSource() }
            },
            fallbackColor: '#ffffff'
        }
    };
}

function normalizeImagePair(input, base) {
    const desktop = { ...base.desktop, ...(input?.desktop || {}) };
    const inherit = input?.mobile?.inheritFromDesktop !== false;
    const mobile = inherit
        ? { inheritFromDesktop: true, ...desktop }
        : { ...base.mobile, ...(input.mobile || {}), inheritFromDesktop: false };
    return { desktop, mobile };
}

export function normalizeBackground(source) {
    if (source === null) return null;
    const base = defaultBackground();
    const input = source && typeof source === 'object' ? source : {};
    const mode = BACKGROUND_MODES.includes(input.mode) ? input.mode : base.mode;
    const image = input.image || {};
    const { desktop, mobile } = normalizeImagePair(image, base.image);
    const darkInput = image.dark || {};
    const darkInherit = darkInput.inheritFromLight !== false;
    const dark = { inheritFromLight: darkInherit, ...normalizeImagePair(darkInput, base.image.dark) };
    return {
        mode,
        color: isHexColor(input.color) ? input.color : null,
        colorPresetId: input.colorPresetId || null,
        gradientPresetId: input.gradientPresetId || null,
        gradient: {
            css: input.gradient?.css ? String(input.gradient.css) : null,
            fallbackColor: isHexColor(input.gradient?.fallbackColor) ? input.gradient.fallbackColor : null
        },
        image: {
            desktop,
            mobile,
            dark,
            fallbackColor: isHexColor(image.fallbackColor) ? image.fallbackColor : base.image.fallbackColor
        }
    };
}

export function defaultVisibility() {
    return { hideDesktop: false, hideMobile: false };
}

export function defaultColumnDirection() {
    return { desktop: 'ltr', mobile: 'stack' };
}

export function defaultSectionSettings(level, binds = SECTION_BINDS) {
    const enabled = new Set(binds || []);
    const settings = {
        padding: enabled.has('padding') ? defaultSpacing(0) : null,
        margin: enabled.has('margin') ? defaultSpacing(0) : null,
        background: enabled.has('background') ? defaultBackground() : null,
        visibility: defaultVisibility()
    };
    if (level === 'row') {
        settings.columnDirection = enabled.has('column-direction') ? defaultColumnDirection() : null;
    }
    return settings;
}

export function normalizeSectionSettings(source, level, defaults) {
    const input = source && typeof source === 'object' ? source : {};
    const base = defaults || defaultSectionSettings(level);
    const settings = {
        padding: base.padding === null ? null : normalizeSpacing(input.padding ?? base.padding, base.padding || undefined),
        margin: base.margin === null ? null : normalizeSpacing(input.margin ?? base.margin, base.margin || undefined),
        background: base.background === null ? null : normalizeBackground(input.background ?? base.background),
        visibility: {
            hideDesktop: !!(input.visibility?.hideDesktop ?? base.visibility?.hideDesktop),
            hideMobile: !!(input.visibility?.hideMobile ?? base.visibility?.hideMobile)
        }
    };
    if (level === 'row') {
        const direction = input.columnDirection ?? base.columnDirection;
        settings.columnDirection = base.columnDirection === null || !direction
            ? null
            : {
                desktop: COLUMN_DIRECTIONS.includes(direction.desktop) ? direction.desktop : 'ltr',
                mobile: COLUMN_DIRECTIONS.includes(direction.mobile) ? direction.mobile : 'stack'
            };
    }
    return settings;
}

function emptyImageVariant(inheritKey) {
    const variant = { source: 'url', url: null, contentId: null, width: null, height: null };
    if (inheritKey) variant[inheritKey] = true;
    return variant;
}

export function defaultContent(type, slot = {}) {
    const base = {
        contentId: uuid(),
        type,
        bindingKey: slot.bindingKey || type
    };
    const defaults = slot.defaults || {};
    switch (type) {
        case 'richText':
            return { ...base, complexity: slot.complexity || 'standard', html: defaults.html || '' };
        case 'image':
            return {
                ...base,
                altText: defaults.altText || '',
                desktop: {
                    light: { ...emptyImageVariant(), width: defaults.width || null, height: defaults.height || null },
                    dark: emptyImageVariant('inheritFromLight')
                },
                mobile: {
                    inheritFromDesktop: true,
                    light: emptyImageVariant(),
                    dark: emptyImageVariant('inheritFromLight')
                }
            };
        case 'bulletList':
            return {
                ...base,
                complexity: slot.complexity || 'basic',
                useIcons: (slot.iconPresets || []).length > 0,
                iconPresetId: (slot.iconPresets || [])[0]?.id || null,
                items: [{ itemId: uuid(), html: '' }]
            };
        case 'divider':
            return {
                ...base,
                paddingTop: toInt(defaults.paddingTop, 12),
                paddingBottom: toInt(defaults.paddingBottom, 12),
                showLine: defaults.showLine !== false,
                lineColor: isHexColor(defaults.lineColor) ? defaults.lineColor : '#dddbda',
                lineWidth: toInt(defaults.lineWidth, 1) || 1
            };
        case 'button':
            return {
                ...base,
                visible: defaults.visible !== false,
                label: defaults.label || '',
                targetType: 'WebURL',
                url: '',
                behavior: 'newTab',
                alias: ''
            };
        default:
            return null;
    }
}

/** Builds an empty block configuration (rows > columns > content) from a block or single-block definition. */
export function buildBlockConfig(definition) {
    const sections = definition?.sections || [];
    const slots = definition?.contentSlots || [];
    const byId = new Map(sections.map(section => [section.sectionId, section]));
    const container = sections.find(section => section.level === 'container');
    const rows = sections.filter(section => section.level === 'row');
    const columnsOf = rowId => sections.filter(section => section.level === 'column' && section.parentId === rowId);
    const contentFor = sectionId => slots
        .filter(slot => slot.sectionId === sectionId)
        .map(slot => defaultContent(slot.type, slot))
        .filter(Boolean);
    const sectionDefaults = section => section
        ? normalizeSectionSettings(section.defaults, section.level, defaultSectionSettings(section.level, section.binds))
        : defaultSectionSettings('container', []);
    const rowModels = rows.length
        ? rows
        : [{ sectionId: 'row-1', level: 'row', binds: [], defaults: {}, implicit: true }];
    const config = {
        sectionId: container?.sectionId || 'block',
        blockSettings: sectionDefaults(container),
        rows: rowModels.map(row => {
            const columns = row.implicit ? sections.filter(section => section.level === 'column') : columnsOf(row.sectionId);
            const columnModels = columns.length ? columns : [{ sectionId: row.sectionId, level: 'column', binds: [], implicit: true }];
            return {
                sectionId: row.sectionId,
                rowSettings: row.implicit ? defaultSectionSettings('row', []) : sectionDefaults(byId.get(row.sectionId)),
                columns: columnModels.map(column => ({
                    sectionId: column.sectionId,
                    columnSettings: column.implicit ? defaultSectionSettings('column', []) : sectionDefaults(column),
                    content: contentFor(column.sectionId)
                }))
            };
        })
    };
    const holders = new Set();
    config.rows.forEach(row => row.columns.forEach(column => holders.add(column.sectionId)));
    const orphans = slots.filter(slot => !holders.has(slot.sectionId));
    if (orphans.length) {
        config.rows[0].columns[0].content.push(...orphans.map(slot => defaultContent(slot.type, slot)).filter(Boolean));
    }
    return config;
}

/** Reads the settings object of a section (container, row or column) of a block configuration. */
export function readSectionSettings(config, sectionId) {
    if (!config || !sectionId) return null;
    if ((config.sectionId || 'block') === sectionId) return config.blockSettings;
    for (const row of config.rows || []) {
        if (row.sectionId === sectionId) return row.rowSettings;
        for (const column of row.columns || []) {
            if (column.sectionId === sectionId) return column.columnSettings;
        }
    }
    return null;
}

/** Writes the settings object of a section of a block configuration (mutates `config`). */
export function writeSectionSettings(config, sectionId, value) {
    if ((config.sectionId || 'block') === sectionId) {
        config.blockSettings = value;
        return;
    }
    for (const row of config.rows || []) {
        if (row.sectionId === sectionId) {
            row.rowSettings = value;
            return;
        }
        for (const column of row.columns || []) {
            if (column.sectionId === sectionId) {
                column.columnSettings = value;
                return;
            }
        }
    }
}

export function contentTypesOf(definition) {
    const found = new Set((definition?.contentSlots || []).map(slot => slot.type));
    return CONTENT_TYPES.filter(type => found.has(type));
}

export function emptyMessageContent({ channel, locale, message, masterTemplate } = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        channel: channel || null,
        locale: locale || null,
        message: {
            messageName: message?.messageName || null,
            messageVariantId: message?.messageVariantId || null,
            messageVariantNumber: message?.messageVariantNumber || 1,
            messageVariantVersionId: message?.messageVariantVersionId || null,
            messageVariantVersionNumber: message?.messageVariantVersionNumber || 1,
            settings: message?.settings || {}
        },
        masterTemplate: {
            definitionId: masterTemplate?.definitionId || null,
            definitionName: masterTemplate?.definitionName || null,
            templateMode: masterTemplate?.templateMode || 'multi',
            mceAssetId: masterTemplate?.mceAssetId || null,
            mceAssetPath: masterTemplate?.mceAssetPath || null,
            mcnAssetId: masterTemplate?.mcnAssetId || null,
            mcnAssetPath: masterTemplate?.mcnAssetPath || null
        },
        blocks: []
    };
}

export function newMessageBlock(blockDefinitionRecord, definition, order) {
    return {
        messageBlockId: uuid(),
        blockTemplateDefinitionId: blockDefinitionRecord?.id || null,
        blockTemplateDefinitionName: blockDefinitionRecord?.name || null,
        contentTypes: contentTypesOf(definition),
        mceBlockAssetId: blockDefinitionRecord?.mceAssetId || null,
        mceBlockAssetPath: blockDefinitionRecord?.mceAssetPath || null,
        mcnBlockAssetId: blockDefinitionRecord?.mcnAssetId || null,
        mcnBlockAssetPath: blockDefinitionRecord?.mcnAssetPath || null,
        blockOrderNumber: order || 1,
        blockConfig: buildBlockConfig(definition)
    };
}

// ─── Validation ─────────────────────────────────────────────────────────────

function pushIssue(list, path, message) {
    list.push(path ? `${path}: ${message}` : message);
}

/** Validates a template definition (output of ccTemplateParser.parseTemplate, enriched by the wizard). */
export function validateDefinition(definition) {
    const errors = [];
    const warnings = [];
    if (!definition || typeof definition !== 'object') {
        return { errors: ['Definition is empty.'], warnings };
    }
    if (definition.schemaVersion !== SCHEMA_VERSION) {
        pushIssue(errors, '', `Unsupported schema version ${definition.schemaVersion || '(none)'}.`);
    }
    const sections = definition.sections || [];
    const ids = new Set();
    sections.forEach(section => {
        if (!SECTION_LEVELS.includes(section.level)) pushIssue(errors, section.sectionId, `Unknown section level "${section.level}".`);
        if (ids.has(section.sectionId)) pushIssue(errors, section.sectionId, 'Duplicate section id.');
        ids.add(section.sectionId);
        (section.binds || []).forEach(bind => {
            if (!SECTION_BINDS.includes(bind)) pushIssue(errors, section.sectionId, `Unknown binding "${bind}".`);
            if (bind === 'column-direction' && section.level !== 'row') {
                pushIssue(errors, section.sectionId, 'Column direction can only be bound on rows.');
            }
        });
        const presets = section.presets || {};
        (presets.colors || []).forEach(preset => {
            if (!isHexColor(preset.hex)) pushIssue(errors, section.sectionId, `Color preset "${preset.label || preset.id}" is not a hex color.`);
        });
        (presets.gradients || []).forEach(preset => {
            if (!/gradient\(/i.test(preset.css || '')) pushIssue(errors, section.sectionId, `Gradient preset "${preset.label || preset.id}" has no CSS gradient.`);
            if (!isHexColor(preset.fallbackColor)) pushIssue(errors, section.sectionId, `Gradient preset "${preset.label || preset.id}" needs a fallback hex color.`);
        });
        const targets = section.targets || {};
        const hasTargets = Object.keys(targets).length > 0;
        if ((section.binds || []).includes('background')) {
            if (!hasTargets && !(presets.colors || []).length && !(presets.gradients || []).length) {
                pushIssue(warnings, section.sectionId, 'Background is bound but no color or gradient presets are configured.');
            }
            if (targets.bgColor && !(presets.colors || []).length) {
                pushIssue(warnings, section.sectionId, 'Background color is bound but no color presets are configured.');
            }
            if (targets.bgGradient && !(presets.gradients || []).length) {
                pushIssue(warnings, section.sectionId, 'Background gradient is bound but no gradient presets are configured.');
            }
        }
    });
    const keys = new Set();
    (definition.contentSlots || []).forEach(slot => {
        if (!CONTENT_TYPES.includes(slot.type)) pushIssue(errors, slot.bindingKey, `Unknown content type "${slot.type}".`);
        if (!isBindingKey(slot.bindingKey)) pushIssue(errors, slot.bindingKey, 'Binding key must start with a letter and use letters, digits, "_" or "-".');
        if (keys.has(slot.bindingKey)) pushIssue(errors, slot.bindingKey, 'Duplicate binding key.');
        keys.add(slot.bindingKey);
        if (slot.sectionId && !ids.has(slot.sectionId) && !String(slot.sectionId).startsWith('implicit')) {
            pushIssue(errors, slot.bindingKey, `Content refers to unknown section "${slot.sectionId}".`);
        }
        if ((slot.type === 'richText' || slot.type === 'bulletList') && slot.complexity && !RICH_TEXT_COMPLEXITY[slot.complexity]) {
            pushIssue(errors, slot.bindingKey, `Unknown rich text complexity "${slot.complexity}".`);
        }
        if (slot.type === 'bulletList') {
            (slot.iconPresets || []).forEach(icon => {
                if (!icon.url && !icon.contentId) pushIssue(errors, slot.bindingKey, `Bullet icon "${icon.label || icon.id}" has no image.`);
            });
            if (!(slot.iconPresets || []).length && slot.allowNoIcon === false) {
                pushIssue(errors, slot.bindingKey, 'Add at least one bullet icon or allow lists without icons.');
            }
        }
    });
    const regions = definition.regions || [];
    const blockRegions = regions.filter(region => region.kind === 'blocks');
    if (definition.kind === 'shell' && definition.templateMode === 'multi' && blockRegions.length !== 1) {
        pushIssue(errors, '', 'A multi-block shell needs exactly one blocks region (data-cc-region="blocks").');
    }
    if ((definition.kind === 'block' || definition.templateMode === 'single') && blockRegions.length) {
        pushIssue(errors, '', 'Single-block templates and content blocks cannot contain a blocks region.');
    }
    if ((definition.kind === 'block' || definition.templateMode === 'single') && !(definition.contentSlots || []).length) {
        pushIssue(errors, '', 'Add at least one content binding (data-cc-content).');
    }
    return { errors, warnings };
}

function validateContentItem(item, slot, path, errors) {
    if (!CONTENT_TYPES.includes(item?.type)) {
        pushIssue(errors, path, `Unknown content type "${item?.type}".`);
        return;
    }
    if (slot && slot.type !== item.type) pushIssue(errors, path, `Expected ${slot.type} but found ${item.type}.`);
    if (item.type === 'button' && item.visible) {
        if (!String(item.label || '').trim()) pushIssue(errors, path, 'Button label is required.');
        if (!String(item.url || '').trim()) pushIssue(errors, path, 'Button target URL is required.');
        if (!BUTTON_TARGET_TYPES.includes(item.targetType)) pushIssue(errors, path, 'Button target type must be WebURL or AppURL.');
        if (item.targetType === 'WebURL' && item.url && !/^https?:\/\//i.test(item.url) && !/^%%/.test(item.url)) {
            pushIssue(errors, path, 'Web URLs must start with http:// or https://.');
        }
    }
    if (item.type === 'image') {
        const desktop = item.desktop?.light || {};
        if (!desktop.url && !desktop.contentId) pushIssue(errors, path, 'Desktop image is required.');
    }
    if (item.type === 'bulletList' && !(item.items || []).some(entry => String(entry.html || '').trim())) {
        pushIssue(errors, path, 'Add at least one list item.');
    }
}

/** Validates a message block (blockConfig) against its block definition before Ready/Live. */
export function validateBlockContent(block, definition) {
    const errors = [];
    const slots = new Map((definition?.contentSlots || []).map(slot => [slot.bindingKey, slot]));
    const allowed = new Set(contentTypesOf(definition));
    (block?.blockConfig?.rows || []).forEach((row, rowIndex) => {
        (row.columns || []).forEach((column, columnIndex) => {
            (column.content || []).forEach((item, itemIndex) => {
                const path = `Row ${rowIndex + 1} / Column ${columnIndex + 1} / ${CONTENT_TYPE_LABELS[item?.type] || 'Content'} ${itemIndex + 1}`;
                if (allowed.size && !allowed.has(item?.type)) {
                    pushIssue(errors, path, `${CONTENT_TYPE_LABELS[item?.type] || item?.type} is not supported by this block.`);
                    return;
                }
                validateContentItem(item, slots.get(item?.bindingKey), path, errors);
            });
        });
    });
    return errors;
}

// ─── Message content JSON ───────────────────────────────────────────────────

export function parseJson(value, fallback = null) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value.trim()) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

export function isV1Block(value) {
    return !!(value && typeof value === 'object' && value.blockConfig && Array.isArray(value.blockConfig.rows));
}

/**
 * Wraps a legacy flat block JSON (pre-v1 MCE mirror format, e.g. {"type":"SMSBody","text":"..."})
 * into a v1 block. The original payload is kept under `legacy` so nothing is lost on round trip.
 */
export function migrateLegacyBlock(legacy, { blockType, order } = {}) {
    const source = parseJson(legacy, {}) || {};
    const content = [];
    Object.keys(source).forEach(key => {
        const value = source[key];
        if (key === 'type' || value == null || typeof value === 'object') return;
        const text = String(value);
        if (!text.trim()) return;
        if (/image|img/i.test(key) && /^(https?:|\/)/i.test(text)) {
            const item = defaultContent('image', { bindingKey: key });
            item.desktop.light.url = text;
            content.push(item);
        } else if (/(url|link|href)$/i.test(key)) {
            return;
        } else {
            const item = defaultContent('richText', { bindingKey: key });
            item.html = text;
            content.push(item);
        }
    });
    return {
        messageBlockId: uuid(),
        blockTemplateDefinitionId: null,
        blockTemplateDefinitionName: blockType || source.type || null,
        contentTypes: CONTENT_TYPES.filter(type => content.some(item => item.type === type)),
        mceBlockAssetId: null,
        mceBlockAssetPath: null,
        mcnBlockAssetId: null,
        mcnBlockAssetPath: null,
        blockOrderNumber: order || 1,
        legacy: source,
        blockConfig: {
            sectionId: 'block',
            blockSettings: defaultSectionSettings('container', []),
            rows: [{
                sectionId: 'row-1',
                rowSettings: defaultSectionSettings('row', []),
                columns: [{ sectionId: 'row-1', columnSettings: defaultSectionSettings('column', []), content }]
            }]
        }
    };
}

export function normalizeBlock(value, options = {}) {
    const parsed = parseJson(value, null);
    if (!parsed) return null;
    if (!isV1Block(parsed)) return migrateLegacyBlock(parsed, options);
    return {
        ...parsed,
        blockOrderNumber: toInt(parsed.blockOrderNumber, options.order || 1) || 1,
        contentTypes: Array.isArray(parsed.contentTypes) ? parsed.contentTypes.filter(type => CONTENT_TYPES.includes(type)) : []
    };
}

/** Splits a JSON string over ContentJson__c / ContentJsonPart2__c. */
export function splitJson(json, limit = JSON_FIELD_LIMIT) {
    const text = typeof json === 'string' ? json : JSON.stringify(json);
    if (text.length > limit * 2) {
        throw new Error(`Block content is too large (${text.length} characters, limit ${limit * 2}).`);
    }
    return { part1: text.slice(0, limit), part2: text.length > limit ? text.slice(limit) : null };
}

export function joinJson(part1, part2) {
    return `${part1 || ''}${part2 || ''}`;
}
