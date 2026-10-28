import { LightningElement, api, track } from 'lwc';
import { parseBlockTemplate } from 'c/contentBindingModel';
import {
    buildSettingsBindingSections,
    mergeStudioLayoutDefaults,
    normalizePad,
    normalizeImagePreset,
    normalizeGradientPreset,
    normalizeColorPreset,
    patchLayoutConfig
} from 'c/blockLayoutStudio';

const VISIBILITY_RADIO_OPTIONS = [
    { label: 'Show', value: 'visible' },
    { label: 'Hide', value: 'hidden' }
];

const PAD_DEVICE_RADIO_OPTIONS = [
    { label: 'Desktop', value: 'desktop' },
    { label: 'Mobile', value: 'mobile' }
];

function safeSwatchHex(hex) {
    const value = String(hex || '').trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '#ffffff';
}

export default class MasterTemplateSettingsBindings extends LightningElement {
    @api blockHtml = '';
    _layoutConfig = null;
    @track padDeviceBySettingKey = {};
    @track imageDeviceByPresetKey = {};

    @api
    get layoutConfig() {
        return this._layoutConfig;
    }

    set layoutConfig(value) {
        this._layoutConfig = value && typeof value === 'object' ? value : null;
    }

    get scan() {
        return parseBlockTemplate(this.blockHtml || '');
    }

    get sections() {
        return buildSettingsBindingSections(this.scan, this._layoutConfig).map(section => ({
            ...section,
            cardClass: 'settings-binding-card slds-card slds-card_boundary slds-m-bottom_small'
                + (section.nested ? ' settings-binding-card_nested' : ''),
            settings: (section.settings || []).map(setting => this._decorateSetting(setting, section.key))
        }));
    }

    get hasSections() {
        return this.sections.length > 0;
    }

    _decorateSetting(setting, sectionKey) {
        const base = {
            ...setting,
            sectionKey,
            enablePath: this._enablePath(setting),
            showEnable: setting.type !== 'columnDirection' && setting.type !== 'hidePair',
            isHideDefault: setting.type === 'hideDefault',
            isHidePair: setting.type === 'hidePair',
            isPadding: setting.type === 'padding',
            isBackgroundStyle: setting.type === 'backgroundStyle',
            isBackgroundColor: setting.type === 'backgroundColor' || (setting.type === 'backgroundStyle' && (setting.bgMode || 'color') === 'color'),
            isBackgroundImage: setting.type === 'backgroundImage' || (setting.type === 'backgroundStyle' && setting.bgMode === 'image'),
            isBackgroundGradient: setting.type === 'backgroundGradient' || (setting.type === 'backgroundStyle' && setting.bgMode === 'gradient'),
            isColumnDirection: setting.type === 'columnDirection',
            hideDefaultPath: setting.hideDefaultPath || (setting.key === 'hideMobile' ? 'defaultHideMobile' : 'defaultHideDesktop'),
            padDesktopPath: setting.padDesktopPath || (setting.columnIndex === undefined
                ? 'defaultPadDesktop'
                : `columns[${setting.columnIndex}].defaultPadDesktop`),
            padMobilePath: setting.padMobilePath || (setting.columnIndex === undefined
                ? 'defaultPadMobile'
                : `columns[${setting.columnIndex}].defaultPadMobile`),
            enablePath: setting.enablePath || this._enablePath(setting)
        };
        if (setting.type === 'hidePair') {
            return {
                ...base,
                visibilityOptions: VISIBILITY_RADIO_OPTIONS,
                visibilityDesktop: setting.hiddenDesktop ? 'hidden' : 'visible',
                visibilityMobile: setting.hiddenMobile ? 'hidden' : 'visible',
                hideDesktopRadioName: `visibility-dsk-${setting.key}`,
                hideMobileRadioName: `visibility-mob-${setting.key}`,
                placeholders: [setting.hideDesktopToken, setting.hideMobileToken].filter(Boolean)
            };
        }
        if (setting.type === 'hideDefault') {
            const hidden = !!setting.hiddenByDefault;
            return {
                ...base,
                hideVisibilityLabel: `View on ${setting.device}`,
                visibilityRadioName: `visibility-${setting.key}`,
                visibilityOptions: VISIBILITY_RADIO_OPTIONS,
                visibilityValue: hidden ? 'hidden' : 'visible',
                previewVisibility: hidden ? 'hidden' : 'visible'
            };
        }
        if (setting.type === 'columnDirection') {
            const ltr = setting.value !== 'rtl';
            return {
                ...base,
                ltrClass: 'column-layout-card' + (ltr ? ' column-layout-card_selected' : ''),
                rtlClass: 'column-layout-card' + (!ltr ? ' column-layout-card_selected' : ''),
                deviceLabel: setting.device === 'mobile' ? 'Mobile default' : 'Desktop default',
                dirPath: setting.device === 'mobile' ? 'defaultColumnDirMobile' : 'defaultColumnDirDesktop'
            };
        }
        if (setting.type === 'padding') {
            const padDesktop = normalizePad(setting.padDesktop);
            const padMobile = normalizePad(setting.padMobile);
            const padDevice = this.padDeviceBySettingKey[setting.key] || 'desktop';
            const padMobileInherit = setting.padMobileInherit !== false;
            const mobilePad = padMobileInherit ? padDesktop : padMobile;
            const activePad = padDevice === 'mobile' ? mobilePad : padDesktop;
            const activePadPath = padDevice === 'mobile' ? base.padMobilePath : base.padDesktopPath;
            return {
                ...base,
                padDesktop,
                padMobile: mobilePad,
                padDevice,
                padDeviceRadioName: `pad-device-${setting.key}`,
                padDeviceOptions: PAD_DEVICE_RADIO_OPTIONS,
                activePad,
                activePadPath,
                padMobileInherit,
                padInputsDisabled: padDevice === 'mobile' && padMobileInherit,
                showPadInherit: padDevice === 'mobile'
            };
        }
        if (setting.type === 'backgroundColor' || setting.type === 'backgroundStyle') {
            const colorRows = (setting.colors || []).map((item, index) => {
                const preset = normalizeColorPreset(item, index);
                return {
                    ...preset,
                    key: `${setting.key}-color-${index}`,
                    index,
                    swatchStyle: `background-color:${safeSwatchHex(preset.hex)}`,
                    isDefault: setting.defaultColor === preset.hex,
                    showSetDefault: setting.defaultColor !== preset.hex
                };
            });
            const rows = {
                colorRows,
                colorOptions: colorRows
                    .filter(row => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(row.hex))
                    .map(row => ({ label: `${row.label} (${row.hex})`, value: row.hex }))
            };
            if (setting.type !== 'backgroundStyle') return { ...base, ...rows };
            return {
                ...base,
                ...rows,
                bgModeOptions: [
                    { label: 'Color', value: 'color' },
                    { label: 'Gradient', value: 'gradient' },
                    { label: 'Image', value: 'image' }
                ],
                bgModeRadioName: `bg-mode-${setting.key}`,
                gradientRows: (setting.gradients || []).map((item, index) => ({
                    ...normalizeGradientPreset(item, index),
                    key: `${setting.key}-gradient-${index}`,
                    index,
                    isDefault: setting.defaultGradientId === item.id,
                    showSetDefault: setting.defaultGradientId !== item.id
                })),
                imageRows: (setting.presets || []).map((item, index) => {
                    const preset = normalizeImagePreset(item, index);
                    const device = this.imageDeviceByPresetKey[preset.id] || 'desktop';
                    const inherit = preset.mobileInherit !== false;
                    const mobileView = device === 'mobile';
                    return {
                        ...preset,
                        key: `${setting.key}-image-${preset.id}`,
                        index,
                        isDefault: setting.defaultPresetId === preset.id,
                        showSetDefault: setting.defaultPresetId !== preset.id,
                        device,
                        deviceRadioName: `image-device-${setting.key}-${preset.id}`,
                        deviceOptions: PAD_DEVICE_RADIO_OPTIONS,
                        showDesktop: !mobileView,
                        showMobile: mobileView,
                        activeUrl: mobileView && inherit ? preset.urlDesktop : (mobileView ? preset.urlMobile : preset.urlDesktop),
                        activePosition: mobileView && inherit ? preset.positionDesktop : (mobileView ? preset.positionMobile : preset.positionDesktop),
                        activeSize: mobileView && inherit ? preset.sizeDesktop : (mobileView ? preset.sizeMobile : preset.sizeDesktop),
                        activeRepeat: mobileView && inherit ? preset.repeatDesktop : (mobileView ? preset.repeatMobile : preset.repeatDesktop),
                        activeUrlField: mobileView ? 'urlMobile' : 'urlDesktop',
                        activePositionField: mobileView ? 'positionMobile' : 'positionDesktop',
                        activeSizeField: mobileView ? 'sizeMobile' : 'sizeDesktop',
                        activeRepeatField: mobileView ? 'repeatMobile' : 'repeatDesktop'
                    };
                })
            };
        }
        if (setting.type === 'backgroundGradient') {
            return {
                ...base,
                gradientRows: (setting.gradients || []).map((item, index) => ({
                    ...normalizeGradientPreset(item, index),
                    key: `${setting.key}-gradient-${index}`,
                    index,
                    isDefault: setting.defaultGradientId === item.id,
                    showSetDefault: setting.defaultGradientId !== item.id
                })),
                colorOptions: (setting.colorOptions || []).map(hex => ({ label: hex, value: hex }))
            };
        }
        if (setting.type === 'backgroundImage') {
            return {
                ...base,
                imageRows: (setting.presets || []).map((item, index) => ({
                    ...normalizeImagePreset(item, index),
                    key: `${setting.key}-image-${index}`,
                    index,
                    isDefault: setting.defaultPresetId === item.id,
                    showSetDefault: setting.defaultPresetId !== item.id,
                    device: 'desktop',
                    showDesktop: true,
                    showMobile: false,
                    activeUrl: normalizeImagePreset(item, index).urlDesktop,
                    activePosition: normalizeImagePreset(item, index).positionDesktop,
                    activeSize: normalizeImagePreset(item, index).sizeDesktop,
                    activeRepeat: normalizeImagePreset(item, index).repeatDesktop,
                    activeUrlField: 'urlDesktop',
                    activePositionField: 'positionDesktop',
                    activeSizeField: 'sizeDesktop',
                    activeRepeatField: 'repeatDesktop',
                    deviceRadioName: `image-device-legacy-${setting.key}-${index}`,
                    deviceOptions: PAD_DEVICE_RADIO_OPTIONS
                })),
                colorOptions: (setting.colorOptions || []).map(hex => ({ label: hex, value: hex }))
            };
        }
        return base;
    }

    _enablePath(setting) {
        if (setting.type === 'hideDefault') {
            return setting.key === 'hideMobile' ? 'hideMobile' : 'hideDesktop';
        }
        if (setting.type === 'padding') {
            return setting.columnIndex === undefined ? 'padding' : `columns[${setting.columnIndex}].padding`;
        }
        if (setting.type === 'backgroundColor') {
            return setting.columnIndex === undefined
                ? 'backgroundColor'
                : `columns[${setting.columnIndex}].backgroundColor`;
        }
        if (setting.type === 'backgroundImage') {
            return setting.columnIndex === undefined
                ? 'backgroundImage'
                : `columns[${setting.columnIndex}].backgroundImage`;
        }
        if (setting.type === 'backgroundGradient') {
            return setting.columnIndex === undefined
                ? 'backgroundGradient'
                : `columns[${setting.columnIndex}].backgroundGradient`;
        }
        if (setting.type === 'columnDirection') return 'columnDirection';
        return '';
    }

    handleEnableChange(event) {
        const path = event.currentTarget.dataset.path;
        this._patch(path, event.target.checked);
    }

    handleHideDefaultChange(event) {
        const path = event.currentTarget.dataset.path;
        if (path) {
            this._patch(path, event.detail.value === 'hidden');
            return;
        }
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const hidden = event.detail.value === 'hidden';
        this._patch(setting.hideDefaultPath, hidden);
    }

    handleBgModeChange(event) {
        const path = event.currentTarget.dataset.path;
        if (!path) return;
        this._patch(path, event.detail.value);
    }

    handleImageDeviceChange(event) {
        const presetKey = event.currentTarget.dataset.presetKey;
        if (!presetKey) return;
        this.imageDeviceByPresetKey = {
            ...this.imageDeviceByPresetKey,
            [presetKey]: event.detail.value
        };
    }

    handlePadDeviceChange(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        if (!settingKey) return;
        this.padDeviceBySettingKey = {
            ...this.padDeviceBySettingKey,
            [settingKey]: event.detail.value
        };
    }

    handleColumnDirClick(event) {
        const path = event.currentTarget.dataset.path;
        const value = event.currentTarget.dataset.value;
        this._patch(path, value);
        this._preview({
            kind: 'columnDirection',
            value,
            columnIndex: null,
            device: event.currentTarget.dataset.device
        });
    }

    handlePadChange(event) {
        const path = event.currentTarget.dataset.path;
        const side = event.currentTarget.dataset.side;
        const value = event.detail?.value ?? event.target?.value ?? '0';
        const layout = mergeStudioLayoutDefaults(this._layoutConfig, this.scan);
        const current = this._readPath(layout, path);
        const nextPad = { ...normalizePad(current), [side]: String(value) };
        let next = patchLayoutConfig(this._layoutConfig, this.scan, { path, value: nextPad });
        if (String(path).endsWith('defaultPadMobile')) {
            const inheritPath = path.replace(/defaultPadMobile$/, 'padMobileInherit');
            next = patchLayoutConfig(next, this.scan, { path: inheritPath, value: false });
        }
        this._emitLayout(next);
    }

    handlePadInherit(event) {
        const setting = this._findSetting(event.currentTarget.dataset.settingKey);
        if (!setting) return;
        const prefix = setting.pathPrefix || '';
        const inheritPath = `${prefix}padMobileInherit`;
        const layout = mergeStudioLayoutDefaults(this._layoutConfig, this.scan);
        const desktop = this._readPath(layout, `${prefix}defaultPadDesktop`);
        const mobilePath = `${prefix}defaultPadMobile`;
        let next = patchLayoutConfig(this._layoutConfig, this.scan, { path: inheritPath, value: true });
        next = patchLayoutConfig(next, this.scan, { path: mobilePath, value: desktop });
        this._emitLayout(next);
    }

    handlePadApplyDefault(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        this._clearPreview();
    }

    handlePadPreview(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const columnIndex = setting.columnIndex === undefined ? null : setting.columnIndex;
        const contentIndex = setting.contentIndex === undefined ? null : setting.contentIndex;
        const pad = normalizePad(setting.activePad);
        this._preview({ kind: 'padding', value: pad, columnIndex, contentIndex });
    }

    handleAddColor(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = this._scoped(setting, 'backgroundColors');
        const colors = [...(setting.colorRows || []).map(row => ({ id: row.id, label: row.label, hex: row.hex })), {
            id: `color-${Date.now()}`,
            label: `Color ${(setting.colorRows || []).length + 1}`,
            hex: '#FFFFFF'
        }];
        this._patch(path, colors);
    }

    handleColorFieldChange(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const index = Number(event.currentTarget.dataset.index);
        const field = event.currentTarget.dataset.field;
        const setting = this._findSetting(settingKey);
        if (!setting || !field) return;
        const value = String(event.detail?.value ?? event.target?.value ?? '');
        const colors = (setting.colorRows || []).map((row, idx) => (
            idx === index ? { id: row.id, label: row.label, hex: row.hex, [field]: value } : { id: row.id, label: row.label, hex: row.hex }
        ));
        this._patch(this._scoped(setting, 'backgroundColors'), colors);
    }

    handleDeletePreset(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const index = Number(event.currentTarget.dataset.index);
        const kind = event.currentTarget.dataset.kind;
        const setting = this._findSetting(settingKey);
        if (!setting || !kind) return;
        if (kind === 'color') {
            const colors = (setting.colorRows || [])
                .filter((row, idx) => idx !== index)
                .map(row => ({ id: row.id, label: row.label, hex: row.hex }));
            this._patch(this._scoped(setting, 'backgroundColors'), colors);
            return;
        }
        if (kind === 'gradient') {
            const gradients = (setting.gradientRows || []).filter((row, idx) => idx !== index);
            this._patch(this._scoped(setting, 'gradients'), gradients);
            return;
        }
        const presets = (setting.imageRows || []).filter((row, idx) => idx !== index);
        this._patch(this._scoped(setting, 'backgroundImagePresets'), presets);
    }

    handleSetDefaultColor(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const hex = event.currentTarget.dataset.hex;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = this._scoped(setting, 'defaultBgColor');
        this._patch(path, hex);
        this._clearPreview();
    }

    handleAddGradient(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = this._scoped(setting, 'gradients');
        const gradients = [...(setting.gradientRows || []), {
            id: `gradient-${Date.now()}`,
            label: 'New gradient',
            css: 'linear-gradient(180deg, #ffffff 0%, #eeeeee 100%)',
            fallbackColor: ''
        }];
        this._patch(path, gradients);
    }

    handleGradientFieldChange(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const index = Number(event.currentTarget.dataset.index);
        const field = event.currentTarget.dataset.field;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const value = event.detail?.value ?? event.target?.value ?? '';
        const gradients = (setting.gradientRows || []).map((item, idx) => (
            idx === index ? { ...item, [field]: value } : item
        ));
        const path = this._scoped(setting, 'gradients');
        this._patch(path, gradients);
    }

    handleSetDefaultGradient(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const id = event.currentTarget.dataset.id;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = this._scoped(setting, 'defaultGradientId');
        this._patch(path, id);
    }

    handleAddImagePreset(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = this._scoped(setting, 'backgroundImagePresets');
        const presets = [...(setting.imageRows || []), {
            id: `bg-image-${Date.now()}`,
            label: `Image ${(setting.imageRows || []).length + 1}`,
            url: '',
            urlDesktop: '',
            urlMobile: '',
            mobileInherit: true,
            desktop: true,
            mobile: true,
            positionDesktop: 'center',
            sizeDesktop: 'cover',
            repeatDesktop: 'no-repeat',
            positionMobile: 'center',
            sizeMobile: 'cover',
            repeatMobile: 'no-repeat',
            fallbackColor: setting.colorRows?.[0]?.hex || ''
        }];
        this._patch(path, presets);
    }

    handleImageFieldChange(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const index = Number(event.currentTarget.dataset.index);
        const field = event.currentTarget.dataset.field;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const value = event.target?.type === 'checkbox' ? event.target.checked : (
            event.detail?.value ?? event.target?.value ?? ''
        );
        const mobileField = ['urlMobile', 'positionMobile', 'sizeMobile', 'repeatMobile'].includes(field);
        const presets = (setting.imageRows || []).map((item, idx) => {
            if (idx !== index) return item;
            const next = { ...item, [field]: value };
            if (field === 'urlDesktop') next.url = value;
            if (mobileField) next.mobileInherit = false;
            return next;
        });
        const path = this._scoped(setting, 'backgroundImagePresets');
        this._patch(path, presets);
    }

    handleSetDefaultImage(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const id = event.currentTarget.dataset.id;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = this._scoped(setting, 'defaultBgImagePresetId');
        this._patch(path, id);
    }

    handleImageInherit(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const index = Number(event.currentTarget.dataset.index);
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const presets = (setting.imageRows || []).map((item, idx) => {
            if (idx !== index) return item;
            return {
                ...item,
                mobileInherit: true,
                urlMobile: item.urlDesktop || item.url || '',
                positionMobile: item.positionDesktop,
                sizeMobile: item.sizeDesktop,
                repeatMobile: item.repeatDesktop
            };
        });
        this._patch(this._scoped(setting, 'backgroundImagePresets'), presets);
    }

    handlePreviewClick(event) {
        const kind = event.currentTarget.dataset.previewKind;
        const value = event.currentTarget.dataset.previewValue;
        const columnIndexRaw = event.currentTarget.dataset.columnIndex;
        const columnIndex = columnIndexRaw === undefined || columnIndexRaw === ''
            ? null
            : Number(columnIndexRaw);
        const contentIndexRaw = event.currentTarget.dataset.contentIndex;
        const contentIndex = contentIndexRaw === undefined || contentIndexRaw === ''
            ? null
            : Number(contentIndexRaw);
        const device = event.currentTarget.dataset.previewDevice || undefined;
        this._preview({ kind, value, columnIndex, contentIndex, device });
    }

    _findSetting(settingKey) {
        for (const section of this.sections) {
            const match = (section.settings || []).find(item => item.key === settingKey);
            if (match) return match;
        }
        return null;
    }

    _readPath(root, path) {
        const parts = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
        return parts.reduce((cursor, part) => (cursor == null ? undefined : cursor[part]), root);
    }

    _scoped(setting, field) {
        return `${setting?.pathPrefix || ''}${field}`;
    }

    _patch(path, value) {
        this._emitLayout(patchLayoutConfig(this._layoutConfig, this.scan, { path, value }));
    }

    _emitLayout(layout) {
        this.dispatchEvent(new CustomEvent('layoutchange', {
            detail: { layout }
        }));
    }

    _preview(detail) {
        this.dispatchEvent(new CustomEvent('settingpreview', { detail }));
    }

    _clearPreview() {
        this.dispatchEvent(new CustomEvent('settingpreview', { detail: null }));
    }
}
