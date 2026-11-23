import { LightningElement, api } from 'lwc';
import { scopePreviewDocument, pinPreviewWidths } from 'c/copyTemplatePreview';
import { describeMarked } from 'c/ccTemplateParser';

const MARKED_SELECTOR = '[data-cc-content], [data-cc-section], [data-cc-region]';
const KIND_COLORS = { section: '#0176d3', content: '#2e844a', region: '#7f4bc4', pick: '#dd7a01' };
const NODE_SELECTOR = '[data-cc-node]';

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
    /** Mark mode is offered when the HTML being shown carries data-cc-node ids (see c/ccElementMarking). */
    @api markable = false;
    @api markMode = false;
    _pickedNode = null;
    device = 'mobile';
    theme = 'light';
    inspectOn = true;
    _render;
    _stamp;
    _selectedKey;
    _scrollPending = false;
    _scrollPickPending = false;
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

    /** Node id (data-cc-node) of the element being marked; highlighted solid orange. */
    @api
    get pickedNode() {
        return this._pickedNode;
    }
    set pickedNode(node) {
        const next = node === undefined ? null : node;
        if (next === this._pickedNode) return;
        this._pickedNode = next;
        this._scrollPickPending = next !== null;
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

    get isDesktop() {
        return this.device === 'desktop';
    }

    get isMobile() {
        return this.device === 'mobile';
    }

    get isLight() {
        return this.theme === 'light';
    }

    get isDark() {
        return this.theme === 'dark';
    }

    get desktopClass() {
        return `slds-button slds-button_icon slds-button_icon-border${this.isDesktop ? ' slds-is-selected' : ''}`;
    }

    get mobileClass() {
        return `slds-button slds-button_icon slds-button_icon-border${this.isMobile ? ' slds-is-selected' : ''}`;
    }

    get lightClass() {
        return `slds-button slds-button_icon slds-button_icon-border${this.isLight ? ' slds-is-selected' : ''}`;
    }

    get darkClass() {
        return `slds-button slds-button_icon slds-button_icon-border${this.isDark ? ' slds-is-selected' : ''}`;
    }

    get desktopVariant() {
        return this.isDesktop ? 'inverse' : '';
    }

    get mobileVariant() {
        return this.isMobile ? 'inverse' : '';
    }

    get lightVariant() {
        return this.isLight ? 'inverse' : '';
    }

    get darkVariant() {
        return this.isDark ? 'inverse' : '';
    }

    get frameClass() {
        return `cc-preview-frame cc-preview-frame_${this.device} cc-preview-frame_${this.theme}`;
    }

    get inspectActive() {
        return !!this.inspectable && this.inspectOn;
    }

    get markActive() {
        return this.inspectActive && !!this.markable && !!this.markMode;
    }

    get showMarkToggle() {
        return this.inspectActive && !!this.markable;
    }

    get hintText() {
        return this.markActive ? 'Click any element to tell the processor what it is.' : 'Hover to identify, click to edit.';
    }

    get legend() {
        return [
            { key: 'section', label: 'Section', style: `background:${KIND_COLORS.section}` },
            { key: 'content', label: 'Content', style: `background:${KIND_COLORS.content}` },
            { key: 'region', label: 'Region', style: `background:${KIND_COLORS.region}` },
            ...(this.markActive ? [{ key: 'pick', label: 'Selected', style: `background:${KIND_COLORS.pick}` }] : [])
        ];
    }

    setDevice(device) {
        if (device === this.device) return;
        this.device = device;
        this._stamp = null;
    }

    setTheme(theme) {
        if (theme === this.theme) return;
        this.theme = theme;
        this._stamp = null;
    }

    handleDeviceDesktop() {
        this.setDevice('desktop');
    }

    handleDeviceMobile() {
        this.setDevice('mobile');
    }

    handleThemeLight() {
        this.setTheme('light');
    }

    handleThemeDark() {
        this.setTheme('dark');
    }

    handleInspectToggle(event) {
        this.inspectOn = event.target.checked;
    }

    handleMarkToggle(event) {
        this.dispatchEvent(new CustomEvent('modechange', { detail: { mark: event.target.checked } }));
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

    /** In mark mode any element that has a node id can be hovered or picked, not only marked ones. */
    elementAt(target) {
        let element = target && target.closest ? target.closest(NODE_SELECTOR) : null;
        while (element && !this.inScope(element)) {
            element = element.parentElement ? element.parentElement.closest(NODE_SELECTOR) : null;
        }
        return element;
    }

    targetAt(target) {
        return this.markActive ? this.elementAt(target) : this.markedAt(target);
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
        const element = this.targetAt(event.target);
        host.style.cursor = element ? 'pointer' : '';
        if (element !== this._hoverElement) this.drawHover(element);
    }

    handleClick(event) {
        if (!this.inspectActive) return;
        const link = event.target && event.target.closest ? event.target.closest('a') : null;
        if (link) event.preventDefault();
        if (this.markActive) {
            const picked = this.elementAt(event.target);
            if (!picked) return;
            event.preventDefault();
            event.stopPropagation();
            const node = Number(picked.getAttribute('data-cc-node'));
            this._pickedNode = node;
            this._scrollPickPending = false;
            this.scheduleOverlay();
            this.dispatchEvent(new CustomEvent('pick', { detail: { node } }));
            return;
        }
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
        // The host is the scroll container of the device mockup; overlays scroll with its content.
        const left = rect.left - hostRect.left + host.scrollLeft;
        const top = rect.top - hostRect.top + host.scrollTop;
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
        if (this.markActive && this._pickedNode !== null) {
            let firstPicked = null;
            host.querySelectorAll(`[data-cc-node="${this._pickedNode}"]`).forEach(element => {
                if (!this.inScope(element)) return;
                const box = this.box(host, element, { color: KIND_COLORS.pick, solid: true, tint: true });
                if (!box) return;
                layer.appendChild(box);
                if (!firstPicked) firstPicked = element;
            });
            if (firstPicked && this._scrollPickPending) firstPicked.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        this._scrollPickPending = false;
    }

    drawHover(element) {
        const host = this.template.querySelector('[data-preview-host]');
        if (!host) return;
        const layer = this.layer(host, 'hover');
        layer.textContent = '';
        this._hoverElement = element;
        if (!element) return;
        const info = describeMarked(element);
        let box;
        if (this.markActive) {
            const tag = element.tagName.toLowerCase();
            box = this.box(host, element, {
                color: info ? KIND_COLORS[info.kind] : KIND_COLORS.pick,
                solid: true,
                tint: true,
                label: info ? `<${tag}> · ${info.label}` : `<${tag}> · click to mark`
            });
        } else if (info) {
            box = this.box(host, element, { color: KIND_COLORS[info.kind], solid: true, tint: true, label: info.label });
        }
        if (box) layer.appendChild(box);
    }
}
