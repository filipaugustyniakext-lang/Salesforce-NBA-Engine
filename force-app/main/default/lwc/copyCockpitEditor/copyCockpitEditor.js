import { LightningElement, api, track, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getMessageById from '@salesforce/apex/CopyCockpitController.getMessageById';
import saveMessageEditor from '@salesforce/apex/CopyCockpitController.saveMessageEditor';
import getVersionsByMessageId from '@salesforce/apex/CopyCockpitController.getVersionsByMessageId';
import getTemplateRenderSource from '@salesforce/apex/ChannelTemplateController.getTemplateRenderSource';
import { renderTemplatePreview, scopePreviewDocument } from './templatePreview';
import { parseBlockTemplate, alignLayout } from 'c/contentBindingModel';

const STATUS_OPTIONS = [
    { label: 'Active',           value: 'Active' },
    { label: 'Draft',            value: 'Draft' },
    { label: 'Active Scheduled', value: 'Active Scheduled' },
    { label: 'Draft Scheduled',  value: 'Draft Scheduled' },
    { label: 'Archived',         value: 'Archived' },
    { label: 'Deactivated',      value: 'Deactivated' },
];

const STATUS_SELECT_CLASS = {
    'active':           'toolbar-status-select toolbar-status_active',
    'draft':            'toolbar-status-select toolbar-status_draft',
    'active scheduled': 'toolbar-status-select toolbar-status_active-scheduled',
    'draft scheduled':  'toolbar-status-select toolbar-status_draft-scheduled',
    'archived':         'toolbar-status-select toolbar-status_archived',
    'deactivated':      'toolbar-status-select toolbar-status_deactivated',
};

const TIMEZONES = [
    { label: 'Pacific/Honolulu (UTC-10)',     value: 'Pacific/Honolulu' },
    { label: 'America/Anchorage (UTC-9)',     value: 'America/Anchorage' },
    { label: 'America/Los_Angeles (UTC-8)',   value: 'America/Los_Angeles' },
    { label: 'America/Denver (UTC-7)',        value: 'America/Denver' },
    { label: 'America/Chicago (UTC-6)',       value: 'America/Chicago' },
    { label: 'America/New_York (UTC-5)',      value: 'America/New_York' },
    { label: 'America/Sao_Paulo (UTC-3)',     value: 'America/Sao_Paulo' },
    { label: 'Europe/London (UTC+0/+1)',      value: 'Europe/London' },
    { label: 'Europe/Brussels (UTC+1/+2)',    value: 'Europe/Brussels' },
    { label: 'Europe/Paris (UTC+1/+2)',       value: 'Europe/Paris' },
    { label: 'Europe/Berlin (UTC+1/+2)',      value: 'Europe/Berlin' },
    { label: 'Europe/Stockholm (UTC+1/+2)',   value: 'Europe/Stockholm' },
    { label: 'Europe/Helsinki (UTC+2/+3)',    value: 'Europe/Helsinki' },
    { label: 'Europe/Moscow (UTC+3)',         value: 'Europe/Moscow' },
    { label: 'Asia/Dubai (UTC+4)',            value: 'Asia/Dubai' },
    { label: 'Asia/Kolkata (UTC+5:30)',       value: 'Asia/Kolkata' },
    { label: 'Asia/Bangkok (UTC+7)',          value: 'Asia/Bangkok' },
    { label: 'Asia/Singapore (UTC+8)',        value: 'Asia/Singapore' },
    { label: 'Asia/Tokyo (UTC+9)',            value: 'Asia/Tokyo' },
    { label: 'Australia/Sydney (UTC+10/+11)', value: 'Australia/Sydney' },
];

const PALETTE_BLOCKS = [
    { id: 'text_image', group: 'Content', blockType: 'TextImage',  label: 'Text-Image (LR/RL)', icon: 'utility:layout_card',      svgHref: '#layout_card',       description: 'Two-column layout: rich text plus image. Choose image left or right in block settings.' },
    { id: 'banner',     group: 'Content', blockType: 'Banner',     label: 'Banner (LR/RL)',     icon: 'utility:layout_banner',    svgHref: '#layout_banner',     description: 'Promotional banner with gradient background, rich text, and image. Configure layout and spacing in block settings.' },
    { id: 'rich_text',  group: 'Content', blockType: 'RichText',   label: 'Rich Text',          icon: 'utility:display_rich_text',svgHref: '#display_rich_text', description: 'Formatted body copy with links and lists.' },
    { id: 'image',      group: 'Content', blockType: 'Image',      label: 'Image',              icon: 'utility:image',            svgHref: '#image',             description: 'Visual block with image URL and alt text.' },
    { id: 'prefooter',  group: 'Content', blockType: 'Prefooter',  label: 'Prefooter',          icon: 'utility:note',             svgHref: '#note',              description: 'Legal footer copy with basic formatting. Same content is used for desktop and mobile.' },
    { id: 'spacer',     group: 'Layout',  blockType: 'Spacer',     label: 'Spacer',             icon: 'utility:spacer',           svgHref: '#spacer',            description: 'Vertical space between blocks. Set desktop and optional mobile heights separately.' },
];

function settingOn(block, id) {
    const settings = Array.isArray(block.blockSettings) ? block.blockSettings : null;
    if (settings) return settings.includes(id);
    if (id === 'columnLayout') return block.blockType === 'TextImage';
    if (id === 'heightDesktop' || id === 'heightMobile') return false;
    return true;
}

function contentOn(block, source) {
    const bindings = Array.isArray(block.bindings) ? block.bindings : null;
    if (bindings) return bindings.some(item => item?.source === source);
    if (source === 'copy') return ['RichText', 'TextImage', 'Banner', 'Prefooter', 'Content'].includes(block.blockType);
    if (source === 'imageUrl' || source === 'altText') return ['Image', 'TextImage', 'Banner', 'Content'].includes(block.blockType);
    if (source === 'legal') return block.blockType === 'Prefooter';
    if (source === 'spacerHeight') return block.blockType === 'Spacer';
    return false;
}

function emptyLayoutState() {
    return {
        hideDesktop: false,
        hideMobile: false,
        padDesktop: { top: '0', right: '0', bottom: '0', left: '0' },
        padMobile: { top: '0', right: '0', bottom: '0', left: '0' },
        padMobileInherit: true,
        bgColor: '',
        bgImage: '',
        bgGradientId: '',
        columnDirection: 'ltr',
        columns: []
    };
}

function padFields(instanceId, device, columnIndex) {
    const column = columnIndex == null ? '' : String(columnIndex);
    return ['top', 'right', 'bottom', 'left'].map(side => ({
        key: `${instanceId}:${device}:${column}:${side}`,
        side,
        label: side.charAt(0).toUpperCase() + side.slice(1),
        device: device.includes('mobile') ? 'mobile' : 'desktop',
        columnIndex: column
    }));
}

function colorOptions(instanceId, colors, selected, columnIndex) {
    const column = columnIndex == null ? '' : String(columnIndex);
    const current = String(selected || '').toLowerCase();
    return (colors || []).map(value => ({
        key: `${instanceId}:${column}:color:${value}`,
        value,
        columnIndex: column,
        swatch: `background:${value}`,
        className: 'bg-swatch' + (String(value).toLowerCase() === current ? ' bg-swatch_active' : '')
    }));
}

function gradientOptions(instanceId, gradients, selected, columnIndex) {
    const column = columnIndex == null ? '' : String(columnIndex);
    return (gradients || []).filter(item => item.css).map(item => ({
        key: `${instanceId}:${column}:gradient:${item.id}`,
        id: item.id,
        label: item.label || 'Gradient',
        columnIndex: column,
        className: 'slds-button vis-btn' + (item.id === selected ? ' vis-btn_active' : '')
    }));
}

function paddingView(instanceId, present, enabled, runtime, columnIndex) {
    const desktop = !!(present?.padDesktop && enabled);
    const mobile = !!(present?.padMobile && enabled);
    const inherit = runtime?.padMobileInherit !== false;
    const scope = columnIndex == null ? 'block' : `column-${columnIndex}`;
    return {
        show: desktop || mobile,
        showDesktop: desktop,
        showInherit: desktop && mobile,
        showMobileFields: mobile && (!desktop || !inherit),
        desktopFields: desktop ? padFields(instanceId, `${scope}-desktop`, columnIndex) : [],
        mobileFields: mobile && (!desktop || !inherit) ? padFields(instanceId, `${scope}-mobile`, columnIndex) : []
    };
}

function columnRuntime(state, index) {
    const column = (state?.columns || [])[index] || {};
    return {
        padMobileInherit: column.padMobileInherit !== false,
        bgColor: column.bgColor || '',
        bgImage: column.bgImage || '',
        bgGradientId: column.bgGradientId || ''
    };
}

function layoutFieldValue(block, dataset) {
    const state = block.layoutState || {};
    const column = dataset.column;
    const source = column === undefined || column === '' ? state : (state.columns || [])[Number(column)] || {};
    if (dataset.field === 'bgImage') return source.bgImage || '';
    if (dataset.side) {
        const pad = dataset.device === 'mobile' ? source.padMobile : source.padDesktop;
        const value = pad ? pad[dataset.side] : '0';
        return value ?? '0';
    }
    return '';
}

function groupBlocks(blocks) {
    const map = new Map();
    for (const b of blocks) {
        if (!map.has(b.group)) map.set(b.group, []);
        map.get(b.group).push(b);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}

let _uid = 0;
function makeInstance(blockId, palette) {
    const blocks = palette && palette.length ? palette : PALETTE_BLOCKS;
    const def = blocks.find(block => block.id === blockId || block.blockType === blockId)
        || PALETTE_BLOCKS.find(block => block.id === blockId || block.blockType === blockId)
        || PALETTE_BLOCKS[0];
    return {
        ...def,
        instanceId: 'blk_' + Date.now() + '_' + (++_uid).toString(36),
        blockOrder: null,
        previewOn:  false,
        activeTab:  'content',
        visDesktop:  'show',
        visMobile:   'show',
        padTop:    '20', padRight:  '40',
        padBottom: '20', padLeft:   '40',
        padLinked: false,
        bgValue:     '',
        imageLayout: 'text-left',
        heightDesktop: '',
        heightMobile: '',
        copyText: '',
        imageUrl: '',
        altText: '',
        legalText: '',
        spacerHeight: '20',
        layoutState: emptyLayoutState(),
    };
}

export default class CopyCockpitEditor extends LightningElement {

    @api recordId = null;

    @wire(CurrentPageReference)
    _pageRef(ref) {
        this._isStandalonePage = ref?.type === 'standard__navItemPage';
        const stateId = ref?.state?.c__recordId || ref?.state?.recordId;
        if (stateId && stateId !== this.recordId) {
            this.recordId = stateId;
            this._loadRecord();
        }
    }

    @track _record    = null;
    @track _isLoading = true;
    @track _hasError  = false;
    @track _errorMsg  = '';

    @track _leftOpen  = true;
    @track _rightOpen = true;

    @track _previewDevice = 'mobile';
    @track _previewTheme  = 'light';

    @track _canvasBlocks   = [];
    @track _renderSource = null;
    @track _renderSourceLoading = false;
    @track _renderSourceError = '';
    @track _isSaving = false;
    @track _previewTick = 0;
    @track _activeBlockId  = null;
    @track _addPopoverOpen  = false;
    @track _addSearchQuery  = '';
    @track _isDirty        = false;
    @track _deleteConfirmOpen = false;

    // versions modal state
    @track _versionsOpen    = false;
    @track _versionsLoading = false;
    @track _versionsError   = null;
    @track _versions        = [];

    // schedule modal state
    @track _scheduleOpen   = false;
    @track _scheduleDate   = '';
    @track _scheduleTime   = '';
    @track _scheduleTz     = 'Europe/Brussels';
    @track _scheduleAction = '';
    @track _scheduleNote   = '';
    @track _scheduleIntent = null; // 'updates' | 'activation' | 'deactivation'

    _dragPaletteId  = null;
    _dragInstanceId = null;
    _dragOverIndex  = null;
    @track _canvasDragOver    = false;
    @track _emptyZoneDragOver = false;

    // ── lifecycle ─────────────────────────────────────────────────────────────

    renderedCallback() {
        const active = this.template.activeElement;
        this.template.querySelectorAll('[data-content-field], [data-layout-field]').forEach(field => {
            if (field === active) return;
            const block = this._canvasBlocks.find(item => item.instanceId === field.dataset.instanceId);
            if (!block) return;
            const next = field.hasAttribute('data-layout-field')
                ? layoutFieldValue(block, field.dataset)
                : (block[field.dataset.field] ?? '');
            if (field.value !== String(next)) field.value = next;
        });
        this._syncPreviewFrame();
    }

    connectedCallback() {
        this._loadRecord();
        this._beforeUnloadHandler = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }

    // ── loading / error ───────────────────────────────────────────────────────

    get isLoading() { return this._isLoading; }
    get hasError()  { return this._hasError; }
    get errorMsg()  { return this._errorMsg; }
    get hasRecord() { return !this._isLoading && !this._hasError && !!this._record; }

    // ── header & toolbar ──────────────────────────────────────────────────────

    get headerTitle() { return this._record?.Name || 'Message Editor'; }

    get headerSubtitle() {
        if (!this._record) return '';
        const parts = [];
        if (this._record.Channel_Type__c) parts.push(this._record.Channel_Type__c);
        if (this._record.Version__c != null) parts.push('Variant ' + this._record.Version__c);
        if (this._record.Language__c) parts.push(this._record.Language__c);
        return parts.join(' · ');
    }

    get channelIcon() {
        const ct = (this._record?.Channel_Type__c || '').toLowerCase();
        if (ct.includes('email'))    return 'utility:email';
        if (ct.includes('push'))     return 'utility:notification';
        if (ct.includes('sms'))      return 'utility:sms';
        if (ct.includes('banner'))   return 'utility:layout_banner';
        if (ct.includes('whatsapp')) return 'utility:anywhere_chat';
        return 'utility:channel_program_levels';
    }

    // ── toolbar right group ───────────────────────────────────────────────────

    get recordStatus() { return this._record?.Status__c || 'Draft'; }

    get statusOptions() {
        const current = this.recordStatus;
        return STATUS_OPTIONS.map(opt => ({ ...opt, selected: opt.value === current }));
    }

    get toolbarStatusSelectClass() {
        const status = (this._record?.Status__c || 'draft').toLowerCase();
        if (status === 'active scheduled') {
            if (this._scheduleIntent === 'deactivation') return 'toolbar-status-select toolbar-status_scheduled-red';
            return 'toolbar-status-select toolbar-status_scheduled-green'; // 'updates' or no intent
        }
        if (status === 'draft scheduled') {
            return 'toolbar-status-select toolbar-status_scheduled-yellow';
        }
        return STATUS_SELECT_CLASS[status] || STATUS_SELECT_CLASS['draft'];
    }

    get sourceTemplateName() {
        return this._renderSource?.name
            || this._record?.Source_Template__r?.Name
            || 'No template';
    }

    get lastModifiedDisplay() {
        const d = this._record?.LastModifiedDate;
        if (!d) return '';
        const date = new Date(d);
        const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
        if (diffSec < 60)    return 'just now';
        if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`;
        if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    get isSaving()            { return this._isSaving; }
    get saveButtonLabel()     { return this._isSaving ? 'Saving…' : (this._isDirty ? 'Save Changes' : 'Save'); }
    get activateButtonLabel() { return this._isDirty ? 'Activate Changes' : 'Activate'; }

    get activateButtonClass() {
        return 'slds-button toolbar-action-btn '
            + (this._isDirty ? 'slds-button_brand' : 'slds-button_neutral');
    }
    get activateIconVariant() { return this._isDirty ? 'inverse' : ''; }

    get deleteConfirmOpen() { return this._deleteConfirmOpen; }

    // ── versions modal ────────────────────────────────────────────────────────

    get versionsOpen()    { return this._versionsOpen; }
    get versionsLoading() { return this._versionsLoading; }
    get versionsError()   { return this._versionsError; }
    get versionsEmpty()   { return !this._versionsLoading && !this._versionsError && this._versions.length === 0; }

    get versions() {
        return this._versions.map((v, idx) => {
            const s = (v.status || 'draft').toLowerCase();
            const dotClass = s === 'active'  ? 'version-dot version-dot_active'
                           : s === 'draft'   ? 'version-dot version-dot_draft'
                           : 'version-dot version-dot_default';
            let formattedDate = '';
            if (v.createdDate) {
                formattedDate = new Date(v.createdDate).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                });
            }
            return {
                ...v,
                index:         idx + 1,
                dotClass,
                formattedDate,
                hasNote:       !!v.deploymentNote,
                hasTrigger:    !!v.triggerAction,
                isLatest:      idx === 0,
            };
        });
    }

    // ── schedule modal ────────────────────────────────────────────────────────

    get scheduleOpen() { return this._scheduleOpen; }

    get timezoneOptions() {
        return TIMEZONES.map(tz => ({ ...tz, selected: tz.value === this._scheduleTz }));
    }

    get scheduleActionOptions() {
        const status = (this._record?.Status__c || 'Draft').toLowerCase();
        if (status === 'active') {
            return [
                { value: 'updates',      label: 'Schedule Message Updates',      selected: this._scheduleAction === 'updates' },
                { value: 'deactivation', label: 'Schedule Message Deactivation', selected: this._scheduleAction === 'deactivation' },
            ];
        }
        return [
            { value: 'activation', label: 'Schedule Message Activation', selected: this._scheduleAction === 'activation' },
        ];
    }

    get scheduleDate()   { return this._scheduleDate; }
    get scheduleTime()   { return this._scheduleTime; }
    get scheduleTz()     { return this._scheduleTz; }
    get scheduleAction() { return this._scheduleAction; }
    get scheduleNote()   { return this._scheduleNote; }

    get scheduleConfirmDisabled() {
        return !this._scheduleDate || !this._scheduleTime || !this._scheduleAction;
    }

    // ── left panel ────────────────────────────────────────────────────────────

    get leftPanelClass() {
        return 'slds-panel slds-size_medium slds-panel_docked slds-panel_docked-left slds-panel_drawer editor-panel-left'
            + (this._leftOpen ? ' slds-is-open' : '');
    }
    get leftPanelAriaHidden() { return this._leftOpen ? 'false' : 'true'; }
    get leftPanelOpen()       { return this._leftOpen ? 'true' : 'false'; }
    get leftToggleTitle()     { return this._leftOpen ? 'Collapse Components panel' : 'Expand Components panel'; }
    get leftToolbarToggleClass() {
        return 'slds-button slds-button_icon slds-button_icon-border' + (this._leftOpen ? ' slds-is-selected' : '');
    }
    get isSingleContentLayout() {
        const actions = this._renderSource?.previewActions || [];
        return actions.includes('expectContent') && !actions.includes('expectBlocks');
    }
    get availablePaletteBlocks() {
        if (this.isSingleContentLayout) return [];
        const templateBlocks = this._renderSource?.blocks || [];
        if (!this._renderSource) return PALETTE_BLOCKS;
        return templateBlocks.filter(block => block.type && block.status !== 'Draft' && block.status !== 'Ready').map(block => {
            const known = PALETTE_BLOCKS.find(item => item.blockType === block.type) || {};
            return {
                id: block.type,
                blockType: block.type,
                group: block.componentGroup || known.group || 'Content',
                label: block.label || known.label || block.type,
                icon: block.icon || known.icon || 'utility:page',
                description: block.description || known.description || '',
                svgHref: known.svgHref || '',
                bindings: Array.isArray(block.bindings) ? block.bindings : null,
                blockSettings: Array.isArray(block.blockSettings) ? block.blockSettings : null
            };
        });
    }

    get paletteEmpty() {
        return !!this._renderSource && this.availablePaletteBlocks.length === 0;
    }
    get paletteEmptyMessage() {
        if (this.isSingleContentLayout) {
            return 'This layout comes from the shell. Edit its content on the canvas. Sections marked preload stay as designed.';
        }
        return 'This template has no components defined.';
    }

    get blockGroups() { return groupBlocks(this.availablePaletteBlocks); }

    // ── canvas ────────────────────────────────────────────────────────────────

    get canvasClass() {
        const l = this._leftOpen  ? 'editor-canvas_panel-left'  : '';
        const r = this._rightOpen ? 'editor-canvas_panel-right' : '';
        return ('editor-canvas ' + l + ' ' + r).trim();
    }

    get isCanvasEmpty()    { return this._canvasBlocks.length === 0; }
    get isCanvasDragOver() { return this._canvasDragOver; }

    get emptyDropzoneClass() {
        return 'editor-dropzone-empty' + (this._emptyZoneDragOver ? ' editor-dropzone-empty_drag' : '');
    }
    get populatedDropzoneClass() {
        return 'editor-canvas-dropzone' + (this._canvasDragOver ? ' editor-canvas-dropzone_drag' : '');
    }

    get canvasBlocks() {
        const len = this._canvasBlocks.length;
        const definitions = this._renderSource?.blocks || [];
        return this._canvasBlocks.map((b, i) => {
            const definition = definitions.find(item => item.type === b.blockType) || {};
            const blockSettings = Array.isArray(definition.blockSettings)
                ? definition.blockSettings
                : (Array.isArray(b.blockSettings) ? b.blockSettings : null);
            const bindings = Array.isArray(definition.bindings)
                ? definition.bindings
                : (Array.isArray(b.bindings) ? b.bindings : null);
            const configured = { ...b, blockSettings, bindings };
            const showViewDesktop = settingOn(configured, 'viewDesktop');
            const showViewMobile = settingOn(configured, 'viewMobile');
            const showPadding = settingOn(configured, 'padding');
            const showBackground = settingOn(configured, 'background');
            const showColumnLayout = settingOn(configured, 'columnLayout');
            const showHeightDesktop = settingOn(configured, 'heightDesktop');
            const showHeightMobile = settingOn(configured, 'heightMobile');
            const showCopy = contentOn(configured, 'copy');
            const showImage = contentOn(configured, 'imageUrl') || contentOn(configured, 'altText');
            const showLegal = contentOn(configured, 'legal');
            const showSpacer = contentOn(configured, 'spacerHeight');
            const scan = definition.html ? parseBlockTemplate(definition.html) : parseBlockTemplate('');
            const layout = alignLayout(definition.layoutJson, scan);
            const modern = !!scan.usesLayout;
            const state = b.layoutState || {};
            const blockPad = paddingView(b.instanceId, scan.block, layout.padding, state);
            const showHideDesktop = modern && !!scan.block.hideDesktop && !!layout.hideDesktop;
            const showHideMobile = modern && !!scan.block.hideMobile && !!layout.hideMobile;
            const showBlockColor = modern && !!scan.block.bgColor && !!layout.backgroundColor;
            const showBlockImage = modern && !!scan.block.bgImage && !!layout.backgroundImage;
            const showBlockGradient = modern && !!scan.block.bgGradient && !!layout.backgroundGradient;
            const showModernColumns = modern && scan.columns.length > 1;
            const showColumnDirection = showModernColumns && !!scan.columnDirection && !!layout.columnDirection;
            const direction = state.columnDirection === 'rtl' ? 'rtl' : 'ltr';
            const layoutColumns = showModernColumns ? scan.columns.map((column, index) => {
                const runtime = columnRuntime(state, index);
                const options = layout.columns[index] || {};
                const pad = paddingView(b.instanceId, column, options.padding, runtime, index);
                const showColor = !!(column.bgColor && options.backgroundColor);
                const showImage = !!(column.bgImage && options.backgroundImage);
                const showGradient = !!(column.bgGradient && options.backgroundGradient);
                return {
                    key: `${b.instanceId}:column:${index}`,
                    index: String(index),
                    label: column.label,
                    showPadding: pad.show,
                    showDesktopPad: pad.showDesktop,
                    showPadInherit: pad.showInherit,
                    padMobileInherit: runtime.padMobileInherit,
                    showMobilePad: pad.showMobileFields,
                    desktopFields: pad.desktopFields,
                    mobileFields: pad.mobileFields,
                    showColor,
                    colors: showColor ? colorOptions(b.instanceId, options.backgroundColors, runtime.bgColor, index) : [],
                    showImage,
                    imageUploadName: `column-bg-${b.instanceId}-${index}`,
                    showGradient,
                    gradients: showGradient ? gradientOptions(b.instanceId, options.gradients, runtime.bgGradientId, index) : []
                };
            }) : [];
            const showModernBlock = showHideDesktop || showHideMobile || blockPad.show || showBlockColor || showBlockImage || showBlockGradient;
            return {
            ...configured,
            blockOrder: i + 1,
            slotBeforeIndex: i,
            isFirst: i === 0,
            isLast:  i === len - 1,
            expanded: b.instanceId === this._activeBlockId,
            blockCardClass: 'block-card'
                + (b.instanceId === this._activeBlockId ? ' block-card_active' : '')
                + (b.instanceId === this._dragInstanceId ? ' block-card_dragging' : ''),
            contentTabClass:     'slds-tabs_default__item' + (b.activeTab === 'content'  ? ' slds-is-active' : ''),
            settingsTabClass:    'slds-tabs_default__item' + (b.activeTab === 'settings' ? ' slds-is-active' : ''),
            contentTabSelected:  b.activeTab === 'content',
            settingsTabSelected: b.activeTab === 'settings',
            contentTabIndex:     b.activeTab === 'content'  ? '0' : '-1',
            settingsTabIndex:    b.activeTab === 'settings' ? '0' : '-1',
            contentPanelStyle:   b.activeTab === 'content'  ? 'display:block' : 'display:none',
            settingsPanelStyle:  b.activeTab === 'settings' ? 'display:block' : 'display:none',
            previewAriaPressed:  b.previewOn ? 'true' : 'false',
            visDesktopShow:      b.visDesktop === 'show',
            visMobileShow:       b.visMobile  === 'show',
            visDesktopShowClass: 'slds-button vis-btn' + (b.visDesktop === 'show' ? ' vis-btn_active' : ''),
            visDesktopHideClass: 'slds-button vis-btn' + (b.visDesktop === 'hide' ? ' vis-btn_active' : ''),
            visMobileShowClass:  'slds-button vis-btn' + (b.visMobile  === 'show' ? ' vis-btn_active' : ''),
            visMobileHideClass:  'slds-button vis-btn' + (b.visMobile  === 'hide' ? ' vis-btn_active' : ''),
            contentTabId:    'block-content-tab-'    + b.instanceId,
            settingsTabId:   'block-settings-tab-'   + b.instanceId,
            contentPanelId:  'block-content-panel-'  + b.instanceId,
            settingsPanelId: 'block-settings-panel-' + b.instanceId,
            padTopId:    'block-padding-' + b.instanceId + '-top',
            padRightId:  'block-padding-' + b.instanceId + '-right',
            padBottomId: 'block-padding-' + b.instanceId + '-bottom',
            padLeftId:   'block-padding-' + b.instanceId + '-left',
            padLinkedPressed:      b.padLinked ? 'true' : 'false',
            padLinkedClass:        'block-pad-link' + (b.padLinked ? ' block-pad-link_active' : ''),
            padLinkedIconVariant:  b.padLinked ? 'inverse' : '',
            bgValueId:   'block-bg-value-' + b.instanceId,
            bgValue:     b.bgValue || '',
            copyText: b.copyText || '',
            imageUrl: b.imageUrl || '',
            altText: b.altText || '',
            legalText: b.legalText || '',
            spacerHeight: b.spacerHeight || '20',
            heightDesktop: b.heightDesktop || '',
            heightMobile: b.heightMobile || '',
            showViewDesktop: !modern && showViewDesktop,
            showViewMobile: !modern && showViewMobile,
            showPadding: !modern && showPadding,
            showBackground: !modern && showBackground,
            showColumnLayout: !modern && showColumnLayout,
            showHeightDesktop: !modern && showHeightDesktop,
            showHeightMobile: !modern && showHeightMobile,
            showLayoutCard: !modern && (showViewDesktop || showViewMobile || showPadding || showBackground || showHeightDesktop || showHeightMobile),
            noBlockSettings: modern
                ? !showModernBlock
                : !showViewDesktop && !showViewMobile && !showPadding && !showBackground && !showColumnLayout && !showHeightDesktop && !showHeightMobile,
            showModernBlock,
            showHideDesktop,
            showHideMobile,
            hideDesktopOn: !!state.hideDesktop,
            hideMobileOn: !!state.hideMobile,
            showBlockPadding: blockPad.show,
            showBlockDesktopPad: blockPad.showDesktop,
            showBlockPadInherit: blockPad.showInherit,
            padMobileInherit: state.padMobileInherit !== false,
            showBlockMobilePad: blockPad.showMobileFields,
            desktopPadFields: blockPad.desktopFields,
            mobilePadFields: blockPad.mobileFields,
            showBlockColor,
            colorOptions: showBlockColor ? colorOptions(b.instanceId, layout.backgroundColors, state.bgColor) : [],
            showBlockImage,
            blockImageUploadName: `block-bg-${b.instanceId}`,
            canUploadImage: !!this.recordId,
            showBlockGradient,
            gradientOptions: showBlockGradient ? gradientOptions(b.instanceId, layout.gradients, state.bgGradientId) : [],
            showModernColumns,
            showColumnDirection,
            directionLtrClass: 'slds-button vis-btn' + (direction === 'ltr' ? ' vis-btn_active' : ''),
            directionRtlClass: 'slds-button vis-btn' + (direction === 'rtl' ? ' vis-btn_active' : ''),
            layoutColumns,
            showCopy,
            showImage,
            showLegal,
            showSpacer,
            noContentFields: !showCopy && !showImage && !showLegal && !showSpacer && !showModernColumns,
            missingBlockTemplate: !!this._renderSource?.shellHtml && !this._templateBlockTypes.has(b.blockType),
            copyFieldId: 'block-copy-' + b.instanceId,
            imageFieldId: 'block-image-' + b.instanceId,
            altFieldId: 'block-alt-' + b.instanceId,
            legalFieldId: 'block-legal-' + b.instanceId,
            spacerFieldId: 'block-spacer-' + b.instanceId,
            isTextImage: b.blockType === 'TextImage',
            imageLayoutTextLeft:      b.imageLayout !== 'image-left',
            imageLayoutImageLeft:     b.imageLayout === 'image-left',
            colLayoutTextLeftClass:   'column-layout-card' + (b.imageLayout !== 'image-left' ? ' column-layout-card_selected' : ''),
            colLayoutImageLeftClass:  'column-layout-card' + (b.imageLayout === 'image-left' ? ' column-layout-card_selected' : ''),
            heightDesktopId: 'block-height-desktop-' + b.instanceId,
            heightMobileId: 'block-height-mobile-' + b.instanceId,
        };
        });
    }

    get addPopoverOpen() { return this._addPopoverOpen; }
    get addSearchQuery() { return this._addSearchQuery; }

    get filteredPopoverBlocks() {
        const q = (this._addSearchQuery || '').toLowerCase();
        const blocks = this.availablePaletteBlocks;
        return q
            ? blocks.filter(b => b.label.toLowerCase().includes(q))
            : blocks.map(b => ({ ...b }));
    }

    get addSearchEmpty() {
        return this.filteredPopoverBlocks.length === 0;
    }

    // ── right panel ───────────────────────────────────────────────────────────

    get rightPanelClass() {
        const device = this._previewDevice === 'mobile' ? ' editor-panel-right_mobile' : ' editor-panel-right_desktop';
        return 'slds-panel slds-size_medium slds-panel_docked slds-panel_docked-right slds-panel_drawer editor-panel-right'
            + device + (this._rightOpen ? ' slds-is-open' : '');
    }
    get rightPanelAriaHidden() { return this._rightOpen ? 'false' : 'true'; }
    get rightPanelOpen()       { return this._rightOpen ? 'true' : 'false'; }
    get rightToggleTitle()     { return this._rightOpen ? 'Collapse Preview panel' : 'Expand Preview panel'; }
    get rightToolbarToggleClass() {
        return 'slds-button slds-button_icon slds-button_icon-border' + (this._rightOpen ? ' slds-is-selected' : '');
    }

    get isDesktop()    { return this._previewDevice === 'desktop'; }
    get isMobile()     { return this._previewDevice === 'mobile'; }
    get isLightTheme() { return this._previewTheme === 'light'; }
    get isDarkTheme()  { return this._previewTheme === 'dark'; }

    get deviceDesktopClass() {
        return 'slds-button slds-button_icon slds-button_icon-border' + (this._previewDevice === 'desktop' ? ' slds-is-selected' : '');
    }
    get deviceMobileClass() {
        return 'slds-button slds-button_icon slds-button_icon-border' + (this._previewDevice === 'mobile' ? ' slds-is-selected' : '');
    }
    get themeLightClass() {
        return 'slds-button slds-button_icon slds-button_icon-border' + (this._previewTheme === 'light' ? ' slds-is-selected' : '');
    }
    get themeDarkClass() {
        return 'slds-button slds-button_icon slds-button_icon-border' + (this._previewTheme === 'dark' ? ' slds-is-selected' : '');
    }
    get deviceDesktopVariant() { return this._previewDevice === 'desktop' ? 'inverse' : ''; }
    get deviceMobileVariant()  { return this._previewDevice === 'mobile'  ? 'inverse' : ''; }
    get themeLightVariant()    { return this._previewTheme  === 'light'   ? 'inverse' : ''; }
    get themeDarkVariant()     { return this._previewTheme  === 'dark'    ? 'inverse' : ''; }
    get previewFrameClass() {
        const d = this._previewDevice === 'mobile' ? 'editor-preview_mobile' : 'editor-preview_desktop';
        const t = this._previewTheme  === 'dark'   ? 'editor-preview_dark'   : 'editor-preview_light';
        return 'editor-preview__frame ' + d + ' ' + t;
    }
    get _templateBlockTypes() {
        return new Set((this._renderSource?.blocks || []).filter(block => block.html).map(block => block.type));
    }

    get renderSourceLoading() { return this._renderSourceLoading; }
    get hasShellPreview() { return !!this._renderSource?.shellHtml && !this._renderSourceLoading; }
    get previewDocument() {
        const revision = this._previewTick;
        if (!this._renderSource?.shellHtml || revision < 0) return '';
        return renderTemplatePreview(this._renderSource, this._canvasBlocks, this._previewDevice);
    }
    get previewContentClass() {
        return 'editor-preview__content' + (this.hasShellPreview ? ' editor-preview__content_document' : '');
    }
    get previewIsEmpty() {
        return !this.hasShellPreview && !this._renderSourceLoading && this._canvasBlocks.length === 0;
    }
    get showIconPreview() {
        return !this.hasShellPreview && !this._renderSourceLoading && this._canvasBlocks.length > 0;
    }
    get previewStatusMessage() {
        if (this._renderSourceError) return this._renderSourceError;
        if (!this._record?.Source_Template__c) {
            return 'This message has no source template. Create a message and choose a validated template to preview the full layout.';
        }
        return 'The source template has no HTML shell to preview.';
    }
    get previewBlocks() {
        return this._canvasBlocks.map(b => ({
            ...b,
            previewBlockClass: 'editor-preview-block'
                + (b.instanceId === this._activeBlockId ? ' editor-preview-block_active' : ''),
        }));
    }

    // ── handlers: header & toolbar ────────────────────────────────────────────

    handleBack() { this.dispatchEvent(new CustomEvent('back')); }

    handleStatusChange(e) {
        if (!this._record) return;
        const newStatus = e.target.value;
        this._record  = { ...this._record, Status__c: newStatus };
        this._isDirty = true;
        const lower = newStatus.toLowerCase();
        if (lower !== 'active scheduled' && lower !== 'draft scheduled') {
            this._scheduleIntent = null;
        }
    }

    handleToolbarSave() {
        if (!this.recordId || this._isSaving) return;
        this._isSaving = true;
        const canvasJson = JSON.stringify(this._canvasBlocks);
        saveMessageEditor({
            recordId: this.recordId,
            status: this._record?.Status__c,
            canvasJson,
        })
            .then(() => {
                this._record = { ...(this._record || {}), Canvas_Blocks_JSON__c: canvasJson };
                this._isDirty = false;
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Saved',
                    message: 'Message copy saved.',
                    variant: 'success',
                }));
                this.dispatchEvent(new CustomEvent('save', {
                    detail: { record: this._record, blocks: this._canvasBlocks },
                }));
            })
            .catch(err => {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Save failed',
                    message: err?.body?.message || 'Could not save the message.',
                    variant: 'error',
                }));
            })
            .finally(() => { this._isSaving = false; });
    }

    handleToolbarSchedule() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const yyyy = tomorrow.getFullYear();
        const mm   = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const dd   = String(tomorrow.getDate()).padStart(2, '0');
        this._scheduleDate   = `${yyyy}-${mm}-${dd}`;
        this._scheduleTime   = '09:00';
        this._scheduleTz     = 'Europe/Brussels';
        this._scheduleAction = '';
        this._scheduleNote   = '';
        this._scheduleOpen   = true;
    }

    handleScheduleClose() { this._scheduleOpen = false; }

    handleScheduleDateChange(e)   { this._scheduleDate   = e.target.value; }
    handleScheduleTimeChange(e)   { this._scheduleTime   = e.target.value; }
    handleScheduleTzChange(e)     { this._scheduleTz     = e.target.value; }
    handleScheduleActionChange(e) { this._scheduleAction = e.target.value; }
    handleScheduleNoteChange(e)   { this._scheduleNote   = e.target.value; }

    handleScheduleConfirm() {
        const status = (this._record?.Status__c || 'Draft').toLowerCase();
        let newStatus;
        if (status === 'active') {
            newStatus            = 'Active Scheduled';
            this._scheduleIntent = this._scheduleAction; // 'updates' or 'deactivation'
        } else {
            newStatus            = 'Draft Scheduled';
            this._scheduleIntent = 'activation';
        }
        this._record      = { ...this._record, Status__c: newStatus };
        this._isDirty     = true;
        this._scheduleOpen = false;
    }

    handleToolbarVersions() {
        this._versionsOpen    = true;
        this._versions        = [];
        this._versionsError   = null;
        this._versionsLoading = true;
        getVersionsByMessageId({ messageId: this.recordId })
            .then(rows => {
                this._versions        = rows || [];
                this._versionsLoading = false;
            })
            .catch(err => {
                this._versionsError   = err?.body?.message || 'Failed to load versions.';
                this._versionsLoading = false;
            });
    }

    handleVersionsClose() { this._versionsOpen = false; }

    handleLoadVersion(e) {
        const vid = e.currentTarget.dataset.versionId;
        const version = this._versions.find(v => v.id === vid);
        if (!version) return;
        try {
            this._canvasBlocks = version.blocksJson ? JSON.parse(version.blocksJson) : [];
        } catch(err) {
            this._canvasBlocks = [];
        }
        this._activeBlockId = null;
        this._isDirty       = true;
        this._versionsOpen  = false;
    }

    handleToolbarActivate() {
        this.dispatchEvent(new CustomEvent('activate', {
            detail: { record: this._record, blocks: this._canvasBlocks, isDirty: this._isDirty },
        }));
    }

    handleToolbarDelete() {
        this._deleteConfirmOpen = true;
    }

    handleDeleteCancel() {
        this._deleteConfirmOpen = false;
    }

    handleDeleteConfirm() {
        this._deleteConfirmOpen = false;
        this.dispatchEvent(new CustomEvent('delete', { detail: { recordId: this.recordId } }));
    }

    // ── handlers: panels ──────────────────────────────────────────────────────

    handleToggleLeft()  { this._leftOpen  = !this._leftOpen; }
    handleToggleRight() { this._rightOpen = !this._rightOpen; }
    handleCloseLeft()   { this._leftOpen  = false; }
    handleCloseRight()  { this._rightOpen = false; }

    // ── handlers: preview controls ────────────────────────────────────────────

    handleDeviceDesktop() { this._previewDevice = 'desktop'; }
    handleDeviceMobile()  { this._previewDevice = 'mobile'; }
    handleThemeLight()    { this._previewTheme  = 'light'; }
    handleThemeDark()     { this._previewTheme  = 'dark'; }

    // ── handlers: add popover ─────────────────────────────────────────────────

    handleOpenAddPopover()  { this._addPopoverOpen = true; }
    handleCloseAddPopover() { this._addPopoverOpen = false; this._addSearchQuery = ''; }
    handleAddSearchChange(e) { this._addSearchQuery = e.target.value; }

    handleAddBlockFromPopover(e) {
        const id   = e.currentTarget.dataset.id;
        const inst = makeInstance(id, this.availablePaletteBlocks);
        this._canvasBlocks   = [...this._canvasBlocks, inst];
        this._activeBlockId  = inst.instanceId;
        this._addPopoverOpen = false;
        this._addSearchQuery = '';
        this._isDirty        = true;
    }

    // ── handlers: empty-state drop zone ──────────────────────────────────────

    handleEmptyZoneDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this._emptyZoneDragOver = true;
    }
    handleEmptyZoneDragLeave() { this._emptyZoneDragOver = false; }
    handleEmptyZoneDrop(e) {
        e.preventDefault();
        this._emptyZoneDragOver = false;
        if (this._dragPaletteId) {
            const inst = makeInstance(this._dragPaletteId, this.availablePaletteBlocks);
            this._canvasBlocks  = [inst];
            this._activeBlockId = inst.instanceId;
        }
        this._dragPaletteId  = null;
        this._dragInstanceId = null;
    }

    // ── handlers: drag ────────────────────────────────────────────────────────

    handlePaletteDragStart(e) {
        this._dragPaletteId  = e.currentTarget.dataset.id;
        this._dragInstanceId = null;
        e.dataTransfer.effectAllowed = 'copy';
    }

    handleBlockDragStart(e) {
        e.stopPropagation();
        this._dragInstanceId = e.currentTarget.dataset.instanceId;
        this._dragPaletteId  = null;
        e.dataTransfer.effectAllowed = 'move';
    }

    handleSlotDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = this._dragPaletteId ? 'copy' : 'move';
        e.currentTarget.classList.add('slds-drop-zone_drag__slot_active');
        this._dragOverIndex = Number(e.currentTarget.dataset.index);
    }
    handleSlotDragLeave(e) {
        e.currentTarget.classList.remove('slds-drop-zone_drag__slot_active');
    }
    handleSlotDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('slds-drop-zone_drag__slot_active');
        const targetIndex = Number(e.currentTarget.dataset.index);
        if (this._dragPaletteId) {
            const inst   = makeInstance(this._dragPaletteId, this.availablePaletteBlocks);
            const blocks = [...this._canvasBlocks];
            blocks.splice(targetIndex, 0, inst);
            this._canvasBlocks  = blocks;
            this._activeBlockId = inst.instanceId;
        } else if (this._dragInstanceId) {
            const blocks    = [...this._canvasBlocks];
            const fromIndex = blocks.findIndex(b => b.instanceId === this._dragInstanceId);
            if (fromIndex === -1) return;
            const [moved]  = blocks.splice(fromIndex, 1);
            const insertAt = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
            blocks.splice(insertAt, 0, moved);
            this._canvasBlocks = blocks;
        }
        this._dragPaletteId  = null;
        this._dragInstanceId = null;
        this._dragOverIndex  = null;
        this._canvasDragOver = false;
    }
    handleDragEnd() {
        this._dragPaletteId     = null;
        this._dragInstanceId    = null;
        this._dragOverIndex     = null;
        this._canvasDragOver    = false;
        this._emptyZoneDragOver = false;
    }
    handleCanvasDragOver(e) {
        e.preventDefault();
        this._canvasDragOver = true;
    }
    handleCanvasDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            this._canvasDragOver = false;
        }
    }

    // Fallback: drop lands on the canvas background — append to end
    handleCanvasDrop(e) {
        e.preventDefault();
        this._canvasDragOver = false;
        if (this._dragPaletteId) {
            const inst = makeInstance(this._dragPaletteId, this.availablePaletteBlocks);
            this._canvasBlocks  = [...this._canvasBlocks, inst];
            this._activeBlockId = inst.instanceId;
        }
        this._dragPaletteId  = null;
        this._dragInstanceId = null;
    }

    // Drop anywhere on an existing card — insert after that card's position
    handleCardDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = this._dragPaletteId ? 'copy' : 'move';
    }

    handleCardDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const insertAfter = Number(e.currentTarget.dataset.index); // blockOrder = 1-based position
        if (this._dragPaletteId) {
            const inst   = makeInstance(this._dragPaletteId, this.availablePaletteBlocks);
            const blocks = [...this._canvasBlocks];
            blocks.splice(insertAfter, 0, inst);
            this._canvasBlocks  = blocks;
            this._activeBlockId = inst.instanceId;
        } else if (this._dragInstanceId) {
            const blocks    = [...this._canvasBlocks];
            const fromIndex = blocks.findIndex(b => b.instanceId === this._dragInstanceId);
            if (fromIndex === -1) return;
            const [moved]  = blocks.splice(fromIndex, 1);
            const insertAt = insertAfter > fromIndex ? insertAfter - 1 : insertAfter;
            blocks.splice(insertAt, 0, moved);
            this._canvasBlocks = blocks;
        }
        this._dragPaletteId  = null;
        this._dragInstanceId = null;
        this._canvasDragOver = false;
    }

    // ── handlers: block chrome ────────────────────────────────────────────────

    handleToggleBlock(e) {
        if (e.target.closest('.block-card__reorder') || e.target.closest('.block-card__actions')) return;
        const instanceId = e.currentTarget.dataset.instanceId;
        // Toggle: clicking active block collapses it; clicking any other expands it exclusively
        this._activeBlockId = this._activeBlockId === instanceId ? null : instanceId;
    }

    handleToggleBlockPreview(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId ? { ...b, previewOn: !b.previewOn } : b
        );
    }

    handleMoveUp(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const blocks = [...this._canvasBlocks];
        const i = blocks.findIndex(b => b.instanceId === instanceId);
        if (i <= 0) return;
        [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
        this._canvasBlocks = blocks;
    }
    handleMoveDown(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const blocks = [...this._canvasBlocks];
        const i = blocks.findIndex(b => b.instanceId === instanceId);
        if (i === -1 || i >= blocks.length - 1) return;
        [blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
        this._canvasBlocks = blocks;
    }
    handleCloneBlock(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const blocks = [...this._canvasBlocks];
        const i = blocks.findIndex(b => b.instanceId === instanceId);
        if (i === -1) return;
        const clone = {
            ...blocks[i],
            instanceId: 'blk_' + Date.now() + '_' + (++_uid).toString(36),
            layoutState: JSON.parse(JSON.stringify(blocks[i].layoutState || emptyLayoutState()))
        };
        blocks.splice(i + 1, 0, clone);
        this._canvasBlocks = blocks;
    }
    handleRemoveBlock(e) {
        e.stopPropagation();
        const instanceId   = e.currentTarget.dataset.instanceId;
        this._canvasBlocks = this._canvasBlocks.filter(b => b.instanceId !== instanceId);
        this._isDirty      = true;
    }

    // ── handlers: block tab ───────────────────────────────────────────────────

    imageAccept = '.png,.jpg,.jpeg,.gif,.webp';

    handleLayoutFlag(event) {
        event.stopPropagation();
        const flag = event.currentTarget.dataset.flag;
        if (flag !== 'hideDesktop' && flag !== 'hideMobile') return;
        this._patchLayout(event.currentTarget.dataset.instanceId, event.currentTarget.dataset.column, {
            [flag]: event.target.checked
        });
    }

    handleLayoutInherit(event) {
        event.stopPropagation();
        this._patchLayout(event.currentTarget.dataset.instanceId, event.currentTarget.dataset.column, {
            padMobileInherit: event.target.checked
        });
    }

    handleLayoutPad(event) {
        event.stopPropagation();
        const { instanceId, column, device, side } = event.currentTarget.dataset;
        if (!instanceId || !side) return;
        const key = device === 'mobile' ? 'padMobile' : 'padDesktop';
        const block = this._canvasBlocks.find(item => item.instanceId === instanceId);
        if (!block) return;
        const state = block.layoutState || {};
        const source = column === undefined || column === '' ? state : (state.columns || [])[Number(column)] || {};
        this._patchLayout(instanceId, column, {
            [key]: { ...(source[key] || {}), [side]: event.target.value }
        }, false);
    }

    handleLayoutImage(event) {
        event.stopPropagation();
        this._patchLayout(event.currentTarget.dataset.instanceId, event.currentTarget.dataset.column, {
            bgImage: event.target.value ?? ''
        }, false);
    }

    handleLayoutImageUpload(event) {
        event.stopPropagation();
        const file = (event.detail?.files || [])[0];
        if (!file?.documentId) return;
        let instanceId = event.currentTarget.dataset.instanceId;
        let column = event.currentTarget.dataset.column;
        const name = event.currentTarget.name || '';
        if (!instanceId && name.startsWith('column-bg-')) {
            const rest = name.slice('column-bg-'.length);
            const split = rest.lastIndexOf('-');
            instanceId = rest.slice(0, split);
            column = rest.slice(split + 1);
        } else if (!instanceId && name.startsWith('block-bg-')) {
            instanceId = name.slice('block-bg-'.length);
        }
        this._patchLayout(instanceId, column, {
            bgImage: `/sfc/servlet.shepherd/document/download/${file.documentId}`
        });
    }

    handleLayoutColor(event) {
        event.stopPropagation();
        this._patchLayout(event.currentTarget.dataset.instanceId, event.currentTarget.dataset.column, {
            bgColor: event.currentTarget.dataset.color || ''
        });
    }

    handleLayoutGradient(event) {
        event.stopPropagation();
        this._patchLayout(event.currentTarget.dataset.instanceId, event.currentTarget.dataset.column, {
            bgGradientId: event.currentTarget.dataset.gradient || ''
        });
    }

    handleColumnDirection(event) {
        event.stopPropagation();
        const direction = event.currentTarget.dataset.direction === 'rtl' ? 'rtl' : 'ltr';
        this._patchLayout(event.currentTarget.dataset.instanceId, '', { columnDirection: direction });
    }

    _patchLayout(instanceId, columnIndex, patch, replace = true) {
        const apply = (block) => {
            const state = { ...(block.layoutState || emptyLayoutState()) };
            if (columnIndex === undefined || columnIndex === '' || columnIndex == null) {
                return { ...block, layoutState: { ...state, ...patch } };
            }
            const index = Number(columnIndex);
            const columns = Array.isArray(state.columns) ? state.columns.map(column => ({ ...column })) : [];
            while (columns.length <= index) columns.push({});
            columns[index] = { ...(columns[index] || {}), ...patch };
            return { ...block, layoutState: { ...state, columns } };
        };
        if (replace) {
            this._canvasBlocks = this._canvasBlocks.map(block => (
                block.instanceId === instanceId ? apply(block) : block
            ));
        } else {
            const block = this._canvasBlocks.find(item => item.instanceId === instanceId);
            if (block) {
                const next = apply(block);
                block.layoutState = next.layoutState;
            }
        }
        this._previewTick += 1;
        this._isDirty = true;
    }

    handleBlockContentChange(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const field = e.currentTarget.dataset.field;
        if (!instanceId || !field) return;
        const value = e.target.value ?? '';
        const block = this._canvasBlocks.find(item => item.instanceId === instanceId);
        if (!block || block[field] === value) return;
        block[field] = value;
        this._previewTick += 1;
        this._isDirty = true;
    }

    handleBlockTabChange(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const tab        = e.currentTarget.dataset.tab;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId ? { ...b, activeTab: tab } : b
        );
    }

    // ── handlers: block settings ──────────────────────────────────────────────

    handleBlockVisChange(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const device     = e.currentTarget.dataset.device;
        const value      = e.target.value;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId !== instanceId ? b
                : { ...b, [device === 'desktop' ? 'visDesktop' : 'visMobile']: value }
        );
    }

    handleBlockPadChange(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const side       = e.currentTarget.dataset.side;
        const value      = e.target.value;
        const key        = 'pad' + side.charAt(0).toUpperCase() + side.slice(1);
        this._canvasBlocks = this._canvasBlocks.map(b => {
            if (b.instanceId !== instanceId) return b;
            if (b.padLinked) return { ...b, padTop: value, padRight: value, padBottom: value, padLeft: value };
            return { ...b, [key]: value };
        });
        this._isDirty = true;
    }
    handleBlockPadLink(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId ? { ...b, padLinked: !b.padLinked } : b
        );
    }
    handleBlockPadReset(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId
                ? { ...b, padTop: '20', padRight: '40', padBottom: '20', padLeft: '40', padLinked: false }
                : b
        );
        this._isDirty = true;
    }
    handleBlockBgChange(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId ? { ...b, bgValue: e.target.value } : b
        );
        this._isDirty = true;
    }
    handleBlockVisClick(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const device     = e.currentTarget.dataset.device;
        const value      = e.currentTarget.dataset.value;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId !== instanceId ? b
                : { ...b, [device === 'desktop' ? 'visDesktop' : 'visMobile']: value }
        );
        this._isDirty = true;
    }
    handleBlockHeightChange(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const field = e.currentTarget.dataset.field;
        if (field !== 'heightDesktop' && field !== 'heightMobile') return;
        const value = e.target.value;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId ? { ...b, [field]: value } : b
        );
        this._isDirty = true;
    }
    handleBlockImageLayout(e) {
        e.stopPropagation();
        const instanceId = e.currentTarget.dataset.instanceId;
        const layout     = e.currentTarget.dataset.layout;
        this._canvasBlocks = this._canvasBlocks.map(b =>
            b.instanceId === instanceId ? { ...b, imageLayout: layout } : b
        );
        this._isDirty = true;
    }

    // ── private ───────────────────────────────────────────────────────────────

    _loadRecord() {
        if (!this.recordId) {
            this._isLoading = false;
            this._hasError  = true;
            this._errorMsg  = 'No record ID provided.';
            return;
        }
        this._isLoading = true;
        getMessageById({ recordId: this.recordId })
            .then(rec => {
                this._record = rec;
                this._canvasBlocks = parseCanvas(rec?.Canvas_Blocks_JSON__c);
                this._isLoading = false;
                this._loadRenderSource();
            })
            .catch(err => {
                this._hasError = true;
                this._errorMsg = err?.body?.message || 'Failed to load message.';
                this._isLoading = false;
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
            theme: this._previewTheme,
        });
        pinPreviewWidths(host);
        host._previewStamp = stamp;
    }

    _seedSingleContentBlock() {
        if (!this.isSingleContentLayout || this._canvasBlocks.length) return;
        const block = (this._renderSource?.blocks || [])[0];
        if (!block?.type) return;
        const instance = makeInstance(block.type, [{
            id: block.type,
            blockType: block.type,
            group: block.componentGroup || 'Content',
            label: block.label || 'Content',
            icon: block.icon || 'utility:edit',
            description: block.description || 'Edit the layout content from the shell.'
        }]);
        this._canvasBlocks = [instance];
        this._activeBlockId = instance.instanceId;
    }

    _loadRenderSource() {
        const templateId = this._record?.Source_Template__c;
        this._renderSource = null;
        this._renderSourceError = '';
        if (!templateId) return;
        this._renderSourceLoading = true;
        getTemplateRenderSource({ templateId })
            .then(source => {
                this._renderSource = source;
                this._seedSingleContentBlock();
            })
            .catch(err => {
                this._renderSourceError = err?.body?.message || 'Could not load the source template.';
            })
            .finally(() => { this._renderSourceLoading = false; });
    }
}

function pinPreviewWidths(root) {
    root.querySelectorAll('table[width], td[width], th[width]').forEach(el => {
        if (el.style.width) return;
        const raw = String(el.getAttribute('width') || '').trim();
        if (/^\d+$/.test(raw)) el.style.width = `${raw}px`;
        else if (/^\d+%$/.test(raw)) el.style.width = raw;
    });
}

function parseCanvas(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}