import { LightningElement, api } from 'lwc';
import { TARGET_TOKENS, TARGET_LABELS } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

const LEVEL_LABELS = { container: 'container', row: 'row', column: 'column' };
const BIND_OPTIONS = [
    { label: 'Padding', value: 'padding' },
    { label: 'Margin', value: 'margin' },
    { label: 'Background (color, gradient, image)', value: 'background' },
    { label: 'Hide on desktop / mobile', value: 'hide' },
    { label: 'Column order (rows only)', value: 'column-direction' }
];
const GROUP_TARGETS = { padding: ['padding'], margin: ['margin'], background: ['bgColor', 'bgGradient', 'bgImage'] };
const OUTPUT = {
    padding: 'Editors send four values, "Top px Right px Bottom px Left px", for example 10px 20px 10px 20px.',
    margin: 'Editors send four values, "Top px Right px Bottom px Left px", for example 0px 0px 24px 0px.',
    bgColor: 'Editors send one hex color, #XXXXXX. Place it where a color goes, for example background-color or bgcolor.',
    bgGradient: 'Editors send complete declarations: background-color, background-image: linear-gradient(...), background-repeat, background-size and min-height. The placeholder stands for all of them. Color and gradient presets are defined below.',
    bgImage: 'Editors send complete declarations: background-color, background-image: url(...), background-position, background-repeat, background-size, min-height and width. The image can differ for desktop and mobile (mobile inherits desktop) and, optionally, for dark mode, from a URL, an upload or Salesforce CMS. There are no presets.'
};
const GROUP_NOTES = {
    hide: 'Adds the classes cc-hide-dsk and cc-hide-mob to this element. The Master Template shell CSS must define them.',
    'column-direction': 'Sets the reading direction and the cc-stack-mob class on this row. The Master Template shell CSS must define cc-stack-mob.'
};

/**
 * Step 2 of a content block or single-block template: for the selected container, row or column choose the settings
 * marketers can change and tell where each value goes in the HTML. The existing declaration in the element's style
 * becomes the placeholder and its value the fallback; settings without one get a declaration added.
 * Emits bindschange { binds }, place { target, fallback }, unplace { target }, fallbackchange { target, fallback },
 * sectionchange { section }, next.
 */
export default class CcSectionSettingsPanel extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api section = null;
    @api info = null;
    @api errors = [];
    @api pendingCount = 0;
    @api canContinue = false;
    @api disabled = false;
    typed = {};

    get hasSection() {
        return !!this.section;
    }

    get heading() {
        const name = this.section?.label || this.section?.sectionId || '';
        return `2. Settings of the ${LEVEL_LABELS[this.section?.level] || 'section'} ${name}`.trim();
    }

    get bindOptions() {
        return BIND_OPTIONS.filter(option => option.value !== 'column-direction' || this.section?.level === 'row');
    }

    get binds() {
        return this.section?.binds || [];
    }

    get hasBinds() {
        return this.binds.length > 0;
    }

    get style() {
        return this.info?.styleInfo || { placed: {} };
    }

    get pendingText() {
        const count = Number(this.pendingCount) || 0;
        return count ? `${count} placeholder${count === 1 ? '' : 's'} still to place in this block.` : 'Every setting has a placeholder.';
    }

    get pendingClass() {
        return `slds-text-body_small slds-m-top_small ${Number(this.pendingCount) > 0 ? 'slds-text-color_error' : 'slds-text-color_success'}`;
    }

    captureText(key) {
        const style = this.style;
        const token = TARGET_TOKENS[key];
        if (key === 'padding' || key === 'margin') {
            const found = style[key];
            return found && !found.includes('{{cc-')
                ? `Found "${key}: ${found}" in the style of this element. It becomes the placeholder and "${found}" the fallback.`
                : `This element has no ${key} in its style. "${key}: ${token}" is added; type the fallback used when nothing is provided.`;
        }
        if (key === 'bgColor') {
            const found = style.backgroundColor || style.bgcolorAttribute;
            return found && !found.includes('{{cc-')
                ? `Found the color "${found}" on this element. It becomes the placeholder and the fallback.`
                : `This element has no background color. "background-color: ${token}" is added; type the fallback.`;
        }
        return style.backgroundDeclarations
            ? `The existing background declarations (${style.backgroundDeclarations}) move into the fallback and ${token} takes their place.`
            : `${token} is added to the style of this element; type the fallback if you want one.`;
    }

    cardFor(key) {
        const target = this.section?.targets?.[key];
        const placed = !!target || !!this.style.placed[key];
        const captured = /^Found|^The existing/.test(this.captureText(key));
        return {
            key,
            title: TARGET_LABELS[key],
            token: TARGET_TOKENS[key],
            output: OUTPUT[key],
            placed,
            notPlaced: !placed,
            capture: this.captureText(key),
            fallback: placed ? target?.fallback || '' : this.typed[key] || '',
            canType: placed || !captured,
            fallbackLabel: 'Fallback (rendered when nothing is provided)'
        };
    }

    get groups() {
        return this.binds
            .filter(bind => GROUP_TARGETS[bind] || GROUP_NOTES[bind])
            .map(bind => {
                const cards = (GROUP_TARGETS[bind] || []).map(key => this.cardFor(key));
                const placedCount = cards.filter(card => card.placed).length;
                return {
                    key: bind,
                    title: BIND_OPTIONS.find(option => option.value === bind).label,
                    note: GROUP_NOTES[bind] || '',
                    hasNote: !!GROUP_NOTES[bind],
                    cards,
                    hasCards: cards.length > 0,
                    needsPlacement: cards.length > 0 && placedCount === 0
                };
            });
    }

    get errorItems() {
        return (this.errors || []).map((message, index) => ({ key: `e${index}`, message }));
    }

    get hasErrors() {
        return (this.errors || []).length > 0;
    }

    get hasDefaults() {
        return this.hasBinds;
    }

    handleBinds(event) {
        this.dispatchEvent(new CustomEvent('bindschange', { detail: { binds: event.detail.value } }));
    }

    handleTyped(event) {
        const key = event.target.dataset.target;
        const value = event.target.value || '';
        const card = this.cardFor(key);
        if (card.placed) {
            this.dispatchEvent(new CustomEvent('fallbackchange', { detail: { target: key, fallback: value } }));
        } else {
            this.typed = { ...this.typed, [key]: value };
        }
    }

    handlePlace(event) {
        const key = event.currentTarget.dataset.target;
        this.dispatchEvent(new CustomEvent('place', { detail: { target: key, fallback: this.typed[key] || '' } }));
        this.typed = { ...this.typed, [key]: '' };
    }

    handleUnplace(event) {
        this.dispatchEvent(new CustomEvent('unplace', { detail: { target: event.currentTarget.dataset.target } }));
    }

    handleSectionChange(event) {
        this.dispatchEvent(new CustomEvent('sectionchange', { detail: { section: event.detail.section } }));
    }

    handleNext() {
        this.dispatchEvent(new CustomEvent('next'));
    }
}
