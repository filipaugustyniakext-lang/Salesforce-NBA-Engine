import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { formatDependencyReportForClipboard } from 'c/marketingDictionaryDeleteHelper';

export default class MarketingDictionaryDependencyDialog extends LightningElement {
    @api report;

    get recordLabel() {
        return this.report?.recordName || 'this value';
    }

    get groups() {
        return (this.report?.groups || []).map((group, index) => {
            const entries = this._entriesForGroup(group);
            return {
                key: `${group.category}-${index}`,
                category: group.category,
                entries,
                count: entries.length
            };
        });
    }

    _entriesForGroup(group) {
        const refs = group.references || [];
        if (refs.length) {
            return refs.map((ref, idx) => this._mapReference(ref, `${group.category}-${idx}`));
        }
        return (group.recordNames || []).map((name, idx) => ({
            key: `${group.category}-${idx}`,
            label: name,
            isLink: false,
            url: null
        }));
    }

    _mapReference(ref, key) {
        const recordId = ref?.recordId;
        const objectApiName = ref?.objectApiName;
        const hasLink = recordId && objectApiName;
        return {
            key,
            label: ref?.label || 'Related record',
            isLink: hasLink,
            url: hasLink ? `/lightning/r/${objectApiName}/${recordId}/view` : null
        };
    }

    get showTruncatedNote() {
        return this.report?.truncated === true;
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleCopy() {
        const text = formatDependencyReportForClipboard(this.report);
        try {
            await navigator.clipboard.writeText(text);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Copied',
                    message: 'Dependency list copied to clipboard.',
                    variant: 'success'
                })
            );
        } catch {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Copy failed',
                    message: 'Could not access the clipboard. Select and copy the list manually.',
                    variant: 'warning'
                })
            );
        }
    }
}