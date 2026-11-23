import { isHexColor, TARGET_TOKENS } from 'c/ccTemplateSchema';
import { parseHtml, serializeHtml } from 'c/ccTemplateParser';

const EMPTY_BLOCKS_HTML = '<div class="cc-blocks-empty" style="border:1px dashed #939393;padding:48px 24px;text-align:center;color:#444444;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">No content blocks yet. Add content blocks from the editor palette.</div>';
const UNSAFE_URL = /^\s*(javascript|vbscript|data:text\/html)/i;

function safeUrl(value) {
    const url = String(value || '').trim();
    return url && !UNSAFE_URL.test(url) ? url : '';
}

function sanitizeRichText(html) {
    const { doc } = parseHtml(String(html || ''));
    doc.querySelectorAll('script, iframe, object, embed, style, link, meta').forEach(node => node.remove());
    doc.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attribute => {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on')) node.removeAttribute(attribute.name);
            if ((name === 'href' || name === 'src') && !safeUrl(attribute.value)) node.removeAttribute(attribute.name);
        });
    });
    return doc.body.innerHTML;
}

function sidesCss(sides) {
    if (!sides) return null;
    return `${sides.top || 0}px ${sides.right || 0}px ${sides.bottom || 0}px ${sides.left || 0}px`;
}

function spacingFor(spacing, device) {
    if (!spacing) return null;
    if (device === 'mobile' && spacing.mobile && spacing.mobile.inheritFromDesktop === false) return spacing.mobile;
    return spacing.desktop;
}

// The style attribute is edited as text so email CSS (hex colors, gradients) is kept exactly as written;
// the CSSOM normalizes values and drops what it cannot parse.
function readStyle(element) {
    const entries = new Map();
    String(element.getAttribute('style') || '').split(';').forEach(declaration => {
        const index = declaration.indexOf(':');
        if (index < 0) return;
        const name = declaration.slice(0, index).trim().toLowerCase();
        const value = declaration.slice(index + 1).trim();
        if (name) entries.set(name, value);
    });
    return entries;
}

function setStyle(element, property, value) {
    const entries = readStyle(element);
    if (value === null || value === undefined || value === '') entries.delete(property);
    else entries.set(property, String(value).replace(/;/g, ''));
    const text = Array.from(entries, ([name, entry]) => `${name}: ${entry}`).join('; ');
    if (text) element.setAttribute('style', `${text};`);
    else element.removeAttribute('style');
}

function presetById(list, id) {
    return (list || []).find(item => item.id === id) || null;
}

/** Desktop or mobile image (mobile inherits desktop when not set), and the dark one when the theme is dark and set. */
function backgroundImageVariant(image, device, theme) {
    const pick = set => (device === 'mobile' && set?.mobile && set.mobile.inheritFromDesktop === false && safeUrl(set.mobile.url)
        ? set.mobile
        : set?.desktop || {});
    const light = pick(image);
    if (theme === 'dark' && image?.dark && image.dark.inheritFromLight === false) {
        const dark = pick(image.dark);
        if (safeUrl(dark.url)) return dark;
    }
    return light;
}

function applyBackground(element, background, device, presets, theme) {
    if (!background || background.mode === 'none') return;
    if (background.mode === 'color') {
        const color = background.colorPresetId
            ? presetById(presets?.colors, background.colorPresetId)?.hex
            : background.color;
        if (!isHexColor(color)) return;
        element.setAttribute('bgcolor', color);
        setStyle(element, 'background-color', color);
        return;
    }
    if (background.mode === 'gradient') {
        const preset = background.gradientPresetId ? presetById(presets?.gradients, background.gradientPresetId) : null;
        const css = preset?.css || background.gradient?.css;
        const fallback = preset?.fallbackColor || background.gradient?.fallbackColor;
        if (!css) return;
        if (isHexColor(fallback)) {
            element.setAttribute('bgcolor', fallback);
            setStyle(element, 'background-color', fallback);
        }
        setStyle(element, 'background-image', css);
        return;
    }
    if (background.mode === 'image') {
        const image = background.image || {};
        const variant = backgroundImageVariant(image, device, theme);
        const url = safeUrl(variant.url);
        if (!url) return;
        if (isHexColor(image.fallbackColor)) {
            element.setAttribute('bgcolor', image.fallbackColor);
            setStyle(element, 'background-color', image.fallbackColor);
        }
        element.setAttribute('background', url);
        setStyle(element, 'background-image', `url('${url.replace(/'/g, '%27')}')`);
        setStyle(element, 'background-size', variant.size || 'cover');
        setStyle(element, 'background-repeat', variant.repeat || 'no-repeat');
        setStyle(element, 'background-position', variant.position || 'center');
    }
}

const TOKEN_PATTERN = /\{\{cc-(?:padding|margin|bg-color|bg-gradient|bg-image)\}\}/g;

function tidyStyle(text) {
    return String(text)
        .replace(/(^|;)\s*[a-z-]+\s*:\s*(?=;|$)/gi, '$1')
        .replace(/;(\s*;)+/g, ';')
        .replace(/^\s*;\s*/, '')
        .trim();
}

function placedKeys(element) {
    const placed = new Set();
    Object.keys(TARGET_TOKENS).forEach(key => {
        if (Array.from(element.attributes).some(attribute => attribute.value.includes(TARGET_TOKENS[key]))) placed.add(key);
    });
    return placed;
}

function declarations(parts) {
    return `${parts.filter(Boolean).join('; ')};`;
}

/** What each placeholder renders for these settings. A setting that has no value falls back to what the HTML had. */
function placeholderValues(settings, section, device, theme) {
    const targets = section?.targets || {};
    const fallback = key => String(targets[key]?.fallback || '');
    const values = {
        padding: fallback('padding'),
        margin: fallback('margin'),
        bgColor: fallback('bgColor'),
        bgGradient: fallback('bgGradient'),
        bgImage: fallback('bgImage')
    };
    const padding = spacingFor(settings?.padding, device);
    if (padding) values.padding = sidesCss(padding);
    const margin = spacingFor(settings?.margin, device);
    if (margin) values.margin = sidesCss(margin);
    const background = settings?.background;
    if (!background || background.mode === 'none') return values;
    const presets = section?.presets;
    if (background.mode === 'color') {
        const color = background.colorPresetId ? presetById(presets?.colors, background.colorPresetId)?.hex : background.color;
        if (isHexColor(color)) {
            values.bgColor = color;
            values.bgGradient = '';
            values.bgImage = '';
        }
    } else if (background.mode === 'gradient') {
        const preset = background.gradientPresetId ? presetById(presets?.gradients, background.gradientPresetId) : null;
        const css = preset?.css || background.gradient?.css;
        const base = preset?.fallbackColor || background.gradient?.fallbackColor;
        if (css) {
            values.bgGradient = declarations([
                isHexColor(base) ? `background-color: ${base}` : '',
                `background-image: ${css}`,
                'background-repeat: no-repeat',
                'background-size: cover',
                'min-height: 100vh'
            ]);
            values.bgColor = '';
            values.bgImage = '';
        }
    } else if (background.mode === 'image') {
        const image = background.image || {};
        const variant = backgroundImageVariant(image, device, theme);
        const url = safeUrl(variant.url);
        if (url) {
            const position = !variant.position || variant.position === 'center' ? 'center center' : variant.position;
            values.bgImage = declarations([
                isHexColor(image.fallbackColor) ? `background-color: ${image.fallbackColor}` : '',
                `background-image: url('${url.replace(/'/g, '%27')}')`,
                `background-position: ${position}`,
                `background-repeat: ${variant.repeat || 'no-repeat'}`,
                `background-size: ${variant.size || 'cover'}`,
                'min-height: 100vh',
                'width: 100%'
            ]);
            values.bgColor = '';
            values.bgGradient = '';
        }
    }
    return values;
}

function substitutePlaceholders(element, values) {
    const byToken = {
        [TARGET_TOKENS.padding]: values.padding,
        [TARGET_TOKENS.margin]: values.margin,
        [TARGET_TOKENS.bgColor]: values.bgColor,
        [TARGET_TOKENS.bgGradient]: values.bgGradient,
        [TARGET_TOKENS.bgImage]: values.bgImage
    };
    Array.from(element.attributes).forEach(attribute => {
        if (!attribute.value.includes('{{cc-')) return;
        let text = attribute.value.replace(TOKEN_PATTERN, token => byToken[token] ?? '');
        if (attribute.name === 'style') text = tidyStyle(text);
        if (text) element.setAttribute(attribute.name, text);
        else element.removeAttribute(attribute.name);
    });
}

/** Removes placeholders no section settings were applied to (they must never reach the preview). */
function stripPlaceholders(root) {
    Array.from(root.querySelectorAll('*')).forEach(element => {
        if (Array.from(element.attributes).some(attribute => attribute.value.includes('{{cc-'))) {
            substitutePlaceholders(element, {});
        }
    });
}

/** Applies section settings onto the bound element. Only bound settings are written. */
export function applySectionSettings(element, settings, section, device, theme = 'light') {
    if (!element || !settings) return;
    const binds = new Set(section?.binds || []);
    const placed = placedKeys(element);
    if (placed.size) substitutePlaceholders(element, placeholderValues(settings, section, device, theme));
    const hasBackgroundPlaceholder = placed.has('bgColor') || placed.has('bgGradient') || placed.has('bgImage');
    if (binds.has('padding') && !placed.has('padding')) {
        const sides = spacingFor(settings.padding, device);
        if (sides) setStyle(element, 'padding', sidesCss(sides));
    }
    if (binds.has('margin') && !placed.has('margin')) {
        const sides = spacingFor(settings.margin, device);
        if (sides) setStyle(element, 'margin', sidesCss(sides));
    }
    if (binds.has('background') && !hasBackgroundPlaceholder) applyBackground(element, settings.background, device, section?.presets, theme);
    if (binds.has('hide')) {
        element.classList.toggle('cc-hide-dsk', !!settings.visibility?.hideDesktop);
        element.classList.toggle('cc-hide-mob', !!settings.visibility?.hideMobile);
    }
    if (binds.has('column-direction') && settings.columnDirection) {
        const direction = device === 'mobile' ? settings.columnDirection.mobile : settings.columnDirection.desktop;
        element.setAttribute('dir', direction === 'rtl' || direction === 'stack-reverse' ? 'rtl' : 'ltr');
        element.classList.toggle('cc-stack-mob', String(settings.columnDirection.mobile || '').startsWith('stack'));
    }
}

function isHidden(settings, device) {
    if (!settings?.visibility) return false;
    return device === 'mobile' ? !!settings.visibility.hideMobile : !!settings.visibility.hideDesktop;
}

function imageVariant(item, device, theme) {
    const desktop = item.desktop || {};
    const mobile = item.mobile || {};
    const deviceSet = device === 'mobile' && mobile.inheritFromDesktop === false ? mobile : desktop;
    const light = deviceSet.light || desktop.light || {};
    const dark = deviceSet.dark || {};
    if (theme === 'dark' && dark.inheritFromLight === false && (dark.url || dark.contentId)) return dark;
    if (!light.url && !light.contentId) return desktop.light || {};
    return light;
}

/** Writes one content item into its bound element. */
export function renderContent(element, item, device = 'desktop', theme = 'light', slot = null) {
    if (!element || !item) return;
    switch (item.type) {
        case 'richText':
            element.innerHTML = sanitizeRichText(item.html);
            break;
        case 'image': {
            const variant = imageVariant(item, device, theme);
            const url = safeUrl(variant.url);
            if (url) element.setAttribute('src', url);
            element.setAttribute('alt', item.altText || '');
            if (variant.width) element.setAttribute('width', String(variant.width));
            if (variant.height) element.setAttribute('height', String(variant.height));
            break;
        }
        case 'bulletList': {
            const template = element.querySelector('[data-cc-loop="item"]');
            if (!template) break;
            const icon = item.useIcons
                ? (slot?.iconPresets || []).find(preset => preset.id === item.iconPresetId) || (slot?.iconPresets || [])[0]
                : null;
            const parent = template.parentNode;
            const clones = (item.items || []).filter(entry => String(entry.html || '').trim()).map(entry => {
                const copy = template.cloneNode(true);
                copy.removeAttribute('data-cc-loop');
                const text = copy.querySelector('[data-cc-slot="text"]');
                if (text) text.innerHTML = sanitizeRichText(entry.html);
                const iconElement = copy.querySelector('[data-cc-slot="icon"]');
                if (iconElement) {
                    const iconUrl = safeUrl(icon?.url);
                    if (iconUrl) iconElement.setAttribute('src', iconUrl);
                    else (copy.querySelector('[data-cc-slot="icon-cell"]') || iconElement).remove();
                }
                return copy;
            });
            parent.querySelectorAll('[data-cc-loop="item"]').forEach(node => node.remove());
            clones.forEach(copy => parent.appendChild(copy));
            break;
        }
        case 'divider': {
            setStyle(element, 'padding-top', `${item.paddingTop || 0}px`);
            setStyle(element, 'padding-bottom', `${item.paddingBottom || 0}px`);
            const line = element.querySelector('[data-cc-slot="line"]');
            if (line) {
                if (!item.showLine) line.remove();
                else {
                    if (isHexColor(item.lineColor)) setStyle(line, 'border-top-color', item.lineColor);
                    setStyle(line, 'border-top-width', `${item.lineWidth || 1}px`);
                }
            }
            break;
        }
        case 'button': {
            if (item.visible === false) {
                element.remove();
                break;
            }
            const url = safeUrl(item.url);
            if (url) element.setAttribute('href', url);
            else element.removeAttribute('href');
            element.setAttribute('target', item.behavior === 'sameTab' ? '_self' : '_blank');
            if (item.alias) element.setAttribute('data-alias', item.alias);
            if (item.targetType) element.setAttribute('data-cc-target-type', item.targetType);
            const label = element.querySelector('[data-cc-slot="label"]') || element;
            label.textContent = item.label || '';
            break;
        }
        default:
            break;
    }
}

function contentItemsByKey(blockConfig) {
    const map = new Map();
    (blockConfig?.rows || []).forEach(row => (row.columns || []).forEach(column => (column.content || []).forEach(item => {
        if (!map.has(item.bindingKey)) map.set(item.bindingKey, []);
        map.get(item.bindingKey).push(item);
    })));
    return map;
}

function sectionSettingsById(blockConfig) {
    const map = new Map();
    if (!blockConfig) return map;
    map.set(blockConfig.sectionId || 'block', blockConfig.blockSettings);
    (blockConfig.rows || []).forEach(row => {
        map.set(row.sectionId, row.rowSettings);
        (row.columns || []).forEach(column => {
            if (column.sectionId !== row.sectionId) map.set(column.sectionId, column.columnSettings);
        });
    });
    return map;
}

/**
 * Content items are rendered in the order the marketer arranged them. Each item is written into the
 * first unused element bound to its key; extra items of the same key clone the last bound element.
 */
function renderBoundContent(root, definition, blockConfig, device, theme) {
    const slots = new Map((definition?.contentSlots || []).map(slot => [slot.bindingKey, slot]));
    const items = contentItemsByKey(blockConfig);
    const elements = Array.from(root.querySelectorAll('[data-cc-content]'));
    const byKey = new Map();
    elements.forEach(element => {
        const key = element.getAttribute('data-cc-key');
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(element);
    });
    byKey.forEach((boundElements, key) => {
        const list = items.get(key) || [];
        if (!list.length) {
            const slot = slots.get(key);
            if (slot && slot.regionKind !== 'fixed-read' && slot.regionKind !== 'fixed-edit') {
                boundElements.forEach(element => element.remove());
            }
            return;
        }
        let last = boundElements[boundElements.length - 1];
        list.forEach((item, index) => {
            let target = boundElements[index];
            if (!target) {
                target = last.cloneNode(true);
                last.parentNode.insertBefore(target, last.nextSibling);
                last = target;
            }
            renderContent(target, item, device, theme, slots.get(key));
        });
        boundElements.slice(list.length).forEach(element => element.remove());
    });
}

function renderSections(root, definition, blockConfig, device, theme = 'light') {
    const sectionDefs = new Map((definition?.sections || []).map(section => [section.sectionId, section]));
    const settings = sectionSettingsById(blockConfig);
    const nodes = Array.from(root.querySelectorAll('[data-cc-section]'));
    if (root.hasAttribute && root.hasAttribute('data-cc-section')) nodes.unshift(root);
    nodes.forEach(element => {
        const id = element.getAttribute('data-cc-id');
        const section = sectionDefs.get(id);
        const sectionSettings = settings.get(id) || section?.defaults;
        if (!section || !sectionSettings) return;
        if (section.regionKind === 'fixed-read' || section.regionKind === 'fixed-edit') {
            applySectionSettings(element, section.defaults, section, device, theme);
            return;
        }
        applySectionSettings(element, sectionSettings, section, device, theme);
        if (isHidden(sectionSettings, device) && element.getAttribute('data-cc-preview-hide') !== 'off') {
            element.setAttribute('data-cc-hidden', 'true');
        }
    });
}

/** Renders one content block (block template HTML + block JSON) to an HTML fragment. */
export function renderBlock(blockHtml, definition, block, { device = 'desktop', theme = 'light', preview = true } = {}) {
    const { doc } = parseHtml(blockHtml);
    const root = doc.body;
    renderSections(root, definition, block?.blockConfig, device, theme);
    renderBoundContent(root, definition, block?.blockConfig, device, theme);
    if (preview) {
        stripPlaceholders(root);
        root.querySelectorAll('[data-cc-hidden="true"]').forEach(node => node.remove());
    }
    return root.innerHTML;
}

/**
 * Renders a full message: master shell + ordered blocks.
 * shell: { html, definition }, blocks: [{ html, definition, block }].
 * For single-block templates the shell itself is the block and `shellContent` holds its JSON block.
 */
export function renderMessage({ shell, blocks = [], shellContent = null, device = 'desktop', theme = 'light', preview = true, zonePlaceholder = null }) {
    if (!shell?.html) return '';
    const { doc, isDocument } = parseHtml(shell.html);
    const definition = shell.definition || {};
    renderSections(doc.body, definition, shellContent?.blockConfig, device, theme);
    if (shellContent) renderBoundContent(doc.body, definition, shellContent.blockConfig, device, theme);
    const zone = doc.querySelector('[data-cc-region="blocks"]');
    if (zone) {
        const ordered = blocks.slice().sort((left, right) => (left.block?.blockOrderNumber || 0) - (right.block?.blockOrderNumber || 0));
        const html = ordered.map(entry => renderBlock(entry.html, entry.definition, entry.block, { device, theme, preview })).join('');
        zone.innerHTML = html || (preview ? zonePlaceholder || EMPTY_BLOCKS_HTML : '');
    }
    if (preview) {
        stripPlaceholders(doc.body);
        doc.querySelectorAll('[data-cc-hidden="true"]').forEach(node => node.remove());
        doc.querySelectorAll('script').forEach(node => node.remove());
        doc.documentElement.setAttribute('data-cc-device', device);
        doc.documentElement.setAttribute('data-cc-theme', theme);
    }
    return serializeHtml(doc, isDocument);
}

export function isV1Template(html) {
    return /\bdata-cc-(section|content|region)\s*=/i.test(String(html || ''));
}
