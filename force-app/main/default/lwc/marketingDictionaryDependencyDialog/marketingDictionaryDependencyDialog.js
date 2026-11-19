import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { formatDependencyReportForClipboard } from 'c/marketingDictionaryDeleteHelper';

export default class MarketingDictionaryDependencyDialog extends LightningElement {
    @api report;

    get recordLabel() {
        return this.report?.recordName || 'this value';
    }

    get isMulti() {
        return Array.isArray(this.report?.reports) && this.report.reports.length > 1;
    }

    get isSingle() {
        return !this.isMulti;
    }

    get introText() {
        return this.isMulti
            ? 'NBA components still reference the values below, so they were not deleted. Remove or reassign their dependencies first.'
            : 'NBA components still reference this dictionary value. Remove or reassign the dependencies below before deleting';
    }

    get sections() {
        const reports = this.isMulti ? this.report.reports : [this.report || {}];
        return reports.map((rep, rIdx) => ({
            key: `${rep.recordId || rep.recordName || 'value'}-${rIdx}`,
            recordName: rep.recordName || 'Value',
            groups: this._groupsFor(rep, rIdx)
        }));
    }

    _groupsFor(report, rIdx) {
        return (report?.groups || []).map((group, index) => {
            const prefix = `${rIdx}-${group.category}-${index}`;
            const entries = this._entriesForGroup(group, prefix);
            return {
                key: prefix,
                category: group.category,
                entries,
                count: entries.length
            };
        });
    }

    _entriesForGroup(group, prefix) {
        const refs = group.references || [];
        if (refs.length) {
            return refs.map((ref, idx) => this._mapReference(ref, `${prefix}-${idx}`));
        }
        return (group.recordNames || []).map((name, idx) => ({
            key: `${prefix}-${idx}`,
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
