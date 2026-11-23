import { LightningElement, api } from 'lwc';
import { normalizeBackground, defaultBackground, isHexColor } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

const SIZE_OPTIONS = ['cover', 'contain', 'auto', '100% auto'].map(value => ({ label: value, value }));
const REPEAT_OPTIONS = ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].map(value => ({ label: value, value }));
const POSITION_OPTIONS = ['center', 'top', 'bottom', 'left', 'right', 'top center', 'bottom center'].map(value => ({ label: value, value }));

export default class CcBackgroundInput extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api label = 'Background';
    @api disabled = false;
    /** Admin (definition) mode allows custom colors and gradients; marketers pick presets unless none exist. */
    @api allowCustom = false;
    sizeOptions = SIZE_OPTIONS;
    repeatOptions = REPEAT_OPTIONS;
    positionOptions = POSITION_OPTIONS;
    _value = defaultBackground();
    _presets = { colors: [], gradients: [] };

    @api
    get value() {
        return this._value;
    }
    set value(next) {
        this._value = normalizeBackground(next || defaultBackground());
    }

    @api
    get presets() {
        return this._presets;
    }
    set presets(next) {
        this._presets = { colors: next?.colors || [], gradients: next?.gradients || [] };
    }

    get modeOptions() {
        const options = [{ label: 'None', value: 'none' }];
        if (this.allowCustom || this._presets.colors.length) options.push({ label: 'Color', value: 'color' });
        if (this.allowCustom || this._presets.gradients.length) options.push({ label: 'Gradient', value: 'gradient' });
        options.push({ label: 'Image', value: 'image' });
        return options;
    }

    get mode() {
        return this._value.mode;
    }

    get isColor() {
        return this.mode === 'color';
    }

    get isGradient() {
        return this.mode === 'gradient';
    }

    get isImage() {
        return this.mode === 'image';
    }

    get colorPresetOptions() {
        return this._presets.colors.map(preset => ({ label: `${preset.label} (${preset.hex})`, value: preset.id }));
    }

    get gradientPresetOptions() {
        return this._presets.gradients.map(preset => ({ label: preset.label, value: preset.id }));
    }

    get hasColorPresets() {
        return this._presets.colors.length > 0;
    }

    get hasGradientPresets() {
        return this._presets.gradients.length > 0;
    }

    get showCustomColor() {
        return this.allowCustom || !this.hasColorPresets;
    }

    get showCustomGradient() {
        return this.allowCustom || !this.hasGradientPresets;
    }

    get colorSwatches() {
        return this._presets.colors.map(preset => ({
            ...preset,
            style: `background:${preset.hex}`,
            className: `cc-bg__swatch${this._value.colorPresetId === preset.id ? ' cc-bg__swatch_selected' : ''}`
        }));
    }

    get gradientPreviewStyle() {
        const preset = this._presets.gradients.find(item => item.id === this._value.gradientPresetId);
        const css = preset?.css || this._value.gradient?.css;
        return css ? `background-image:${css}` : '';
    }

    get desktopImage() {
        return this._value.image.desktop;
    }

    get mobileImage() {
        return this._value.image.mobile;
    }

    get mobileInherits() {
        return this._value.image.mobile.inheritFromDesktop !== false;
    }

    get showMobileImage() {
        return !this.mobileInherits;
    }

    get customColor() {
        return this._value.color || '';
    }

    get gradientCss() {
        return this._value.gradient?.css || '';
    }

    get gradientFallback() {
        return this._value.gradient?.fallbackColor || '';
    }

    get imageFallback() {
        return this._value.image.fallbackColor || '';
    }

    update(mutator) {
        const next = JSON.parse(JSON.stringify(this._value));
        mutator(next);
        this._value = normalizeBackground(next);
        this.dispatchEvent(new CustomEvent('change', { detail: { value: this._value } }));
    }

    handleMode(event) {
        const mode = event.detail.value;
        this.update(next => {
            next.mode = mode;
            if (mode === 'color' && !next.colorPresetId && this._presets.colors[0] && !this.allowCustom) next.colorPresetId = this._presets.colors[0].id;
            if (mode === 'gradient' && !next.gradientPresetId && this._presets.gradients[0] && !this.allowCustom) next.gradientPresetId = this._presets.gradients[0].id;
        });
    }

    handleSwatch(event) {
        const id = event.currentTarget.dataset.id;
        this.update(next => {
            next.colorPresetId = id;
            next.color = null;
        });
    }

    handleColorPreset(event) {
        this.update(next => {
            next.colorPresetId = event.detail.value;
            next.color = null;
        });
    }

    handleCustomColor(event) {
        const color = (event.target.value || '').trim();
        this.update(next => {
            next.color = isHexColor(color) ? color : null;
            if (next.color) next.colorPresetId = null;
        });
    }

    handleGradientPreset(event) {
        this.update(next => {
            next.gradientPresetId = event.detail.value;
        });
    }

    handleGradientCss(event) {
        const css = event.target.value;
        this.update(next => {
            next.gradient.css = css || null;
            next.gradientPresetId = null;
        });
    }

    handleGradientFallback(event) {
        const color = (event.target.value || '').trim();
        this.update(next => {
            next.gradient.fallbackColor = isHexColor(color) ? color : null;
        });
    }

    handleImageFallback(event) {
        const color = (event.target.value || '').trim();
        this.update(next => {
            next.image.fallbackColor = isHexColor(color) ? color : '#ffffff';
        });
    }

    handleImageSource(event) {
        const device = event.target.dataset.device;
        const value = event.detail.value;
        this.update(next => {
            next.image[device] = { ...next.image[device], source: value.source, url: value.url, contentId: value.contentId };
        });
    }

    handleImageOption(event) {
        const { device, option } = event.target.dataset;
        const value = event.detail.value;
        this.update(next => {
            next.image[device][option] = value;
        });
    }

    handleMobileInherit(event) {
        const inherit = event.target.checked;
        this.update(next => {
            next.image.mobile.inheritFromDesktop = inherit;
        });
    }
}
