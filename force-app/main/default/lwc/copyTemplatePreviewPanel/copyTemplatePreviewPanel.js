import { LightningElement, api, track } from 'lwc';
import getTemplateRenderSource from '@salesforce/apex/ChannelTemplateController.getTemplateRenderSource';
import { parseBlockTemplate } from 'c/contentBindingModel';
import { layoutToPreviewRuntimeState, mergeStudioLayoutDefaults } from 'c/blockLayoutStudio';
import {
    renderTemplatePreview,
    scopePreviewDocument,
    buildSamplePreviewBlocks,
    buildStudioPreviewBlocks,
    pinPreviewWidths,
    parsePreviewLayoutFromShell,
    previewPanelWidthPx,
    previewFrameWidthPx
} from 'c/copyTemplatePreview';

export default class CopyTemplatePreviewPanel extends LightningElement {
    @api heading = 'Copy Center preview';
    @api helpText = 'Uses the same preview compiler as the Copy Center editor. Sample copy and images stand in for author content.';
    /** When true, blocks cc-preview regions render the empty canvas placeholder. */
    @api emptyCanvas = false;
    /** shell: fixed regions only; blocks: catalog HTML in shell; full: sample copy (Copy Center). */
    @api previewMode = 'full';

    @track _renderSource = null;
    @track _renderSourceLoading = false;
    @track _renderSourceError = '';
    @track _previewDevice = 'desktop';
    @track _previewTheme = 'light';
    @track _previewTick = 0;

    _templateId;
    _canvasBlocks = [];
    _previewBlockKey = '';
    _studioBlockHtml = '';
    _studioLayoutConfigJson = '';
    _studioPreviewFocusJson = '';

    @api
    get previewBlockKey() {
        return this._previewBlockKey;
    }

    set previewBlockKey(value) {
        const next = String(value || '').trim();
        if (next === this._previewBlockKey) return;
        this._previewBlockKey = next;
        if (this._renderSource) {
            this._canvasBlocks = this._resolveCanvasBlocks(this._previewRenderSource());
            this._previewTick += 1;
        }
    }

    @api
    get studioBlockHtml() {
        return this._studioBlockHtml;
    }

    set studioBlockHtml(value) {
        this._studioBlockHtml = String(value || '');
        this._refreshCanvasFromStudioLayout();
    }

    @api
    get studioLayoutConfigJson() {
        return this._studioLayoutConfigJson;
    }

    set studioLayoutConfigJson(value) {
        this._studioLayoutConfigJson = String(value || '');
        this._refreshCanvasFromStudioLayout();
    }

    @api
    get studioPreviewFocusJson() {
        return this._studioPreviewFocusJson;
    }

    set studioPreviewFocusJson(value) {
        this._studioPreviewFocusJson = String(value || '');
        this._refreshCanvasFromStudioLayout();
    }

    @api
    get templateId() {
        return this._templateId;
    }

    set templateId(value) {
        if (value === this._templateId) return;
        this._templateId = value;
        this._loadRenderSource();
    }

    @api
    refreshPreview() {
        this._loadRenderSource();
    }

    connectedCallback() {
        if (this._templateId) this._loadRenderSource();
    }

    renderedCallback() {
        this._syncPreviewFrame();
    }

    get renderSourceLoading() {
        return this._renderSourceLoading;
    }

    get hasShellPreview() {
        return !!this._renderSource?.shellHtml && !this._renderSourceLoading;
    }

    get previewStatusMessage() {
        if (this._renderSourceError) return this._renderSourceError;
        if (!this._templateId) return 'Save the template and attach a shell HTML file to preview.';
        return 'The template has no HTML shell to preview yet.';
    }

    get previewIsEmpty() {
        return !this.hasShellPreview && !this._renderSourceLoading;
    }

    get previewDocument() {
        const revision = this._previewTick;
        const source = this._previewRenderSource();
        if (!source?.shellHtml || revision < 0) return '';
        return renderTemplatePreview(source, this._canvasBlocks, this._previewDevice);
    }

    get isDesktop() {
        return this._previewDevice === 'desktop';
    }

    get isMobile() {
        return this._previewDevice === 'mobile';
    }

    get isLightTheme() {
        return this._previewTheme === 'light';
    }

    get isDarkTheme() {
        return this._previewTheme === 'dark';
    }

    get _previewLayout() {
        return parsePreviewLayoutFromShell(this._renderSource?.shellHtml || '');
    }

    get panelClass() {
        const device = this.isMobile ? ' preview-panel_device-mobile' : ' preview-panel_device-desktop';
        return `preview-panel${device}`;
    }

    get panelStyle() {
        const width = previewPanelWidthPx(this._previewDevice, this._previewLayout);
        return `width: ${width}px; max-width: 100%;`;
    }

    get previewFrameClass() {
        const device = this.isMobile ? 'preview-panel__frame_mobile' : 'preview-panel__frame_desktop';
        const theme = this.isDarkTheme ? 'preview-panel__frame_dark' : 'preview-panel__frame_light';
        return `preview-panel__frame ${device} ${theme}`;
    }

    get previewFrameStyle() {
        const frameWidth = previewFrameWidthPx(this._previewDevice, this._previewLayout);
        if (this.isMobile) {
            return `width: ${frameWidth}px;`;
        }
        return `width: 100%; max-width: ${frameWidth}px;`;
    }

    get deviceDesktopClass() {
        return 'slds-button slds-button_icon slds-button_icon-border'
            + (this._previewDevice === 'desktop' ? ' slds-is-selected' : '');
    }

    get deviceMobileClass() {
        return 'slds-button slds-button_icon slds-button_icon-border'
            + (this._previewDevice === 'mobile' ? ' slds-is-selected' : '');
    }

    get themeLightClass() {
        return 'slds-button slds-button_icon slds-button_icon-border'
            + (this._previewTheme === 'light' ? ' slds-is-selected' : '');
    }

    get themeDarkClass() {
        return 'slds-button slds-button_icon slds-button_icon-border'
            + (this._previewTheme === 'dark' ? ' slds-is-selected' : '');
    }

    get deviceDesktopVariant() {
        return this._previewDevice === 'desktop' ? 'inverse' : '';
    }

    get deviceMobileVariant() {
        return this._previewDevice === 'mobile' ? 'inverse' : '';
    }

    get themeLightVariant() {
        return this._previewTheme === 'light' ? 'inverse' : '';
    }

    get themeDarkVariant() {
        return this._previewTheme === 'dark' ? 'inverse' : '';
    }

    handleDeviceDesktop() {
        this._previewDevice = 'desktop';
        this._refreshCanvasFromStudioLayout();
        this._emitLayoutChange();
    }

    handleDeviceMobile() {
        this._previewDevice = 'mobile';
        this._refreshCanvasFromStudioLayout();
        this._emitLayoutChange();
    }

    handleThemeLight() {
        this._previewTheme = 'light';
        this._previewTick += 1;
    }

    handleThemeDark() {
        this._previewTheme = 'dark';
        this._previewTick += 1;
    }

    _emitLayoutChange() {
        this.dispatchEvent(new CustomEvent('previewlayoutchange', {
            bubbles: true,
            composed: true,
            detail: {
                device: this._previewDevice,
                panelWidth: previewPanelWidthPx(this._previewDevice, this._previewLayout)
            }
        }));
    }

    _previewRenderSource() {
        if (!this._renderSource) return null;
        if (this.previewMode !== 'blocks') return this._renderSource;
        const studio = this._renderSource.studioBlocks;
        if (!Array.isArray(studio) || !studio.length) return this._renderSource;
        const merged = new Map();
        (this._renderSource.blocks || []).forEach(block => {
            if (block?.type) merged.set(block.type, block);
        });
        studio.forEach(block => {
            const key = block?.type || block?.fileName;
            if (key) merged.set(key, block);
        });
        return { ...this._renderSource, blocks: [...merged.values()] };
    }

    _resolveCanvasBlocks(source) {
        if (this.previewMode === 'shell' || this.emptyCanvas) {
            return [];
        }
        if (this.previewMode === 'blocks') {
            return buildStudioPreviewBlocks(
                source,
                this._previewBlockKey,
                this._resolveStudioLayoutState()
            );
        }
        return buildSamplePreviewBlocks(source);
    }

    _resolveStudioLayoutState() {
        if (!this._studioBlockHtml && !this._studioLayoutConfigJson) return null;
        try {
            const scan = parseBlockTemplate(this._studioBlockHtml || '');
            const layout = this._studioLayoutConfigJson
                ? mergeStudioLayoutDefaults(JSON.parse(this._studioLayoutConfigJson), scan)
                : mergeStudioLayoutDefaults(null, scan);
            const focus = this._studioPreviewFocusJson
                ? JSON.parse(this._studioPreviewFocusJson)
                : null;
            return layoutToPreviewRuntimeState(layout, scan, focus, this._previewDevice);
        } catch (error) {
            return null;
        }
    }

    _refreshCanvasFromStudioLayout() {
        if (!this._renderSource || this.previewMode !== 'blocks') return;
        this._canvasBlocks = this._resolveCanvasBlocks(this._previewRenderSource());
        this._previewTick += 1;
    }

    _loadRenderSource() {
        const templateId = this._templateId;
        this._renderSource = null;
        this._renderSourceError = '';
        this._canvasBlocks = [];
        if (!templateId) return;
        this._renderSourceLoading = true;
        getTemplateRenderSource({ templateId })
            .then(source => {
                this._renderSource = source;
                this._canvasBlocks = this._resolveCanvasBlocks(this._previewRenderSource());
                this._previewTick += 1;
            })
            .catch(err => {
                this._renderSourceError = err?.body?.message || 'Could not load the template preview source.';
            })
            .finally(() => {
                this._renderSourceLoading = false;
            });
    }

    _syncPreviewFrame() {
        const host = this.template.querySelector('[data-preview-host]');
        if (!host) return;
        const html = this.previewDocument || '';
        const stamp = `${this._previewDevice}|${this._previewTheme}|${html}`;
        if (!html || host._previewStamp === stamp) return;
        host.innerHTML = scopePreviewDocument(html, {
            device: this._previewDevice,
            theme: this._previewTheme
        });
        pinPreviewWidths(host, { device: this._previewDevice });
        host._previewStamp = stamp;
    }
}