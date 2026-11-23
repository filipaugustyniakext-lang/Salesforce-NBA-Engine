import { LightningElement, api } from 'lwc';
import { parseTemplate, describeMarked } from 'c/ccTemplateParser';
import {
    inspectNode,
    inspectGroup,
    applyMarking,
    wrapElements,
    insertBlocksZone,
    rangeBetween,
    nodeElement,
    isUnmarked,
    listAreas,
    updateArea,
    removeArea,
    removeBlocksZone,
    zonePlacement,
    shellProgress,
    blockProgress,
    listBindings,
    placeTarget,
    removeTarget,
    setSectionBinds,
    setRowAsColumn,
    pendingTargets
} from 'c/ccElementMarking';
import {
    validateDefinition,
    buildBlockConfig,
    normalizeSpacing,
    normalizeBackground,
    defaultSpacing,
    isHexColor,
    CONTENT_TYPE_LABELS,
    clone
} from 'c/ccTemplateSchema';
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
 * Emits bindingchange { html, definition, errors, warnings }.
 * Emits testchange { config } while "Test bindings" is on (config is null again when it ends): the wizard renders the
 * preview with those values so every binding can be tried out.
 * Both kinds of template are set up in three gated steps; the workspace announces the active step with
 * stepchange { step, pickScope } so the preview only offers what the step needs.
 *   multi-block shell:             fixed areas, dropzone, editable content
 *   content block / single-block:  containers, settings (placeholders, defaults, presets), content
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
    testMode = false;
    testConfig = null;
    selectedKey;
    fileName;
    pickedNodes = [];
    activeStep = 1;
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
        if (key && this.isGuided && this.html) this.routeKey(key, false);
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
        this.exitTest();
        this.html = html;
        this.definition = definition;
        if (html) {
            const result = parseTemplate(html, { kind: this.kind, templateMode: this._templateMode, previous: definition });
            this.definition = result.definition;
            this.html = result.html;
            this.errors = result.errors;
            this.warnings = result.warnings;
            this.openFirstStep();
        } else {
            this.errors = [];
            this.warnings = [];
        }
    }

    get setupVariant() {
        return this.testMode ? 'neutral' : 'brand';
    }

    get testVariant() {
        return this.testMode ? 'brand' : 'neutral';
    }

    get cannotTest() {
        const definition = this.definition;
        const hasBindings = !!definition && ((definition.sections || []).length > 0 || (definition.contentSlots || []).length > 0);
        return this.hasErrors || !hasBindings;
    }

    get testTitle() {
        return this.cannotTest ? 'Fix the errors and mark some sections or content first' : 'Change settings and content to check how the preview reacts';
    }

    handleTestMode() {
        if (this.cannotTest || this.testMode) return;
        this.testConfig = buildBlockConfig(this.definition);
        this.testMode = true;
        this.emitTest();
    }

    handleSetupMode() {
        this.exitTest();
    }

    exitTest() {
        if (!this.testMode) return;
        this.testMode = false;
        this.testConfig = null;
        this.emitTest();
    }

    handlePlaygroundChange(event) {
        if (!event.detail || !event.detail.config) return;
        this.testConfig = event.detail.config;
        this.emitTest();
    }

    handlePlaygroundReset() {
        this.testConfig = buildBlockConfig(this.definition);
        this.emitTest();
    }

    emitTest() {
        this.dispatchEvent(new CustomEvent('testchange', { detail: { config: this.testConfig } }));
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
            : 'One HTML file for this block. The Master Template HTML shell must already contain the CSS this markup relies on (classes, media queries, resets); only the block markup is uploaded here.';
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
        if (this.isMultiShell) return this.shellNavItems;
        if (this.isGuidedBlock) return this.blockNavItems;
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
        this.openFirstStep();
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
        if (this.isGuided && !this.stepUnlocked(this.activeStep)) this.setStep(this.highestUnlockedStep());
        this.emit();
    }

    handleSelect(event) {
        const key = event.currentTarget.dataset.key;
        this.selectedKey = key;
        if (this.isGuided && this.routeKey(key, true)) return;
        this.setPicked([]);
        this.dispatchEvent(new CustomEvent('select', { detail: { key } }));
    }

    // ─── Shell setup steps (multi-block shells) ───────────────────────────────

    get isMultiShell() {
        return this.kind === 'shell' && this._templateMode !== 'single';
    }

    /** A content block, or a single-block template (the template is the block). */
    get isGuidedBlock() {
        return this.kind === 'block' || (this.kind === 'shell' && this._templateMode === 'single');
    }

    get isGuided() {
        return this.isMultiShell || this.isGuidedBlock;
    }

    get stepsVariant() {
        return this.isMultiShell ? 'shell' : 'block';
    }

    get showSteps() {
        return this.isGuided && !!this.html;
    }

    get progress() {
        return this.isMultiShell ? shellProgress(this.definition) : blockProgress(this.definition);
    }

    get bindings() {
        return this.html && this.isGuidedBlock ? listBindings(this.html) : { sections: [], content: [] };
    }

    get blockSections() {
        return this.bindings.sections;
    }

    get noSections() {
        return !!this.progress.noSections;
    }

    get areas() {
        return this.html && this.isMultiShell ? listAreas(this.html) : [];
    }

    get placement() {
        return this.html && this.isMultiShell ? zonePlacement(this.html) : null;
    }

    get isStep1() {
        return this.activeStep === 1;
    }

    get isStep2() {
        return this.activeStep === 2;
    }

    get isStep3() {
        return this.activeStep === 3;
    }

    get step1Done() {
        return this.progress.steps[0].done;
    }

    get step2Done() {
        return this.progress.steps[1].done;
    }

    get noFixedAreas() {
        return this.progress.noFixedAreas;
    }

    /** Step 2 of a block only selects what is already marked ('inspect'); the other steps pick elements. */
    get pickScope() {
        if (this.isMultiShell) return this.activeStep === 3 ? 'editable' : 'areas';
        return this.isGuidedBlock && this.activeStep === 2 ? 'inspect' : 'any';
    }

    stepUnlocked(step) {
        const state = this.progress.steps.find(item => item.step === step);
        return !!state && state.unlocked;
    }

    highestUnlockedStep() {
        return [3, 2, 1].find(step => this.stepUnlocked(step)) || 1;
    }

    openFirstStep() {
        if (this.isGuided && this.html) this.setStep(this.progress.firstOpenStep, true);
    }

    /** Opens a step if it is unlocked. Changing the step clears the current selection. */
    setStep(step, force = false) {
        if (!this.stepUnlocked(step)) return false;
        if (step === this.activeStep && !force) return true;
        this.activeStep = step;
        this.markerErrors = [];
        if (this.pickedNodes.length) this.setPicked([]);
        if (step === 2 && this.isGuidedBlock) this.selectDefaultSection();
        const detail = { step, pickScope: this.pickScope };
        Promise.resolve().then(() => this.dispatchEvent(new CustomEvent('stepchange', { detail })));
        return true;
    }

    handleStepSelect(event) {
        this.setStep(event.detail.step);
    }

    /** Opens the step and selection that belong to a list key. Returns true when the key was handled here. */
    routeKey(key, announce) {
        if (this.isGuidedBlock) return this.routeBlockKey(key, announce);
        if (key.startsWith('region:')) {
            const id = key.slice(7);
            const area = this.areas.find(item => item.regionId === id);
            const zone = this.placement && this.placement.zoneId === id ? this.placement : null;
            const target = area || zone;
            if (!target || !this.setStep(area ? 1 : 2)) return false;
            if (announce) this.setPicked([target.node]);
            return true;
        }
        if (key.startsWith('slot:')) {
            if (!this.setStep(3)) return false;
            if (announce) this.dispatchEvent(new CustomEvent('select', { detail: { key } }));
            return true;
        }
        return false;
    }

    /** Step 2 works on a selected section; open it on the first one that still needs a placeholder. */
    selectDefaultSection() {
        if (this.selectedSection || !this.definition) return;
        const pending = pendingTargets(this.definition)[0];
        const target = pending
            ? this.definition.sections.find(item => item.sectionId === pending.sectionId)
            : this.definition.sections[0];
        if (!target) return;
        const key = `section:${target.sectionId}`;
        this.selectedKey = key;
        Promise.resolve().then(() => this.dispatchEvent(new CustomEvent('select', { detail: { key } })));
    }

    routeBlockKey(key, announce) {
        const isSection = key.startsWith('section:');
        const isSlot = key.startsWith('slot:');
        if (!isSection && !isSlot) return false;
        const id = key.slice(isSection ? 8 : 5);
        const target = isSection
            ? this.bindings.sections.find(item => item.sectionId === id)
            : this.bindings.content.find(item => item.key === id);
        if (!target) return false;
        if (isSection) {
            // Containers are identified in step 1 and configured in step 2; from the content step go to settings.
            if (this.activeStep === 3 && !this.setStep(2)) return false;
            if (this.activeStep === 2) {
                if (announce) this.dispatchEvent(new CustomEvent('select', { detail: { key } }));
                return true;
            }
            if (announce) this.setPicked([target.node]);
            return true;
        }
        if (!this.setStep(3)) return false;
        if (announce) this.setPicked([target.node]);
        return true;
    }

    get blockNavItems() {
        const { sections, content } = this.bindings;
        const item = (key, label, meta, icon, depth) => ({
            key,
            label,
            meta,
            icon,
            className: `cc-workspace__nav-item cc-workspace__nav-item_depth-${depth}${key === this.selectedKey ? ' cc-workspace__nav-item_selected' : ''}`
        });
        const state = step => this.progress.steps.find(entry => entry.step === step);
        const title = (step, text) => `${step} · ${text}${state(step).unlocked ? '' : ' (locked)'}`;
        const pending = new Set(pendingTargets(this.definition).map(entry => entry.sectionId));
        const definitionOf = id => (this.definition?.sections || []).find(section => section.sectionId === id) || {};
        const sectionMeta = section => {
            const binds = definitionOf(section.sectionId).binds || section.binds;
            const parts = [section.asColumn ? `${section.level} · as column` : section.level];
            if (this.activeStep >= 2 && binds.length) parts.push(binds.join(', '));
            if (pending.has(section.sectionId)) parts.push('placeholder missing');
            return parts.join(' · ');
        };
        const pendingCount = this.progress.pendingCount || 0;
        return [
            {
                key: 'g-sections',
                title: title(1, 'Containers'),
                items: sections.map(section => item(
                    `section:${section.sectionId}`,
                    section.label || section.sectionId,
                    sectionMeta(section),
                    LEVEL_ICONS[section.level],
                    Math.min(section.depth, 2)
                )),
                empty: this.progress.noSections ? 'This block needs no layout settings.' : 'No containers yet.'
            },
            {
                key: 'g-settings',
                title: title(2, 'Settings'),
                items: [],
                empty: !sections.length ? 'Identify the containers first.' : pendingCount ? `${pendingCount} placeholder${pendingCount === 1 ? '' : 's'} to place.` : 'All placeholders are placed.'
            },
            {
                key: 'g-content',
                title: title(3, 'Content'),
                items: content.map(entry => item(`slot:${entry.key}`, entry.label || entry.key, `${CONTENT_TYPE_LABELS[entry.type] || entry.type} · ${entry.key}`, TYPE_ICONS[entry.type], 0)),
                empty: 'No content marked yet.'
            }
        ].map(group => ({ ...group, isEmpty: group.items.length === 0 }));
    }

    get shellNavItems() {
        const item = (key, label, meta, icon) => ({
            key,
            label,
            meta,
            icon,
            className: `cc-workspace__nav-item cc-workspace__nav-item_depth-0${key === this.selectedKey ? ' cc-workspace__nav-item_selected' : ''}`
        });
        const areas = this.areas;
        const placement = this.placement;
        const slots = (this.definition.contentSlots || []).map(slot => {
            const area = areas.find(entry => entry.contentKeys.includes(slot.bindingKey));
            return item(`slot:${slot.bindingKey}`, slot.label || slot.bindingKey, `${CONTENT_TYPE_LABELS[slot.type]}${area ? ` · in ${area.name}` : ''}`, TYPE_ICONS[slot.type]);
        });
        const state = step => this.progress.steps.find(entry => entry.step === step);
        const title = (step, text) => `${step} · ${text}${state(step).unlocked ? '' : ' (locked)'}`;
        return [
            {
                key: 'g-areas',
                title: title(1, 'Fixed areas'),
                items: areas.map(area => item(`region:${area.regionId}`, area.name, area.kind === 'fixed-edit' ? 'Editable' : 'Read-only', 'utility:lock')),
                empty: this.progress.noFixedAreas ? 'This template has no fixed areas.' : 'No fixed areas yet.'
            },
            {
                key: 'g-zone',
                title: title(2, 'Dropzone'),
                items: placement ? [item(`region:${placement.zoneId}`, 'Content blocks dropzone', placement.text, 'utility:drag_and_drop')] : [],
                empty: 'Not placed yet.'
            },
            {
                key: 'g-content',
                title: title(3, 'Editable content'),
                items: slots,
                empty: this.progress.editableCount ? 'Nothing marked yet.' : 'No editable areas.'
            }
        ].map(group => ({ ...group, isEmpty: group.items.length === 0 }));
    }

    // Step 1 (fixed areas)

    handleAreaCreate(event) {
        const { name, kind } = event.detail;
        const marking = { regionKind: kind, name };
        const result = this.pickedNodes.length > 1
            ? wrapElements(this.html, this.pickedNodes, marking, { kind: this.kind })
            : applyMarking(this.html, this.primaryNode, { role: 'region', ...marking }, { kind: this.kind });
        this.finishStructureChange(result);
    }

    handleAreaUpdate(event) {
        const { regionId, name, kind, removeContent } = event.detail;
        this.finishStructureChange(updateArea(this.html, regionId, { name, kind, removeContent }));
    }

    handleAreaRemove(event) {
        const result = removeArea(this.html, event.detail.regionId);
        this.finishStructureChange({ ...result, markedNode: null }, true);
    }

    handleNoFixedAreas(event) {
        const definition = clone(this.definition);
        definition.setup = { ...(definition.setup || {}), noFixedAreas: !!event.detail.value };
        this.updateDefinition(definition);
    }

    // Step 1 of a block (layout sections)

    handleNoSections(event) {
        const definition = clone(this.definition);
        definition.setup = { ...(definition.setup || {}), noSections: !!event.detail.value };
        this.updateDefinition(definition);
    }

    handleAsColumn(event) {
        const node = this.primaryNode;
        if (node === null) return;
        const result = setRowAsColumn(this.html, node, !!event.detail.value);
        this.finishStructureChange({ ...result, markedNode: node });
    }

    // Step 2 of a block (settings and placeholders)

    get settingsSection() {
        return this.isGuidedBlock && this.activeStep === 2 ? this.selectedSection : null;
    }

    get settingsNode() {
        const section = this.settingsSection;
        const entry = section ? this.bindings.sections.find(item => item.sectionId === section.sectionId) : null;
        return entry ? entry.node : null;
    }

    get settingsInfo() {
        const node = this.settingsNode;
        if (!this.html || node === null) return null;
        const cache = this._settingsCache || {};
        if (cache.html !== this.html || cache.node !== node) {
            this._settingsCache = { html: this.html, node, info: inspectNode(this.html, node, { kind: this.kind, templateMode: this._templateMode }) };
        }
        return this._settingsCache.info;
    }

    get pendingCount() {
        return this.progress.pendingCount || 0;
    }

    patchSection(sectionId, mutator) {
        const definition = clone(this.definition);
        const section = definition.sections.find(item => item.sectionId === sectionId);
        if (!section) return;
        mutator(section);
        this.updateDefinition(definition);
    }

    applyHtmlChange(result) {
        if (result.errors.length) {
            this.markerErrors = result.errors;
            return false;
        }
        this.markerErrors = [];
        this.html = result.html;
        this.reparse();
        return true;
    }

    handleBindsChange(event) {
        const section = this.settingsSection;
        const node = this.settingsNode;
        if (!section || node === null) return;
        const fallbacks = {};
        Object.keys(section.targets || {}).forEach(key => {
            fallbacks[key] = section.targets[key].fallback || '';
        });
        this.applyHtmlChange(setSectionBinds(this.html, node, event.detail.binds || [], fallbacks));
    }

    handlePlace(event) {
        const section = this.settingsSection;
        const node = this.settingsNode;
        const { target, fallback } = event.detail || {};
        if (!section || node === null || !target) return;
        const result = placeTarget(this.html, node, target, { fallback });
        if (!this.applyHtmlChange(result)) return;
        this.patchSection(section.sectionId, item => {
            item.targets = { ...(item.targets || {}), [target]: { fallback: result.fallback } };
            item.defaults = { ...(item.defaults || {}) };
            if (result.sides && (target === 'padding' || target === 'margin')) {
                item.defaults[target] = normalizeSpacing({ desktop: result.sides, mobile: { inheritFromDesktop: true } }, defaultSpacing(0));
            }
            if (target === 'bgColor' && isHexColor(result.fallback) && (!item.defaults.background || item.defaults.background.mode === 'none')) {
                item.defaults.background = normalizeBackground({ ...(item.defaults.background || {}), mode: 'color', color: result.fallback });
            }
        });
    }

    handleUnplace(event) {
        const section = this.settingsSection;
        const node = this.settingsNode;
        const target = event.detail?.target;
        if (!section || node === null || !target) return;
        this.applyHtmlChange(removeTarget(this.html, node, target, section.targets?.[target]?.fallback || ''));
    }

    handleFallbackChange(event) {
        const section = this.settingsSection;
        const { target, fallback } = event.detail || {};
        if (!section || !target) return;
        this.patchSection(section.sectionId, item => {
            item.targets = { ...(item.targets || {}), [target]: { fallback: fallback || '' } };
        });
    }

    handleNextStep() {
        this.setStep(this.activeStep + 1);
    }

    // Step 2 (dropzone)

    handleZonePlace(event) {
        this.finishStructureChange(insertBlocksZone(this.html, this.primaryNode, event.detail.position, { kind: this.kind, templateMode: this._templateMode }));
    }

    handleZoneRemove() {
        this.finishStructureChange({ ...removeBlocksZone(this.html), markedNode: null }, true);
    }

    // Step 3 (editable content)

    get showContentMarker() {
        return !!this.markerInfo;
    }

    get contentBlockedReason() {
        const info = this.markerInfo;
        if (!info) return '';
        if (this.isGuidedBlock) {
            return info.marks.role === 'section'
                ? 'This element is a container. Pick an element inside it for the content, or remove the container marking in step 1.'
                : '';
        }
        if (info.inEditableRegion) return '';
        return 'Only elements inside an editable area can be edited by marketers. Pick an element inside an editable area, or make the surrounding area editable in step 1.';
    }

    get contentHintBlock() {
        return 'Click a text, image, list, divider or button element in the preview and choose its content type. The path above the form helps you pick the right element.';
    }

    get contentHint() {
        return this.progress.editableCount
            ? 'Click an element inside an editable area in the preview, then choose its content type. Select an item in the list to change its editor options.'
            : 'Nothing to edit yet. To let marketers change part of the template, make an area editable in step 1.';
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
