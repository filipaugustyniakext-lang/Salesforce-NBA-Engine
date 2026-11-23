import { LightningElement, api } from 'lwc';
import { parseTemplate } from 'c/ccTemplateParser';
import { validateDefinition, CONTENT_TYPE_LABELS, clone } from 'c/ccTemplateSchema';

const LEVEL_ICONS = { container: 'utility:layout', row: 'utility:rows', column: 'utility:column' };
const TYPE_ICONS = {
    richText: 'utility:richtextbulletedlist',
    image: 'utility:image',
    bulletList: 'utility:bulleted_list',
    divider: 'utility:dash',
    button: 'utility:button_choice'
};
const MAX_FILE_BYTES = 262144;

/**
 * Upload + parse + configure bindings of one HTML file (shell or block).
 * Emits change { html, definition, errors, warnings }.
 */
export default class CcBindingWorkspace extends LightningElement {
    @api kind = 'block';
    @api disabled = false;
    html = '';
    definition = null;
    errors = [];
    warnings = [];
    selectedKey;
    fileName;
    _templateMode = 'multi';

    @api
    get templateMode() {
        return this._templateMode;
    }
    set templateMode(next) {
        const changed = next && next !== this._templateMode;
        this._templateMode = next || 'multi';
        if (changed && this.html) this.reparse();
    }

    @api
    get source() {
        return { html: this.html, definition: this.definition };
    }
    set source(next) {
        const html = next?.html || '';
        const definition = next?.definition || null;
        if (html === this.html && JSON.stringify(definition) === JSON.stringify(this.definition)) return;
        this.html = html;
        this.definition = definition;
        if (html) {
            const result = parseTemplate(html, { kind: this.kind, templateMode: this._templateMode, previous: definition });
            this.definition = result.definition;
            this.html = result.html;
            this.errors = result.errors;
            this.warnings = result.warnings;
        } else {
            this.errors = [];
            this.warnings = [];
        }
    }

    get guideOpen() {
        return !this.html;
    }

    get hasHtml() {
        return !!this.html;
    }

    get uploadLabel() {
        return this.kind === 'shell' ? 'Upload template shell HTML' : 'Upload content block HTML';
    }

    get helpText() {
        return this.kind === 'shell'
            ? 'One HTML file with its CSS inlined in <style> tags. Mark sections with data-cc-section, regions with data-cc-region (fixed-read, fixed-edit, blocks) and content with data-cc-content.'
            : 'One HTML file for this block. Mark container/row/column with data-cc-section and bind settings with data-cc-bind; mark content with data-cc-content and data-cc-key.';
    }

    get hasErrors() {
        return this.errors.length > 0;
    }

    get hasWarnings() {
        return this.warnings.length > 0;
    }

    get errorItems() {
        return this.errors.map((message, index) => ({ key: `e${index}`, message }));
    }

    get warningItems() {
        return this.warnings.map((message, index) => ({ key: `w${index}`, message }));
    }

    get navItems() {
        if (!this.definition) return [];
        const sections = this.definition.sections.map(section => ({
            key: `section:${section.sectionId}`,
            label: section.label || section.sectionId,
            meta: `${section.level}${section.binds.length ? ` · ${section.binds.join(', ')}` : ''}`,
            icon: LEVEL_ICONS[section.level],
            depth: section.level === 'container' ? 0 : section.level === 'row' ? 1 : 2
        }));
        const slots = this.definition.contentSlots.map(slot => ({
            key: `slot:${slot.bindingKey}`,
            label: slot.label || slot.bindingKey,
            meta: `${CONTENT_TYPE_LABELS[slot.type]} · ${slot.bindingKey}`,
            icon: TYPE_ICONS[slot.type],
            depth: 0
        }));
        const regions = (this.definition.regions || []).map(region => ({
            key: `region:${region.regionId}`,
            label: region.regionId,
            meta: region.kind,
            icon: region.kind === 'blocks' ? 'utility:drag_and_drop' : 'utility:lock',
            depth: 0
        }));
        const decorate = list => list.map(item => ({
            ...item,
            className: `cc-workspace__nav-item cc-workspace__nav-item_depth-${item.depth}${item.key === this.selectedKey ? ' cc-workspace__nav-item_selected' : ''}`
        }));
        return [
            { key: 'g-regions', title: 'Regions', items: decorate(regions), empty: 'No data-cc-region markers.' },
            { key: 'g-sections', title: 'Sections', items: decorate(sections), empty: 'No data-cc-section markers.' },
            { key: 'g-content', title: 'Content bindings', items: decorate(slots), empty: 'No data-cc-content markers.' }
        ].map(group => ({ ...group, isEmpty: group.items.length === 0 }));
    }

    get selectedSection() {
        if (!this.selectedKey?.startsWith('section:') || !this.definition) return null;
        const id = this.selectedKey.slice(8);
        return this.definition.sections.find(section => section.sectionId === id) || null;
    }

    get selectedSlot() {
        if (!this.selectedKey?.startsWith('slot:') || !this.definition) return null;
        const key = this.selectedKey.slice(5);
        return this.definition.contentSlots.find(slot => slot.bindingKey === key) || null;
    }

    get selectedRegion() {
        if (!this.selectedKey?.startsWith('region:') || !this.definition) return null;
        const id = this.selectedKey.slice(7);
        return (this.definition.regions || []).find(region => region.regionId === id) || null;
    }

    get regionDescription() {
        const kind = this.selectedRegion?.kind;
        if (kind === 'fixed-read') return 'Rendered exactly as uploaded. Marketers cannot change anything inside it.';
        if (kind === 'fixed-edit') return 'Always rendered. Section settings are fixed; content bindings inside stay editable.';
        if (kind === 'blocks') return 'Drop zone where marketers add content blocks in the Copy Center editor.';
        return '';
    }

    get showEmptySelection() {
        return !this.selectedSection && !this.selectedSlot && !this.selectedRegion;
    }

    async handleFile(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            this.errors = [`The file is too large (${Math.round(file.size / 1024)} KB). The limit is ${MAX_FILE_BYTES / 1024} KB.`];
            return;
        }
        if (!/\.html?$/i.test(file.name)) {
            this.errors = ['Upload an .html file with the CSS inlined.'];
            return;
        }
        this.fileName = file.name;
        const text = await file.text();
        this.html = text;
        this.reparse();
    }

    reparse() {
        const result = parseTemplate(this.html, { kind: this.kind, templateMode: this._templateMode, previous: this.definition });
        this.definition = result.definition;
        this.html = result.html;
        this.errors = result.errors;
        this.warnings = result.warnings;
        if (this.selectedKey && !this.navItems.some(group => group.items.some(item => item.key === this.selectedKey))) {
            this.selectedKey = null;
        }
        this.emit();
    }

    handleSelect(event) {
        this.selectedKey = event.currentTarget.dataset.key;
    }

    handleSectionChange(event) {
        const section = event.detail.section;
        const definition = clone(this.definition);
        definition.sections = definition.sections.map(item => (item.sectionId === section.sectionId ? section : item));
        this.updateDefinition(definition);
    }

    handleSlotChange(event) {
        const slot = event.detail.slot;
        const definition = clone(this.definition);
        definition.contentSlots = definition.contentSlots.map(item => (item.bindingKey === slot.bindingKey ? slot : item));
        this.updateDefinition(definition);
    }

    updateDefinition(definition) {
        this.definition = definition;
        const validation = validateDefinition(definition);
        const parseErrors = parseTemplate(this.html, { kind: this.kind, templateMode: this._templateMode, previous: definition }).errors;
        this.errors = Array.from(new Set([...parseErrors, ...validation.errors]));
        this.warnings = validation.warnings;
        this.emit();
    }

    emit() {
        this.dispatchEvent(new CustomEvent('change', {
            detail: { html: this.html, definition: this.definition, errors: this.errors, warnings: this.warnings }
        }));
    }
}
