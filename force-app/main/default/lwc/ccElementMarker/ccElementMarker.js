import { LightningElement, api } from 'lwc';
import { COMPLEXITY_OPTIONS } from 'c/ccTemplateSchema';

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
const REGION_OPTIONS = [
    { label: 'Read-only (rendered as is)', value: 'fixed-read' },
    { label: 'Editable content, fixed settings', value: 'fixed-edit' },
    { label: 'Blocks zone (marketers drop blocks here)', value: 'blocks' }
];
const BLANK = { role: 'none', level: 'container', id: '', binds: [], contentType: 'richText', key: '', label: '', complexity: 'standard', regionKind: 'fixed-read' };

/** Guided panel: tell the processor what the picked element is. Emits apply { marking }, remove, close, pick { node }. */
export default class CcElementMarker extends LightningElement {
    @api kind = 'block';
    @api templateMode = 'multi';
    @api existingIds = [];
    @api errors = [];
    complexityOptions = COMPLEXITY_OPTIONS;
    contentOptions = CONTENT_OPTIONS;
    regionOptions = REGION_OPTIONS;
    draft = { ...BLANK };
    _info;
    _existingKeys = [];
    _autoKey = null;

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
        if (marks.role !== 'none') {
            return {
                role: marks.role,
                level: marks.level || 'container',
                id: marks.id || '',
                binds: marks.binds || [],
                contentType: marks.contentType || 'richText',
                key: marks.key || '',
                label: marks.label || '',
                complexity: marks.complexity || 'standard',
                regionKind: marks.regionKind || 'fixed-read'
            };
        }
        const suggestion = info.suggestion || {};
        const draft = { ...BLANK, role: suggestion.role || 'none' };
        if (suggestion.role === 'section') draft.level = suggestion.level;
        if (suggestion.role === 'content') {
            draft.contentType = suggestion.contentType;
            draft.key = this.autoKey(suggestion.key || 'content');
            draft.complexity = suggestion.contentType === 'bulletList' ? 'basic' : 'standard';
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

    get hasInfo() {
        return !!this._info;
    }

    get isMarked() {
        return this._info?.marks.role !== 'none';
    }

    get heading() {
        return `Mark <${this._info?.tag}> element`;
    }

    get snippet() {
        return this._info?.text ? `"${this._info.text}"` : 'No text';
    }

    get suggestionText() {
        if (this.isMarked || !this._info?.suggestion?.reason) return '';
        return `Suggestion: ${this._info.suggestion.reason}`;
    }

    get path() {
        const items = this._info?.path || [];
        return items.map((item, index) => ({
            ...item,
            key: `${item.node}`,
            current: index === items.length - 1,
            className: `cc-marker__crumb${item.marked ? ' cc-marker__crumb_marked' : ''}${index === items.length - 1 ? ' cc-marker__crumb_current' : ''}`
        }));
    }

    get children() {
        return (this._info?.children || []).map(item => ({ ...item, key: `${item.node}` }));
    }

    get hasChildren() {
        return this.children.length > 0;
    }

    get roleOptions() {
        const options = [
            { label: 'Section', value: 'section' },
            { label: 'Content', value: 'content' }
        ];
        if (this.kind === 'shell' && this.templateMode !== 'single') options.push({ label: 'Region', value: 'region' });
        options.push({ label: 'Not marked', value: 'none' });
        return options;
    }

    get isSection() {
        return this.draft.role === 'section';
    }

    get isContent() {
        return this.draft.role === 'content';
    }

    get isRegion() {
        return this.draft.role === 'region';
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
        return this.draft.role === 'none' || !!this.tagWarning || !!this.keyWarning;
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

    handlePick(event) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: Number(event.currentTarget.dataset.node) } }));
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
