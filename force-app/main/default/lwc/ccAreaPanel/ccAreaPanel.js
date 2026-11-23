import { LightningElement, api } from 'lwc';
import { isolateNativeEvents } from 'c/ccEventGuard';

const KIND_OPTIONS = [
    { label: 'Read-only: rendered exactly as uploaded', value: 'fixed-read' },
    { label: 'Editable: stays in place, marketers edit the content you mark', value: 'fixed-edit' }
];

/**
 * Step 1 of the shell setup: name fixed areas and decide whether they are read-only or editable.
 * Emits create { name, kind }, update { regionId, name, kind, removeContent }, remove { regionId },
 * nofixed { value }, pick { node }, clear, next.
 */
export default class CcAreaPanel extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api areas = [];
    @api info = null;
    @api group = null;
    @api noFixedAreas = false;
    @api errors = [];
    @api canContinue = false;
    kindOptions = KIND_OPTIONS;
    edits = { key: null };
    confirmingRemove = false;

    get editedArea() {
        return this.info && this.info.isArea ? (this.areas || []).find(area => area.node === this.info.node) || null : null;
    }

    get currentKey() {
        if (this.editedArea) return `edit:${this.editedArea.regionId}`;
        if (this.group) return `group:${this.group.nodes.join(',')}`;
        return this.info ? `new:${this.info.node}` : 'none';
    }

    get draft() {
        return this.edits.key === this.currentKey ? this.edits : {};
    }

    get nameValue() {
        return this.draft.name !== undefined ? this.draft.name : (this.editedArea ? this.editedArea.name : '');
    }

    get kindValue() {
        return this.draft.kind || (this.editedArea ? this.editedArea.kind : 'fixed-read');
    }

    get mode() {
        if (this.group) return 'group';
        if (!this.info) return 'idle';
        if (this.info.isArea && this.editedArea) return 'edit';
        if (this.info.isZone) return 'zone';
        if (this.info.insideRegion) return 'inside';
        return 'create';
    }

    get isIdle() {
        return this.mode === 'idle';
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    get isZoneElement() {
        return this.mode === 'zone';
    }

    get isInside() {
        return this.mode === 'inside';
    }

    get isCreate() {
        return this.mode === 'create' || this.mode === 'group';
    }

    get isGroup() {
        return this.mode === 'group';
    }

    get targetLabel() {
        if (this.group) return `${this.group.count} neighbouring elements in ${this.group.parentLabel}`;
        return this.info ? `<${this.info.tag}> ${this.info.text ? `"${this.info.text.slice(0, 40)}"` : ''}`.trim() : '';
    }

    get groupProblem() {
        return this.group?.problem || '';
    }

    get wrapperNote() {
        if (!this.group || this.group.problem) return '';
        return this.group.wrapperTag === 'div'
            ? 'The elements are wrapped in a new <div> that becomes the area.'
            : 'The rows are wrapped in a new <tbody> that becomes the area.';
    }

    get insideName() {
        return this.info?.areaName || 'another area';
    }

    // ─── Existing areas ──────────────────────────────────────────────────────

    get hasAreas() {
        return (this.areas || []).length > 0;
    }

    get areaRows() {
        return (this.areas || []).map(area => ({
            ...area,
            key: area.regionId,
            meta: `${area.kind === 'fixed-edit' ? 'Editable' : 'Read-only'}${area.bindingCount ? ` · ${area.bindingCount} binding(s)` : ''}`,
            className: `cc-area__row${this.editedArea && this.editedArea.regionId === area.regionId ? ' cc-area__row_selected' : ''}`
        }));
    }

    get showNoFixed() {
        return !this.hasAreas;
    }

    // ─── Form state ──────────────────────────────────────────────────────────

    get willDropContent() {
        const area = this.editedArea;
        return !!area && area.kind === 'fixed-edit' && this.kindValue === 'fixed-read' && area.bindingCount > 0;
    }

    get dropWarning() {
        return this.willDropContent
            ? `Making this area read-only removes its ${this.editedArea.bindingCount} editable content binding(s).`
            : '';
    }

    get saveLabel() {
        return this.willDropContent ? `Switch and remove ${this.editedArea.bindingCount} binding(s)` : 'Save changes';
    }

    get saveDisabled() {
        const area = this.editedArea;
        if (!area) return true;
        return !String(this.nameValue).trim() || (this.nameValue === area.name && this.kindValue === area.kind);
    }

    get createDisabled() {
        return !String(this.nameValue).trim() || !!this.groupProblem;
    }

    get removeLabel() {
        const area = this.editedArea;
        return area && area.bindingCount ? `Remove area and ${area.bindingCount} binding(s)` : 'Remove area';
    }

    get errorItems() {
        return (this.errors || []).map((message, index) => ({ key: `e${index}`, message }));
    }

    get hasErrors() {
        return (this.errors || []).length > 0;
    }

    // ─── Handlers ────────────────────────────────────────────────────────────

    setDraft(changes) {
        const base = this.edits.key === this.currentKey ? this.edits : { key: this.currentKey };
        this.edits = { ...base, ...changes };
        this.confirmingRemove = false;
    }

    handleName(event) {
        this.setDraft({ name: event.detail.value });
    }

    handleKind(event) {
        this.setDraft({ kind: event.detail.value });
    }

    handleCreate() {
        this.dispatchEvent(new CustomEvent('create', { detail: { name: String(this.nameValue).trim(), kind: this.kindValue } }));
        this.edits = { key: null };
    }

    handleSave() {
        this.dispatchEvent(new CustomEvent('update', {
            detail: {
                regionId: this.editedArea.regionId,
                name: String(this.nameValue).trim(),
                kind: this.kindValue,
                removeContent: this.willDropContent
            }
        }));
    }

    handleRemoveAsk() {
        this.confirmingRemove = true;
    }

    handleRemoveCancel() {
        this.confirmingRemove = false;
    }

    handleRemoveConfirm() {
        this.confirmingRemove = false;
        this.dispatchEvent(new CustomEvent('remove', { detail: { regionId: this.editedArea.regionId } }));
    }

    handleNoFixed(event) {
        this.dispatchEvent(new CustomEvent('nofixed', { detail: { value: !!event.target.checked } }));
    }

    handlePickArea(event) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: Number(event.currentTarget.dataset.node) } }));
    }

    handleUseEnclosing() {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: this.info.areaNode } }));
    }

    handleClear() {
        this.dispatchEvent(new CustomEvent('clear'));
    }

    handleNext() {
        this.dispatchEvent(new CustomEvent('next'));
    }
}
