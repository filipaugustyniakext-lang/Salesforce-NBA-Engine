import { LightningElement, api } from 'lwc';
import { clone, readSectionSettings, writeSectionSettings, CONTENT_TYPE_LABELS } from 'c/ccTemplateSchema';
import { isolateNativeEvents } from 'c/ccEventGuard';

/**
 * Lets a template admin play with the configured bindings the way a marketer would: change section settings and
 * content values and watch the preview react. Nothing is saved.
 * Works on a block configuration (see buildBlockConfig) and emits configchange { config }; reset emits resetconfig.
 */
export default class CcBindingPlayground extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api definition = null;
    @api config = null;
    selectedSectionId = null;

    get sectionOptions() {
        return (this.definition?.sections || [])
            .filter(section => section.binds?.length && section.regionKind !== 'fixed-read')
            .map(section => ({ label: `${section.level}: ${section.label || section.sectionId}`, value: section.sectionId }));
    }

    get hasSectionOptions() {
        return this.sectionOptions.length > 0;
    }

    get activeSectionId() {
        const known = this.sectionOptions.some(option => option.value === this.selectedSectionId);
        return known ? this.selectedSectionId : this.sectionOptions[0]?.value || null;
    }

    get activeSection() {
        return (this.definition?.sections || []).find(section => section.sectionId === this.activeSectionId) || null;
    }

    get activeSettings() {
        return readSectionSettings(this.config, this.activeSectionId);
    }

    get columns() {
        const slots = this.definition?.contentSlots || [];
        const result = [];
        (this.config?.rows || []).forEach((row, rowIndex) => {
            (row.columns || []).forEach((column, columnIndex) => {
                const items = (column.content || [])
                    .map((item, itemIndex) => {
                        const binding = slots.find(slot => slot.bindingKey === item.bindingKey) || {};
                        const typeLabel = CONTENT_TYPE_LABELS[item.type] || item.type;
                        return {
                            key: item.contentId || `${rowIndex}-${columnIndex}-${itemIndex}`,
                            item,
                            itemIndex,
                            binding,
                            title: binding.label ? `${typeLabel} · ${binding.label}` : typeLabel
                        };
                    })
                    .filter(entry => entry.binding.regionKind !== 'fixed-read');
                if (!items.length) return;
                result.push({ key: `${rowIndex}-${columnIndex}`, rowIndex, columnIndex, label: `Row ${rowIndex + 1} · Column ${columnIndex + 1}`, items });
            });
        });
        return result;
    }

    get hasContent() {
        return this.columns.length > 0;
    }

    get isEmpty() {
        return !this.hasSectionOptions && !this.hasContent;
    }

    handleSectionPick(event) {
        this.selectedSectionId = event.detail.value;
    }

    handleSectionSettings(event) {
        const next = clone(this.config);
        writeSectionSettings(next, this.activeSectionId, event.detail.value);
        this.emit(next);
    }

    handleItemChange(event) {
        const { row, column, item } = event.currentTarget.dataset;
        const next = clone(this.config);
        next.rows[Number(row)].columns[Number(column)].content[Number(item)] = event.detail.item;
        this.emit(next);
    }

    handleReset() {
        this.dispatchEvent(new CustomEvent('resetconfig'));
    }

    emit(config) {
        this.dispatchEvent(new CustomEvent('configchange', { detail: { config } }));
    }
}
