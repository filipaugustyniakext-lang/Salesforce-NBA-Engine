import { alignLayout, emptyColumnLayout } from 'c/contentBindingModel';

const PAD_SIDES = ['top', 'right', 'bottom', 'left'];

function cleanColorList(primary, fallback) {
    if (Array.isArray(primary)) {
        return primary.map(value => String(value ?? ''));
    }
    return Array.isArray(fallback) ? [...fallback] : [];
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

export function normalizeImagePreset(item, index) {
    return {
        id: String(item?.id || `bg-image-${index + 1}`),
        label: String(item?.label || `Image ${index + 1}`),
        url: String(item?.url || ''),
        desktop: item?.desktop !== false,
        mobile: item?.mobile !== false,
        positionX: String(item?.positionX || 'center'),
        positionY: String(item?.positionY || 'center'),
        backgroundRepeat: String(item?.backgroundRepeat || 'no-repeat'),
        backgroundSize: String(item?.backgroundSize || 'cover'),
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
        defaultBgColor: String(source.defaultBgColor || ''),
        defaultGradientId: String(source.defaultGradientId || ''),
        defaultBgImagePresetId: String(source.defaultBgImagePresetId || ''),
        backgroundImagePresets: (Array.isArray(source.backgroundImagePresets)
            ? source.backgroundImagePresets
            : []
        ).map(normalizeImagePreset),
        backgroundColors: cleanColorList(source.backgroundColors, aligned.backgroundColors),
        gradients: cleanGradientList(source.gradients, aligned.gradients),
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
                defaultBgColor: String(colSource.defaultBgColor || colAligned.defaultBgColor || ''),
                defaultGradientId: String(colSource.defaultGradientId || colAligned.defaultGradientId || ''),
                defaultBgImagePresetId: String(
                    colSource.defaultBgImagePresetId || colAligned.defaultBgImagePresetId || ''
                ),
                backgroundColors: cleanColorList(colSource.backgroundColors, colAligned.backgroundColors),
                gradients: cleanGradientList(colSource.gradients, colAligned.gradients),
                backgroundImagePresets: (Array.isArray(colSource.backgroundImagePresets)
                    && colSource.backgroundImagePresets.length
                    ? colSource.backgroundImagePresets
                    : colAligned.backgroundImagePresets || []
                ).map(normalizeImagePreset)
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
    if (scan?.block?.hideDesktop) {
        blockSettings.push(settingRow({
            key: 'hideDesktop',
            type: 'hideDefault',
            label: 'Hide on desktop',
            device: 'desktop',
            placeholder: 'blo-hide-dsk',
            enabled: !!config.hideDesktop,
            hiddenByDefault: !!config.defaultHideDesktop
        }));
    }
    if (scan?.block?.hideMobile) {
        blockSettings.push(settingRow({
            key: 'hideMobile',
            type: 'hideDefault',
            label: 'Hide on mobile',
            device: 'mobile',
            placeholder: 'blo-hide-mob',
            enabled: !!config.hideMobile,
            hiddenByDefault: !!config.defaultHideMobile
        }));
    }
    if (scan?.block?.padDesktop || scan?.block?.padMobile) {
        blockSettings.push(settingRow({
            key: 'blockPadding',
            type: 'padding',
            label: 'Block padding',
            placeholders: [
                scan?.block?.padDesktop ? 'blo-pad-dsk' : null,
                scan?.block?.padMobile ? 'blo-pad-mob' : null
            ].filter(Boolean),
            enabled: !!config.padding,
            padDesktop: config.defaultPadDesktop,
            padMobile: config.defaultPadMobile,
            padMobileInherit: config.padMobileInherit
        }));
    }
    if (scan?.block?.bgColor) {
        blockSettings.push(settingRow({
            key: 'blockBgColor',
            type: 'backgroundColor',
            label: 'Background color',
            placeholder: 'blo-bg-color',
            enabled: !!config.backgroundColor,
            colors: config.backgroundColors || [],
            defaultColor: config.defaultBgColor
        }));
    }
    if (scan?.block?.bgImage) {
        blockSettings.push(settingRow({
            key: 'blockBgImage',
            type: 'backgroundImage',
            label: 'Background image',
            placeholder: 'blo-bg-img',
            enabled: !!config.backgroundImage,
            presets: config.backgroundImagePresets || [],
            defaultPresetId: config.defaultBgImagePresetId,
            colorOptions: config.backgroundColors || []
        }));
    }
    if (scan?.block?.bgGradient) {
        blockSettings.push(settingRow({
            key: 'blockBgGradient',
            type: 'backgroundGradient',
            label: 'Background gradient',
            placeholder: 'blo-bg-grd',
            enabled: !!config.backgroundGradient,
            gradients: config.gradients || [],
            defaultGradientId: config.defaultGradientId,
            colorOptions: config.backgroundColors || []
        }));
    }

    if (blockSettings.length) {
        sections.unshift({
            key: 'block',
            title: 'Block settings',
            placeholders: blockSettings.flatMap(row => (
                row.placeholders?.length
                    ? row.placeholders.map(placeholderBadge)
                    : (row.placeholder ? [placeholderBadge(row.placeholder)] : [])
            )),
            settings: blockSettings
        });
    }

    (scan?.columns || []).forEach((column, index) => {
        const colConfig = config.columns[index] || emptyColumnLayout();
        const colSettings = [];
        if (column.padDesktop || column.padMobile) {
            colSettings.push(settingRow({
                key: `col-${index}-padding`,
                type: 'padding',
                label: 'Column padding',
                columnIndex: index,
                placeholders: [
                    column.padDesktop ? 'col-pad-dsk' : null,
                    column.padMobile ? 'col-pad-mob' : null
                ].filter(Boolean),
                enabled: !!colConfig.padding,
                padDesktop: colConfig.defaultPadDesktop,
                padMobile: colConfig.defaultPadMobile,
                padMobileInherit: colConfig.padMobileInherit
            }));
        }
        if (column.bgColor) {
            colSettings.push(settingRow({
                key: `col-${index}-bgColor`,
                type: 'backgroundColor',
                label: 'Background color',
                columnIndex: index,
                placeholder: 'col-bg-color',
                enabled: !!colConfig.backgroundColor,
                colors: colConfig.backgroundColors || [],
                defaultColor: colConfig.defaultBgColor
            }));
        }
        if (column.bgImage) {
            colSettings.push(settingRow({
                key: `col-${index}-bgImage`,
                type: 'backgroundImage',
                label: 'Background image',
                columnIndex: index,
                placeholder: 'col-bg-image',
                enabled: !!colConfig.backgroundImage,
                presets: colConfig.backgroundImagePresets || [],
                defaultPresetId: colConfig.defaultBgImagePresetId,
                colorOptions: colConfig.backgroundColors || []
            }));
        }
        if (column.bgGradient) {
            colSettings.push(settingRow({
                key: `col-${index}-bgGradient`,
                type: 'backgroundGradient',
                label: 'Background gradient',
                columnIndex: index,
                placeholder: 'col-bg-gradient',
                enabled: !!colConfig.backgroundGradient,
                gradients: colConfig.gradients || [],
                defaultGradientId: colConfig.defaultGradientId,
                colorOptions: colConfig.backgroundColors || []
            }));
        }
        if (!colSettings.length) return;
        sections.push({
            key: `column-${index}`,
            nested: true,
            title: column.label || `Column ${index + 1}`,
            placeholders: colSettings.flatMap(row => (
                row.placeholders?.length
                    ? row.placeholders.map(placeholderBadge)
                    : (row.placeholder ? [placeholderBadge(row.placeholder)] : [])
            )),
            settings: colSettings
        });
    });

    return sections;
}

export function layoutToPreviewRuntimeState(layout, scan, focus, device) {
    const config = mergeStudioLayoutDefaults(layout, scan);
    const isMobile = device === 'mobile';
    const padDesktop = isMobile && config.padMobileInherit
        ? config.defaultPadDesktop
        : (isMobile ? config.defaultPadMobile : config.defaultPadDesktop);
    const padMobile = config.padMobileInherit ? config.defaultPadDesktop : config.defaultPadMobile;

    let hideDesktop = !!config.defaultHideDesktop;
    let hideMobile = !!config.defaultHideMobile;
    let bgColor = config.defaultBgColor || (config.backgroundColors || [])[0] || '';
    let bgImage = '';
    let bgGradientId = config.defaultGradientId || (config.gradients || [])[0]?.id || '';
    let columnDirection = isMobile ? config.defaultColumnDirMobile : config.defaultColumnDirDesktop;

    if (focus) {
        if (focus.kind === 'hideDesktop' || focus.kind === 'hideMobile') {
            const hidden = focus.value === 'hidden';
            if (focus.kind === 'hideDesktop') hideDesktop = hidden;
            if (focus.kind === 'hideMobile') hideMobile = hidden;
        }
        if (focus.kind === 'bgColor') bgColor = focus.value || bgColor;
        if (focus.kind === 'bgGradient') bgGradientId = focus.value || bgGradientId;
        if (focus.kind === 'bgImage') {
            const preset = (config.backgroundImagePresets || []).find(item => item.id === focus.value);
            if (preset?.url) bgImage = preset.url;
        }
        if (focus.kind === 'columnDirection') {
            const dir = focus.value === 'rtl' ? 'rtl' : 'ltr';
            const deviceMatches = !focus.device
                || (focus.device === 'mobile') === isMobile;
            if (deviceMatches) columnDirection = dir;
        }
        if (focus.kind === 'padding') {
            const pad = normalizePad(
                focus.value && typeof focus.value === 'object' ? focus.value : padDesktop
            );
            const blockPadDesktop = focus.columnIndex == null
                ? (isMobile && !config.padMobileInherit ? config.defaultPadDesktop : pad)
                : config.defaultPadDesktop;
            const blockPadMobile = focus.columnIndex == null
                ? (config.padMobileInherit ? pad : normalizePad(focus.mobileValue || pad))
                : config.defaultPadMobile;
            return {
                hideDesktop,
                hideMobile,
                padDesktop: blockPadDesktop,
                padMobile: blockPadMobile,
                padMobileInherit: config.padMobileInherit,
                bgColor,
                bgImage,
                bgGradientId,
                columnDirection,
                columns: config.columns.map((col, index) => {
                    if (focus.columnIndex === index) {
                        return columnPreviewRuntime(col, { ...focus, kind: 'paddingCol' }, index, isMobile, pad);
                    }
                    return columnPreviewRuntime(col, focus, index, isMobile);
                })
            };
        }
    }

    const imagePreset = (config.backgroundImagePresets || []).find(
        item => item.id === config.defaultBgImagePresetId
    );
    if (imagePreset?.url) bgImage = imagePreset.url;

    return {
        hideDesktop,
        hideMobile,
        padDesktop: isMobile ? padMobile : config.defaultPadDesktop,
        padMobile,
        padMobileInherit: config.padMobileInherit,
        bgColor,
        bgImage,
        bgGradientId,
        columnDirection,
        columns: config.columns.map(col => columnPreviewRuntime(col, null, null, isMobile))
    };
}

function columnPreviewRuntime(col, focus, columnIndex, isMobile, padOverride) {
    let pad = padOverride
        ? normalizePad(padOverride)
        : (isMobile && col.padMobileInherit ? col.defaultPadDesktop : (
            isMobile ? col.defaultPadMobile : col.defaultPadDesktop
        ));
    if (focus?.kind === 'paddingCol' && padOverride) {
        pad = normalizePad(padOverride);
    }
    let bgColor = col.defaultBgColor || (col.backgroundColors || [])[0] || '';
    let bgImage = '';
    let bgGradientId = col.defaultGradientId || (col.gradients || [])[0]?.id || '';
    if (focus && focus.columnIndex === columnIndex) {
        if (focus.kind === 'bgColor') bgColor = focus.value || bgColor;
        if (focus.kind === 'bgGradient') bgGradientId = focus.value || bgGradientId;
        if (focus.kind === 'bgImage') {
            const preset = (col.backgroundImagePresets || []).find(item => item.id === focus.value);
            if (preset?.url) bgImage = preset.url;
        }
    } else {
        const preset = (col.backgroundImagePresets || []).find(item => item.id === col.defaultBgImagePresetId);
        if (preset?.url) bgImage = preset.url;
    }
    return {
        padDesktop: pad,
        padMobile: col.padMobileInherit ? col.defaultPadDesktop : col.defaultPadMobile,
        padMobileInherit: col.padMobileInherit,
        bgColor,
        bgImage,
        bgGradientId
    };
}

export function patchLayoutConfig(layout, scan, patch) {
    const config = mergeStudioLayoutDefaults(layout, scan);
    const next = JSON.parse(JSON.stringify(config));
    const { path, value } = patch;
    if (!path) return next;
    const columnMatch = path.match(/^columns\[(\d+)\]\.(.+)$/);
    if (columnMatch) {
        const idx = Number(columnMatch[1]);
        const field = columnMatch[2];
        while (next.columns.length <= idx) {
            next.columns.push(emptyColumnLayout());
        }
        next.columns[idx][field] = value;
        return next;
    }
    next[path] = value;
    return next;
}
