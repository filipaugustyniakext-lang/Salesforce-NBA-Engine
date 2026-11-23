import { LightningElement, api } from 'lwc';
import { scopePreviewDocument, pinPreviewWidths } from 'c/copyTemplatePreview';
import { describeMarked } from 'c/ccTemplateParser';

const MARKED_SELECTOR = '[data-cc-content], [data-cc-section], [data-cc-region]';
const KIND_COLORS = { section: '#0176d3', content: '#2e844a', region: '#7f4bc4' };

/**
 * Renders already-merged HTML (see c/ccTemplateRenderer) in a scoped preview host.
 * `renderFn` is a function (device, theme) => html so the parent re-renders per device/theme.
 *
 * Inspect mode (when `inspectable`): marked elements get colored outlines, hovering names the element,
 * clicking fires `select` { key } using the keys of c/ccBindingWorkspace (section:id, slot:key, region:id).
 * `selectedKey` highlights and scrolls to the matching element(s). `inspectScope="blocks"` limits
 * inspection to the blocks region so a block shown inside a shell is not confused with shell elements.
 */
export default class CcTemplatePreview extends LightningElement {
    @api heading = 'Preview';
    @api inspectable = false;
    @api inspectScope = 'all';
    device = 'desktop';
    theme = 'light';
    inspectOn = true;
    _render;
    _stamp;
    _selectedKey;
    _scrollPending = false;
    _frame;
    _hoverElement = null;
    _resizeHandler = () => this.scheduleOverlay();

    @api
    get renderFn() {
        return this._render;
    }
    set renderFn(fn) {
        this._render = fn;
        this._stamp = null;
    }

    @api
    get selectedKey() {
        return this._selectedKey;
    }
    set selectedKey(key) {
        if (key === this._selectedKey) return;
        this._selectedKey = key;
        this._scrollPending = !!key;
    }

    @api
    refresh() {
        this._stamp = null;
        this.paint();
    }

    connectedCallback() {
        window.addEventListener('resize', this._resizeHandler);
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this._resizeHandler);
        if (this._frame) cancelAnimationFrame(this._frame);
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

    get inspectActive() {
        return !!this.inspectable && this.inspectOn;
    }

    get legend() {
        return [
            { key: 'section', label: 'Section', style: `background:${KIND_COLORS.section}` },
            { key: 'content', label: 'Content', style: `background:${KIND_COLORS.content}` },
            { key: 'region', label: 'Region', style: `background:${KIND_COLORS.region}` }
        ];
    }

    handleDevice(event) {
        this.device = event.detail.value;
        this._stamp = null;
    }

    handleTheme(event) {
        this.theme = event.detail.value;
        this._stamp = null;
    }

    handleInspectToggle(event) {
        this.inspectOn = event.target.checked;
    }

    renderedCallback() {
        this.paint();
        this.bindHost();
        this.scheduleOverlay();
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

    // ─── Inspect mode ────────────────────────────────────────────────────────

    bindHost() {
        const host = this.template.querySelector('[data-preview-host]');
        if (!host || host._inspectBound) return;
        host._inspectBound = true;
        host.addEventListener('mousemove', event => this.handleMove(event));
        host.addEventListener('mouseleave', () => this.drawHover(null));
        host.addEventListener('click', event => this.handleClick(event), true);
        host.addEventListener('load', () => this.scheduleOverlay(), true);
    }

    inScope(element) {
        if (!element) return false;
        return this.inspectScope !== 'blocks' || !!element.closest('[data-cc-region="blocks"]');
    }

    markedAt(target) {
        let element = target && target.closest ? target.closest(MARKED_SELECTOR) : null;
        while (element && !this.inScope(element)) {
            element = element.parentElement ? element.parentElement.closest(MARKED_SELECTOR) : null;
        }
        return element;
    }

    handleMove(event) {
        if (!this.inspectActive) return;
        const host = event.currentTarget;
        const element = this.markedAt(event.target);
        host.style.cursor = element ? 'pointer' : '';
        if (element !== this._hoverElement) this.drawHover(element);
    }

    handleClick(event) {
        if (!this.inspectActive) return;
        const link = event.target && event.target.closest ? event.target.closest('a') : null;
        if (link) event.preventDefault();
        const element = this.markedAt(event.target);
        const info = describeMarked(element);
        if (!info) return;
        event.preventDefault();
        this._selectedKey = info.key;
        this.scheduleOverlay();
        this.dispatchEvent(new CustomEvent('select', { detail: { key: info.key } }));
    }

    scheduleOverlay() {
        if (this._frame) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this.drawMarks();
        });
    }

    layer(host, name) {
        let layer = host.querySelector(`[data-inspect-layer="${name}"]`);
        if (!layer) {
            layer = document.createElement('div');
            layer.setAttribute('data-inspect-layer', name);
            layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:5;';
            host.appendChild(layer);
        }
        return layer;
    }

    box(host, element, { color, solid, tint, label }) {
        const hostRect = host.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const box = document.createElement('div');
        const left = rect.left - hostRect.left;
        const top = rect.top - hostRect.top;
        box.style.cssText = `position:absolute;box-sizing:border-box;left:${left}px;top:${top}px;width:${rect.width}px;height:${rect.height}px;`
            + `border:${solid ? '2px solid' : '1px dashed'} ${color};${tint ? `background:${color}22;` : ''}`;
        if (label) {
            const badge = document.createElement('span');
            const above = top >= 18;
            badge.textContent = label;
            badge.style.cssText = `position:absolute;left:-2px;${above ? 'top:-19px' : 'top:0'};padding:1px 6px;font:11px/16px Arial,sans-serif;`
                + `color:#ffffff;background:${color};white-space:nowrap;border-radius:2px;`;
            box.appendChild(badge);
        }
        return box;
    }

    drawMarks() {
        const host = this.template.querySelector('[data-preview-host]');
        if (!host) return;
        const layer = this.layer(host, 'marks');
        layer.textContent = '';
        this._hoverElement = null;
        const hover = host.querySelector('[data-inspect-layer="hover"]');
        if (hover) hover.textContent = '';
        if (!this.inspectActive) return;
        let firstSelected = null;
        host.querySelectorAll(MARKED_SELECTOR).forEach(element => {
            if (!this.inScope(element)) return;
            const info = describeMarked(element);
            if (!info) return;
            const selected = !!this._selectedKey && info.key === this._selectedKey;
            const box = this.box(host, element, { color: KIND_COLORS[info.kind], solid: selected, tint: selected });
            if (!box) return;
            layer.appendChild(box);
            if (selected && !firstSelected) firstSelected = element;
        });
        if (firstSelected && this._scrollPending) {
            firstSelected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        this._scrollPending = false;
    }

    drawHover(element) {
        const host = this.template.querySelector('[data-preview-host]');
        if (!host) return;
        const layer = this.layer(host, 'hover');
        layer.textContent = '';
        this._hoverElement = element;
        if (!element) return;
        const info = describeMarked(element);
        const box = info && this.box(host, element, { color: KIND_COLORS[info.kind], solid: true, tint: true, label: info.label });
        if (box) layer.appendChild(box);
    }
}
