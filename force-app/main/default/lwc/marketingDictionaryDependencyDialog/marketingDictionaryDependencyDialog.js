import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { formatDependencyReportForClipboard } from 'c/marketingDictionaryDeleteHelper';

export default class MarketingDictionaryDependencyDialog extends LightningElement {
    @api report;

    get recordLabel() {
        return this.report?.recordName || 'this value';
    }

    get groups() {
        return (this.report?.groups || []).map((group, index) => ({
            key: `${group.category}-${index}`,
            category: group.category,
            names: group.recordNames || [],
            count: (group.recordNames || []).length
        }));
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
