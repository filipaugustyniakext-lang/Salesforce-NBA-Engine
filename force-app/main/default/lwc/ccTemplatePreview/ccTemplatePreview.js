import { LightningElement, api } from 'lwc';
import { scopePreviewDocument, pinPreviewWidths } from 'c/copyTemplatePreview';

/**
 * Renders already-merged HTML (see c/ccTemplateRenderer) in a scoped preview host.
 * `renderFn` is a function (device, theme) => html so the parent re-renders per device/theme.
 */
export default class CcTemplatePreview extends LightningElement {
    @api heading = 'Preview';
    device = 'desktop';
    theme = 'light';
    _render;
    _stamp;

    @api
    get renderFn() {
        return this._render;
    }
    set renderFn(fn) {
        this._render = fn;
        this._stamp = null;
    }

    @api
    refresh() {
        this._stamp = null;
        this.paint();
    }

    get deviceOptions() {
        return [
            { label: 'Desktop', value: 'desktop' },
            { label: 'Mobile', value: 'mobile' }
        ];
    }

    get themeOptions() {
        return [
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' }
        ];
    }

    get frameClass() {
        return `cc-preview-frame cc-preview-frame_${this.device} cc-preview-frame_${this.theme}`;
    }

    handleDevice(event) {
        this.device = event.detail.value;
        this._stamp = null;
    }

    handleTheme(event) {
        this.theme = event.detail.value;
        this._stamp = null;
    }

    renderedCallback() {
        this.paint();
    }

    paint() {
        const host = this.template.querySelector('[data-preview-host]');
        if (!host || typeof this._render !== 'function') return;
        let html = '';
        try {
            html = this._render(this.device, this.theme) || '';
        } catch (error) {
            html = `<p style="color:#ba0517;font-family:Arial,sans-serif;padding:1rem;">Preview failed: ${String(error?.message || error).replace(/</g, '&lt;')}</p>`;
        }
        const stamp = `${this.device}|${this.theme}|${html}`;
        if (stamp === this._stamp) return;
        host.innerHTML = scopePreviewDocument(html, { device: this.device, theme: this.theme });
        pinPreviewWidths(host, { device: this.device });
        this._stamp = stamp;
    }
}
