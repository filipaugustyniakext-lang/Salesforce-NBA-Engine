import { LightningElement, api } from 'lwc';
import { normalizeSectionSettings, defaultSectionSettings, uuid, isHexColor, clone } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

const DIRECTION_OPTIONS = [
    { label: 'Left to right', value: 'ltr' },
    { label: 'Right to left', value: 'rtl' },
    { label: 'Stack (first column on top)', value: 'stack' },
    { label: 'Stack reversed (last column on top)', value: 'stack-reverse' }
];
const LEVEL_LABELS = { container: 'Container', row: 'Row', column: 'Column' };

/**
 * mode="definition": template admin edits section defaults and presets; emits change { section }.
 * mode="content": marketer edits the settings of one message block section; emits change { value }.
 */
export default class CcSectionSettingsEditor extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api mode = 'content';
    @api disabled = false;
    directionOptions = DIRECTION_OPTIONS;
    _section = { binds: [], defaults: {}, presets: { colors: [], gradients: [] } };
    _value;

    @api
    get section() {
        return this._section;
    }
    set section(next) {
        this._section = {
            ...(next || {}),
            binds: next?.binds || [],
            presets: { colors: next?.presets?.colors || [], gradients: next?.presets?.gradients || [] }
        };
    }

    @api
    get value() {
        return this._value;
    }
    set value(next) {
        this._value = next;
    }

    get isDefinition() {
        return this.mode === 'definition';
    }

    get binds() {
        return new Set(this._section.binds);
    }

    get settings() {
        const level = this._section.level;
        const base = normalizeSectionSettings(this._section.defaults, level, defaultSectionSettings(level, this._section.binds));
        return this.isDefinition ? base : normalizeSectionSettings(this._value, level, base);
    }

    get title() {
        const label = this._section.label || this._section.sectionId || '';
        return `${LEVEL_LABELS[this._section.level] || 'Section'} ${label}`.trim();
    }

    get isFixed() {
        return this._section.regionKind === 'fixed-read' || this._section.regionKind === 'fixed-edit';
    }

    get fixedMessage() {
        return this._section.regionKind === 'fixed-read'
            ? 'This section is read-only: it always renders exactly as in the template.'
            : 'This section is fixed-edit: its settings are fixed, only its content can be edited.';
    }

    get backgroundLabel() {
        return this.isDefinition ? 'Default background' : 'Background';
    }

    get readOnly() {
        return this.disabled || (!this.isDefinition && this.isFixed);
    }

    get hasPadding() {
        return this.binds.has('padding');
    }

    get hasMargin() {
        return this.binds.has('margin');
    }

    get hasBackground() {
        return this.binds.has('background');
    }

    /** Background kinds this section's placeholders support; null when the section predates placeholders (everything is offered). */
    get backgroundModes() {
        const targets = this._section.targets || {};
        const modes = [];
        if (targets.bgColor) modes.push('color');
        if (targets.bgGradient) modes.push('gradient');
        if (targets.bgImage) modes.push('image');
        return modes.length ? modes : null;
    }

    get showColorPresets() {
        const modes = this.backgroundModes;
        return !modes || modes.includes('color');
    }

    get showGradientPresets() {
        const modes = this.backgroundModes;
        return !modes || modes.includes('gradient');
    }

    get hasHide() {
        return this.binds.has('hide');
    }

    get hasDirection() {
        return this.binds.has('column-direction') && this._section.level === 'row';
    }

    get hasAnyBinding() {
        return this._section.binds.length > 0;
    }

    get colorPresets() {
        return this._section.presets.colors.map((preset, index) => ({ ...preset, index, key: preset.id || `c${index}` }));
    }

    get gradientPresets() {
        return this._section.presets.gradients.map((preset, index) => ({ ...preset, index, key: preset.id || `g${index}` }));
    }

    get presetErrors() {
        const errors = [];
        this._section.presets.colors.forEach(preset => {
            if (!isHexColor(preset.hex)) errors.push(`Color "${preset.label || preset.id}" needs a hex value such as #e2001a.`);
        });
        this._section.presets.gradients.forEach(preset => {
            if (!/gradient\(/i.test(preset.css || '')) errors.push(`Gradient "${preset.label || preset.id}" needs CSS such as linear-gradient(...).`);
            if (!isHexColor(preset.fallbackColor)) errors.push(`Gradient "${preset.label || preset.id}" needs a fallback hex color.`);
        });
        return errors;
    }

    get hasPresetErrors() {
        return this.presetErrors.length > 0;
    }

    applySetting(key, settingValue) {
        if (this.isDefinition) {
            const section = clone(this._section);
            section.defaults = { ...this.settings, [key]: settingValue };
            this._section = section;
            this.dispatchEvent(new CustomEvent('change', { detail: { section } }));
            return;
        }
        const value = { ...this.settings, [key]: settingValue };
        this._value = value;
        this.dispatchEvent(new CustomEvent('change', { detail: { value } }));
    }

    handlePadding(event) {
        this.applySetting('padding', event.detail.value);
    }

    handleMargin(event) {
        this.applySetting('margin', event.detail.value);
    }

    handleBackground(event) {
        this.applySetting('background', event.detail.value);
    }

    handleHide(event) {
        const key = event.target.dataset.key;
        this.applySetting('visibility', { ...this.settings.visibility, [key]: event.target.checked });
    }

    handleDirection(event) {
        const device = event.target.dataset.device;
        this.applySetting('columnDirection', { ...(this.settings.columnDirection || { desktop: 'ltr', mobile: 'stack' }), [device]: event.detail.value });
    }

    emitPresets(mutator) {
        const section = clone(this._section);
        mutator(section.presets);
        this._section = section;
        this.dispatchEvent(new CustomEvent('change', { detail: { section } }));
    }

    handleAddColor() {
        this.emitPresets(presets => presets.colors.push({ id: uuid().slice(0, 8), label: `Color ${presets.colors.length + 1}`, hex: '#ffffff' }));
    }

    handleAddGradient() {
        this.emitPresets(presets => presets.gradients.push({
            id: uuid().slice(0, 8),
            label: `Gradient ${presets.gradients.length + 1}`,
            css: 'linear-gradient(90deg, #ffffff 0%, #f3f3f3 100%)',
            fallbackColor: '#ffffff'
        }));
    }

    handlePresetField(event) {
        const { kind, index, field } = event.target.dataset;
        const value = event.target.value;
        this.emitPresets(presets => {
            presets[kind][Number(index)][field] = value;
        });
    }

    handleRemovePreset(event) {
        const { kind, index } = event.currentTarget.dataset;
        this.emitPresets(presets => presets[kind].splice(Number(index), 1));
    }
}
