import { LightningElement, track, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelRecords from '@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords';
import getMessagesForDictionaryChannel from '@salesforce/apex/CopyCockpitController.getMessagesForDictionaryChannel';
import {
    getVisibleChannelRecords,
    getChannelDisplayName,
    getCommunicationBadges
} from 'c/marketingDictionaryState';
import getVersionCountsByMessageIds from '@salesforce/apex/CopyCockpitController.getVersionCountsByMessageIds';
import createMessage from '@salesforce/apex/CopyCockpitController.createMessage';
import cloneMessage from '@salesforce/apex/CopyCockpitController.cloneMessage';
import updateMessageMaster from '@salesforce/apex/CopyCockpitController.updateMessageMaster';
import getProductFamilies from '@salesforce/apex/CopyCockpitController.getProductFamilies';
import getActiveOffersByFamily from '@salesforce/apex/CopyCockpitController.getActiveOffersByFamily';
import getProductFamilyForOffer from '@salesforce/apex/CopyCockpitController.getProductFamilyForOffer';
import saveMasterRowSettings from '@salesforce/apex/CopyCockpitController.saveMasterRowSettings';
import updateMessageSourceTemplates from '@salesforce/apex/CopyCockpitController.updateMessageSourceTemplates';
import saveVariantDisplayWeight from '@salesforce/apex/CopyCockpitController.saveVariantDisplayWeight';
import getSelectableTemplates from '@salesforce/apex/ChannelTemplateController.getSelectableTemplates';
import updateMessageStatus from '@salesforce/apex/CopyCockpitController.updateMessageStatus';
import syncWithMCE from '@salesforce/apex/MarketingCloudCopySync.syncWithMCE';
import syncVariantsWithMCE from '@salesforce/apex/MarketingCloudCopySync.syncVariantsWithMCE';
import deleteMessageVariants from '@salesforce/apex/CopyCockpitController.deleteMessageVariants';
import deleteMasterMessageGroup from '@salesforce/apex/CopyCockpitController.deleteMasterMessageGroup';
import refreshStreamViaFlow from '@salesforce/apex/FlowInit_TriggerDataSourceObjectRefresh.refreshStreamViaFlow';
import {
    channelPrefixForType,
    composeStem,
    groupKeyFromName,
    masterGroupKey,
    recordBelongsToMasterGroup,
    variantNumberFromRecord,
    nameBelongsToStem,
    nextAvailableVariant,
    parseFullName
} from 'c/copyMessageNaming';

// ── constants ──────────────────────────────────────────────────────────────

const FALLBACK_ICON = 'utility:channel_program_levels';

const ICON_MAP = {
    sms:       'utility:sms',
    push:      'utility:push',
    email:     'utility:email',
    banner:    'utility:layout_banner',
    webbanner: 'utility:layout_banner',
    in_app:    'utility:app_web_messaging',
    inapp:     'utility:app_web_messaging',
    whatsapp:  'utility:anywhere_chat',
};

const COLUMN_WIDTH_DEFAULTS = {
    name: 280,
    status: 128,
    weight: 72,
    versions: 64,
    modified: 168,
};

const COLUMN_FIT_MIN = {
    name: 160,
    status: 96,
    weight: 56,
    versions: 44,
    modified: 108,
};

/** Relative share of flexible width when auto-fitting columns. */
const COLUMN_FIT_WEIGHTS = {
    name: 3.2,
    status: 1.35,
    weight: 0.75,
    versions: 0.65,
    modified: 1.5,
};

const COL_CHECK_PX = 32;
const COL_ACTIONS_PX = 112;

const STATUS_BADGE_CLASS = {
    draft:     'slds-badge slds-theme_lightest',
    ready:     'slds-badge slds-theme_info',
    published: 'slds-badge slds-theme_success',
    inactive:  'slds-badge slds-theme_warning',
    archived:  'slds-badge slds-theme_shade',
};

const VARIANT_STATUS_OPTIONS = [
    { value: 'Draft', label: 'Draft' },
    { value: 'Ready', label: 'Ready' },
    { value: 'Published', label: 'Published' },
    { value: 'Inactive', label: 'Inactive' },
    { value: 'Archived', label: 'Archived' },
];

function allowedTargetStatuses(fromStatus) {
    const from = (fromStatus || 'Draft').toLowerCase();
    if (from === 'published') {
        return ['Published', 'Inactive', 'Archived'];
    }
    if (from === 'inactive') {
        return ['Inactive', 'Draft', 'Ready', 'Published'];
    }
    if (from === 'archived') {
        return ['Archived', 'Published'];
    }
    return VARIANT_STATUS_OPTIONS.map(o => o.value);
}

function isStatusTransitionAllowed(fromStatus, toStatus) {
    return allowedTargetStatuses(fromStatus).includes(toStatus);
}

function statusChangeNeedsConfirm(fromStatus, toStatus) {
    const from = (fromStatus || '').toLowerCase();
    const to = (toStatus || '').toLowerCase();
    if (from === to) {
        return false;
    }
    return to === 'published' || to === 'archived' || (from === 'published' && to === 'inactive');
}

function buildStatusConfirmCopy(fromStatus, toStatus, variantName) {
    const to = (toStatus || '').toLowerCase();
    const label = variantName || 'this variant';
    if (to === 'published') {
        return {
            title: 'Publish message variant?',
            message:
                `"${label}" will become available to the NBA engine content selection ` +
                'and may be sent to customers. Do you want to continue?',
        };
    }
    if (to === 'archived') {
        return {
            title: 'Archive message variant?',
            message:
                `"${label}" will no longer be available to active campaigns that use it ` +
                'and will not be selected for customer activation. Do you want to continue?',
        };
    }
    if (to === 'inactive') {
        return {
            title: 'Inactivate message variant?',
            message:
                `"${label}" will be temporarily removed from live activation while you ` +
                'change templates or copy. You can validate and publish again when ready.',
        };
    }
    return { title: 'Change status?', message: 'Do you want to continue?' };
}

function variantStatusOptionsFor(fromStatus) {
    const allowed = new Set(allowedTargetStatuses(fromStatus));
    return VARIANT_STATUS_OPTIONS.filter(o => allowed.has(o.value));
}

const STATUS_FILTERS = [
    { value: 'All',       label: 'All' },
    { value: 'Draft',     label: 'Draft' },
    { value: 'Ready',     label: 'Ready' },
    { value: 'Published', label: 'Published' },
    { value: 'Inactive',  label: 'Inactive' },
    { value: 'Archived',  label: 'Archived' },
];

// ── helpers ────────────────────────────────────────────────────────────────

function resolveIcon(channel) {
    if (channel.Channel_Icon__c && channel.Channel_Icon__c.includes(':')) {
        return channel.Channel_Icon__c;
    }
    const key = (channel.Channel_Type__c || '').toLowerCase().replace(/[\s-]/g, '_');
    for (const [pattern, icon] of Object.entries(ICON_MAP)) {
        if (key.includes(pattern)) return icon;
    }
    return FALLBACK_ICON;
}

function fmtDate(dtStr) {
    if (!dtStr) return null;
    const d = new Date(dtStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(dtStr) {
    if (!dtStr) return null;
    const d = new Date(dtStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
           ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function statusBadgeClass(status) {
    return STATUS_BADGE_CLASS[(status || '').toLowerCase()] || 'slds-badge slds-theme_lightest';
}

function statusPickerClass(status) {
    const key = (status || 'draft').toLowerCase();
    const allowed = ['draft', 'ready', 'published', 'inactive', 'archived'];
    const suffix = allowed.includes(key) ? key : 'draft';
    return `cockpit-status-picker cockpit-status-picker--${suffix}`;
}

function buildMasterStatusSummary(variants) {
    const inactiveCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'inactive').length;
    if (inactiveCount > 0 && inactiveCount === variants.length) {
        return {
            masterStatusSummary: inactiveCount === 1 ? '1 Inactive' : `${inactiveCount} Inactive`,
            masterStatusSummaryClass: 'slds-badge slds-theme_warning',
        };
    }
    const publishedCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'published').length;
    if (publishedCount > 0) {
        return {
            masterStatusSummary: publishedCount === 1 ? '1 Published' : `${publishedCount} Published`,
            masterStatusSummaryClass: 'slds-badge slds-theme_success',
        };
    }
    const readyCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'ready').length;
    if (readyCount > 0) {
        return {
            masterStatusSummary: readyCount === 1 ? '1 Ready' : `${readyCount} Ready`,
            masterStatusSummaryClass: 'slds-badge slds-theme_info',
        };
    }
    const archivedCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'archived').length;
    if (archivedCount === variants.length && archivedCount > 0) {
        return {
            masterStatusSummary: archivedCount === 1 ? '1 Archived' : `${archivedCount} Archived`,
            masterStatusSummaryClass: 'slds-badge slds-theme_shade',
        };
    }
    const draftCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'draft').length;
    const count = draftCount || variants.length;
    return {
        masterStatusSummary: count === 1 ? '1 Draft' : `${count} Draft`,
        masterStatusSummaryClass: 'slds-badge slds-theme_lightest',
    };
}

function weightPercentFromRecord(prob, probManual) {
    const val = probManual != null ? probManual : prob;
    if (val == null) return null;
    const pct = Number(val) * 100;
    return Math.round(pct);
}

/** Whole number 0–100 for inline weight editor (empty string allowed while typing). */
function sanitizeWeightInput(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits === '') return '';
    let n = parseInt(digits, 10);
    if (Number.isNaN(n)) return '';
    if (n > 100) n = 100;
    if (n < 0) n = 0;
    return String(n);
}

function parseCommittedWeight(raw) {
    const sanitized = sanitizeWeightInput(raw);
    if (sanitized === '') return null;
    return parseInt(sanitized, 10);
}

function buildScheduleBadge(record) {
    const action   = (record.Scheduled_Action__c || '').toLowerCase();
    const status   = (record.Scheduled_Status__c || '').toLowerCase();
    const toStatus = (record.Scheduled_To_Status__c || '').toLowerCase();

    if (!action || status === 'executed' || status === 'cancelled') return null;

    const at = fmtDate(record.Scheduled_At__c) || '?';
    if (action === 'publish' || toStatus === 'published') {
        return {
            label:     'Scheduled: Activate',
            tone:      'activate',
            iconClass: 'cockpit-schedule-icon cockpit-schedule-icon_activate',
            icon:      'utility:clock',
            title:     `Scheduled to activate on ${at}`,
        };
    }
    if (action === 'deactivate' || toStatus === 'archived') {
        return {
            label:     'Scheduled: Deactivate',
            tone:      'deactivate',
            iconClass: 'cockpit-schedule-icon cockpit-schedule-icon_deactivate',
            icon:      'utility:ban',
            title:     `Scheduled to deactivate on ${at}`,
        };
    }
    return {
        label:     `Scheduled: ${record.Scheduled_Action__c}`,
        tone:      'update',
        iconClass: 'cockpit-schedule-icon cockpit-schedule-icon_update',
        icon:      'utility:clock',
        title:     `${record.Scheduled_Action__c} — ${at}`,
    };
}

function buildVariantQuickActions(v, isSyncingMCE = false) {
    const isPublished = (v.Status__c || '').toLowerCase() === 'published';
    const items = [
        { key: 'edit', title: 'Edit', icon: 'utility:edit' },
        { key: 'clone', title: 'Clone as new Variant', icon: 'utility:copy' },
        { key: 'clone-message', title: 'Clone as new Message', icon: 'utility:copy' },
        {
            key: 'sync',
            title: 'Sync with MCE',
            icon: 'utility:sync',
            isDisabled: isSyncingMCE || !v.canSyncFromMCE,
        },
        isPublished
            ? { key: 'schedule-unpublish', title: 'Schedule Unpublishing', icon: 'utility:date_input' }
            : { key: 'schedule-publish', title: 'Schedule Publication', icon: 'utility:date_input' },
        {
            key: 'delete',
            title: 'Delete',
            icon: 'utility:delete',
            isDestructive: true,
            prefixDivider: true,
        },
    ];
    const variantQuickActionMenuItems = items.map(a => ({
        ...a,
        menuValue: `${a.key}:${v.Id}`,
        menuValueDividerKey: `${a.key}:${v.Id}:divider`,
        isDisabled: !!a.isDisabled,
        menuItemClass: a.isDestructive ? 'cockpit-menu-item_destructive' : '',
        menuItemVariant: a.isDestructive ? 'destructive' : '',
    }));
    return { variantQuickActionMenuItems };
}

function buildGroups(
    records,
    expandedSet,
    editingGroupName,
    selectedIds,
    versionCounts,
    editingWeightId,
    isSyncingMCE = false,
    quickActionMenuOpenId = null,
    syncingVariantIds = null
) {
    const map = new Map();
    for (const r of records) {
        const key = masterGroupKey(r);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
    }

    return Array.from(map.entries()).map(([stem, variants]) => {
        // Stable order by variant number
        variants = [...variants].sort((a, b) => variantNumberFromRecord(a) - variantNumberFromRecord(b));

        const parsed = parseFullName(variants[0]?.MessageName__c || variants[0]?.Name || stem);
        const totalVariants  = variants.length;
        const publishedCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'published').length;
        const hasPublished   = publishedCount > 0;
        const hasReady       = variants.some(v => (v.Status__c || '').toLowerCase() === 'ready');
        const hasDraft       = variants.some(v => (v.Status__c || '').toLowerCase() === 'draft');
        const hasArchived    = variants.some(v => (v.Status__c || '').toLowerCase() === 'archived');
        const hasInactive    = variants.some(v => (v.Status__c || '').toLowerCase() === 'inactive');
        const isExpanded     = expandedSet.has(stem);
        const isEditing      = editingGroupName === stem;

        const enrichedVariants = variants.map(v => {
            const sched = buildScheduleBadge(v);
            const isSelected = selectedIds.has(v.Id);
            const modBy = v.MCE_Last_Modified_By__c || v.LastModifiedBy__c || null;
            const variantNum = variantNumberFromRecord(v);
            const weightPercent = weightPercentFromRecord(v.Display_Probability__c, v.Display_Probability_Manual__c);
            const mceVariantKey = v.MessageVariantId__c || v.Message_Variant_Id__c || null;
            return {
                ...v,
                statusClass:        statusBadgeClass(v.Status__c),
                statusPickerClass:  statusPickerClass(v.Status__c),
                statusAriaLabel:    `Status for ${v.Name || 'variant'}`,
                variantStatusOptions: variantStatusOptionsFor(v.Status__c),
                validFromFmt:       fmtDate(v.Valid_From__c),
                validToFmt:         fmtDate(v.Valid_To__c),
                campaignName:       v.Campaign__r?.Name || null,
                variantBadgeLabel:  variantNum > 0 ? String(variantNum) : '—',
                weightPercent,
                weightDisplayText:  weightPercent != null ? String(weightPercent) : '—',
                weightIsEditing:    editingWeightId === v.Id,
                weightAriaLabel:    `Weight (0–100) for ${v.Name || 'variant'}`,
                mceVariantKey,
                canSyncFromMCE:     !!mceVariantKey,
                hasSchedule:        !!sched,
                scheduleBadgeIcon:  sched?.icon || 'utility:clock',
                scheduleIconClass:  sched?.iconClass || '',
                scheduleBadgeTitle: sched?.title || sched?.label || '',
                variantBadgeTitle:  variantNum > 0
                    ? `Variant ${variantNum}${v.Block_Count__c ? ` · ${v.Block_Count__c} block(s)` : ''}`
                    : 'Variant',
                ...buildVariantQuickActions({
                    Id: v.Id,
                    Status__c: v.Status__c,
                    canSyncFromMCE: !!mceVariantKey,
                }, isSyncingMCE),
                versionCount:       versionCounts?.[v.Id] || null,
                lastModifiedFmt:    fmtDateTime(v.MCE_Updated_At__c || v.LastModifiedDate),
                lastModifiedBy:     modBy,
                isSelected,
                checkboxLabel:      `Select ${v.Name || 'variant'}`,
                isVariantSyncing:   !!(syncingVariantIds && syncingVariantIds[v.Id]),
                variantRowClass:    `cockpit-variant-row${isSelected ? ' cockpit-variant-row_selected' : ''}${
                    quickActionMenuOpenId === v.Id ? ' cockpit-variant-row_menu-open' : ''
                }`,
                sourceTemplateBadge: v.Source_Template__r?.Name || null,
                canChangeSourceTemplate: (v.Status__c || '').toLowerCase() !== 'published',
                sourceTemplateButtonDisabled: (v.Status__c || '').toLowerCase() === 'published',
                sourceTemplateButtonTitle:
                    (v.Status__c || '').toLowerCase() === 'published'
                        ? 'Published variants must be set to Inactive before changing the source template'
                        : 'Change Source Template',
            };
        });

        const allSelected = enrichedVariants.length > 0 && enrichedVariants.every(v => selectedIds.has(v.Id));
        const language = parsed.language || variants[0]?.Language__c || null;
        const displayName = stem;
        const masterStatus = buildMasterStatusSummary(variants);

        return {
            messageName:          stem,
            displayName,
            channelPrefix:        parsed.prefix || '',
            countryCode:          parsed.countryCode || '',
            locale:               parsed.locale || '',
            messageNamePart:      parsed.messageName || '',
            totalVariants,
            publishedCount,
            variantPlural:        totalVariants !== 1 ? 's' : '',
            hasPublished,
            hasReady,
            hasDraft,
            hasArchived,
            hasInactive,
            isExpanded,
            isEditing,
            expandedStr:          isExpanded ? 'true' : 'false',
            chevronIcon:          isExpanded ? 'utility:chevrondown' : 'utility:chevronright',
            expandToggleTitle:    isExpanded ? 'Collapse' : 'Expand',
            masterRowClass:       `cockpit-master-row${isExpanded ? ' cockpit-master-row_expanded' : ''}`,
            language,
            allSelected,
            masterCheckboxLabel:  `Select all variants of ${displayName}`,
            masterStatusSummary:      masterStatus.masterStatusSummary,
            masterStatusSummaryClass: masterStatus.masterStatusSummaryClass,
            variants:             enrichedVariants,
        };
    });
}

// ── component ──────────────────────────────────────────────────────────────

export default class CopyCockpit extends NavigationMixin(LightningElement) {

    @track _activeChannelId = null;
    @track _searchTerm = '';
    @track _statusFilter = 'All';
    @track _messages = [];
    @track _isMessagesLoading = false;
    @track _expandedGroups = new Set();
    @track _allExpanded = false;
    @track _selectedIds = new Set();
    @track _versionCounts = {};

    @track isAddModalOpen = false;
    @track _addChannelName = '';
    @track _addChannelType = '';
    @track _addBannerTypes = [];

    @track isDeleteModalOpen = false;
    @track deleteTargetId = null;
    @track deleteTargetName = '';
    @track deleteTargetVersion = null;
    @track deleteTargetVariantLabel = '';

    @track isMasterDeleteModalOpen = false;
    @track masterDeleteStem = '';
    @track masterDeleteDisplayName = '';
    @track masterDeleteVariantCount = 0;
    @track isMasterDeleteSaving = false;

    /** Pending status change when confirmation modal is open. */
    @track _statusConfirmModal = null;

    @track isBulkDeleteModalOpen = false;
    @track isBulkDeleteSaving = false;
    @track isVariantDeleteSaving = false;

    @track _columnWidths = { ...COLUMN_WIDTH_DEFAULTS };

    @track isCloneModalOpen = false;
    @track isCloneMessageModalOpen = false;
    @track cloneMessageNamePart = '';
    @track isCloning = false;
    cloneSourceId = null;
    cloneMasterStem = '';
    @track cloneSourceName = '';
    @track cloneProposedVersion = null;

    @track _editingGroupName = null;
    @track _editingCountryCode = '';
    @track _editingMessageNamePart = '';
    @track _editingLanguage = 'PL';
    @track _editingChannelPrefix = '';
    @track _renameError = '';

    @track _masterEditModal = null;
    @track _sourceTemplateModal = null;
    @track _templateReplaceConfirm = null;

    @track _editingWeightId = null;
    @track _weightEditValue = '';
    _focusWeightInput = false;

    @track _editorRecordId = null;
    @track _editorOpenScheduleIntent = null;
    @track _quickActionMenuOpenId = null;
    /** Record ids currently syncing from MCE (per-row spinners). */
    @track _syncingVariantIds = {};

    get isEditorOpen() { return !!this._editorRecordId; }
    get editorOpenScheduleIntent() { return this._editorOpenScheduleIntent; }

    _firstChannelSeeded = false;
    _pageRefSeeded = false;
    _channelsRefreshPending = true;

    connectedCallback() {
        if (this._wiredChannels) {
            refreshApex(this._wiredChannels);
        }
    }

    @wire(CurrentPageReference)
    _onPageRef(ref) {
        const id = ref?.state?.c__editId;
        const schedule = ref?.state?.c__schedule;
        if (id && !this._pageRefSeeded) {
            this._pageRefSeeded = true;
            this._editorRecordId = id;
            this._editorOpenScheduleIntent = schedule || null;
        }
    }

    @wire(getChannelRecords)
    _wiredChannels;

    @wire(getSelectableTemplates, { channelName: '$activeChannelName', channelType: '$activeChannelType' })
    _wiredSelectableTemplates;

    // ── channel state ──────────────────────────────────────────────────────

    get isLoading() {
        return !this._wiredChannels.data && !this._wiredChannels.error;
    }

    get hasError() {
        return !!this._wiredChannels.error;
    }

    get errorMessage() {
        return this._wiredChannels.error?.body?.message || 'Failed to load channels.';
    }

    get isEmpty() {
        return !this.isLoading && !this.hasError && this._visibleDictionaryChannels.length === 0;
    }

    get _visibleDictionaryChannels() {
        return getVisibleChannelRecords(this._wiredChannels.data);
    }

    get channels() {
        const list = this._visibleDictionaryChannels;
        if (!list.length) return [];
        const activeId = this._activeChannelId || list[0]?.Id;
        return list.map(ch => ({
            ...ch,
            displayName: getChannelDisplayName(ch),
            commBadges: getCommunicationBadges(ch),
            safeIcon: resolveIcon(ch),
            sidebarClass: `ch-sidebar__item${ch.Id === activeId ? ' ch-sidebar__item_active' : ''}`,
        }));
    }

    get activeChannel() {
        const list = this._visibleDictionaryChannels;
        if (!list.length) return null;
        const id = this._activeChannelId || list[0]?.Id;
        const found = list.find(ch => ch.Id === id) || list[0];
        if (!found) return null;
        return {
            ...found,
            displayName: getChannelDisplayName(found),
            commBadges: getCommunicationBadges(found),
            safeIcon: resolveIcon(found)
        };
    }

    get activeChannelName() {
        return this.activeChannel?.Name || '';
    }

    get activeChannelType() {
        return this.activeChannel?.Channel_Type__c || '';
    }

    get selectableTemplateOptions() {
        return (this._wiredSelectableTemplates?.data || []).map(template => ({
            value: template.id,
            label: template.packageLabel ? `${template.name} (${template.packageLabel})` : template.name
        }));
    }

    get selectableTemplatesLoading() {
        return !this._wiredSelectableTemplates?.data && !this._wiredSelectableTemplates?.error;
    }

    get addChannelName() { return this._addChannelName; }
    get addChannelType() { return this._addChannelType; }
    get addBannerTypes() { return this._addBannerTypes; }

    // ── messages & groups ──────────────────────────────────────────────────

    get isMessagesLoading() { return this._isMessagesLoading; }

    get isMessagesEmpty() {
        return !this._isMessagesLoading && this._messages.length === 0;
    }

    get searchTerm() { return this._searchTerm; }

    get isStatusConfirmOpen() {
        return !!this._statusConfirmModal;
    }

    get statusConfirmTitle() {
        return this._statusConfirmModal?.title || 'Change status?';
    }

    get statusConfirmMessage() {
        return this._statusConfirmModal?.message || '';
    }

    get statusConfirmProceedLabel() {
        return this._statusConfirmModal?.proceedLabel || 'Confirm';
    }

    get statusFilterOptions() {
        return STATUS_FILTERS;
    }

    get allGroups() {
        return buildGroups(
            this._messages,
            this._expandedGroups,
            this._editingGroupName,
            this._selectedIds,
            this._versionCounts,
            this._editingWeightId,
            this.isSyncingMCE,
            this._quickActionMenuOpenId,
            this._syncingVariantIds,
        );
    }

    get weightEditValue() {
        return this._weightEditValue;
    }

    get editingCountryCode() { return this._editingCountryCode; }
    get editingMessageNamePart() { return this._editingMessageNamePart; }
    get editingLanguage() { return this._editingLanguage; }
    get editingChannelPrefix() { return this._editingChannelPrefix; }
    get renameError() { return this._renameError; }
    get isRenameOpen() { return !!this._editingGroupName; }
    get renamePreview() {
        if (!this._editingGroupName) return '';
        const stem = composeStem(
            this._editingChannelPrefix,
            this._editingCountryCode,
            this._editingLanguage,
            this._editingMessageNamePart
        );
        return stem ? `${stem}_<Variant>` : '—';
    }
    get renameLanguageOptions() {
        return [
            { label: 'PL', value: 'PL' },
            { label: 'EN', value: 'EN' },
            { label: 'ES', value: 'ES' },
        ];
    }

    get filteredGroups() {
        let groups = this.allGroups;

        if (this._statusFilter !== 'All') {
            const f = this._statusFilter.toLowerCase();
            groups = groups.filter(g => {
                if (f === 'published') return g.hasPublished;
                if (f === 'ready')     return g.hasReady;
                if (f === 'draft')     return g.hasDraft;
                if (f === 'archived')  return g.hasArchived;
                if (f === 'inactive')  return g.hasInactive;
                return true;
            });
        }

        if (this._searchTerm) {
            const term = this._searchTerm.toLowerCase();
            groups = groups.filter(g =>
                (g.messageName || '').toLowerCase().includes(term) ||
                (g.messageNamePart || '').toLowerCase().includes(term) ||
                (g.countryCode || '').toLowerCase().includes(term) ||
                (g.locale || '').toLowerCase().includes(term) ||
                g.variants.some(v =>
                    (v.Subject__c || '').toLowerCase().includes(term) ||
                    (v.Name || '').toLowerCase().includes(term)
                )
            );
        }

        return groups;
    }

    get hasGroups() {
        return !this._isMessagesLoading && this.filteredGroups.length > 0;
    }

    get messageGroupCountLabel() {
        const total = this.allGroups.length;
        const shown = this.filteredGroups.length;
        if (this._searchTerm || this._statusFilter !== 'All') {
            return `${shown} of ${total} message${total !== 1 ? 's' : ''}`;
        }
        return `${total} message${total !== 1 ? 's' : ''}`;
    }

    get cloneProposedName() {
        const stem = this.cloneMasterStem || masterGroupKey({ Name: this.cloneSourceName });
        const v = this.cloneProposedVersion;
        return stem && v != null ? `${stem}_${v}` : (this.cloneSourceName || '');
    }

    get cloneMessageProposedName() {
        const row = this._messageRecordById(this.cloneSourceId);
        if (!row) return '';
        const parsed = parseFullName(row.Name);
        const stem = composeStem(
            parsed.prefix,
            parsed.countryCode,
            parsed.language,
            this.cloneMessageNamePart
        );
        return stem ? `${stem}_1` : '';
    }

    get expandAllLabel() { return this._allExpanded ? 'Collapse all' : 'Expand all'; }
    get expandAllIcon()  { return this._allExpanded ? 'utility:collapse_all' : 'utility:expand_all'; }

    // ── master edit modal ──────────────────────────────────────────────────

    get isMasterEditOpen()        { return !!this._masterEditModal; }
    get masterEditModal()         { return this._masterEditModal; }
    get masterEditFamilyOptions() { return this._masterEditModal?.families || []; }
    get masterEditOfferOptions()  { return this._masterEditModal?.offers  || []; }
    get masterEditNoOffers() {
        const m = this._masterEditModal;
        return m?.productFamilyId && !m?.isLoadingOffers && (!m?.offers || m.offers.length === 0);
    }

    get isSourceTemplateModalOpen() {
        return !!this._sourceTemplateModal;
    }

    get sourceTemplateModal() {
        return this._sourceTemplateModal || {};
    }

    get isTemplateReplaceConfirmOpen() {
        return !!this._templateReplaceConfirm;
    }

    get templateReplaceConfirmMessage() {
        const names = this._templateReplaceConfirm?.messageNames || [];
        const list = names.length ? names.join(', ') : 'selected messages';
        return (
            `Are you sure you want to change source templates for these messages: ${list}? ` +
            'If message copy data is missing data expected by the template, messages might not ' +
            'be rendered correctly or fail to send at all.'
        );
    }

    // ── selection ──────────────────────────────────────────────────────────

    get hasSelection() { return this._selectedIds.size > 0; }

    get selectionCountLabel() {
        const n = this._selectedIds.size;
        return `${n} variant${n !== 1 ? 's' : ''} selected`;
    }

    get allVisibleVariantIds() {
        const ids = [];
        (this.filteredGroups || []).forEach(group => {
            (group.variants || []).forEach(variant => {
                if (variant.Id) {
                    ids.push(variant.Id);
                }
            });
        });
        return ids;
    }

    get allVisibleVariantsSelected() {
        const ids = this.allVisibleVariantIds;
        return ids.length > 0 && ids.every(id => this._selectedIds.has(id));
    }

    get someVisibleVariantsSelected() {
        const ids = this.allVisibleVariantIds;
        if (!ids.length) {
            return false;
        }
        const selectedCount = ids.filter(id => this._selectedIds.has(id)).length;
        return selectedCount > 0 && selectedCount < ids.length;
    }

    get selectAllVisibleLabel() {
        const masterCount = this.filteredGroups.length;
        const variantCount = this.allVisibleVariantIds.length;
        if (!variantCount) {
            return 'Select all messages';
        }
        return `Select all ${masterCount} message${masterCount !== 1 ? 's' : ''} and ${variantCount} variant${variantCount !== 1 ? 's' : ''} shown`;
    }

    get columnWidthStyle() {
        const w = this._columnWidths || COLUMN_WIDTH_DEFAULTS;
        return [
            `--col-name: ${w.name}px`,
            `--col-status: ${w.status}px`,
            `--col-weight: ${w.weight}px`,
            `--col-versions: ${w.versions}px`,
            `--col-modified: ${w.modified}px`,
        ].join('; ');
    }

    get fitColumnsLabel() {
        return 'Fit columns';
    }

    handleAutoFitColumns(event) {
        event?.stopPropagation?.();
        this._fitColumnsToAvailableSpace();
    }

    _estimateNameColumnWidthPx() {
        let maxChars = 'Message / Variant'.length;
        (this.filteredGroups || []).forEach(group => {
            const master = group.displayName || group.messageName || '';
            maxChars = Math.max(maxChars, master.length + 4);
            (group.variants || []).forEach(variant => {
                const variantLabel = variant.variantBadgeLabel || '';
                const badgeLen = variant.sourceTemplateBadge ? variant.sourceTemplateBadge.length + 2 : 0;
                maxChars = Math.max(maxChars, variantLabel.length + badgeLen + 6);
            });
        });
        return Math.min(380, Math.max(COLUMN_FIT_MIN.name, Math.round(maxChars * 6.5 + 28)));
    }

    _fitColumnsToAvailableSpace() {
        const list = this.template.querySelector('.cockpit-list');
        if (!list) {
            return;
        }
        const containerWidth = list.clientWidth;
        if (!containerWidth || containerWidth < 480) {
            this._columnWidths = { ...COLUMN_WIDTH_DEFAULTS };
            return;
        }

        const available =
            containerWidth - COL_CHECK_PX - COL_ACTIONS_PX - 20;
        const weightTotal = Object.values(COLUMN_FIT_WEIGHTS).reduce((sum, w) => sum + w, 0);
        const next = {};
        Object.keys(COLUMN_FIT_WEIGHTS).forEach(key => {
            next[key] = Math.max(
                COLUMN_FIT_MIN[key],
                Math.round((available * COLUMN_FIT_WEIGHTS[key]) / weightTotal)
            );
        });

        const nameNeed = this._estimateNameColumnWidthPx();
        if (next.name < nameNeed) {
            const deficit = nameNeed - next.name;
            const donors = ['modified', 'status', 'versions', 'weight'];
            let remaining = deficit;
            for (const donor of donors) {
                if (remaining <= 0) {
                    break;
                }
                const slack = next[donor] - COLUMN_FIT_MIN[donor];
                if (slack <= 0) {
                    continue;
                }
                const take = Math.min(slack, remaining);
                next[donor] -= take;
                remaining -= take;
            }
            next.name = nameNeed;
        }

        let assigned = Object.values(next).reduce((sum, px) => sum + px, 0);
        if (assigned > available) {
            const scale = available / assigned;
            Object.keys(next).forEach(key => {
                next[key] = Math.max(COLUMN_FIT_MIN[key], Math.floor(next[key] * scale));
            });
            assigned = Object.values(next).reduce((sum, px) => sum + px, 0);
        }

        if (assigned < available) {
            next.name += available - assigned;
        }

        this._columnWidths = next;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    renderedCallback() {
        if (this._channelsRefreshPending && this._wiredChannels) {
            this._channelsRefreshPending = false;
            refreshApex(this._wiredChannels);
        }
        const visible = this._visibleDictionaryChannels;
        if (visible.length > 0) {
            const activeStillVisible = visible.some(ch => ch.Id === this._activeChannelId);
            if (!this._activeChannelId || !activeStillVisible) {
                this._activeChannelId = visible[0].Id;
                this._loadMessages(visible[0].Name, visible[0].Channel_Type__c);
                this._firstChannelSeeded = true;
            } else if (!this._firstChannelSeeded) {
                this._firstChannelSeeded = true;
                const active = visible.find(ch => ch.Id === this._activeChannelId) || visible[0];
                this._loadMessages(active.Name, active.Channel_Type__c);
            }
        }
        if (this._focusWeightInput && this._editingWeightId) {
            this._focusWeightInput = false;
            const input = this.template.querySelector(
                `input.cockpit-weight-input-native[data-id="${this._editingWeightId}"]`
            );
            if (input) {
                input.focus();
                input.select();
            }
        }
        const selectAllCheckbox = this.template.querySelector('[data-select-all-variants]');
        if (selectAllCheckbox) {
            selectAllCheckbox.indeterminate = this.someVisibleVariantsSelected;
        }
        if (this.hasGroups && !this._isMessagesLoading) {
            this._scheduleColumnFit();
        }
    }

    _scheduleColumnFit() {
        if (this._columnFitScheduled) {
            return;
        }
        this._columnFitScheduled = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => {
                this._columnFitScheduled = false;
                this._fitColumnsToAvailableSpace();
            });
        });
    }

    // ── handlers: channel ──────────────────────────────────────────────────

    handleSelectChannel(e) {
        const id = e.currentTarget.dataset.id;
        if (id === this._activeChannelId) return;
        this._activeChannelId = id;
        this._searchTerm = '';
        this._statusFilter = 'All';
        this._expandedGroups = new Set();
        this._allExpanded = false;
        this._columnWidths = { ...COLUMN_WIDTH_DEFAULTS };
        this._selectedIds = new Set();
        this._cancelWeightEdit();
        const ch = this._visibleDictionaryChannels.find(c => c.Id === id);
        if (ch) {
            this._loadMessages(ch.Name, ch.Channel_Type__c);
        }
    }

    // ── handlers: filter / expand ─────────────────────────────────────────

    handleSearch(e) {
        this._searchTerm = e.target.value;
    }

    handleStatusFilterChange(e) {
        this._statusFilter = e.detail.value;
    }

    handleWeightDisplayClick(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (!recordId) return;
        const prior = this._messages.find(m => m.Id === recordId);
        const pct = prior
            ? weightPercentFromRecord(prior.Display_Probability__c, prior.Display_Probability_Manual__c)
            : null;
        this._editingWeightId = recordId;
        this._weightEditValue = pct != null ? String(pct) : '';
        this._focusWeightInput = true;
    }

    handleWeightEditInput(event) {
        event.stopPropagation();
        this._weightEditValue = sanitizeWeightInput(event.target.value);
        event.target.value = this._weightEditValue;
    }

    handleWeightEditKeydown(event) {
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this._cancelWeightEdit();
        }
    }

    handleWeightEditBlur(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (!recordId || recordId !== this._editingWeightId) {
            return;
        }
        const weightPercent = parseCommittedWeight(event.target.value);
        this._editingWeightId = null;
        this._weightEditValue = '';
        if (weightPercent == null) {
            return;
        }
        this._persistVariantWeight(recordId, weightPercent);
    }

    _cancelWeightEdit() {
        this._editingWeightId = null;
        this._weightEditValue = '';
        this._focusWeightInput = false;
    }

    _persistVariantWeight(recordId, weightPercent) {
        const clamped = Math.min(100, Math.max(0, weightPercent));
        const prior = this._messages.find(m => m.Id === recordId);
        const priorPct = prior
            ? weightPercentFromRecord(prior.Display_Probability__c, prior.Display_Probability_Manual__c)
            : null;
        if (priorPct === clamped) {
            return;
        }

        saveVariantDisplayWeight({ recordId, weightPercent: clamped })
            .then(() => {
                this._setMessageWeight(recordId, clamped / 100);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Could not save weight.', 'error');
                if (prior) {
                    this._messages = this._messages.map(m => (m.Id === recordId ? { ...prior } : m));
                }
            });
    }

    handleStatusPickerClick(event) {
        event.stopPropagation();
    }

    handleVariantStatusChange(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id
            || event.target?.dataset?.id
            || event.target?.closest?.('[data-id]')?.dataset?.id;
        const newStatus = event.detail.value;
        if (!recordId || !newStatus) {
            return;
        }
        const prior = this._messages.find(m => m.Id === recordId);
        if (!prior || prior.Status__c === newStatus) {
            return;
        }
        const previousStatus = prior.Status__c;

        if (!isStatusTransitionAllowed(previousStatus, newStatus)) {
            this._setMessageStatus(recordId, previousStatus);
            this._showToast(
                'Status change not allowed',
                this._statusTransitionHint(previousStatus),
                'warning'
            );
            return;
        }

        if (statusChangeNeedsConfirm(previousStatus, newStatus)) {
            const copy = buildStatusConfirmCopy(previousStatus, newStatus, prior.Name);
            this._setMessageStatus(recordId, previousStatus);
            this._statusConfirmModal = {
                recordId,
                previousStatus,
                newStatus,
                title: copy.title,
                message: copy.message,
                proceedLabel: newStatus === 'Published' ? 'Publish' : 'Archive',
            };
            return;
        }

        this._applyStatusChange(recordId, previousStatus, newStatus);
    }

    handleStatusConfirmCancel() {
        this._statusConfirmModal = null;
    }

    handleStatusConfirmProceed() {
        const pending = this._statusConfirmModal;
        if (!pending) {
            return;
        }
        this._statusConfirmModal = null;
        this._applyStatusChange(pending.recordId, pending.previousStatus, pending.newStatus);
    }

    _statusTransitionHint(fromStatus) {
        const from = (fromStatus || '').toLowerCase();
        if (from === 'published') {
            return 'Published messages can only be moved to Inactive or Archived.';
        }
        if (from === 'archived') {
            return 'Archived messages can only be restored to Published.';
        }
        return 'That status change is not allowed for this variant.';
    }

    _setMessageWeight(recordId, manualOrComputedDecimal) {
        this._messages = this._messages.map(m => {
            if (m.Id !== recordId) return m;
            return {
                ...m,
                Display_Probability_Manual__c: manualOrComputedDecimal,
            };
        });
    }

    _setMessageStatus(recordId, status) {
        this._messages = this._messages.map(m =>
            m.Id === recordId ? { ...m, Status__c: status } : m
        );
    }

    _applyStatusChange(recordId, previousStatus, newStatus) {
        this._setMessageStatus(recordId, newStatus);
        updateMessageStatus({ recordId, status: newStatus })
            .catch(err => {
                this._setMessageStatus(recordId, previousStatus);
                this._showToast(
                    'Status update failed',
                    err?.body?.message || 'Could not update variant status.',
                    'error'
                );
            });
    }

    handleToggleGroup(e) {
        const name = e.currentTarget.dataset.name;
        const next = new Set(this._expandedGroups);
        if (next.has(name)) {
            next.delete(name);
        } else {
            next.add(name);
        }
        this._expandedGroups = next;
        this._allExpanded = next.size === this.allGroups.length;
    }

    handleMasterRowKeydown(e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            this.handleToggleGroup(e);
        }
    }

    handleToggleAll() {
        if (this._allExpanded) {
            this._expandedGroups = new Set();
            this._allExpanded = false;
        } else {
            this._expandedGroups = new Set(this.allGroups.map(g => g.messageName));
            this._allExpanded = true;
        }
    }

    // ── handlers: selection ───────────────────────────────────────────────

    handleCheckboxClick(e) {
        e.stopPropagation();
    }

    handleMasterCheckboxClick(e) {
        e.stopPropagation();
    }

    handleSelectAllCheckboxClick(e) {
        e.stopPropagation();
    }

    handleSelectAllVisible(e) {
        e.stopPropagation();
        const ids = this.allVisibleVariantIds;
        const next = new Set(this._selectedIds);
        if (e.target.checked) {
            ids.forEach(id => next.add(id));
        } else {
            ids.forEach(id => next.delete(id));
        }
        this._selectedIds = next;
    }

    handleGroupSelect(e) {
        e.stopPropagation();
        const stem = e.target.dataset.name;
        const checked = e.target.checked;
        const groupIds = this._messages
            .filter(m => recordBelongsToMasterGroup(m, stem))
            .map(m => m.Id);
        const next = new Set(this._selectedIds);
        if (checked) {
            groupIds.forEach(id => next.add(id));
        } else {
            groupIds.forEach(id => next.delete(id));
        }
        this._selectedIds = next;
    }

    handleVariantSelect(e) {
        e.stopPropagation();
        const id = e.target.dataset.id;
        const next = new Set(this._selectedIds);
        if (e.target.checked) {
            next.add(id);
        } else {
            next.delete(id);
        }
        this._selectedIds = next;
    }

    handleClearSelection() {
        this._selectedIds = new Set();
    }

    // ── handlers: bulk actions ────────────────────────────────────────────

    handleBulkPublish() {
        this._showToast('Coming soon', 'Bulk publish will be wired to MCE API.', 'info');
    }

    handleBulkArchive() {
        this._showToast('Coming soon', 'Bulk archive will be wired to MCE API.', 'info');
    }

    handleBulkDeletePrompt() {
        this.isBulkDeleteModalOpen = true;
    }

    handleBulkDeleteCancel() {
        this.isBulkDeleteModalOpen = false;
    }

    handleBulkSyncMCE() {
        const ids = Array.from(this._selectedIds);
        if (!ids.length) {
            this._showToast('Sync with MCE', 'Select at least one variant to sync.', 'warning');
            return;
        }
        this._executeMceVariantSync(ids);
    }

    _messageRecordById(recordId) {
        return this._messages.find(m => m.Id === recordId) || null;
    }

    _messageVariantLabel(record) {
        if (!record) {
            return 'Unknown message';
        }
        const name = record.MessageName__c || record.Name || 'Message';
        const variantNum = variantNumberFromRecord(record);
        if (variantNum > 0) {
            return `${name} (#${variantNum})`;
        }
        return name;
    }

    _splitEligibleForTemplateChange(variantIds) {
        const eligible = [];
        const publishedLabels = [];
        (variantIds || []).forEach(id => {
            const row = this._messageRecordById(id);
            if ((row?.Status__c || '').toLowerCase() === 'published') {
                publishedLabels.push(this._messageVariantLabel(row));
            } else if (id) {
                eligible.push(id);
            }
        });
        return { eligible, publishedLabels };
    }

    _toastPublishedTemplateBlock(publishedLabels) {
        const sample = publishedLabels.slice(0, 3).join(', ');
        const suffix = publishedLabels.length > 3 ? ` (+${publishedLabels.length - 3} more)` : '';
        this._showToast(
            'Cannot change source template',
            `Published variants must be set to Inactive first: ${sample}${suffix}`,
            'error'
        );
    }

    _replaceTemplateMessageNames(variantIds, newTemplateId) {
        return (variantIds || [])
            .map(id => {
                const row = this._messageRecordById(id);
                if (!row?.Source_Template__c) {
                    return null;
                }
                if (newTemplateId && row.Source_Template__c === newTemplateId) {
                    return null;
                }
                return this._messageVariantLabel(row);
            })
            .filter(Boolean);
    }

    _needsTemplateReplaceConfirm(variantIds, newTemplateId) {
        return this._replaceTemplateMessageNames(variantIds, newTemplateId).length > 0;
    }

    handleBulkChangeSourceTemplate() {
        const ids = Array.from(this._selectedIds);
        if (!ids.length) {
            this._showToast('Change Source Template', 'Select at least one variant.', 'warning');
            return;
        }
        const { eligible, publishedLabels } = this._splitEligibleForTemplateChange(ids);
        if (publishedLabels.length) {
            this._toastPublishedTemplateBlock(publishedLabels);
        }
        if (!eligible.length) {
            return;
        }
        this._openSourceTemplateModal({
            title: 'Change Source Template',
            subtitle: `Assign a validated channel template to ${eligible.length} selected variant(s).`,
            variantIds: eligible,
            selectedTemplateId: ''
        });
    }

    handleVariantChangeSourceTemplate(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (!recordId) {
            return;
        }
        const row = this._messageRecordById(recordId);
        if ((row?.Status__c || '').toLowerCase() === 'published') {
            this._toastPublishedTemplateBlock([this._messageVariantLabel(row)]);
            return;
        }
        this._openSourceTemplateModal({
            title: 'Change Source Template',
            subtitle: 'Assign a validated channel template to this variant.',
            variantIds: [recordId],
            selectedTemplateId: row?.Source_Template__c || ''
        });
    }

    handleMasterChangeSourceTemplate(event) {
        event.stopPropagation();
        const stem = event.currentTarget.dataset.name;
        const groupRecords = this._messages.filter(m => recordBelongsToMasterGroup(m, stem));
        const ids = groupRecords.map(v => v.Id);
        const { eligible, publishedLabels } = this._splitEligibleForTemplateChange(ids);
        if (publishedLabels.length) {
            this._toastPublishedTemplateBlock(publishedLabels);
        }
        if (!eligible.length) {
            return;
        }
        const templateSource = groupRecords.find(m => m.Source_Template__c) || groupRecords[0];
        this._openSourceTemplateModal({
            title: 'Change Source Template',
            subtitle: `Assign a validated template to ${eligible.length} eligible variant(s) in this master row.`,
            variantIds: eligible,
            selectedTemplateId: templateSource?.Source_Template__c || ''
        });
    }

    _openSourceTemplateModal({ title, subtitle, variantIds, selectedTemplateId }) {
        this._sourceTemplateModal = {
            title,
            subtitle,
            variantIds: variantIds || [],
            selectedTemplateId: selectedTemplateId || '',
            isSaving: false,
            replaceConfirmed: false
        };
    }

    handleSourceTemplateModalChange(event) {
        if (!this._sourceTemplateModal) return;
        this._sourceTemplateModal = {
            ...this._sourceTemplateModal,
            selectedTemplateId: event.detail.value || ''
        };
    }

    handleSourceTemplateModalCancel() {
        this._sourceTemplateModal = null;
    }

    handleSourceTemplateModalSave() {
        const modal = this._sourceTemplateModal;
        if (!modal?.selectedTemplateId) {
            this._showToast('Change Source Template', 'Select a source template.', 'warning');
            return;
        }
        const ids = modal.variantIds || [];
        if (!ids.length) {
            this._showToast('Change Source Template', 'No variants to update.', 'warning');
            return;
        }
        if (!modal.replaceConfirmed && this._needsTemplateReplaceConfirm(ids, modal.selectedTemplateId)) {
            this._templateReplaceConfirm = {
                context: 'sourceModal',
                messageNames: this._replaceTemplateMessageNames(ids, modal.selectedTemplateId)
            };
            return;
        }
        this._executeSourceTemplateUpdate(modal);
    }

    _executeSourceTemplateUpdate(modal) {
        const ids = modal.variantIds || [];
        this._sourceTemplateModal = { ...modal, isSaving: true };
        updateMessageSourceTemplates({
            messageIds: ids,
            sourceTemplateId: modal.selectedTemplateId
        })
            .then(count => {
                this._sourceTemplateModal = null;
                this._templateReplaceConfirm = null;
                this._showToast(
                    'Source template updated',
                    `Updated ${count} variant${count !== 1 ? 's' : ''}.`,
                    'success'
                );
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                if (!this._sourceTemplateModal) return;
                this._sourceTemplateModal = { ...this._sourceTemplateModal, isSaving: false };
                this._showToast('Error', err?.body?.message || 'Could not update source template.', 'error');
            });
    }

    handleTemplateReplaceConfirmCancel() {
        this._templateReplaceConfirm = null;
    }

    handleTemplateReplaceConfirmProceed() {
        const ctx = this._templateReplaceConfirm?.context;
        this._templateReplaceConfirm = null;
        if (ctx === 'sourceModal' && this._sourceTemplateModal) {
            const modal = { ...this._sourceTemplateModal, replaceConfirmed: true };
            this._sourceTemplateModal = modal;
            this._executeSourceTemplateUpdate(modal);
            return;
        }
        if (ctx === 'masterEdit' && this._masterEditModal) {
            const modal = { ...this._masterEditModal, templateReplaceConfirmed: true };
            this._masterEditModal = modal;
            this._commitMasterEditSave(modal);
        }
    }

    handleVariantSyncMCE(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (!recordId) {
            return;
        }
        this._executeMceVariantSync([recordId]);
    }

    handleVariantQuickAction(event) {
        event.stopPropagation();
        const action = event.currentTarget.dataset.action;
        const id = event.currentTarget.dataset.id;
        if (!action || !id) return;
        this._runVariantQuickAction(action, id);
    }

    handleVariantOverflowAction(event) {
        event.stopPropagation();
        const value = event.detail.value || '';
        const sep = value.indexOf(':');
        if (sep < 0) return;
        this._quickActionMenuOpenId = null;
        this._runVariantQuickAction(value.substring(0, sep), value.substring(sep + 1));
    }

    handleVariantMenuOpen(event) {
        event.stopPropagation();
        const id = event.currentTarget?.dataset?.variantId;
        this._quickActionMenuOpenId = id || null;
    }

    handleVariantMenuClose(event) {
        event.stopPropagation();
        this._quickActionMenuOpenId = null;
    }

    _runVariantQuickAction(action, recordId) {
        switch (action) {
            case 'sync':
                this._executeMceVariantSync([recordId]);
                break;
            case 'template':
                this.handleVariantChangeSourceTemplate({
                    stopPropagation: () => {},
                    currentTarget: { dataset: { id: recordId } }
                });
                break;
            case 'edit':
                this._openEditor(recordId);
                break;
            case 'clone': {
                const row = this._messageRecordById(recordId);
                if (!row) return;
                this.cloneSourceId = recordId;
                this.cloneSourceName = row.Name;
                this.cloneMasterStem = masterGroupKey(row);
                this.cloneProposedVersion = this._nextVersionForStem(this.cloneMasterStem);
                this.isCloneModalOpen = true;
                break;
            }
            case 'clone-message': {
                const row = this._messageRecordById(recordId);
                if (!row) return;
                const parsed = parseFullName(row.Name);
                this.cloneSourceId = recordId;
                this.cloneSourceName = row.Name;
                this.cloneMessageNamePart = parsed.messageName
                    ? `${parsed.messageName}_Copy`
                    : 'Copy';
                this.isCloneMessageModalOpen = true;
                break;
            }
            case 'schedule-unpublish':
                this._openEditor(recordId, 'unpublishing');
                break;
            case 'schedule-publish':
                this._openEditor(recordId, 'publication');
                break;
            case 'delete':
                this.handleDeletePrompt({
                    stopPropagation: () => {},
                    currentTarget: { dataset: { id: recordId, name: '', version: '' } }
                });
                break;
            default:
                break;
        }
    }

    // ── handlers: channel header ──────────────────────────────────────────

    @track isSyncingMCE = false;
    @track isSyncingD360 = false;
    @track isSyncModalOpen = false;

    get syncMCEButtonLabel() {
        const channel = this.activeChannel?.Channel_Type__c || 'channel';
        return this.isSyncingMCE ? `Syncing ${channel}...` : `Sync with MCE`;
    }

    get syncD360ButtonLabel() {
        const channel = this.activeChannel?.Channel_Type__c || 'channel';
        return this.isSyncingD360 ? `Syncing ${channel}...` : `Push to D360`;
    }


    handleSyncWithMCE() {
        const channel = this.activeChannel?.Channel_Type__c;
        if (!channel) {
            this._showToast('Sync with MCE', 'Select a channel before syncing.', 'error');
            return;
        }
        // Open the warning modal instead of firing immediately
        this.isSyncModalOpen = true; 
    }

    handleSyncCancel() {
        this.isSyncModalOpen = false;
    }

    handleSyncPartialConfirm() {
        this.isSyncModalOpen = false;
        this._executeMceSync(15); // Sync only last 15 mins
    }

    handleSyncFullConfirm() {
        this.isSyncModalOpen = false;
        this._executeMceSync(null); // Sync all
    }

    _mceVariantKeysForRecordIds(recordIds) {
        return (recordIds || [])
            .map(id => {
                const row = this._messages.find(m => m.Id === id);
                return row?.MessageVariantId__c || row?.Message_Variant_Id__c || null;
            })
            .filter(key => !!key);
    }

    _showMceSyncResult(result, titlePrefix) {
        const created = result?.createdCount ?? 0;
        const updated = result?.updatedCount ?? 0;
        const failed = result?.failedCount ?? 0;
        const skipped = result?.skippedCount ?? 0;
        const saved = created + updated;
        const detail = [`Saved ${saved} row(s) (${created} new, ${updated} updated).`];
        if (skipped > 0) {
            detail.push(`${skipped} not found in MCE.`);
        }
        if (failed > 0) {
            detail.push(`${failed} could not be saved.`);
            if (result?.errorMessage) {
                detail.push(result.errorMessage);
            }
        }
        this._showToast(
            titlePrefix,
            detail.join(' '),
            failed > 0 && saved === 0 ? 'error' : (failed > 0 || skipped > 0 ? 'warning' : 'success')
        );
    }

    _executeMceVariantSync(recordIds) {
        if (this.isSyncingMCE) {
            return;
        }
        const channel = this.activeChannel?.Channel_Type__c;
        if (!channel) {
            this._showToast('Sync with MCE', 'Select a channel before syncing.', 'error');
            return;
        }
        const variantKeys = this._mceVariantKeysForRecordIds(recordIds);
        if (!variantKeys.length) {
            this._showToast(
                'Sync with MCE',
                'Selected variant(s) have no Marketing Cloud variant id to sync.',
                'warning'
            );
            return;
        }

        this._setVariantsSyncing(recordIds, true);
        this.isSyncingMCE = true;
        syncVariantsWithMCE({ messageVariantIds: variantKeys })
            .then(result => {
                this._showMceSyncResult(result, `Sync ${variantKeys.length} variant(s) with MCE`);
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                this._showToast(
                    'Sync with MCE',
                    err?.body?.message || err?.message || 'Marketing Cloud Engagement sync failed.',
                    'error'
                );
            })
            .finally(() => {
                this._setVariantsSyncing(recordIds, false);
                this.isSyncingMCE = false;
            });
    }

    _setVariantsSyncing(recordIds, syncing) {
        const next = { ...this._syncingVariantIds };
        for (const id of recordIds || []) {
            if (!id) continue;
            if (syncing) {
                next[id] = true;
            } else {
                delete next[id];
            }
        }
        this._syncingVariantIds = next;
    }

    _executeMceSync(minutesBack) {
        if (this.isSyncingMCE) return;
        
        const channel = this.activeChannel?.Channel_Type__c;
        if (!channel) return;

        this.isSyncingMCE = true;
        
        // Pass both channel and minutesBack to the updated Apex method
        syncWithMCE({ channel: channel, minutesBack: minutesBack })
            .then(result => {
                this._showMceSyncResult(result, `Sync ${channel} with MCE`);
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                this._showToast(
                    'Sync with MCE',
                    err?.body?.message || err?.message || 'Marketing Cloud Engagement sync failed.',
                    'error'
                );
            })
            .finally(() => {
                this.isSyncingMCE = false;
            });
    }

    handleSyncWithD360() {
        if (this.isSyncingD360) {
            return;
        }

        const channel = this.activeChannel?.Channel_Type__c;
        if (!channel) {
            this._showToast('D360 Sync', 'Select a channel before syncing.', 'error');
            return;
        }

        // Map your Salesforce channel name to your actual Data Cloud Stream API Name
        // Adjust this string interpolation based on your actual D360 naming conventions
        const dsoId = `1dsds0000000p8zAAA`; 

        this.isSyncingD360 = true;
        
        refreshStreamViaFlow({ dsoId: dsoId })
            .then(() => {
                this._showToast('D360 Sync', `${channel} refresh initiated successfully.`, 'success');
            })
            .catch(err => {
                this._showToast(
                    'D360 Sync Error', 
                    err?.body?.message || 'Failed to trigger Data Cloud refresh.', 
                    'error'
                );
            })
            .finally(() => {
                this.isSyncingD360 = false;
            });
    }

    // ── handlers: add copy ────────────────────────────────────────────────

    handleAddCopy() {
        const channel = this.activeChannel;
        if (!channel) {
            this._showToast('Error', 'Select a channel before creating a message.', 'error');
            return;
        }
        this._addChannelName = channel.Name || '';
        this._addChannelType = channel.Channel_Type__c || '';
        this._addBannerTypes = [...(channel.Channel_Banner_Types__r || [])];
        this.isAddModalOpen = true;
    }

    handleAddModalClose() {
        this.isAddModalOpen = false;
        this._clearAddChannelContext();
    }

    handleAddModalSave(e) {
        const data = e.detail;
        createMessage({ messageJson: JSON.stringify(data) })
            .then(newId => {
                this.isAddModalOpen = false;
                this._clearAddChannelContext();
                this._showToast('Created', `"${data.messageName}" Variant ${data.version} saved as draft.`, 'success');
                this._reloadActiveChannelMessages();
                if (data.action === 'edit') {
                    this._openEditor(newId);
                }
            })
            .catch(err => {
                const modal = this.template.querySelector('c-copy-cockpit-add-modal');
                if (modal) modal.resetSaving();
                this._showToast('Error', err?.body?.message || 'Create failed.', 'error');
            });
    }

    _clearAddChannelContext() {
        this._addChannelName = '';
        this._addChannelType = '';
        this._addBannerTypes = [];
    }

    // ── handlers: edit / clone / delete ───────────────────────────────────

    handleEdit(e) {
        e.stopPropagation();
        this._openEditor(e.currentTarget.dataset.id);
    }

    handleClonePrompt(e) {
        e.stopPropagation();
        this.cloneSourceId = e.currentTarget.dataset.id;
        this.cloneSourceName = e.currentTarget.dataset.name;
        this.cloneMasterStem = e.currentTarget.dataset.stem || '';
        const stem = this.cloneMasterStem || masterGroupKey({
            Name: this.cloneSourceName,
            MessageName__c: e.currentTarget.dataset.messageName
        });
        this.cloneProposedVersion = this._nextVersionForStem(stem);
        this.isCloneModalOpen = true;
    }

    handleCloneCancel() {
        this._resetClone();
    }

    handleCloneConfirm() {
        this._doClone(false);
    }

    handleCloneConfirmAndEdit() {
        this._doClone(true);
    }

    handleCloneMessageCancel() {
        this._resetCloneMessage();
    }

    handleCloneMessageNameChange(e) {
        this.cloneMessageNamePart = e.target.value;
    }

    handleCloneMessageConfirm() {
        this._doCloneMessage(false);
    }

    handleCloneMessageConfirmAndEdit() {
        this._doCloneMessage(true);
    }

    handleDeletePrompt(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        const row = this._messageRecordById(id);
        this.deleteTargetId = id;
        this.deleteTargetName = row?.MessageName__c || row?.Name || e.currentTarget.dataset.name || 'Message';
        const variantNum = row ? variantNumberFromRecord(row) : 0;
        this.deleteTargetVariantLabel = variantNum > 0
            ? String(variantNum)
            : (e.currentTarget.dataset.version || '—');
        this.isDeleteModalOpen = true;
    }

    handleDeleteCancel() {
        this.isDeleteModalOpen = false;
        this.deleteTargetId = null;
        this.deleteTargetName = '';
        this.deleteTargetVersion = null;
        this.deleteTargetVariantLabel = '';
        this.isVariantDeleteSaving = false;
    }

    handleDeleteConfirm() {
        const id = this.deleteTargetId;
        if (!id || this.isVariantDeleteSaving) {
            return;
        }
        this.isVariantDeleteSaving = true;
        deleteMessageVariants({ metadataIds: [id] })
            .then(() => {
                this._messages = this._messages.filter(m => m.Id !== id);
                this._selectedIds = new Set([...this._selectedIds].filter(sid => sid !== id));
                this._showToast(
                    'Deleted',
                    'Variant and its block data were permanently removed.',
                    'success'
                );
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Delete failed.', 'error');
            })
            .finally(() => {
                this.isDeleteModalOpen = false;
                this.deleteTargetId = null;
                this.deleteTargetName = '';
                this.deleteTargetVersion = null;
                this.deleteTargetVariantLabel = '';
                this.isVariantDeleteSaving = false;
            });
    }

    handleBulkDeleteConfirm() {
        const ids = Array.from(this._selectedIds);
        if (!ids.length || this.isBulkDeleteSaving) {
            return;
        }
        this.isBulkDeleteSaving = true;
        deleteMessageVariants({ metadataIds: ids })
            .then(count => {
                this._messages = this._messages.filter(m => !ids.includes(m.Id));
                this._selectedIds = new Set();
                this._showToast(
                    'Deleted',
                    `${count} variant(s) and related block data were permanently removed.`,
                    'success'
                );
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Bulk delete failed.', 'error');
            })
            .finally(() => {
                this.isBulkDeleteModalOpen = false;
                this.isBulkDeleteSaving = false;
            });
    }

    handleMasterDelete(e) {
        e.stopPropagation();
        const stem = e.currentTarget.dataset.name;
        if (!stem) {
            return;
        }
        const groupRecords = this._messages.filter(m => recordBelongsToMasterGroup(m, stem));
        if (!groupRecords.length) {
            this._showToast('Delete', 'No variants found for this message.', 'warning');
            return;
        }
        this.masterDeleteStem = stem;
        this.masterDeleteDisplayName = groupRecords[0]?.MessageName__c || stem;
        this.masterDeleteVariantCount = groupRecords.length;
        this.isMasterDeleteModalOpen = true;
    }

    handleMasterDeleteCancel() {
        this.isMasterDeleteModalOpen = false;
        this.masterDeleteStem = '';
        this.masterDeleteDisplayName = '';
        this.masterDeleteVariantCount = 0;
        this.isMasterDeleteSaving = false;
    }

    handleMasterDeleteConfirm() {
        const stem = this.masterDeleteStem;
        const channelType = this.activeChannel?.Channel_Type__c;
        if (!stem || !channelType || this.isMasterDeleteSaving) {
            return;
        }
        this.isMasterDeleteSaving = true;
        deleteMasterMessageGroup({ masterStem: stem, channelType })
            .then(count => {
                this._messages = this._messages.filter(m => !recordBelongsToMasterGroup(m, stem));
                this._selectedIds = new Set(
                    [...this._selectedIds].filter(id => this._messages.some(m => m.Id === id))
                );
                this._showToast(
                    'Deleted',
                    `Message "${this.masterDeleteDisplayName}" and ${count} variant(s) with block data were removed.`,
                    'success'
                );
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Delete failed.', 'error');
            })
            .finally(() => {
                this.handleMasterDeleteCancel();
            });
    }

    // ── handlers: master row edit modal ───────────────────────────────────

    handleMasterEdit(e) {
        e.stopPropagation();
        const stem = e.currentTarget.dataset.name;
        const groupRecords = this._messages.filter(
            m => recordBelongsToMasterGroup(m, stem)
        );
        const first = groupRecords[0] || {};
        const familySource = groupRecords.find(m => m.Product_Family__c) || first;
        const offerSource = groupRecords.find(m => m.Offer__c) || first;
        const familyId = familySource.Product_Family__c || null;
        const familyName = familySource.Product_Family__r?.Name || null;
        const currentOfferId = offerSource.Offer__c || null;
        const currentOfferName = offerSource.Offer__r?.Name || null;
        const templateSource = groupRecords.find(m => m.Source_Template__c) || first;

        this._masterEditModal = {
            messageName: stem,
            productFamilyId: familyId,
            productFamilyName: familyName,
            offerId: currentOfferId,
            currentOfferName,
            sourceTemplateId: templateSource?.Source_Template__c || '',
            currentSourceTemplateName: templateSource?.Source_Template__r?.Name || '',
            families: [],
            offers: [],
            isLoadingFamilies: true,
            isLoadingOffers: false,
            isSaving: false,
            variantIds: groupRecords.map(v => v.Id),
        };

        getProductFamilies()
            .then(families => {
                if (!this._masterEditModal) return;
                let options = (families || []).map(f => ({ value: f.Id, label: f.Name }));
                if (familyId && familyName && !options.some(f => f.value === familyId)) {
                    options = [{ value: familyId, label: familyName }, ...options];
                }
                this._masterEditModal = {
                    ...this._masterEditModal,
                    families: options,
                    isLoadingFamilies: false,
                };
                if (familyName) {
                    this._loadModalOffers(familyName);
                    return null;
                }
                if (!currentOfferId) return null;
                return getProductFamilyForOffer({ offerId: currentOfferId });
            })
            .then(family => {
                if (!family || !this._masterEditModal) return;
                const known = (this._masterEditModal.families || []).some(f => f.value === family.Id);
                this._masterEditModal = {
                    ...this._masterEditModal,
                    families: known
                        ? this._masterEditModal.families
                        : [{ value: family.Id, label: family.Name }, ...this._masterEditModal.families],
                    productFamilyId: family.Id,
                    productFamilyName: family.Name,
                };
                this._loadModalOffers(family.Name);
            })
            .catch(() => {
                if (!this._masterEditModal) return;
                this._masterEditModal = { ...this._masterEditModal, isLoadingFamilies: false };
            });
    }

    _loadModalOffers(familyName) {
        const offerId = this._masterEditModal?.offerId;
        const offerName = this._masterEditModal?.currentOfferName;
        this._masterEditModal = { ...this._masterEditModal, isLoadingOffers: true, offers: [] };
        getActiveOffersByFamily({ familyName })
            .then(offers => {
                if (!this._masterEditModal) return;
                let options = (offers || []).map(o => ({ value: o.Id, label: o.Name }));
                if (offerId && offerName && !options.some(o => o.value === offerId)) {
                    options = [{ value: offerId, label: offerName }, ...options];
                }
                this._masterEditModal = {
                    ...this._masterEditModal,
                    offers: options,
                    isLoadingOffers: false,
                };
            })
            .catch(() => {
                if (!this._masterEditModal) return;
                this._masterEditModal = { ...this._masterEditModal, isLoadingOffers: false };
            });
    }

    handleMasterEditFamilyChange(e) {
        const familyId = e.detail.value;
        const familyOption = (this._masterEditModal?.families || []).find(f => f.value === familyId);
        const familyName = familyOption?.label || null;
        this._masterEditModal = {
            ...this._masterEditModal,
            productFamilyId: familyId,
            productFamilyName: familyName,
            offerId: null,
            offers: [],
        };
        if (familyName) this._loadModalOffers(familyName);
    }

    handleMasterEditOfferChange(e) {
        this._masterEditModal = { ...this._masterEditModal, offerId: e.detail.value };
    }

    handleMasterEditSourceTemplateChange(e) {
        this._masterEditModal = {
            ...this._masterEditModal,
            sourceTemplateId: e.detail.value || ''
        };
    }

    handleMasterEditCancel() {
        this._masterEditModal = null;
    }

    handleMasterEditSave() {
        const modal = this._masterEditModal;
        if (!modal) {
            return;
        }
        const variantIds = modal.variantIds || [];
        if (modal.sourceTemplateId) {
            const { publishedLabels } = this._splitEligibleForTemplateChange(variantIds);
            if (publishedLabels.length) {
                this._toastPublishedTemplateBlock(publishedLabels);
                return;
            }
            if (
                !modal.templateReplaceConfirmed
                && this._needsTemplateReplaceConfirm(variantIds, modal.sourceTemplateId)
            ) {
                this._templateReplaceConfirm = {
                    context: 'masterEdit',
                    messageNames: this._replaceTemplateMessageNames(variantIds, modal.sourceTemplateId)
                };
                return;
            }
        }
        this._commitMasterEditSave(modal);
    }

    _commitMasterEditSave(modal) {
        this._masterEditModal = { ...modal, isSaving: true };
        const settingsJson = JSON.stringify({
            offerId: modal.offerId || null,
            productFamilyId: modal.productFamilyId || null,
            sourceTemplateId: modal.sourceTemplateId || null,
            variantIds: modal.variantIds || [],
        });
        saveMasterRowSettings({ settingsJson })
            .then(() => {
                this._masterEditModal = null;
                this._templateReplaceConfirm = null;
                this._showToast('Saved', `Settings for "${modal.messageName}" saved.`, 'success');
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                if (!this._masterEditModal) return;
                this._masterEditModal = { ...this._masterEditModal, isSaving: false };
                this._showToast('Error', err?.body?.message || 'Save failed.', 'error');
            });
    }

    // ── handlers: group rename (master MessageName / Country / Language) ──

    handleNameCellClick(e) {
        // Keep expand/collapse on the row chrome; name cell opens rename via dblclick only.
        e.stopPropagation();
    }

    handleGroupNameDblClick(e) {
        e.stopPropagation();
        const stem = e.currentTarget.dataset.name;
        const group = this.allGroups.find(g => g.messageName === stem);
        const parsed = group
            ? {
                prefix: group.channelPrefix,
                countryCode: group.countryCode,
                language: group.language,
                messageName: group.messageNamePart,
            }
            : parseFullName(stem);
        this._editingGroupName = stem;
        this._editingChannelPrefix = parsed.prefix || channelPrefixForType(this.activeChannel?.Channel_Type__c);
        this._editingCountryCode = parsed.countryCode || '';
        this._editingMessageNamePart = parsed.messageName || '';
        this._editingLanguage = parsed.language || group?.language || 'PL';
        this._renameError = '';
    }

    handleRenameCountryChange(e) {
        this._editingCountryCode = e.target.value;
        this._renameError = '';
    }

    handleRenameMessageNameChange(e) {
        this._editingMessageNamePart = e.target.value;
        this._renameError = '';
    }

    handleRenameLanguageChange(e) {
        this._editingLanguage = e.detail.value;
        this._renameError = '';
    }

    handleRenameCancel() {
        this._cancelRename();
    }

    handleRenameSave() {
        this._commitRename();
    }

    _commitRename() {
        const oldStem = this._editingGroupName;
        if (!oldStem) return;

        const cc = (this._editingCountryCode || '').trim().toUpperCase();
        const mn = (this._editingMessageNamePart || '').trim();
        const language = this._editingLanguage || null;
        const prefix = this._editingChannelPrefix;

        if (!cc || !mn || !language) {
            this._renameError = 'Country Code, Language, and Message Name are required.';
            return;
        }

        const newStem = composeStem(prefix, cc, language, mn);
        if (newStem === oldStem) {
            this._cancelRename();
            return;
        }

        // Client-side uniqueness for a different stem (locale + message name)
        const collision = this.allGroups.some(g => g.messageName === newStem);
        if (collision) {
            this._renameError = `A message with locale "${cc}-${language}" and Message Name "${mn}" already exists.`;
            return;
        }

        updateMessageMaster({
            oldStem,
            countryCode: cc,
            messageNamePart: mn,
            language,
            channelType: this.activeChannel?.Channel_Type__c,
        })
            .then(() => {
                this._cancelRename();
                this._showToast('Updated', 'Message name settings saved for all variants.', 'success');
                this._reloadActiveChannelMessages();
            })
            .catch(err => {
                this._renameError = err?.body?.message || 'Update failed.';
            });
    }

    _cancelRename() {
        this._editingGroupName = null;
        this._editingCountryCode = '';
        this._editingMessageNamePart = '';
        this._editingLanguage = 'PL';
        this._editingChannelPrefix = '';
        this._renameError = '';
    }

    // ── private ────────────────────────────────────────────────────────────

    _messagesForStem(stem) {
        return this._messages.filter(
            m => recordBelongsToMasterGroup(m, stem)
        );
    }

    _nextVersionForStem(stem) {
        const taken = this._messagesForStem(stem)
            .map(m => variantNumberFromRecord(m))
            .filter(n => !Number.isNaN(n) && n > 0);
        return nextAvailableVariant(taken);
    }

    _nextVersionForName(fullOrStemName) {
        const stem = masterGroupKey({ Name: fullOrStemName }) || groupKeyFromName(fullOrStemName);
        return this._nextVersionForStem(stem);
    }

    _doClone(openEditor) {
        const sourceId   = this.cloneSourceId;
        const newVersion = this.cloneProposedVersion;
        const name       = this.cloneProposedName;
        this.isCloning = true;
        cloneMessage({ sourceId, newVersion, masterStem: this.cloneMasterStem || null })
            .then(newId => {
                this._showToast('Copy created', `"${name}" saved as draft.`, 'success');
                this._reloadActiveChannelMessages();
                if (openEditor) this._openEditor(newId);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Clone failed.', 'error');
            })
            .finally(() => {
                this._resetClone();
            });
    }

    _resetClone() {
        this.isCloneModalOpen = false;
        this.isCloning = false;
        this.cloneSourceId = null;
        this.cloneMasterStem = '';
        this.cloneSourceName = '';
        this.cloneProposedVersion = null;
    }

    _resetCloneMessage() {
        this.isCloneMessageModalOpen = false;
        this.isCloning = false;
        this.cloneSourceId = null;
        this.cloneSourceName = '';
        this.cloneMessageNamePart = '';
    }

    _doCloneMessage(openEditor) {
        const sourceId = this.cloneSourceId;
        const row = this._messageRecordById(sourceId);
        if (!sourceId || !row) return;
        const parsed = parseFullName(row.Name);
        const masterStem = composeStem(
            parsed.prefix,
            parsed.countryCode,
            parsed.language,
            this.cloneMessageNamePart
        );
        if (!masterStem) {
            this._showToast('Error', 'Enter a valid message name.', 'error');
            return;
        }
        this.isCloning = true;
        cloneMessage({ sourceId, newVersion: 1, masterStem })
            .then(newId => {
                this._showToast('Created', `"${this.cloneMessageProposedName}" saved as draft.`, 'success');
                this._reloadActiveChannelMessages();
                if (openEditor) this._openEditor(newId);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Clone failed.', 'error');
            })
            .finally(() => {
                this._resetCloneMessage();
            });
    }

    _openEditor(recordId, scheduleIntent = null) {
        this._editorOpenScheduleIntent = scheduleIntent;
        this._editorRecordId = recordId;
        const state = { c__editId: recordId };
        if (scheduleIntent) {
            state.c__schedule = scheduleIntent;
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Copy_Center' },
            state,
        }, false);
    }

    handleEditorBack() {
        this._editorRecordId = null;
        this._editorOpenScheduleIntent = null;
        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Copy_Center' },
            state: {},
        }, true);
        this._reloadActiveChannelMessages();
    }

    _reloadActiveChannelMessages() {
        const ch = this.activeChannel;
        if (!ch) {
            this._messages = [];
            return;
        }
        this._loadMessages(ch.Name, ch.Channel_Type__c);
    }

    _loadMessages(channelName, channelType) {
        if (!channelName && !channelType) { this._messages = []; return; }
        this._isMessagesLoading = true;
        this._messages = [];
        this._selectedIds = new Set();
        this._versionCounts = {};
        getMessagesForDictionaryChannel({ channelName, channelType })
            .then(data => {
                this._messages = data || [];
                const ids = this._messages.map(m => m.Id);
                if (ids.length > 0) {
                    return getVersionCountsByMessageIds({ messageIds: ids });
                }
                return {};
            })
            .then(counts => {
                this._versionCounts = counts || {};
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Failed to load messages.', 'error');
            })
            .finally(() => {
                this._isMessagesLoading = false;
                this._scheduleColumnFit();
            });
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}