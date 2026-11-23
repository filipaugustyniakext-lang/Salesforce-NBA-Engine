import { LightningElement, api } from 'lwc';
import { isolateNativeEvents } from 'c/ccEventGuard';

const LEVEL_HELP = {
    container: 'The outermost wrapper of the block. Usually the main table or div.',
    row: 'A horizontal band inside the container. A row without columns counts as one column.',
    column: 'A cell of a row. Content (text, images, buttons) sits inside columns.'
};
const STAGE_HINTS = {
    container: 'Click the outermost layout element in the preview (usually the main table) and mark it as the container.',
    rows: 'Now click each row inside the container. A block without rows is fine: press Continue when you are done.',
    columns: 'Click the columns of each row. A row without inner columns can be treated as a column: select the row and tick the box.',
    done: 'The containers are identified. You can still select any element to rename it, change its level or remove it.'
};
const LEVEL_ORDER = ['container', 'row', 'column'];

/**
 * Step 1 of a content block or single-block template: identify the containers, from the outside in: the parent
 * container, its rows, and the columns of each row (or treat a row as its only column).
 * Settings and placeholders are step 2. Emits apply { marking }, remove, pick { node }, ascolumn { value },
 * nosections { value }, clear, next.
 */
export default class CcSectionPanel extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api sections = [];
    @api info = null;
    @api noSections = false;
    @api progress = null;
    @api errors = [];
    @api canContinue = false;
    edits = { key: null };
    confirmingRemove = false;

    get isMarkedSection() {
        return !!this.info && this.info.marks.role === 'section';
    }

    get isContentElement() {
        return !!this.info && this.info.marks.role === 'content';
    }

    get hasInfo() {
        return !!this.info;
    }

    get showIdleHint() {
        return !this.info;
    }

    get canMark() {
        return this.hasInfo && !this.isContentElement;
    }

    get currentKey() {
        return this.info ? `${this.info.node}:${this.info.marks.role}:${this.info.marks.id || ''}` : 'none';
    }

    get draft() {
        return this.edits.key === this.currentKey ? this.edits : {};
    }

    get suggestedLevel() {
        const suggestion = this.info?.suggestion;
        return suggestion && suggestion.role === 'section' ? suggestion.level : this.nextLevel;
    }

    /** The level that fits under the nearest section: container first, then row, then column. */
    get nextLevel() {
        const parent = this.info?.parentLevel;
        if (!parent) return 'container';
        return LEVEL_ORDER[Math.min(LEVEL_ORDER.indexOf(parent) + 1, LEVEL_ORDER.length - 1)];
    }

    get levelValue() {
        return this.draft.level || (this.isMarkedSection ? this.info.marks.level : this.suggestedLevel);
    }

    get stage() {
        return this.progress?.stage || 'container';
    }

    get stageHint() {
        return STAGE_HINTS[this.stage];
    }

    get stageChips() {
        const progress = this.progress || {};
        const stage = this.stage;
        const chip = (key, label, done, current) => ({
            key,
            label,
            className: `cc-sections__chip${done ? ' cc-sections__chip_done' : ''}${current ? ' cc-sections__chip_current' : ''}`,
            icon: done ? 'utility:success' : 'utility:record'
        });
        return [
            chip('container', 'Parent container', stage !== 'container', stage === 'container'),
            chip('rows', 'Rows', (progress.rowCount || 0) > 0, stage === 'rows'),
            chip('columns', 'Columns', stage === 'done' && (progress.rowCount || 0) > 0, stage === 'columns')
        ];
    }

    get isMarkedRow() {
        return this.isMarkedSection && this.info.marks.level === 'row';
    }

    get asColumnChecked() {
        return !!this.info?.asColumn;
    }

    get idValue() {
        return this.draft.id !== undefined ? this.draft.id : (this.isMarkedSection ? this.info.marks.id || '' : '');
    }

    get labelValue() {
        return this.draft.label !== undefined ? this.draft.label : (this.isMarkedSection ? this.info.marks.label || '' : '');
    }

    get levelOptions() {
        const parent = this.info?.parentLevel;
        const hints = {
            container: parent ? ' (not nested in another section)' : ' (fits here)',
            row: parent === 'container' ? ' (fits here)' : '',
            column: parent === 'row' ? ' (fits here)' : ''
        };
        return LEVEL_ORDER.map(value => ({ label: `${value.charAt(0).toUpperCase()}${value.slice(1)}${hints[value]}`, value }));
    }

    get levelHelp() {
        return LEVEL_HELP[this.levelValue];
    }


    get heading() {
        const tag = this.info ? `<${this.info.tag}>` : '';
        return this.isMarkedSection ? `Edit the ${this.info.marks.level} ${tag}` : `Mark ${tag} as a section`;
    }

    get applyLabel() {
        return this.isMarkedSection ? 'Update section' : 'Mark as section';
    }

    get sectionRows() {
        return (this.sections || []).map(section => ({
            ...section,
            key: `${section.node}`,
            name: section.label || section.sectionId || section.level,
            meta: section.asColumn ? 'row · treated as a column' : section.level === 'row' && !section.hasColumns ? 'row · needs columns' : section.level,
            metaClass: `slds-text-body_small ${section.level === 'row' && !section.asColumn && !section.hasColumns ? 'slds-text-color_error' : 'slds-text-color_weak'}`,
            className: `cc-sections__row cc-sections__row_depth-${Math.min(section.depth, 2)}${this.info && this.info.node === section.node ? ' cc-sections__row_selected' : ''}`
        }));
    }

    get hasSections() {
        return (this.sections || []).length > 0;
    }

    get showNoSections() {
        return !this.hasSections;
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

    handleLevel(event) {
        this.setDraft({ level: event.detail.value });
    }

    handleAsColumn(event) {
        this.dispatchEvent(new CustomEvent('ascolumn', { detail: { value: !!event.target.checked } }));
    }

    handleField(event) {
        this.setDraft({ [event.target.dataset.field]: event.detail.value });
    }

    handleApply() {
        this.dispatchEvent(new CustomEvent('apply', {
            detail: {
                marking: {
                    role: 'section',
                    level: this.levelValue,
                    id: this.idValue,
                    label: this.labelValue
                }
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
        this.dispatchEvent(new CustomEvent('remove'));
    }

    handlePathPick(event) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: event.detail.node } }));
    }

    handlePickSection(event) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: Number(event.currentTarget.dataset.node) } }));
    }

    handleNoSections(event) {
        this.dispatchEvent(new CustomEvent('nosections', { detail: { value: !!event.target.checked } }));
    }

    handleClear() {
        this.dispatchEvent(new CustomEvent('clear'));
    }

    handleNext() {
        this.dispatchEvent(new CustomEvent('next'));
    }
}
