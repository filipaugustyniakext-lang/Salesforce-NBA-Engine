import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

const COPIED_FEEDBACK_MS = 1500;

async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    document.body.removeChild(area);
    if (!done) {
        throw new Error('Copy is not available in this browser.');
    }
}

/**
 * Small, italic and subtle value ID with a copy-to-clipboard button, shown next to the label of a Marketing
 * Dictionary value. NBA components are linked to dictionary values by this ID, never by the label, so the label
 * can change without losing any connection.
 */
export default class MarketingDictionaryValueId extends LightningElement {
    @api recordId;
    copied = false;
    _timer;

    disconnectedCallback() {
        clearTimeout(this._timer);
    }

    get hasId() {
        return !!this.recordId;
    }

    get iconName() {
        return this.copied ? 'utility:check' : 'utility:copy';
    }

    get buttonTitle() {
        return this.copied ? 'Copied' : 'Copy value ID';
    }

    get liveText() {
        return this.copied ? 'Value ID copied' : '';
    }

    async handleCopy(event) {
        // The ID often sits inside clickable rows and cards.
        event.stopPropagation();
        try {
            await copyToClipboard(this.recordId);
            this.copied = true;
            clearTimeout(this._timer);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this._timer = setTimeout(() => {
                this.copied = false;
            }, COPIED_FEEDBACK_MS);
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not copy the value ID',
                message: error?.message || 'Select the ID and copy it manually.',
                variant: 'warning'
            }));
        }
    }

    handleContainerClick(event) {
        event.stopPropagation();
    }
}
