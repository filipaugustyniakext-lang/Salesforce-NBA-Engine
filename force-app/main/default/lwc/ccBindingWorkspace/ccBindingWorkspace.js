import { LightningElement, api } from 'lwc';
import { parseTemplate, describeMarked } from 'c/ccTemplateParser';
import { inspectNode, inspectGroup, applyMarking, wrapElements, insertBlocksZone, rangeBetween, nodeElement, isUnmarked } from 'c/ccElementMarking';
import { validateDefinition, CONTENT_TYPE_LABELS, clone } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

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
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api kind = 'block';
    @api disabled = false;
    html = '';
    definition = null;
    errors = [];
    warnings = [];
    selectedKey;
    fileName;
    pickedNodes = [];
    markerErrors = [];
    _markerCache = { html: null, node: null, mode: null, info: null };
    _templateMode = 'multi';

    /** Key of the selected list item (section:id, slot:key, region:id); set by the preview or the list. */
    @api
    get activeKey() {
        return this.selectedKey;
    }
    set activeKey(key) {
        if ((key || null) === this.selectedKey) return;
        this.selectedKey = key || null;
        this._revealPending = !!key;
    }

    renderedCallback() {
        if (!this._revealPending) return;
        this._revealPending = false;
        const target = this.template.querySelector('.cc-workspace__nav-item_selected');
        if (target) target.scrollIntoView({ block: 'nearest' });
        const editor = this.template.querySelector('.cc-workspace__editor');
        if (editor) editor.scrollIntoView({ block: 'nearest' });
    }

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
        this.setPicked([]);
        this.dispatchEvent(new CustomEvent('select', { detail: { key: this.selectedKey } }));
    }

    // ─── Guided marking ──────────────────────────────────────────────────────

    /** Node indexes (see c/ccElementMarking) of the element(s) picked in the preview's mark mode. */
    @api
    get pickedElements() {
        return this.pickedNodes;
    }
    set pickedElements(nodes) {
        const next = Array.isArray(nodes) ? nodes : [];
        if (next.length === this.pickedNodes.length && next.every((node, index) => node === this.pickedNodes[index])) return;
        this.pickedNodes = next;
        this.markerErrors = [];
        this._revealPending = next.length > 0;
    }

    /** Shift-click: extends the selection from the first picked element to `node` (neighbours in one parent). */
    @api
    extendSelection(node) {
        if (!this.pickedNodes.length) {
            this.setPicked([node]);
            return;
        }
        const range = rangeBetween(this.html, this.pickedNodes[0], node);
        if (range.error) {
            this.markerErrors = [range.error];
            return;
        }
        this.setPicked(range.nodes);
    }

    setPicked(nodes) {
        this.pickedNodes = nodes;
        this.markerErrors = [];
        this.dispatchEvent(new CustomEvent('pick', { detail: { nodes } }));
    }

    get primaryNode() {
        return this.pickedNodes.length ? this.pickedNodes[0] : null;
    }

    get markerInfo() {
        if (!this.html || this.pickedNodes.length !== 1) return null;
        const node = this.primaryNode;
        const cache = this._markerCache;
        if (cache.html !== this.html || cache.node !== node || cache.mode !== this._templateMode) {
            this._markerCache = {
                html: this.html,
                node,
                mode: this._templateMode,
                info: inspectNode(this.html, node, { kind: this.kind, templateMode: this._templateMode })
            };
        }
        return this._markerCache.info;
    }

    get groupInfo() {
        if (!this.html || this.pickedNodes.length < 2) return null;
        return inspectGroup(this.html, this.pickedNodes);
    }

    get showMarker() {
        return !!this.markerInfo || !!this.groupInfo;
    }

    get markerKind() {
        return this.kind;
    }

    get existingKeys() {
        return (this.definition?.contentSlots || []).map(slot => slot.bindingKey);
    }

    get isRawHtml() {
        return !!this.html && isUnmarked(this.definition);
    }

    /** Checklist for multi-block shells: fixed areas, blocks zone, editable content. */
    get isMultiShell() {
        return this.kind === 'shell' && this._templateMode !== 'single';
    }

    get checklist() {
        const regions = this.definition?.regions || [];
        const fixed = regions.filter(region => region.kind !== 'blocks').length;
        const zone = regions.some(region => region.kind === 'blocks');
        const editable = regions.some(region => region.kind === 'fixed-edit');
        const slots = (this.definition?.contentSlots || []).length;
        const item = (key, done, text, optional) => ({
            key,
            done,
            icon: done ? 'utility:success' : 'utility:routing_offline',
            className: `cc-workspace__todo${done ? ' cc-workspace__todo_done' : ''}`,
            text: optional ? `${text} (optional)` : text
        });
        return [
            item('fixed', fixed > 0, 'Mark the fixed areas (header, footer): click an element, Shift-click its neighbours, choose Region.'),
            item('zone', zone, 'Place the blocks zone: click an element next to a fixed area and choose Insert blocks zone.'),
            item('content', slots > 0, editable ? 'Mark the editable content inside the editable regions.' : 'Mark editable content inside editable regions.', true)
        ];
    }

    get showChecklist() {
        return this.isMultiShell && !!this.html;
    }

    handleMarkerPick(event) {
        this.setPicked([event.detail.node]);
    }

    handleMarkerClose() {
        this.setPicked([]);
    }

    handleMarkerApply(event) {
        this.applyMarkingChange(event.detail.marking);
    }

    handleMarkerRemove() {
        this.applyMarkingChange({ role: 'none' });
    }

    handleGroupChildren() {
        const info = this.markerInfo;
        if (!info || info.firstChild === null) return;
        const range = rangeBetween(this.html, info.firstChild, info.lastChild);
        if (range.error) this.markerErrors = [range.error];
        else this.setPicked(range.nodes);
    }

    handleMarkerWrap(event) {
        const result = wrapElements(this.html, this.pickedNodes, event.detail.marking, { kind: this.kind });
        this.finishStructureChange(result);
    }

    handleMarkerZone(event) {
        const result = insertBlocksZone(this.html, this.primaryNode, event.detail.position, { kind: this.kind, templateMode: this._templateMode });
        this.finishStructureChange(result);
    }

    applyMarkingChange(marking) {
        const result = applyMarking(this.html, this.primaryNode, marking, { kind: this.kind });
        this.finishStructureChange(result, marking.role === 'none');
    }

    /** Stores the edited HTML, re-parses it and selects the element that now carries the marking. */
    finishStructureChange(result, removed = false) {
        if (result.errors.length) {
            this.markerErrors = result.errors;
            return;
        }
        this.html = result.html;
        this.reparse();
        let key = null;
        if (!removed && result.markedNode !== null && result.markedNode !== undefined) {
            key = describeMarked(nodeElement(this.html, result.markedNode))?.key || null;
        }
        this.selectedKey = key;
        this.setPicked([]);
        if (key) this.dispatchEvent(new CustomEvent('select', { detail: { key } }));
    }

    handleSectionChange(event) {
        const section = event.detail?.section;
        if (!section) return;
        const definition = clone(this.definition);
        definition.sections = definition.sections.map(item => (item.sectionId === section.sectionId ? section : item));
        this.updateDefinition(definition);
    }

    handleSlotChange(event) {
        const slot = event.detail?.slot;
        if (!slot) return;
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
        this.dispatchEvent(new CustomEvent('bindingchange', {
            detail: { html: this.html, definition: this.definition, errors: this.errors, warnings: this.warnings }
        }));
    }
}
