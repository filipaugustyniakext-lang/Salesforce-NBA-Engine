import { LightningElement, track, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { deleteRecord } from 'lightning/uiRecordApi';
import getChannelRecords from '@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords';
import getMessagesByChannelType from '@salesforce/apex/CopyCockpitController.getMessagesByChannelType';
import getVersionCountsByMessageIds from '@salesforce/apex/CopyCockpitController.getVersionCountsByMessageIds';
import createMessage from '@salesforce/apex/CopyCockpitController.createMessage';
import cloneMessage from '@salesforce/apex/CopyCockpitController.cloneMessage';
import updateMessageMaster from '@salesforce/apex/CopyCockpitController.updateMessageMaster';
import getProductFamilies from '@salesforce/apex/CopyCockpitController.getProductFamilies';
import getActiveOffersByFamily from '@salesforce/apex/CopyCockpitController.getActiveOffersByFamily';
import saveMasterRowSettings from '@salesforce/apex/CopyCockpitController.saveMasterRowSettings';
import {
    channelPrefixForType,
    composeStem,
    groupKeyFromName,
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

const STATUS_BADGE_CLASS = {
    draft:     'slds-badge slds-badge_lightest',
    ready:     'slds-badge cockpit-badge-ready',
    published: 'slds-badge cockpit-badge-published',
    archived:  'slds-badge cockpit-badge-archived',
};

const STATUS_FILTERS = [
    { value: 'All',       label: 'All' },
    { value: 'Draft',     label: 'Draft' },
    { value: 'Ready',     label: 'Ready' },
    { value: 'Published', label: 'Published' },
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
    return STATUS_BADGE_CLASS[(status || '').toLowerCase()] || 'slds-badge slds-badge_lightest';
}

function fmtWeight(prob, probManual) {
    // prefer manual override; fall back to computed probability
    const val = probManual != null ? probManual : prob;
    if (val == null) return null;
    // express as percentage rounded to 1 decimal, strip trailing zero
    const pct = (val * 100);
    return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function buildScheduleBadge(record) {
    const action   = (record.Scheduled_Action__c || '').toLowerCase();
    const status   = (record.Scheduled_Status__c || '').toLowerCase();
    const toStatus = (record.Scheduled_To_Status__c || '').toLowerCase();

    if (!action || status === 'executed' || status === 'cancelled') return null;

    if (action === 'publish' || toStatus === 'published') {
        return {
            label:     'Scheduled: Activate',
            cssClass:  'cockpit-schedule-badge cockpit-schedule-badge_activate',
            icon:      'utility:clock',
            title:     `Scheduled to Publish on ${fmtDate(record.Scheduled_At__c) || '?'}`,
        };
    }
    if (action === 'deactivate' || toStatus === 'archived') {
        return {
            label:     'Scheduled: Deactivate',
            cssClass:  'cockpit-schedule-badge cockpit-schedule-badge_deactivate',
            icon:      'utility:ban',
            title:     `Scheduled to Deactivate on ${fmtDate(record.Scheduled_At__c) || '?'}`,
        };
    }
    return {
        label:    `Sched: ${record.Scheduled_Action__c}`,
        cssClass: 'cockpit-schedule-badge cockpit-schedule-badge_other',
        icon:     'utility:clock',
        title:    record.Scheduled_Action__c,
    };
}

function buildGroups(records, expandedSet, editingGroupName, selectedIds, versionCounts) {
    const map = new Map();
    for (const r of records) {
        const key = groupKeyFromName(r.Name);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
    }

    return Array.from(map.entries()).map(([stem, variants]) => {
        // Stable order by variant number
        variants = [...variants].sort((a, b) => {
            const va = Number(a.Version__c) || parseFullName(a.Name).variant || 0;
            const vb = Number(b.Version__c) || parseFullName(b.Name).variant || 0;
            return va - vb;
        });

        const parsed = parseFullName(variants[0]?.Name || stem);
        const totalVariants  = variants.length;
        const publishedCount = variants.filter(v => (v.Status__c || '').toLowerCase() === 'published').length;
        const hasPublished   = publishedCount > 0;
        const hasReady       = variants.some(v => (v.Status__c || '').toLowerCase() === 'ready');
        const hasDraft       = variants.some(v => (v.Status__c || '').toLowerCase() === 'draft');
        const hasArchived    = variants.some(v => (v.Status__c || '').toLowerCase() === 'archived');
        const isExpanded     = expandedSet.has(stem);
        const isEditing      = editingGroupName === stem;

        const enrichedVariants = variants.map(v => {
            const sched = buildScheduleBadge(v);
            const isSelected = selectedIds.has(v.Id);
            const modBy = v.MCE_Last_Modified_By__c || null;
            const vParsed = parseFullName(v.Name);
            const variantNum = v.Version__c != null ? v.Version__c : vParsed.variant;
            return {
                ...v,
                statusClass:        statusBadgeClass(v.Status__c),
                validFromFmt:       fmtDate(v.Valid_From__c),
                validToFmt:         fmtDate(v.Valid_To__c),
                campaignName:       v.Campaign__r?.Name || null,
                versionLabel:       v.Message_Variant__c || (variantNum != null ? `Variant ${variantNum}` : '—'),
                weightDisplay:      fmtWeight(v.Display_Probability__c, v.Display_Probability_Manual__c),
                scheduleBadge:      sched?.label || null,
                scheduleBadgeClass: sched?.cssClass || null,
                scheduleBadgeIcon:  sched?.icon || null,
                scheduleBadgeTitle: sched?.title || null,
                versionCount:       versionCounts?.[v.Id] || null,
                lastModifiedFmt:    fmtDateTime(v.MCE_Updated_At__c || v.LastModifiedDate),
                lastModifiedBy:     modBy,
                isSelected,
                checkboxLabel:      `Select ${v.Name || 'variant'}`,
                variantRowClass:    `cockpit-variant-row${isSelected ? ' cockpit-variant-row_selected' : ''}`,
            };
        });

        const allSelected = enrichedVariants.length > 0 && enrichedVariants.every(v => selectedIds.has(v.Id));
        const language = variants[0]?.Language__c || null;
        const displayName = stem;

        return {
            messageName:          stem,
            displayName,
            channelPrefix:        parsed.prefix || '',
            countryCode:          parsed.countryCode || '',
            messageNamePart:      parsed.messageName || '',
            totalVariants,
            publishedCount,
            variantPlural:        totalVariants !== 1 ? 's' : '',
            hasPublished,
            hasReady,
            hasDraft,
            hasArchived,
            isExpanded,
            isEditing,
            expandedStr:          isExpanded ? 'true' : 'false',
            chevronIcon:          isExpanded ? 'utility:chevrondown' : 'utility:chevronright',
            expandToggleTitle:    isExpanded ? 'Collapse' : 'Expand',
            masterRowClass:       `cockpit-master-row${isExpanded ? ' cockpit-master-row_expanded' : ''}`,
            language,
            allSelected,
            masterCheckboxLabel:  `Select all variants of ${displayName}`,
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

    @track isDeleteModalOpen = false;
    @track deleteTargetId = null;
    @track deleteTargetName = '';
    @track deleteTargetVersion = null;

    @track isBulkDeleteModalOpen = false;

    @track isCloneModalOpen = false;
    @track isCloning = false;
    cloneSourceId = null;
    @track cloneSourceName = '';
    @track cloneProposedVersion = null;

    @track _editingGroupName = null;
    @track _editingCountryCode = '';
    @track _editingMessageNamePart = '';
    @track _editingLanguage = 'PL';
    @track _editingChannelPrefix = '';
    @track _renameError = '';

    @track _masterEditModal = null;

    @track _editorRecordId = null;

    get isEditorOpen() { return !!this._editorRecordId; }

    _firstChannelSeeded = false;
    _pageRefSeeded = false;

    @wire(CurrentPageReference)
    _onPageRef(ref) {
        const id = ref?.state?.c__editId;
        if (id && !this._pageRefSeeded) {
            this._pageRefSeeded = true;
            this._editorRecordId = id;
        }
    }

    @wire(getChannelRecords)
    _wiredChannels;

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
        return !this.isLoading && !this.hasError &&
               (!this._wiredChannels.data || this._wiredChannels.data.length === 0);
    }

    get channels() {
        if (!this._wiredChannels.data) return [];
        const activeId = this._activeChannelId || this._wiredChannels.data[0]?.Id;
        return this._wiredChannels.data.map(ch => ({
            ...ch,
            safeIcon: resolveIcon(ch),
            sidebarClass: `ch-sidebar__item${ch.Id === activeId ? ' ch-sidebar__item_active' : ''}`,
        }));
    }

    get activeChannel() {
        if (!this._wiredChannels.data) return null;
        const id = this._activeChannelId || this._wiredChannels.data[0]?.Id;
        const found = this._wiredChannels.data.find(ch => ch.Id === id);
        if (!found) return null;
        return { ...found, safeIcon: resolveIcon(found) };
    }

    get activeBannerTypes() {
        if (!this.activeChannel) return [];
        return this.activeChannel.Channel_Banner_Types__r || [];
    }

    // ── messages & groups ──────────────────────────────────────────────────

    get isMessagesLoading() { return this._isMessagesLoading; }

    get isMessagesEmpty() {
        return !this._isMessagesLoading && this._messages.length === 0;
    }

    get searchTerm() { return this._searchTerm; }

    get statusFilters() {
        return STATUS_FILTERS.map(sf => ({
            ...sf,
            pillClass: `cockpit-status-pill${this._statusFilter === sf.value ? ' cockpit-status-pill_active' : ''}`,
        }));
    }

    get allGroups() {
        return buildGroups(
            this._messages,
            this._expandedGroups,
            this._editingGroupName,
            this._selectedIds,
            this._versionCounts,
        );
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
                return true;
            });
        }

        if (this._searchTerm) {
            const term = this._searchTerm.toLowerCase();
            groups = groups.filter(g =>
                (g.messageName || '').toLowerCase().includes(term) ||
                (g.messageNamePart || '').toLowerCase().includes(term) ||
                (g.countryCode || '').toLowerCase().includes(term) ||
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
        const stem = groupKeyFromName(this.cloneSourceName);
        const v = this.cloneProposedVersion;
        return stem && v != null ? `${stem}_${v}` : (this.cloneSourceName || '');
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

    // ── selection ──────────────────────────────────────────────────────────

    get hasSelection() { return this._selectedIds.size > 0; }

    get selectionCountLabel() {
        const n = this._selectedIds.size;
        return `${n} variant${n !== 1 ? 's' : ''} selected`;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    renderedCallback() {
        if (!this._firstChannelSeeded && this._wiredChannels.data?.length > 0) {
            this._firstChannelSeeded = true;
            const first = this._wiredChannels.data[0];
            this._activeChannelId = first.Id;
            this._loadMessages(first.Channel_Type__c);
        }
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
        this._selectedIds = new Set();
        this._loadMessages(e.currentTarget.dataset.channeltype);
    }

    // ── handlers: filter / expand ─────────────────────────────────────────

    handleSearch(e) {
        this._searchTerm = e.target.value;
    }

    handleStatusFilter(e) {
        this._statusFilter = e.currentTarget.dataset.value;
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

    handleGroupSelect(e) {
        e.stopPropagation();
        const stem = e.target.dataset.name;
        const checked = e.target.checked;
        const groupIds = this._messages
            .filter(m => nameBelongsToStem(m.Name, stem) || groupKeyFromName(m.Name) === stem)
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

    handleBulkDeleteConfirm() {
        const ids = Array.from(this._selectedIds);
        this.isBulkDeleteModalOpen = false;
        Promise.all(ids.map(id => deleteRecord(id)))
            .then(() => {
                this._messages = this._messages.filter(m => !ids.includes(m.Id));
                this._selectedIds = new Set();
                this._showToast('Deleted', `${ids.length} variant${ids.length !== 1 ? 's' : ''} deleted.`, 'success');
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Bulk delete failed.', 'error');
            });
    }

    // ── handlers: add copy ────────────────────────────────────────────────

    handleAddCopy() {
        this.isAddModalOpen = true;
    }

    handleAddModalClose() {
        this.isAddModalOpen = false;
    }

    handleAddModalSave(e) {
        const data = e.detail;
        createMessage({ messageJson: JSON.stringify(data) })
            .then(newId => {
                this.isAddModalOpen = false;
                this._showToast('Created', `"${data.messageName}" Variant ${data.version} saved as draft.`, 'success');
                this._loadMessages(this.activeChannel?.Channel_Type__c);
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

    // ── handlers: edit / clone / delete ───────────────────────────────────

    handleEdit(e) {
        e.stopPropagation();
        this._openEditor(e.currentTarget.dataset.id);
    }

    handleClonePrompt(e) {
        e.stopPropagation();
        this.cloneSourceId = e.currentTarget.dataset.id;
        this.cloneSourceName = e.currentTarget.dataset.name;
        this.cloneProposedVersion = this._nextVersionForName(this.cloneSourceName);
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

    handleDeletePrompt(e) {
        e.stopPropagation();
        this.deleteTargetId = e.currentTarget.dataset.id;
        this.deleteTargetName = e.currentTarget.dataset.name;
        this.deleteTargetVersion = e.currentTarget.dataset.version;
        this.isDeleteModalOpen = true;
    }

    handleDeleteCancel() {
        this.isDeleteModalOpen = false;
        this.deleteTargetId = null;
        this.deleteTargetName = '';
        this.deleteTargetVersion = null;
    }

    handleDeleteConfirm() {
        const id = this.deleteTargetId;
        deleteRecord(id)
            .then(() => {
                this._messages = this._messages.filter(m => m.Id !== id);
                this._selectedIds = new Set([...this._selectedIds].filter(sid => sid !== id));
                this._showToast('Deleted', 'Variant deleted.', 'success');
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Delete failed.', 'error');
            })
            .finally(() => {
                this.isDeleteModalOpen = false;
                this.deleteTargetId = null;
                this.deleteTargetName = '';
                this.deleteTargetVersion = null;
            });
    }

    // ── handlers: master row edit modal ───────────────────────────────────

    handleMasterEdit(e) {
        e.stopPropagation();
        const stem = e.currentTarget.dataset.name;
        const groupRecords = this._messages.filter(
            m => nameBelongsToStem(m.Name, stem) || groupKeyFromName(m.Name) === stem
        );
        const first = groupRecords[0] || {};
        const currentOfferId   = first.Offer__c || null;
        const currentOfferName = first.Offer__r?.Name || null;

        this._masterEditModal = {
            messageName: stem,
            productFamilyId: null,
            offerId: currentOfferId,
            currentOfferName,
            families: [],
            offers: [],
            isLoadingFamilies: true,
            isLoadingOffers: false,
            isSaving: false,
            variants: groupRecords.map(v => this._buildModalVariant(v)),
        };

        getProductFamilies()
            .then(families => {
                if (!this._masterEditModal) return;
                this._masterEditModal = {
                    ...this._masterEditModal,
                    families: families.map(f => ({ value: f.Id, label: f.Name })),
                    isLoadingFamilies: false,
                };
            })
            .catch(() => {
                if (!this._masterEditModal) return;
                this._masterEditModal = { ...this._masterEditModal, isLoadingFamilies: false };
            });
    }

    _buildModalVariant(v) {
        const prob = v.Display_Probability_Manual__c != null ? Number(v.Display_Probability_Manual__c) : 1;
        return {
            id:         v.Id,
            label:      v.Message_Variant__c || (v.Version__c != null ? `Variant ${v.Version__c}` : '—'),
            status:     v.Status__c,
            statusClass: statusBadgeClass(v.Status__c),
            probability: prob,
            pctDisplay:  `${Math.round(prob * 100)}%`,
            decDisplay:  prob.toFixed(2),
        };
    }

    _loadModalOffers(familyName) {
        this._masterEditModal = { ...this._masterEditModal, isLoadingOffers: true, offers: [] };
        getActiveOffersByFamily({ familyName })
            .then(offers => {
                if (!this._masterEditModal) return;
                this._masterEditModal = {
                    ...this._masterEditModal,
                    offers: offers.map(o => ({ value: o.Id, label: o.Name })),
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

    handleMasterEditSlider(e) {
        e.stopPropagation();
        const varId = e.currentTarget.dataset.varId;
        const value = Math.min(1, Math.max(0, parseFloat(e.target.value)));
        this._masterEditModal = {
            ...this._masterEditModal,
            variants: this._masterEditModal.variants.map(v =>
                v.id === varId
                    ? { ...v, probability: value, pctDisplay: `${Math.round(value * 100)}%`, decDisplay: value.toFixed(2) }
                    : v
            ),
        };
    }

    handleMasterEditReset(e) {
        e.stopPropagation();
        const varId = e.currentTarget.dataset.varId;
        this._masterEditModal = {
            ...this._masterEditModal,
            variants: this._masterEditModal.variants.map(v =>
                v.id === varId
                    ? { ...v, probability: 1, pctDisplay: '100%', decDisplay: '1.00' }
                    : v
            ),
        };
    }

    handleMasterEditCancel() {
        this._masterEditModal = null;
    }

    handleMasterEditSave() {
        const modal = this._masterEditModal;
        this._masterEditModal = { ...modal, isSaving: true };
        const settingsJson = JSON.stringify({
            offerId: modal.offerId || null,
            variants: modal.variants.map(v => ({ id: v.id, probability: v.probability })),
        });
        saveMasterRowSettings({ settingsJson })
            .then(() => {
                this._masterEditModal = null;
                this._showToast('Saved', `Settings for "${modal.messageName}" saved.`, 'success');
                this._loadMessages(this.activeChannel?.Channel_Type__c);
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
                messageName: group.messageNamePart,
            }
            : parseFullName(stem);
        this._editingGroupName = stem;
        this._editingChannelPrefix = parsed.prefix || channelPrefixForType(this.activeChannel?.Channel_Type__c);
        this._editingCountryCode = parsed.countryCode || '';
        this._editingMessageNamePart = parsed.messageName || '';
        this._editingLanguage = group?.language || 'PL';
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

        if (!cc || !mn) {
            this._renameError = 'Country Code and Message Name are required.';
            return;
        }

        const newStem = composeStem(prefix, cc, mn);
        const unchanged =
            newStem === oldStem
            && language === (this.allGroups.find(g => g.messageName === oldStem)?.language || null);

        if (unchanged) {
            this._cancelRename();
            return;
        }

        // Client-side uniqueness for a different stem
        if (newStem !== oldStem) {
            const collision = this.allGroups.some(g => g.messageName === newStem);
            if (collision) {
                this._renameError = `A message with Country Code "${cc}" and Message Name "${mn}" already exists.`;
                return;
            }
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
                this._loadMessages(this.activeChannel?.Channel_Type__c);
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
            m => nameBelongsToStem(m.Name, stem) || groupKeyFromName(m.Name) === stem
        );
    }

    _nextVersionForName(fullOrStemName) {
        const stem = groupKeyFromName(fullOrStemName);
        const taken = this._messagesForStem(stem).map(m => {
            const parsed = parseFullName(m.Name);
            return Number(m.Version__c != null ? m.Version__c : parsed.variant);
        }).filter(n => !Number.isNaN(n) && n > 0);
        return nextAvailableVariant(taken);
    }

    _doClone(openEditor) {
        const sourceId   = this.cloneSourceId;
        const newVersion = this.cloneProposedVersion;
        const name       = this.cloneProposedName;
        this.isCloning = true;
        cloneMessage({ sourceId, newVersion })
            .then(newId => {
                this._showToast('Copy created', `"${name}" saved as draft.`, 'success');
                this._loadMessages(this.activeChannel?.Channel_Type__c);
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
        this.cloneSourceName = '';
        this.cloneProposedVersion = null;
    }

    _openEditor(recordId) {
        this._editorRecordId = recordId;
        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Copy_Center' },
            state: { c__editId: recordId },
        }, false);
    }

    handleEditorBack() {
        this._editorRecordId = null;
        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Copy_Center' },
            state: {},
        }, true);
        this._loadMessages(this.activeChannel?.Channel_Type__c);
    }

    _loadMessages(channelType) {
        if (!channelType) { this._messages = []; return; }
        this._isMessagesLoading = true;
        this._messages = [];
        this._selectedIds = new Set();
        this._versionCounts = {};
        getMessagesByChannelType({ channelType })
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
            });
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}