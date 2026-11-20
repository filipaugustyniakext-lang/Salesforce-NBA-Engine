import { LightningElement, api } from 'lwc';
import { COMPLEXITY_OPTIONS, CONTENT_TYPE_LABELS, uuid, clone } from 'c/ccTemplateSchema';

/** Template admin configuration of one content binding (data-cc-content). Emits change { slot }. */
export default class CcContentBindingEditor extends LightningElement {
    @api disabled = false;
    complexityOptions = COMPLEXITY_OPTIONS;
    _slot = {};

    @api
    get binding() {
        return this._slot;
    }
    set binding(next) {
        this._slot = clone(next || {});
        this._slot.defaults = this._slot.defaults || {};
        this._slot.iconPresets = this._slot.iconPresets || [];
    }

    get typeLabel() {
        return CONTENT_TYPE_LABELS[this._slot.type] || this._slot.type;
    }

    get heading() {
        return `${this.typeLabel} · ${this._slot.bindingKey}`;
    }

    get isRichText() {
        return this._slot.type === 'richText';
    }

    get isBulletList() {
        return this._slot.type === 'bulletList';
    }

    get isImage() {
        return this._slot.type === 'image';
    }

    get isDivider() {
        return this._slot.type === 'divider';
    }

    get isButton() {
        return this._slot.type === 'button';
    }

    get usesComplexity() {
        return this.isRichText || this.isBulletList;
    }

    get regionNote() {
        if (this._slot.regionKind === 'fixed-edit') return 'Inside a fixed-edit region: marketers can edit this content but not its section settings.';
        if (this._slot.regionKind === 'fixed-read') return 'Inside a read-only region: marketers cannot edit this content.';
        return '';
    }

    get icons() {
        return this._slot.iconPresets.map((icon, index) => ({ ...icon, index, key: icon.id || `i${index}` }));
    }

    get hasNoIcons() {
        return this._slot.iconPresets.length === 0;
    }

    get iconError() {
        return this.hasNoIcons && this._slot.allowNoIcon === false ? 'Add at least one icon or allow lists without icons.' : '';
    }

    get allowNoIcon() {
        return this._slot.allowNoIcon !== false;
    }

    get dividerShowLine() {
        return this._slot.defaults.showLine !== false;
    }

    get buttonVisible() {
        return this._slot.defaults.visible !== false;
    }

    emit() {
        const slot = clone(this._slot);
        this.dispatchEvent(new CustomEvent('change', { detail: { slot } }));
    }

    handleField(event) {
        const field = event.target.dataset.field;
        this._slot = { ...this._slot, [field]: event.detail?.value ?? event.target.value };
        this.emit();
    }

    handleDefault(event) {
        const { field, kind } = event.target.dataset;
        let value = kind === 'checkbox' ? event.target.checked : event.target.value;
        if (kind === 'number') value = Math.max(0, parseInt(value, 10) || 0);
        this._slot = { ...this._slot, defaults: { ...this._slot.defaults, [field]: value } };
        this.emit();
    }

    handleAllowNoIcon(event) {
        this._slot = { ...this._slot, allowNoIcon: event.target.checked };
        this.emit();
    }

    handleAddIcon() {
        const iconPresets = [...this._slot.iconPresets, { id: uuid().slice(0, 8), label: `Icon ${this._slot.iconPresets.length + 1}`, source: 'url', url: null, contentId: null }];
        this._slot = { ...this._slot, iconPresets };
        this.emit();
    }

    handleIconLabel(event) {
        const index = Number(event.target.dataset.index);
        const iconPresets = clone(this._slot.iconPresets);
        iconPresets[index].label = event.target.value;
        this._slot = { ...this._slot, iconPresets };
        this.emit();
    }

    handleIconImage(event) {
        const index = Number(event.target.dataset.index);
        const iconPresets = clone(this._slot.iconPresets);
        iconPresets[index] = { ...iconPresets[index], ...event.detail.value };
        this._slot = { ...this._slot, iconPresets };
        this.emit();
    }

    handleRemoveIcon(event) {
        const index = Number(event.currentTarget.dataset.index);
        const iconPresets = clone(this._slot.iconPresets);
        iconPresets.splice(index, 1);
        this._slot = { ...this._slot, iconPresets };
        this.emit();
    }
}
