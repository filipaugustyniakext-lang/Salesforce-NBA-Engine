import { LightningElement, api } from 'lwc';
import { COMPLEXITY_OPTIONS } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

const LEVEL_HELP = {
    container: 'The outermost wrapper of the block. Usually the main table or div.',
    row: 'A horizontal band inside the container. A row without columns counts as one column.',
    column: 'A cell of a row. Content (text, images, buttons) sits inside columns.'
};
const BIND_OPTIONS = [
    { label: 'Padding', value: 'padding' },
    { label: 'Margin', value: 'margin' },
    { label: 'Background (color, gradient, image)', value: 'background' },
    { label: 'Hide on desktop / mobile', value: 'hide' },
    { label: 'Column order (rows only)', value: 'column-direction' }
];
const CONTENT_OPTIONS = [
    { label: 'Rich text', value: 'richText' },
    { label: 'Image (<img>)', value: 'image' },
    { label: 'Bullet list', value: 'bulletList' },
    { label: 'Divider', value: 'divider' },
    { label: 'Button (<a>)', value: 'button' }
];
const BLANK = { role: 'none', level: 'container', id: '', binds: [], contentType: 'richText', key: '', label: '', complexity: 'standard' };

/**
 * Tells the processor what a picked element is. `mode="any"` (blocks, single-block templates) offers sections and
 * content; `mode="content"` (editable areas of a shell) offers content only.
 * Emits apply { marking }, remove, close, pick { node }.
 */
export default class CcElementMarker extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api errors = [];
    /** When set, the marking cannot be applied (for example the element is outside an editable area). */
    @api blockedReason = '';
    complexityOptions = COMPLEXITY_OPTIONS;
    contentOptions = CONTENT_OPTIONS;
    draft = { ...BLANK };
    _info;
    _mode = 'any';
    _existingKeys = [];
    _autoKey = null;

    /** 'any' or 'content'. Re-initialises the form because it changes what is offered. */
    @api
    get mode() {
        return this._mode;
    }
    set mode(next) {
        const value = next === 'content' ? 'content' : 'any';
        if (value === this._mode) return;
        this._mode = value;
        if (this._info) this.draft = this.initialDraft(this._info);
    }

    /** Keys already used in the file. Suggested keys are re-made unique if this arrives after `info`. */
    @api
    get existingKeys() {
        return this._existingKeys;
    }
    set existingKeys(keys) {
        this._existingKeys = keys || [];
        if (this._autoKey && this.draft.key === this._autoKey.value) {
            const unique = this.uniqueKey(this._autoKey.base);
            this._autoKey.value = unique;
            this.draft = { ...this.draft, key: unique };
        }
    }

    @api
    get info() {
        return this._info;
    }
    set info(next) {
        const same = this._info && next && this._info.node === next.node && this._info.marks.role === next.marks.role
            && this._info.marks.key === next.marks.key && this._info.marks.id === next.marks.id;
        this._info = next;
        if (!next || same) return;
        this.draft = this.initialDraft(next);
    }

    initialDraft(info) {
        const marks = info.marks;
        if (marks.role === 'content' || (marks.role === 'section' && !this.isContentMode)) {
            return {
                role: marks.role,
                level: marks.level || 'container',
                id: marks.id || '',
                binds: marks.binds || [],
                contentType: marks.contentType || 'richText',
                key: marks.key || '',
                label: marks.label || '',
                complexity: marks.complexity || 'standard'
            };
        }
        const suggestion = info.suggestion || {};
        const draft = { ...BLANK };
        if (this.isContentMode || suggestion.role === 'content') {
            const asContent = suggestion.role === 'content';
            draft.role = 'content';
            draft.contentType = asContent ? suggestion.contentType : 'richText';
            draft.key = this.autoKey(asContent && suggestion.key ? suggestion.key : 'content');
            draft.complexity = draft.contentType === 'bulletList' ? 'basic' : 'standard';
        } else if (suggestion.role === 'section') {
            draft.role = 'section';
            draft.level = suggestion.level;
        }
        return draft;
    }

    autoKey(base) {
        const value = this.uniqueKey(base);
        this._autoKey = { base, value };
        return value;
    }

    uniqueKey(base) {
        const own = this._info?.marks?.key;
        const taken = new Set((this.existingKeys || []).filter(key => key !== own));
        let key = base;
        let counter = 2;
        while (taken.has(key)) {
            key = `${base}${counter}`;
            counter += 1;
        }
        return key;
    }

    // ─── View model ──────────────────────────────────────────────────────────

    get isContentMode() {
        return this._mode === 'content';
    }

    get hasInfo() {
        return !!this._info;
    }

    get isMarked() {
        const role = this._info?.marks.role;
        return role === 'content' || (role === 'section' && !this.isContentMode);
    }

    get heading() {
        return this.isContentMode ? `Editable content: <${this._info?.tag}>` : `Mark <${this._info?.tag}> element`;
    }

    get snippet() {
        return this._info?.text ? `"${this._info.text}"` : 'No text';
    }

    get suggestionText() {
        if (this.isMarked || !this._info?.suggestion?.reason || this.isContentMode) return '';
        return `Suggestion: ${this._info.suggestion.reason}`;
    }




    get roleOptions() {
        const options = [];
        if (!this.isContentMode) options.push({ label: 'Section', value: 'section' });
        options.push({ label: 'Content', value: 'content' });
        options.push({ label: 'Not marked', value: 'none' });
        return options;
    }

    get isSection() {
        return this.draft.role === 'section';
    }

    get isContent() {
        return this.draft.role === 'content';
    }

    get levelOptions() {
        const parent = this._info?.parentLevel;
        const hint = { container: parent ? ' (not nested in another section)' : '', row: parent === 'container' ? ' (fits here)' : '', column: parent === 'row' ? ' (fits here)' : '' };
        return ['container', 'row', 'column'].map(value => ({ label: `${value.charAt(0).toUpperCase()}${value.slice(1)}${hint[value]}`, value }));
    }

    get levelHelp() {
        return LEVEL_HELP[this.draft.level];
    }

    get bindOptions() {
        return BIND_OPTIONS.filter(option => option.value !== 'column-direction' || this.draft.level === 'row');
    }

    get usesComplexity() {
        return this.draft.contentType === 'richText' || this.draft.contentType === 'bulletList';
    }

    get tagWarning() {
        const tag = this._info?.tag;
        if (!this.isContent) return '';
        if (this.draft.contentType === 'image' && tag !== 'img') return `An image must be an <img> element, but this is a <${tag}>. Select the image element (see the path above).`;
        if (this.draft.contentType === 'button' && tag !== 'a') return `A button must be an <a> element, but this is a <${tag}>. Select the link element (see the path above).`;
        return '';
    }

    get keyWarning() {
        if (!this.isContent || !this.draft.key) return '';
        const own = this._info?.marks?.key;
        return this.draft.key !== own && (this.existingKeys || []).includes(this.draft.key) ? 'This key is already used by another element.' : '';
    }

    get errorItems() {
        return (this.errors || []).map((message, index) => ({ key: `e${index}`, message }));
    }

    get hasErrors() {
        return (this.errors || []).length > 0;
    }

    get applyDisabled() {
        return this.draft.role === 'none' || !!this.tagWarning || !!this.keyWarning || !!this.blockedReason;
    }

    get applyLabel() {
        return this.isMarked ? 'Update marking' : 'Apply marking';
    }

    // ─── Handlers ────────────────────────────────────────────────────────────

    setDraft(changes) {
        this.draft = { ...this.draft, ...changes };
    }

    handleRole(event) {
        const role = event.detail.value;
        const changes = { role };
        if (role === 'content' && !this.draft.key) {
            changes.key = this.autoKey(this._info?.suggestion?.key || 'content');
        }
        this.setDraft(changes);
    }

    handleLevel(event) {
        const level = event.detail.value;
        const binds = level === 'row' ? this.draft.binds : this.draft.binds.filter(bind => bind !== 'column-direction');
        this.setDraft({ level, binds });
    }

    handleBinds(event) {
        this.setDraft({ binds: event.detail.value });
    }

    handleContentType(event) {
        const contentType = event.detail.value;
        const changes = { contentType };
        if (contentType === 'bulletList') changes.complexity = 'basic';
        if (contentType === 'richText') changes.complexity = 'standard';
        this.setDraft(changes);
    }

    handleField(event) {
        this.setDraft({ [event.target.dataset.field]: event.detail?.value ?? event.target.value });
    }

    handlePathPick(event) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: event.detail.node } }));
    }

    handleApply() {
        this.dispatchEvent(new CustomEvent('apply', { detail: { marking: { ...this.draft } } }));
    }

    handleRemove() {
        this.dispatchEvent(new CustomEvent('remove'));
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
