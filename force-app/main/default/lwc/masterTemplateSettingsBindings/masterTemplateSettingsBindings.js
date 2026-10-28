import { LightningElement, api, track } from 'lwc';
import { parseBlockTemplate } from 'c/contentBindingModel';
import {
    buildSettingsBindingSections,
    mergeStudioLayoutDefaults,
    normalizePad,
    normalizeImagePreset,
    normalizeGradientPreset,
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
            showEnable: setting.type !== 'columnDirection',
            isHideDefault: setting.type === 'hideDefault',
            isPadding: setting.type === 'padding',
            isBackgroundColor: setting.type === 'backgroundColor',
            isBackgroundImage: setting.type === 'backgroundImage',
            isBackgroundGradient: setting.type === 'backgroundGradient',
            isColumnDirection: setting.type === 'columnDirection',
            hideDefaultPath: setting.key === 'hideMobile' ? 'defaultHideMobile' : 'defaultHideDesktop',
            padDesktopPath: setting.columnIndex === undefined
                ? 'defaultPadDesktop'
                : `columns[${setting.columnIndex}].defaultPadDesktop`,
            padMobilePath: setting.columnIndex === undefined
                ? 'defaultPadMobile'
                : `columns[${setting.columnIndex}].defaultPadMobile`
        };
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
        if (setting.type === 'backgroundColor') {
            return {
                ...base,
                colorRows: (setting.colors || []).map((hex, index) => ({
                    key: `${setting.key}-color-${index}`,
                    index,
                    hex,
                    swatchStyle: `background-color:${safeSwatchHex(hex)}`,
                    isDefault: setting.defaultColor === hex,
                    showSetDefault: setting.defaultColor !== hex
                }))
            };
        }
        if (setting.type === 'backgroundGradient') {
            return {
                ...base,
                gradientRows: (setting.gradients || []).map((item, index) => ({
                    ...normalizeGradientPreset(item, index),
                    key: `${setting.key}-gradient-${index}`,
                    index,
                    isDefault: setting.defaultGradientId === item.id
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
                    isDefault: setting.defaultPresetId === item.id
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
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const hidden = event.detail.value === 'hidden';
        this._patch(setting.hideDefaultPath, hidden);
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
        const columnIndex = event.currentTarget.dataset.columnIndex;
        const value = event.detail?.value ?? event.target?.value ?? '0';
        const layout = mergeStudioLayoutDefaults(this._layoutConfig, this.scan);
        const current = path.includes('columns[')
            ? this._readColumnPad(layout, path)
            : (path.includes('Mobile') ? layout.defaultPadMobile : layout.defaultPadDesktop);
        const nextPad = { ...normalizePad(current), [side]: String(value) };
        let next = patchLayoutConfig(this._layoutConfig, this.scan, { path, value: nextPad });
        if (path.includes('Mobile')) {
            const inheritPath = columnIndex === undefined || columnIndex === ''
                ? 'padMobileInherit'
                : `columns[${columnIndex}].padMobileInherit`;
            next = patchLayoutConfig(next, this.scan, { path: inheritPath, value: false });
        }
        this._emitLayout(next);
    }

    handlePadInherit(event) {
        const columnIndex = event.currentTarget.dataset.columnIndex;
        const inheritPath = columnIndex === undefined || columnIndex === ''
            ? 'padMobileInherit'
            : `columns[${columnIndex}].padMobileInherit`;
        const layout = mergeStudioLayoutDefaults(this._layoutConfig, this.scan);
        const desktop = columnIndex === undefined || columnIndex === ''
            ? layout.defaultPadDesktop
            : layout.columns[Number(columnIndex)]?.defaultPadDesktop;
        const mobilePath = columnIndex === undefined || columnIndex === ''
            ? 'defaultPadMobile'
            : `columns[${columnIndex}].defaultPadMobile`;
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
        const pad = normalizePad(setting.activePad);
        this._preview({ kind: 'padding', value: pad, columnIndex });
    }

    handleAddColor(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = setting.columnIndex === undefined
            ? 'backgroundColors'
            : `columns[${setting.columnIndex}].backgroundColors`;
        const colors = [...(setting.colorRows || []).map(row => row.hex), '#FFFFFF'];
        this._patch(path, colors);
    }

    handleColorHexChange(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const index = Number(event.currentTarget.dataset.index);
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const hex = String(event.detail?.value ?? event.target?.value ?? '').trim();
        const colors = (setting.colorRows || []).map(row => row.hex);
        colors[index] = hex;
        const path = setting.columnIndex === undefined
            ? 'backgroundColors'
            : `columns[${setting.columnIndex}].backgroundColors`;
        this._patch(path, colors);
    }

    handleSetDefaultColor(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const hex = event.currentTarget.dataset.hex;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = setting.columnIndex === undefined
            ? 'defaultBgColor'
            : `columns[${setting.columnIndex}].defaultBgColor`;
        this._patch(path, hex);
        this._clearPreview();
    }

    handleAddGradient(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = setting.columnIndex === undefined ? 'gradients' : `columns[${setting.columnIndex}].gradients`;
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
        const path = setting.columnIndex === undefined ? 'gradients' : `columns[${setting.columnIndex}].gradients`;
        this._patch(path, gradients);
    }

    handleSetDefaultGradient(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const id = event.currentTarget.dataset.id;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = setting.columnIndex === undefined
            ? 'defaultGradientId'
            : `columns[${setting.columnIndex}].defaultGradientId`;
        this._patch(path, id);
    }

    handleAddImagePreset(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = setting.columnIndex === undefined
            ? 'backgroundImagePresets'
            : `columns[${setting.columnIndex}].backgroundImagePresets`;
        const presets = [...(setting.imageRows || []), {
            id: `bg-image-${Date.now()}`,
            label: 'Background image',
            url: '',
            desktop: true,
            mobile: true,
            positionX: 'center',
            positionY: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
            fallbackColor: (setting.colorOptions || [])[0] || ''
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
        const presets = (setting.imageRows || []).map((item, idx) => (
            idx === index ? { ...item, [field]: value } : item
        ));
        const path = setting.columnIndex === undefined
            ? 'backgroundImagePresets'
            : `columns[${setting.columnIndex}].backgroundImagePresets`;
        this._patch(path, presets);
    }

    handleSetDefaultImage(event) {
        const settingKey = event.currentTarget.dataset.settingKey;
        const id = event.currentTarget.dataset.id;
        const setting = this._findSetting(settingKey);
        if (!setting) return;
        const path = setting.columnIndex === undefined
            ? 'defaultBgImagePresetId'
            : `columns[${setting.columnIndex}].defaultBgImagePresetId`;
        this._patch(path, id);
    }

    handlePreviewClick(event) {
        const kind = event.currentTarget.dataset.previewKind;
        const value = event.currentTarget.dataset.previewValue;
        const columnIndexRaw = event.currentTarget.dataset.columnIndex;
        const columnIndex = columnIndexRaw === undefined || columnIndexRaw === ''
            ? null
            : Number(columnIndexRaw);
        const device = event.currentTarget.dataset.previewDevice || undefined;
        this._preview({ kind, value, columnIndex, device });
    }

    _findSetting(settingKey) {
        for (const section of this.sections) {
            const match = (section.settings || []).find(item => item.key === settingKey);
            if (match) return match;
        }
        return null;
    }

    _readColumnPad(layout, path) {
        const match = path.match(/columns\[(\d+)\]\.(defaultPadDesktop|defaultPadMobile)/);
        if (!match) return normalizePad({});
        const col = layout.columns[Number(match[1])] || {};
        return normalizePad(col[match[2]]);
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
