import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getMessageContent from '@salesforce/apex/CcMessageContentService.getMessageContent';
import saveMessageContent from '@salesforce/apex/CcMessageContentService.saveMessageContent';
import getActiveTemplateBundle from '@salesforce/apex/CcTemplateDefinitionController.getActiveTemplateBundle';
import {
    parseJson,
    normalizeBlock,
    newMessageBlock,
    buildBlockConfig,
    defaultContent,
    validateBlockContent,
    clone,
    CONTENT_TYPE_LABELS
} from 'c/ccTemplateSchema';
import { renderMessage } from 'c/ccTemplateRenderer';
import { isolateNativeEvents } from 'c/ccEventGuard';

const LOCKED_STATUSES = new Set(['Live', 'Published', 'Archived']);

function errorMessage(error) {
    return error?.body?.message || error?.message || 'Something went wrong.';
}

/** Schema v1 Copy Center editor for messages whose source template has a v1 definition. */
export default class CcMessageEditor extends LightningElement {
    @api messageId;
    loading = true;
    saving = false;
    loadError;
    content;
    template;
    blocks = [];
    selectedIndex = 0;
    selectedSectionId;
    dirty = false;

    connectedCallback() {
        isolateNativeEvents(this);
        this.load();
    }

    async load() {
        this.loading = true;
        this.loadError = null;
        try {
            this.content = await getMessageContent({ messageId: this.messageId });
            if (!this.content.templateId) throw new Error('This message has no source template.');
            const bundle = await getActiveTemplateBundle({ templateId: this.content.templateId });
            this.template = {
                ...bundle,
                definition: parseJson(bundle.definitionJson, null),
                blocks: (bundle.blocks || []).map(block => ({ ...block, definition: parseJson(block.definitionJson, null) }))
            };
            this.blocks = (this.content.blocks || [])
                .map((row, index) => normalizeBlock(row.contentJson, { order: index + 1, blockType: row.blockTemplateDefinitionName }))
                .filter(Boolean)
                .map(block => ({ ...block, messageBlockId: block.messageBlockId }));
            if (this.isSingle && !this.blocks.length && this.template.definition) {
                this.blocks = [{ ...newMessageBlock({ name: this.template.name }, this.template.definition, 1), blockTemplateDefinitionId: null }];
            }
            this.selectedIndex = 0;
            this.selectedSectionId = null;
            this.dirty = false;
        } catch (error) {
            this.loadError = errorMessage(error);
        } finally {
            this.loading = false;
        }
    }

    // ─── Header ──────────────────────────────────────────────────────────────

    get title() {
        return this.content?.messageName || 'Message';
    }

    get statusLabel() {
        return this.content?.status || 'Draft';
    }

    get versionLabel() {
        if (!this.content) return '';
        return this.content.isDraftVersion
            ? `Draft version ${this.content.versionNumber} (not live yet)`
            : `Version ${this.content.versionNumber || 1}`;
    }

    get isLocked() {
        return !this.content?.isDraftVersion && LOCKED_STATUSES.has(this.content?.status);
    }

    get lockMessage() {
        return this.content?.status === 'Archived'
            ? 'Archived messages are read-only. Create a new message variant to reuse this content.'
            : 'This message is live. Use "Create New Variant Version" in the cockpit to edit it without changing the live content.';
    }

    get saveDisabled() {
        return this.saving || this.isLocked || !this.dirty;
    }

    get isSingle() {
        return this.template?.templateMode === 'single';
    }

    get isMulti() {
        return !this.isSingle;
    }

    // ─── Palette & canvas ────────────────────────────────────────────────────

    get palette() {
        return (this.template?.blocks || []).map(block => ({
            ...block,
            typesLabel: (block.contentTypes || []).map(type => CONTENT_TYPE_LABELS[type] || type).join(', ')
        }));
    }

    get hasPalette() {
        return this.palette.length > 0;
    }

    definitionFor(block) {
        if (!block) return null;
        if (!block.blockTemplateDefinitionId) return this.isSingle ? this.template?.definition : null;
        return this.template?.blocks.find(item => item.id === block.blockTemplateDefinitionId)?.definition || null;
    }

    htmlFor(block) {
        if (!block?.blockTemplateDefinitionId) return null;
        return this.template?.blocks.find(item => item.id === block.blockTemplateDefinitionId)?.sourceHtml || null;
    }

    get canvas() {
        return this.blocks.map((block, index) => {
            const definition = this.definitionFor(block);
            const errors = definition ? validateBlockContent(block, definition) : [];
            return {
                key: block.messageBlockId || `b${index}`,
                index,
                name: block.blockTemplateDefinitionName || `Block ${index + 1}`,
                isLegacy: !!block.legacy && !(block.blockConfig?.rows || []).length,
                missingDefinition: !definition,
                errorCount: errors.length,
                isFirst: index === 0,
                isLast: index === this.blocks.length - 1,
                className: `cc-editor__canvas-item${index === this.selectedIndex ? ' cc-editor__canvas-item_selected' : ''}`
            };
        });
    }

    get hasBlocks() {
        return this.blocks.length > 0;
    }

    handleAddBlock(event) {
        const definitionRecord = this.template.blocks.find(item => item.id === event.currentTarget.dataset.id);
        if (!definitionRecord?.definition) return;
        const block = newMessageBlock(definitionRecord, definitionRecord.definition, this.blocks.length + 1);
        this.blocks = [...this.blocks, block];
        this.selectedIndex = this.blocks.length - 1;
        this.selectedSectionId = null;
        this.dirty = true;
    }

    handleSelectBlock(event) {
        this.selectedIndex = Number(event.currentTarget.dataset.index);
        this.selectedSectionId = null;
    }

    handleMoveBlock(event) {
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        const target = index + Number(event.currentTarget.dataset.offset);
        if (target < 0 || target >= this.blocks.length) return;
        const blocks = [...this.blocks];
        [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
        this.blocks = blocks.map((block, order) => ({ ...block, blockOrderNumber: order + 1 }));
        this.selectedIndex = target;
        this.dirty = true;
    }

    handleRemoveBlock(event) {
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        this.blocks = this.blocks.filter((_, position) => position !== index).map((block, order) => ({ ...block, blockOrderNumber: order + 1 }));
        this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.blocks.length - 1));
        this.dirty = true;
    }

    // ─── Selected block ──────────────────────────────────────────────────────

    get selectedBlock() {
        return this.blocks[this.selectedIndex] || null;
    }

    get selectedDefinition() {
        return this.definitionFor(this.selectedBlock);
    }

    get selectedIsLegacy() {
        const block = this.selectedBlock;
        return !!block?.legacy && !(block.blockConfig?.rows || []).length;
    }

    get selectedErrors() {
        const definition = this.selectedDefinition;
        if (!definition || !this.selectedBlock) return [];
        return validateBlockContent(this.selectedBlock, definition).map((message, index) => ({ key: `e${index}`, message }));
    }

    get hasSelectedErrors() {
        return this.selectedErrors.length > 0;
    }

    get sectionOptions() {
        const definition = this.selectedDefinition;
        if (!definition) return [];
        return (definition.sections || [])
            .filter(section => section.binds.length && section.regionKind !== 'fixed-read')
            .map(section => ({ label: `${section.level}: ${section.label || section.sectionId}`, value: section.sectionId }));
    }

    get hasSectionOptions() {
        return this.sectionOptions.length > 0;
    }

    get activeSectionId() {
        return this.selectedSectionId || this.sectionOptions[0]?.value || null;
    }

    get activeSection() {
        return (this.selectedDefinition?.sections || []).find(section => section.sectionId === this.activeSectionId) || null;
    }

    get activeSectionSettings() {
        return readSettings(this.selectedBlock?.blockConfig, this.activeSectionId);
    }

    handleSectionPick(event) {
        this.selectedSectionId = event.detail.value;
    }

    handleSectionSettings(event) {
        this.updateSelected(block => writeSettings(block.blockConfig, this.activeSectionId, event.detail.value));
    }

    get columns() {
        const block = this.selectedBlock;
        const definition = this.selectedDefinition;
        if (!block || !definition) return [];
        const slots = definition.contentSlots || [];
        const rows = block.blockConfig.rows || [];
        const columnIds = new Set();
        rows.forEach(row => (row.columns || []).forEach(column => columnIds.add(column.sectionId)));
        // Content declared outside any column is placed in the first column (see buildBlockConfig).
        const orphanSlots = slots.filter(slot => !columnIds.has(slot.sectionId));
        const result = [];
        rows.forEach((row, rowIndex) => {
            (row.columns || []).forEach((column, columnIndex) => {
                const usable = slots
                    .filter(slot => slot.sectionId === column.sectionId)
                    .concat(rowIndex === 0 && columnIndex === 0 ? orphanSlots : [])
                    .filter(slot => slot.regionKind !== 'fixed-read');
                const addTypes = Array.from(new Set(usable.map(slot => slot.type))).map(type => ({
                    label: `Add ${CONTENT_TYPE_LABELS[type]}`,
                    value: type
                }));
                const content = column.content || [];
                result.push({
                    key: `${rowIndex}-${columnIndex}`,
                    rowIndex,
                    columnIndex,
                    label: `Row ${rowIndex + 1} · Column ${columnIndex + 1}`,
                    addTypes,
                    canAdd: addTypes.length > 0,
                    items: content.map((item, itemIndex) => {
                        const binding = slots.find(slot => slot.bindingKey === item.bindingKey) || {};
                        const typeLabel = CONTENT_TYPE_LABELS[item.type] || item.type;
                        return {
                            key: item.contentId || `${rowIndex}-${columnIndex}-${itemIndex}`,
                            item,
                            itemIndex,
                            binding,
                            title: binding.label ? `${typeLabel} · ${binding.label}` : typeLabel,
                            isFirst: itemIndex === 0,
                            isLast: itemIndex === content.length - 1
                        };
                    })
                });
            });
        });
        return result;
    }

    columnAt(block, dataset) {
        return block.blockConfig.rows[Number(dataset.row)].columns[Number(dataset.column)];
    }

    handleItemChange(event) {
        const dataset = event.currentTarget.dataset;
        this.updateSelected(block => {
            this.columnAt(block, dataset).content[Number(dataset.item)] = event.detail.item;
        });
    }

    handleAddItem(event) {
        const dataset = event.currentTarget.dataset;
        const type = event.detail.value;
        const definition = this.selectedDefinition;
        this.updateSelected(block => {
            const column = this.columnAt(block, dataset);
            const slot = (definition.contentSlots || []).find(item => item.type === type && item.sectionId === column.sectionId)
                || (definition.contentSlots || []).find(item => item.type === type);
            const item = defaultContent(type, slot || {});
            if (item) column.content = [...(column.content || []), item];
        });
    }

    handleMoveItem(event) {
        const dataset = event.currentTarget.dataset;
        const index = Number(dataset.item);
        const target = index + Number(dataset.offset);
        this.updateSelected(block => {
            const content = this.columnAt(block, dataset).content;
            if (target < 0 || target >= content.length) return;
            [content[index], content[target]] = [content[target], content[index]];
        });
    }

    handleRemoveItem(event) {
        const dataset = event.currentTarget.dataset;
        this.updateSelected(block => {
            this.columnAt(block, dataset).content.splice(Number(dataset.item), 1);
        });
    }

    updateSelected(mutator) {
        const blocks = clone(this.blocks);
        const block = blocks[this.selectedIndex];
        if (!block) return;
        mutator(block);
        this.blocks = blocks;
        this.dirty = true;
    }

    // ─── Preview ─────────────────────────────────────────────────────────────

    get previewRender() {
        const template = this.template;
        if (!template?.shellHtml) return null;
        const blocks = this.blocks;
        const isSingle = this.isSingle;
        const entries = isSingle ? [] : blocks
            .map(block => ({ html: this.htmlFor(block), definition: this.definitionFor(block), block }))
            .filter(entry => entry.html && entry.definition);
        return (device, theme) => renderMessage({
            shell: { html: template.shellHtml, definition: template.definition },
            shellContent: isSingle ? (blocks[0] || { blockConfig: buildBlockConfig(template.definition) }) : null,
            blocks: entries,
            device,
            theme
        });
    }

    // ─── Save ────────────────────────────────────────────────────────────────

    async handleSave() {
        this.saving = true;
        try {
            const payload = this.blocks.map((block, index) => ({ ...block, blockOrderNumber: index + 1 }));
            this.content = await saveMessageContent({ messageId: this.messageId, blocksJson: JSON.stringify(payload), messageSettingsJson: null });
            this.blocks = (this.content.blocks || []).map((row, index) => normalizeBlock(row.contentJson, { order: index + 1 })).filter(Boolean);
            this.dirty = false;
            const issues = this.blocks.reduce((total, block) => total + validateBlockContent(block, this.definitionFor(block) || {}).length, 0);
            this.toast('Message saved', issues ? `${issues} issue(s) must be fixed before the message can be set to Ready.` : 'All blocks are valid.', issues ? 'warning' : 'success');
        } catch (error) {
            this.toast('Message could not be saved', errorMessage(error), 'error');
        } finally {
            this.saving = false;
        }
    }

    handleBack() {
        this.dispatchEvent(new CustomEvent('back'));
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}

function readSettings(config, sectionId) {
    if (!config || !sectionId) return null;
    if ((config.sectionId || 'block') === sectionId) return config.blockSettings;
    for (const row of config.rows || []) {
        if (row.sectionId === sectionId) return row.rowSettings;
        for (const column of row.columns || []) {
            if (column.sectionId === sectionId) return column.columnSettings;
        }
    }
    return null;
}

function writeSettings(config, sectionId, value) {
    if ((config.sectionId || 'block') === sectionId) {
        config.blockSettings = value;
        return;
    }
    for (const row of config.rows || []) {
        if (row.sectionId === sectionId) {
            row.rowSettings = value;
            return;
        }
        for (const column of row.columns || []) {
            if (column.sectionId === sectionId) {
                column.columnSettings = value;
                return;
            }
        }
    }
}
