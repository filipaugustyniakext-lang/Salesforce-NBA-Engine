import { LightningElement, api } from 'lwc';
import { RICH_TEXT_COMPLEXITY, CONTENT_TYPE_LABELS, uuid, clone } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

const TARGET_TYPES = [
    { label: 'Web URL', value: 'WebURL' },
    { label: 'App URL (deep link)', value: 'AppURL' }
];
const BEHAVIORS = [
    { label: 'Open in a new tab', value: 'newTab' },
    { label: 'Open in the same tab', value: 'sameTab' }
];

/** Marketer editor of one content item in a message block. Emits change { item }. */
export default class CcContentItemEditor extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api disabled = false;
    targetTypes = TARGET_TYPES;
    behaviors = BEHAVIORS;
    _item = {};
    _binding = {};

    @api
    get item() {
        return this._item;
    }
    set item(next) {
        this._item = clone(next || {});
    }

    /** Template definition of this content (iconPresets, complexity, label). */
    @api
    get binding() {
        return this._binding;
    }
    set binding(next) {
        this._binding = next || {};
    }

    get label() {
        return this._binding.label || CONTENT_TYPE_LABELS[this._item.type] || this._item.type;
    }

    get isRichText() {
        return this._item.type === 'richText';
    }

    get isImage() {
        return this._item.type === 'image';
    }

    get isBulletList() {
        return this._item.type === 'bulletList';
    }

    get isDivider() {
        return this._item.type === 'divider';
    }

    get isButton() {
        return this._item.type === 'button';
    }

    get formats() {
        const level = this._item.complexity || this._binding.complexity || (this.isBulletList ? 'basic' : 'standard');
        return RICH_TEXT_COMPLEXITY[level] || RICH_TEXT_COMPLEXITY.standard;
    }

    // ─── Image ───────────────────────────────────────────────────────────────

    get desktopLight() {
        return this._item.desktop?.light || {};
    }

    get desktopDark() {
        return this._item.desktop?.dark || {};
    }

    get mobileLight() {
        return this._item.mobile?.light || {};
    }

    get mobileDark() {
        return this._item.mobile?.dark || {};
    }

    get desktopDarkCustom() {
        return this.desktopDark.inheritFromLight === false;
    }

    get mobileCustom() {
        return this._item.mobile?.inheritFromDesktop === false;
    }

    get mobileDarkCustom() {
        return this.mobileDark.inheritFromLight === false;
    }

    // ─── Bullet list ─────────────────────────────────────────────────────────

    get hasIconPresets() {
        return (this._binding.iconPresets || []).length > 0;
    }

    get iconOptions() {
        return (this._binding.iconPresets || []).map(icon => ({ label: icon.label || icon.id, value: icon.id }));
    }

    get canDisableIcons() {
        return this._binding.allowNoIcon !== false;
    }

    get listItems() {
        const items = this._item.items || [];
        return items.map((entry, index) => ({
            ...entry,
            index,
            key: entry.itemId || `i${index}`,
            label: `Item ${index + 1}`,
            isFirst: index === 0,
            isLast: index === items.length - 1
        }));
    }

    // ─── Updates ─────────────────────────────────────────────────────────────

    emit(item) {
        this._item = item;
        this.dispatchEvent(new CustomEvent('change', { detail: { item: clone(item) } }));
    }

    handleRichText(event) {
        this.emit({ ...this._item, html: event.target.value });
    }

    handleField(event) {
        const { field, kind } = event.target.dataset;
        let value = kind === 'checkbox' ? event.target.checked : (event.detail?.value ?? event.target.value);
        if (kind === 'number') value = Math.max(0, parseInt(value, 10) || 0);
        this.emit({ ...this._item, [field]: value });
    }

    handleImage(event) {
        const { device, theme } = event.target.dataset;
        const item = clone(this._item);
        item[device] = item[device] || {};
        item[device][theme] = { ...(item[device][theme] || {}), ...event.detail.value };
        this.emit(item);
    }

    handleImageSize(event) {
        const { device, theme, field } = event.target.dataset;
        const item = clone(this._item);
        item[device][theme] = { ...(item[device][theme] || {}), [field]: parseInt(event.target.value, 10) || null };
        this.emit(item);
    }

    handleDarkCustom(event) {
        const device = event.target.dataset.device;
        const item = clone(this._item);
        item[device].dark = { ...(item[device].dark || {}), inheritFromLight: !event.target.checked };
        this.emit(item);
    }

    handleMobileCustom(event) {
        const item = clone(this._item);
        item.mobile = { ...(item.mobile || {}), inheritFromDesktop: !event.target.checked };
        this.emit(item);
    }

    handleListItem(event) {
        const index = Number(event.target.dataset.index);
        const item = clone(this._item);
        item.items[index].html = event.target.value;
        this.emit(item);
    }

    handleAddListItem() {
        const item = clone(this._item);
        item.items = [...(item.items || []), { itemId: uuid(), html: '' }];
        this.emit(item);
    }

    handleMoveListItem(event) {
        const index = Number(event.currentTarget.dataset.index);
        const offset = Number(event.currentTarget.dataset.offset);
        const item = clone(this._item);
        const target = index + offset;
        if (target < 0 || target >= item.items.length) return;
        [item.items[index], item.items[target]] = [item.items[target], item.items[index]];
        this.emit(item);
    }

    handleRemoveListItem(event) {
        const index = Number(event.currentTarget.dataset.index);
        const item = clone(this._item);
        item.items.splice(index, 1);
        this.emit(item);
    }
}
