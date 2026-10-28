import { alignLayout, buildBackgroundPayload, emptyColumnLayout } from 'c/contentBindingModel';

const PAD_SIDES = ['top', 'right', 'bottom', 'left'];

function cleanColorList(primary, fallback) {
    const list = Array.isArray(primary) ? primary : (Array.isArray(fallback) ? fallback : []);
    return list.map((item, index) => normalizeColorPreset(item, index));
}

function cleanGradientList(primary, fallback) {
    const list = Array.isArray(primary) && primary.length ? primary : fallback;
    return Array.isArray(list) ? [...list] : [];
}

export function normalizePad(pad) {
    const source = pad && typeof pad === 'object' ? pad : {};
    return {
        top: String(source.top ?? '0'),
        right: String(source.right ?? '0'),
        bottom: String(source.bottom ?? '0'),
        left: String(source.left ?? '0')
    };
}

export function normalizeColorPreset(item, index) {
    if (typeof item === 'string') {
        return { id: `color-${index + 1}`, label: `Color ${index + 1}`, hex: item };
    }
    return {
        id: String(item?.id || `color-${index + 1}`),
        label: String(item?.label || `Color ${index + 1}`),
        hex: String(item?.hex || '')
    };
}

export function normalizeImagePreset(item, index) {
    const urlDesktop = String(item?.urlDesktop || item?.url || '');
    const inherit = item?.mobileInherit !== false;
    return {
        id: String(item?.id || `bg-image-${index + 1}`),
        label: String(item?.label || `Image ${index + 1}`),
        url: urlDesktop,
        urlDesktop,
        urlMobile: String(item?.urlMobile || ''),
        mobileInherit: inherit,
        desktop: item?.desktop !== false,
        mobile: item?.mobile !== false,
        positionX: String(item?.positionX || 'center'),
        positionY: String(item?.positionY || 'center'),
        backgroundRepeat: String(item?.backgroundRepeat || 'no-repeat'),
        backgroundSize: String(item?.backgroundSize || 'cover'),
        positionDesktop: String(item?.positionDesktop || item?.positionX || 'center'),
        sizeDesktop: String(item?.sizeDesktop || item?.backgroundSize || 'cover'),
        repeatDesktop: String(item?.repeatDesktop || item?.backgroundRepeat || 'no-repeat'),
        positionMobile: String(item?.positionMobile || item?.positionDesktop || item?.positionX || 'center'),
        sizeMobile: String(item?.sizeMobile || item?.sizeDesktop || item?.backgroundSize || 'cover'),
        repeatMobile: String(item?.repeatMobile || item?.repeatDesktop || item?.backgroundRepeat || 'no-repeat'),
        fallbackColor: String(item?.fallbackColor || '')
    };
}

export function normalizeGradientPreset(item, index) {
    return {
        id: String(item?.id || `gradient-${index + 1}`),
        label: String(item?.label || `Gradient ${index + 1}`),
        css: String(item?.css || ''),
        fallbackColor: String(item?.fallbackColor || '')
    };
}

export function mergeStudioLayoutDefaults(layout, scan) {
    const aligned = alignLayout(layout, scan);
    const source = layout && typeof layout === 'object' ? layout : {};
    return {
        ...aligned,
        defaultHideDesktop: !!source.defaultHideDesktop,
        defaultHideMobile: !!source.defaultHideMobile,
        defaultPadDesktop: normalizePad(source.defaultPadDesktop ?? aligned.defaultPadDesktop),
        defaultPadMobile: normalizePad(source.defaultPadMobile ?? aligned.defaultPadMobile),
        padMobileInherit: source.padMobileInherit !== false,
        defaultMarginDesktop: normalizePad(source.defaultMarginDesktop ?? aligned.defaultMarginDesktop),
        defaultMarginMobile: normalizePad(source.defaultMarginMobile ?? aligned.defaultMarginMobile),
        marginMobileInherit: source.marginMobileInherit !== false,
        defaultBgColor: String(source.defaultBgColor || ''),
        defaultGradientId: String(source.defaultGradientId || ''),
        defaultBgImagePresetId: String(source.defaultBgImagePresetId || ''),
        backgroundImagePresets: (Array.isArray(source.backgroundImagePresets)
            ? source.backgroundImagePresets
            : []
        ).map(normalizeImagePreset),
        backgroundColors: cleanColorList(source.backgroundColors, aligned.backgroundColors),
        gradients: cleanGradientList(source.gradients, aligned.gradients),
        background: source.background != null ? !!source.background : !!aligned.background,
        defaultBgMode: source.defaultBgMode === 'gradient' || source.defaultBgMode === 'image'
            ? source.defaultBgMode
            : 'color',
        defaultColumnDirDesktop: source.defaultColumnDirDesktop === 'rtl' ? 'rtl' : 'ltr',
        defaultColumnDirMobile: source.defaultColumnDirMobile === 'rtl' ? 'rtl' : 'ltr',
        columns: (scan?.columns || []).map((column, index) => {
            const colSource = Array.isArray(source.columns) ? source.columns[index] : {};
            const colAligned = aligned.columns[index] || emptyColumnLayout();
            return {
                ...colAligned,
                defaultPadDesktop: normalizePad(colSource.defaultPadDesktop ?? colAligned.defaultPadDesktop),
                defaultPadMobile: normalizePad(colSource.defaultPadMobile ?? colAligned.defaultPadMobile),
                padMobileInherit: colSource.padMobileInherit !== false,
                defaultMarginDesktop: normalizePad(colSource.defaultMarginDesktop),
                defaultMarginMobile: normalizePad(colSource.defaultMarginMobile),
                marginMobileInherit: colSource.marginMobileInherit !== false,
                defaultBgColor: String(colSource.defaultBgColor || colAligned.defaultBgColor || ''),
                defaultGradientId: String(colSource.defaultGradientId || colAligned.defaultGradientId || ''),
                defaultBgImagePresetId: String(
                    colSource.defaultBgImagePresetId || colAligned.defaultBgImagePresetId || ''
                ),
                backgroundColors: cleanColorList(colSource.backgroundColors, colAligned.backgroundColors),
                gradients: cleanGradientList(colSource.gradients, colAligned.gradients),
                background: colSource.background != null ? !!colSource.background : !!colAligned.background,
                hideDesktop: colSource.hideDesktop != null ? !!colSource.hideDesktop : !!colAligned.hideDesktop,
                hideMobile: colSource.hideMobile != null ? !!colSource.hideMobile : !!colAligned.hideMobile,
                defaultBgMode: colSource.defaultBgMode === 'gradient' || colSource.defaultBgMode === 'image'
                    ? colSource.defaultBgMode
                    : 'color',
                defaultHideDesktop: !!colSource.defaultHideDesktop,
                defaultHideMobile: !!colSource.defaultHideMobile,
                backgroundImagePresets: (Array.isArray(colSource.backgroundImagePresets)
                    && colSource.backgroundImagePresets.length
                    ? colSource.backgroundImagePresets
                    : colAligned.backgroundImagePresets || []
                ).map(normalizeImagePreset),
                contents: (column.contents || []).map((content, contentIndex) => {
                    const saved = (colSource.contents || [])[contentIndex] || {};
                    const alignedContent = (colAligned.contents || [])[contentIndex] || {};
                    return {
                        ...alignedContent,
                        padding: saved.padding != null ? !!saved.padding : !!alignedContent.padding,
                        background: saved.background != null ? !!saved.background : !!alignedContent.background,
                        hideDesktop: saved.hideDesktop != null ? !!saved.hideDesktop : !!alignedContent.hideDesktop,
                        hideMobile: saved.hideMobile != null ? !!saved.hideMobile : !!alignedContent.hideMobile,
                        backgroundColor: !!saved.backgroundColor,
                        backgroundImage: !!saved.backgroundImage,
                        backgroundGradient: !!saved.backgroundGradient,
                        defaultHideDesktop: !!saved.defaultHideDesktop,
                        defaultHideMobile: !!saved.defaultHideMobile,
                        defaultPadDesktop: normalizePad(saved.defaultPadDesktop),
                        defaultPadMobile: normalizePad(saved.defaultPadMobile),
                        padMobileInherit: saved.padMobileInherit !== false,
                        defaultMarginDesktop: normalizePad(saved.defaultMarginDesktop),
                        defaultMarginMobile: normalizePad(saved.defaultMarginMobile),
                        marginMobileInherit: saved.marginMobileInherit !== false,
                        defaultBgColor: String(saved.defaultBgColor || ''),
                        defaultBgMode: saved.defaultBgMode === 'gradient' || saved.defaultBgMode === 'image'
                            ? saved.defaultBgMode
                            : 'color',
                        defaultGradientId: String(saved.defaultGradientId || ''),
                        defaultBgImagePresetId: String(saved.defaultBgImagePresetId || ''),
                        backgroundColors: cleanColorList(saved.backgroundColors, alignedContent.backgroundColors),
                        gradients: cleanGradientList(saved.gradients, alignedContent.gradients),
                        backgroundImagePresets: (Array.isArray(saved.backgroundImagePresets)
                            ? saved.backgroundImagePresets
                            : []
                        ).map(normalizeImagePreset)
                    };
                })
            };
        })
    };
}

function placeholderBadge(name) {
    return `{{${name}}}`;
}

function settingRow(config) {
    return { ...config, placeholderLabel: config.placeholder ? placeholderBadge(config.placeholder) : '' };
}

const HIDE_DESKTOP_TOKENS = ['container-hide-dsk', 'blo-hide-dsk', 'column-hide-dsk', 'content-hide-dsk'];
const HIDE_MOBILE_TOKENS = ['container-hide-mob', 'blo-hide-mob', 'column-hide-mob', 'content-hide-mob'];
const PAD_DESKTOP_TOKENS = ['container-pad-dsk', 'blo-pad-dsk', 'column-pad-dsk', 'col-pad-dsk', 'content-pad-dsk'];
const PAD_MOBILE_TOKENS = ['container-pad-mob', 'blo-pad-mob', 'column-pad-mob', 'col-pad-mob', 'content-pad-mob'];
const BG_TOKENS = ['container-bg', 'column-bg', 'content-bg'];

function firstToken(names, candidates) {
    return (candidates || []).find(name => (names || []).includes(name)) || '';
}

function sectionPlaceholders(settings) {
    return settings.flatMap(row => (
        row.placeholders?.length
            ? row.placeholders.map(placeholderBadge)
            : (row.placeholder ? [placeholderBadge(row.placeholder)] : [])
    ));
}

function appendRegionSettings(settings, region, config, scope) {
    const names = region?.placeholders || [];
    const prefix = scope.prefix || '';
    const hideDesktopToken = firstToken(names, HIDE_DESKTOP_TOKENS);
    const hideMobileToken = firstToken(names, HIDE_MOBILE_TOKENS);
    if (hideDesktopToken && hideMobileToken) {
        settings.push(settingRow({
            key: `${scope.id}-hide`,
            type: 'hidePair',
            label: 'Visibility',
            pathPrefix: prefix,
            columnIndex: scope.columnIndex,
            contentIndex: scope.contentIndex,
            hideDesktopToken,
            hideMobileToken,
            hideDesktopEnabled: !!config.hideDesktop,
            hideMobileEnabled: !!config.hideMobile,
            hiddenDesktop: !!config.defaultHideDesktop,
            hiddenMobile: !!config.defaultHideMobile,
            hideDesktopEnablePath: `${prefix}hideDesktop`,
            hideMobileEnablePath: `${prefix}hideMobile`,
            hideDesktopPath: `${prefix}defaultHideDesktop`,
            hideMobilePath: `${prefix}defaultHideMobile`,
            placeholders: [hideDesktopToken, hideMobileToken]
        }));
    } else if (hideDesktopToken || hideMobileToken) {
        const token = hideDesktopToken || hideMobileToken;
        settings.push(settingRow({
            key: `${scope.id}-hide`,
            type: 'hideDefault',
            label: hideMobileToken ? 'Hide on mobile' : 'Hide on desktop',
            device: hideMobileToken ? 'mobile' : 'desktop',
            placeholder: token,
            pathPrefix: prefix,
            columnIndex: scope.columnIndex,
            contentIndex: scope.contentIndex,
            enabled: hideMobileToken ? !!config.hideMobile : !!config.hideDesktop,
            hiddenByDefault: hideMobileToken ? !!config.defaultHideMobile : !!config.defaultHideDesktop,
            hideDefaultPath: hideMobileToken ? `${prefix}defaultHideMobile` : `${prefix}defaultHideDesktop`,
            enablePath: hideMobileToken ? `${prefix}hideMobile` : `${prefix}hideDesktop`
        }));
    }
    const padDesktopToken = firstToken(names, PAD_DESKTOP_TOKENS);
    const padMobileToken = firstToken(names, PAD_MOBILE_TOKENS);
    if (padDesktopToken || padMobileToken || region?.padDesktop || region?.padMobile) {
        const placeholders = [padDesktopToken, padMobileToken].filter(Boolean);
        if (placeholders.length || region?.padDesktop || region?.padMobile) {
            settings.push(settingRow({
                key: `${scope.id}-padding`,
                type: 'padding',
                label: 'Padding',
                pathPrefix: prefix,
                columnIndex: scope.columnIndex,
                contentIndex: scope.contentIndex,
                placeholders: placeholders.length ? placeholders : undefined,
                enabled: !!config.padding,
                enablePath: `${prefix}padding`,
                padDesktopPath: `${prefix}defaultPadDesktop`,
                padMobilePath: `${prefix}defaultPadMobile`,
                marginDesktopPath: `${prefix}defaultMarginDesktop`,
                marginMobilePath: `${prefix}defaultMarginMobile`,
                padDesktop: config.defaultPadDesktop,
                padMobile: config.defaultPadMobile,
                padMobileInherit: config.padMobileInherit,
                marginDesktop: config.defaultMarginDesktop,
                marginMobile: config.defaultMarginMobile,
                marginMobileInherit: config.marginMobileInherit
            }));
        }
    }
    const backgroundToken = firstToken(names, BG_TOKENS);
    if (backgroundToken) {
        settings.push(settingRow({
            key: `${scope.id}-background`,
            type: 'backgroundStyle',
            label: 'Background style',
            placeholder: backgroundToken,
            pathPrefix: prefix,
            columnIndex: scope.columnIndex,
            contentIndex: scope.contentIndex,
            enabled: !!config.background,
            enablePath: `${prefix}background`,
            bgMode: config.defaultBgMode || 'color',
            bgModePath: `${prefix}defaultBgMode`,
            colors: config.backgroundColors || [],
            defaultColor: config.defaultBgColor,
            gradients: config.gradients || [],
            defaultGradientId: config.defaultGradientId,
            presets: config.backgroundImagePresets || [],
            defaultPresetId: config.defaultBgImagePresetId,
            colorOptions: config.backgroundColors || []
        }));
    }
    if (!backgroundToken && (region?.bgColor || names.includes('blo-bg-color') || names.includes('col-bg-color'))) {
        settings.push(settingRow({
            key: `${scope.id}-bgColor`,
            type: 'backgroundColor',
            label: 'Background color',
            placeholder: firstToken(names, ['blo-bg-color', 'col-bg-color']) || 'blo-bg-color',
            pathPrefix: prefix,
            columnIndex: scope.columnIndex,
            enabled: !!config.backgroundColor,
            colors: config.backgroundColors || [],
            defaultColor: config.defaultBgColor
        }));
    }
    if (!backgroundToken && (region?.bgImage || names.includes('blo-bg-img') || names.includes('col-bg-image'))) {
        settings.push(settingRow({
            key: `${scope.id}-bgImage`,
            type: 'backgroundImage',
            label: 'Background image',
            placeholder: firstToken(names, ['blo-bg-img', 'col-bg-image']) || 'blo-bg-img',
            pathPrefix: prefix,
            columnIndex: scope.columnIndex,
            enabled: !!config.backgroundImage,
            presets: config.backgroundImagePresets || [],
            defaultPresetId: config.defaultBgImagePresetId,
            colorOptions: config.backgroundColors || []
        }));
    }
    if (!backgroundToken && (region?.bgGradient || names.includes('blo-bg-grd') || names.includes('col-bg-gradient'))) {
        settings.push(settingRow({
            key: `${scope.id}-bgGradient`,
            type: 'backgroundGradient',
            label: 'Background gradient',
            placeholder: firstToken(names, ['blo-bg-grd', 'col-bg-gradient']) || 'blo-bg-grd',
            pathPrefix: prefix,
            columnIndex: scope.columnIndex,
            enabled: !!config.backgroundGradient,
            gradients: config.gradients || [],
            defaultGradientId: config.defaultGradientId,
            colorOptions: config.backgroundColors || []
        }));
    }
}

export function buildSettingsBindingSections(scan, layout) {
    const config = mergeStudioLayoutDefaults(layout, scan);
    const sections = [];

    if (scan?.columnDirection) {
        sections.push({
            key: 'container',
            title: 'Container (binding-container)',
            placeholders: [placeholderBadge('column-dir')],
            settings: [
                settingRow({
                    key: 'columnDirectionDesktop',
                    type: 'columnDirection',
                    label: 'Column layout',
                    device: 'desktop',
                    placeholder: 'column-dir',
                    enabled: !!config.columnDirection,
                    value: config.defaultColumnDirDesktop
                }),
                settingRow({
                    key: 'columnDirectionMobile',
                    type: 'columnDirection',
                    label: 'Column layout',
                    device: 'mobile',
                    placeholder: 'column-dir',
                    enabled: !!config.columnDirection,
                    value: config.defaultColumnDirMobile
                })
            ]
        });
    }

    const blockSettings = [];
    appendRegionSettings(blockSettings, scan?.block, config, {
        id: 'block',
        prefix: '',
        columnIndex: undefined,
        contentIndex: undefined
    });
    if (blockSettings.length) {
        sections.unshift({
            key: 'block',
            title: 'Block container',
            placeholders: sectionPlaceholders(blockSettings),
            settings: blockSettings
        });
    }

    (scan?.columns || []).forEach((column, index) => {
        const colConfig = config.columns[index] || emptyColumnLayout();
        const colSettings = [];
        appendRegionSettings(colSettings, column, colConfig, {
            id: `col-${index}`,
            prefix: `columns[${index}].`,
            columnIndex: index,
            contentIndex: undefined
        });
        if (colSettings.length) {
            sections.push({
                key: `column-${index}`,
                nested: true,
                title: column.label || `Column ${index + 1}`,
                placeholders: sectionPlaceholders(colSettings),
                settings: colSettings
            });
        }
        (column.contents || []).forEach((content, contentIndex) => {
            const contentConfig = colConfig.contents?.[contentIndex] || {};
            const contentSettings = [];
            appendRegionSettings(contentSettings, content, contentConfig, {
                id: `col-${index}-content-${contentIndex}`,
                prefix: `columns[${index}].contents[${contentIndex}].`,
                columnIndex: index,
                contentIndex
            });
            if (!contentSettings.length) return;
            sections.push({
                key: `column-${index}-content-${contentIndex}`,
                nested: true,
                title: `${column.label || `Column ${index + 1}`} content`,
                placeholders: sectionPlaceholders(contentSettings),
                settings: contentSettings
            });
        });
    });

    return sections;
}

function sameScopeIndex(left, right) {
    const normalize = (value) => (value == null || value === '' ? null : Number(value));
    return normalize(left) === normalize(right);
}

function focusMatches(focus, columnIndex, contentIndex) {
    if (!focus) return false;
    return sameScopeIndex(focus.columnIndex, columnIndex)
        && sameScopeIndex(focus.contentIndex, contentIndex);
}

function regionPreview(region, focus, columnIndex, contentIndex, isMobile) {
    const source = region || {};
    const applies = focusMatches(focus, columnIndex, contentIndex);
    let hideDesktop = !!source.defaultHideDesktop;
    let hideMobile = !!source.defaultHideMobile;
    if (applies && focus.kind === 'hideDesktop') hideDesktop = focus.value === 'hidden';
    if (applies && focus.kind === 'hideMobile') hideMobile = focus.value === 'hidden';
    let padDesktop = normalizePad(source.defaultPadDesktop);
    let padMobile = source.padMobileInherit === false
        ? normalizePad(source.defaultPadMobile)
        : padDesktop;
    if (applies && focus.kind === 'padding') {
        const pad = normalizePad(focus.value);
        if (isMobile) padMobile = pad;
        else padDesktop = pad;
    }
    const shownPad = isMobile ? padMobile : padDesktop;
    let mode = source.defaultBgMode || 'color';
    const firstColor = source.backgroundColors?.[0];
    let color = source.defaultBgColor || (typeof firstColor === 'string' ? firstColor : firstColor?.hex) || '';
    let gradientId = source.defaultGradientId || (source.gradients || [])[0]?.id || '';
    let imageId = source.defaultBgImagePresetId || '';
    if (applies && focus.kind === 'bgMode') mode = focus.value || mode;
    if (applies && focus.kind === 'bgColor') {
        mode = 'color';
        color = focus.value || color;
    }
    if (applies && focus.kind === 'bgGradient') {
        mode = 'gradient';
        gradientId = focus.value || gradientId;
    }
    if (applies && focus.kind === 'bgImage') {
        mode = 'image';
        imageId = focus.value || imageId;
    }
    const imagePreset = (source.backgroundImagePresets || []).find(item => item.id === imageId)
        || (source.backgroundImagePresets || []).find(item => item.url || item.urlDesktop || item.urlMobile);
    const backgroundPayload = (source.background || source.backgroundColor || source.backgroundImage || source.backgroundGradient)
        ? buildBackgroundPayload(source, {
            mode: source.background ? mode : (source.backgroundGradient ? 'gradient' : source.backgroundImage ? 'image' : 'color'),
            color,
            gradientId,
            imageId,
            device: isMobile ? 'mobile' : 'desktop'
        })
        : null;
    return {
        hideDesktop,
        hideMobile,
        padDesktop: shownPad,
        padMobile,
        padMobileInherit: source.padMobileInherit !== false,
        bgColor: color,
        bgImage: imagePreset?.url || '',
        bgGradientId: gradientId,
        backgroundPayload
    };
}

export function layoutToPreviewRuntimeState(layout, scan, focus, device) {
    const config = mergeStudioLayoutDefaults(layout, scan);
    const isMobile = device === 'mobile';
    const block = regionPreview(config, focus, null, null, isMobile);
    let columnDirection = isMobile ? config.defaultColumnDirMobile : config.defaultColumnDirDesktop;
    if (focus?.kind === 'columnDirection') {
        const dir = focus.value === 'rtl' ? 'rtl' : 'ltr';
        const deviceMatches = !focus.device || (focus.device === 'mobile') === isMobile;
        if (deviceMatches) columnDirection = dir;
    }
    return {
        ...block,
        columnDirection,
        columns: (config.columns || []).map((column, index) => ({
            ...regionPreview(column, focus, index, null, isMobile),
            contents: (column.contents || []).map((content, contentIndex) =>
                regionPreview(content, focus, index, contentIndex, isMobile)
            )
        }))
    };
}

export function patchLayoutConfig(layout, scan, patch) {
    const config = mergeStudioLayoutDefaults(layout, scan);
    const next = JSON.parse(JSON.stringify(config));
    if (!patch?.path) return next;
    assignPath(next, patch.path, patch.value);
    return next;
}

function assignPath(root, path, value) {
    const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cursor = root;
    parts.forEach((part, index) => {
        if (index === parts.length - 1) {
            cursor[part] = value;
            return;
        }
        const nextPart = parts[index + 1];
        if (cursor[part] == null || typeof cursor[part] !== 'object') {
            cursor[part] = /^\d+$/.test(nextPart) ? [] : {};
        }
        cursor = cursor[part];
    });
}
