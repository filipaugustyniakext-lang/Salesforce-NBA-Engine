import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getChannelRecords from '@salesforce/apex/MarketingDictionaryManagerController.getChannelRecords';
import getPersonRecords from '@salesforce/apex/MarketingDictionaryManagerController.getPersonRecords';
import saveChannelRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveChannelRecord';
import toggleChannelActive from '@salesforce/apex/MarketingDictionaryManagerController.toggleChannelActive';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import saveCooldownRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveCooldownRecord';
import deleteCooldownRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteCooldownRecord';
import saveBlackoutDayRule from '@salesforce/apex/MarketingDictionaryManagerController.saveBlackoutDayRule';
import deleteBlackoutDayRule from '@salesforce/apex/MarketingDictionaryManagerController.deleteBlackoutDayRule';
import saveBannerType from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerType';
import deleteBannerType from '@salesforce/apex/MarketingDictionaryManagerController.deleteBannerType';
import saveBannerPlacement from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacement';
import saveBannerPlacementsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerPlacementsBulk';
import deleteBannerPlacement from '@salesforce/apex/MarketingDictionaryManagerController.deleteBannerPlacement';
import saveIntentTarget from '@salesforce/apex/MarketingDictionaryManagerController.saveIntentTarget';
import deleteIntentTarget from '@salesforce/apex/MarketingDictionaryManagerController.deleteIntentTarget';
import saveBannerIntent from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerIntent';
import saveBannerIntentsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveBannerIntentsBulk';
import deleteBannerIntent from '@salesforce/apex/MarketingDictionaryManagerController.deleteBannerIntent';

const CHANNEL_TYPES = ['Email', 'SMS', 'Push', 'Banner', 'In-App', 'AI Agent', 'Branch Agent', 'WhatsApp'];
const VALID_ICON = /^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$/;
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let _key = 0;
const newKey = () => String(++_key);
const newBTRow = (i) => ({ key: newKey(), name: '', label: `Type ${i}` });
const newPlRow = () => ({ key: newKey(), placeholderId: '', appScreen: '', bannerTypeId: '', description: '' });
const newITRow = (i) => ({ key: newKey(), name: '', label: `Target ${i}` });
const newIntentRow = () => ({ key: newKey(), intentValue: '', intentTargetId: '' });

const EMPTY_CHANNEL = () => ({ Name: '', Channel_Type__c: '', Channel_Icon__c: '', Is_Active__c: true });
const EMPTY_COOLDOWN = () => ({ Audience_Type_Dict__c: '', Cooldown_Days__c: null, Channel__c: null });
const EMPTY_DAY_RULE = (day, channelId) => ({
    Day_Of_Week__c: day || '',
    Channel__c: channelId || null,
    Is_Fully_Blocked__c: false,
    Blocked_From_Hour__c: 22,
    Blocked_To_Hour__c: 8
});
const EMPTY_PLACEMENT = () => ({ Name: '', App_Screen__c: '', Banner_Type__c: null, Position_Description__c: '', Channel__c: null });

// Per-channel UI state (not part of wire data)
const defaultChState = () => ({
    activeTab: 'cooldown',
    placementSearch: '',
    sortCol: 'Name',
    sortAsc: true,
    intentSearch: '',
    intentSortCol: 'Name',
    intentSortAsc: true
});

export default class MarketingDictionaryChannelTab extends LightningElement {
    @track isChannelModalOpen = false;
    @track isCooldownModalOpen = false;
    @track isDayRuleModalOpen = false;
    @track isBannerTypeModalOpen = false;
    @track isPlacementModalOpen = false;
    @track isIntentTargetModalOpen = false;
    @track isIntentModalOpen = false;
    @track isDeleteModalOpen = false;
    @track editChannel = EMPTY_CHANNEL();
    @track editCooldown = EMPTY_COOLDOWN();
    @track editDayRule = EMPTY_DAY_RULE();
    @track editPlacement = EMPTY_PLACEMENT();
    @track bannerTypeRows = [newBTRow(1)];
    @track editBannerType = {};
    @track intentTargetRows = [newITRow(1)];
    @track placementRows = [newPlRow()];
    @track intentRows = [newIntentRow()];
    @track _intentPasteText = '';
    @track _intentPasteTargetId = '';
    @track isSaving = false;
    @track _chState = {}; // keyed by channel Id

    _wiredResult;
    _rawChannels = [];
    isLoading = true;
    _activeChannelId = null;
    _activeBannerChannelId = null;
    // 'add' | 'editOne'
    _bannerTypeMode = 'add';
    // 'addRows' | 'editOne' | 'editAll'
    _placementMode = 'addRows';
    // 'add' | 'editAll'
    _intentMode = 'add';
    _pendingDeleteId = null;
    _pendingDeleteName = '';
    _pendingDeleteType = '';

    channelTypeOptions = CHANNEL_TYPES.map(t => ({ label: t, value: t }));
    _audienceTypeRecords = [];

    @wire(getPersonRecords)
    wiredPersonRecords({ data }) {
        if (data) this._audienceTypeRecords = data.filter(r => r.Dictionary_Sub_Type__c === 'Audience Type');
    }

    get audienceTypeOptions() {
        return this._audienceTypeRecords.map(r => ({ label: r.Name, value: r.Id }));
    }

    @wire(getChannelRecords)
    wiredChannels(result) {
        this._wiredResult = result;
        this.isLoading = false;
        if (result.data) {
            this._rawChannels = result.data;
            // Seed state for any new channel ids
            result.data.forEach(ch => {
                if (!this._chState[ch.Id]) {
                    this._chState = { ...this._chState, [ch.Id]: defaultChState() };
                }
            });
            // Select first channel if none active or active was deleted
            if (!this._activeChannelId || !result.data.find(c => c.Id === this._activeChannelId)) {
                this._activeChannelId = result.data[0]?.Id || null;
            }
        } else if (result.error) {
            this._showToast('Error', result.error.body?.message || 'Failed to load channels', 'error');
        }
    }

    // ── Derived channels with per-card computed props ──────────────────

    get channels() {
        return this._rawChannels.map(ch => {
            const state = this._chState[ch.Id] || defaultChState();
            const placements = ch.Channel_Banner_Placements__r || [];
            const filtered = this._filterAndSort(placements, state);
            const intents = ch.Channel_Banner_Intents__r || [];
            const filteredIntents = this._filterAndSortIntents(intents, state);
            const isActive = ch.Id === this._activeChannelId;
            const cooldowns = (ch.Channel_Cooldowns__r || []).map(cd => ({
                ...cd,
                audienceName: cd.Audience_Type_Dict__r ? cd.Audience_Type_Dict__r.Name : '(Unassigned)'
            }));
            const weekDays = this._buildWeekDays(ch.Blackout_Day_Rules__r || [], ch.Id);
            return {
                ...ch,
                Is_Active__c: ch.Is_Active__c !== false,
                Channel_Cooldowns__r: cooldowns.length ? cooldowns : null,
                weekDays,
                isBanner: ch.Channel_Type__c === 'Banner',
                isNotBanner: ch.Channel_Type__c !== 'Banner',
                templatesTabLabel: `${ch.Name} Templates`,
                statusLabel: ch.Is_Active__c === false ? 'Inactive' : 'Active',
                statusClass: ch.Is_Active__c === false
                    ? 'slds-badge channel-status channel-status_inactive'
                    : 'slds-badge channel-status channel-status_active',
                sidebarClass: `ch-sidebar__item${isActive ? ' ch-sidebar__item_active' : ''}`,
                activeTab: state.activeTab,
                placementSearch: state.placementSearch,
                filteredPlacements: filtered.length ? filtered : null,
                placementCountLabel: this._countLabel(filtered.length, placements.length, state.placementSearch),
                sortIconName: this._sortIcon(state, 'Name'),
                sortIconScreen: this._sortIcon(state, 'App_Screen__c'),
                sortIconType: this._sortIcon(state, 'Banner_Type__r.Name'),
                intentSearch: state.intentSearch,
                filteredIntents: filteredIntents.length ? filteredIntents : null,
                intentCountLabel: this._intentCountLabel(filteredIntents.length, intents.length, state.intentSearch),
                intentSortIconValue: this._intentSortIcon(state, 'Name'),
                intentSortIconTarget: this._intentSortIcon(state, 'Intent_Target__r.Name')
            };
        });
    }

    _buildWeekDays(rules, channelId) {
        const rulesMap = {};
        (rules || []).forEach(r => { rulesMap[r.Day_Of_Week__c] = r; });
        return WEEK_DAYS.map(day => {
            const rule = rulesMap[day] || null;
            const isWeekend = day === 'Saturday' || day === 'Sunday';
            let cardClass = 'bo-day-card';
            if (rule && rule.Is_Fully_Blocked__c) cardClass += ' bo-day-card_blocked';
            else if (rule) cardClass += ' bo-day-card_partial';
            else if (isWeekend) cardClass += ' bo-day-card_weekend';
            return { name: day, rule, cardClass, isWeekend, channelId };
        });
    }

    _filterAndSort(placements, state) {
        let list = [...placements];
        const q = (state.placementSearch || '').toLowerCase().trim();
        if (q) {
            list = list.filter(p =>
                (p.Name || '').toLowerCase().includes(q) ||
                (p.App_Screen__c || '').toLowerCase().includes(q) ||
                (p.Banner_Type__r?.Name || '').toLowerCase().includes(q) ||
                (p.Position_Description__c || '').toLowerCase().includes(q)
            );
        }
        const col = state.sortCol;
        const asc = state.sortAsc ? 1 : -1;
        list.sort((a, b) => {
            let av, bv;
            if (col === 'Banner_Type__r.Name') {
                av = (a.Banner_Type__r?.Name || '').toLowerCase();
                bv = (b.Banner_Type__r?.Name || '').toLowerCase();
            } else {
                av = (a[col] || '').toLowerCase();
                bv = (b[col] || '').toLowerCase();
            }
            if (av < bv) return -1 * asc;
            if (av > bv) return 1 * asc;
            return 0;
        });
        return list;
    }

    _countLabel(shown, total, search) {
        if (search && shown < total) return `Showing ${shown} of ${total} placeholders matching "${search}"`;
        return `${total} placeholder${total !== 1 ? 's' : ''}`;
    }

    _sortIcon(state, col) {
        if (state.sortCol !== col) return 'utility:arrowdown';
        return state.sortAsc ? 'utility:arrowup' : 'utility:arrowdown';
    }

    _filterAndSortIntents(intents, state) {
        let list = [...intents];
        const q = (state.intentSearch || '').toLowerCase().trim();
        if (q) {
            list = list.filter(i =>
                (i.Name || '').toLowerCase().includes(q) ||
                (i.Intent_Target__r?.Name || '').toLowerCase().includes(q)
            );
        }
        const col = state.intentSortCol;
        const asc = state.intentSortAsc ? 1 : -1;
        list.sort((a, b) => {
            const av = col === 'Intent_Target__r.Name'
                ? (a.Intent_Target__r?.Name || '').toLowerCase()
                : (a[col] || '').toLowerCase();
            const bv = col === 'Intent_Target__r.Name'
                ? (b.Intent_Target__r?.Name || '').toLowerCase()
                : (b[col] || '').toLowerCase();
            if (av < bv) return -1 * asc;
            if (av > bv) return 1 * asc;
            return 0;
        });
        return list;
    }

    _intentCountLabel(shown, total, search) {
        if (search && shown < total) return `Showing ${shown} of ${total} intents matching "${search}"`;
        return `${total} intent${total !== 1 ? 's' : ''}`;
    }

    _intentSortIcon(state, col) {
        if (state.intentSortCol !== col) return 'utility:arrowdown';
        return state.intentSortAsc ? 'utility:arrowup' : 'utility:arrowdown';
    }

    _updateChState(channelId, patch) {
        const current = this._chState[channelId] || defaultChState();
        this._chState = { ...this._chState, [channelId]: { ...current, ...patch } };
    }

    get activeChannel() {
        if (!this._activeChannelId) return null;
        return this.channels.find(ch => ch.Id === this._activeChannelId) || null;
    }

    handleSelectChannel(event) {
        this._activeChannelId = event.currentTarget.dataset.id;
    }

    get channelCount() { return this._rawChannels.length; }
    get hasChannels() { return !this.isLoading && this._rawChannels.length > 0; }
    get isEmpty() { return !this.isLoading && this._rawChannels.length === 0; }
    get channelModalTitle() { return this.editChannel.Id ? 'Edit Channel' : 'New Channel'; }
    get cooldownModalTitle() { return this.editCooldown.Id ? 'Edit Cooldown Rule' : 'New Cooldown Rule'; }
    get dayRuleModalTitle() { return `Restrictions for ${this.editDayRule.Day_Of_Week__c || '—'}`; }
    get showDayRuleHourRange() { return !this.editDayRule.Is_Fully_Blocked__c; }
    get pendingDeleteName() { return this._pendingDeleteName; }
    get deleteModalMessage() {
        if (this._pendingDeleteType === 'channel') return `Permanently delete the channel "${this._pendingDeleteName}" and all its rules and placeholders?`;
        if (this._pendingDeleteType === 'cooldown') return `Delete the cooldown rule for "${this._pendingDeleteName}"?`;
        if (this._pendingDeleteType === 'dayRule') return `Remove the weekly restriction ${this._pendingDeleteName}?`;
        if (this._pendingDeleteType === 'bannerType') return `Delete banner type "${this._pendingDeleteName}"? Placeholders using it will lose their type link.`;
        if (this._pendingDeleteType === 'intentTarget') return `Delete intent target "${this._pendingDeleteName}"? Intents mapped to it will lose their target link.`;
        if (this._pendingDeleteType === 'intent') return `Delete intent "${this._pendingDeleteName}"?`;
        return `Delete placeholder "${this._pendingDeleteName}"?`;
    }
    get iconPreviewName() {
        const v = this.editChannel.Channel_Icon__c?.trim();
        return v && VALID_ICON.test(v) ? v : null;
    }
    get isAddBannerTypeMode() { return this._bannerTypeMode === 'add'; }
    get bannerTypeModalTitle() { return this._bannerTypeMode === 'editOne' ? 'Edit Banner Type' : 'Add Banner Types'; }
    get isSingleBannerTypeRow() { return this.bannerTypeRows.length === 1; }
    get bannerTypeSaveLabel() {
        if (this._bannerTypeMode === 'editOne') return 'Save';
        const n = this.bannerTypeRows.filter(r => r.name.trim()).length;
        return n > 1 ? `Save ${n}` : 'Save';
    }
    get isEditOnePlacementMode() { return this._placementMode === 'editOne'; }
    get isEditAllPlacementMode() { return this._placementMode === 'editAll'; }
    get isAddPlacementMode() { return this._placementMode === 'addRows'; }
    get isSinglePlacementRow() { return this.placementRows.length === 1; }
    get placementModalTitle() {
        if (this._placementMode === 'editOne') return 'Edit Placeholder';
        if (this._placementMode === 'editAll') return 'Edit All Placeholders';
        return 'Add Banner Placeholders';
    }
    get placementSaveLabel() {
        if (this._placementMode === 'editOne') return 'Save';
        const n = this.placementRows.filter(r => r.placeholderId.trim()).length;
        return n > 1 ? `Save ${n}` : 'Save';
    }
    get activeBannerTypeOptions() {
        const ch = this._rawChannels.find(c => c.Id === this._activeBannerChannelId);
        if (!ch?.Channel_Banner_Types__r?.length) return [];
        const opts = ch.Channel_Banner_Types__r.map(bt => ({ label: bt.Name, value: bt.Id }));
        return [{ label: '— None —', value: '' }, ...opts];
    }

    get intentTargetSaveLabel() {
        const n = this.intentTargetRows.filter(r => r.name.trim()).length;
        return n > 1 ? `Save ${n}` : 'Save';
    }
    get isSingleIntentTargetRow() { return this.intentTargetRows.length === 1; }

    get activeIntentTargetOptions() {
        const ch = this._rawChannels.find(c => c.Id === this._activeBannerChannelId);
        if (!ch?.Channel_Banner_Intent_Targets__r?.length) return [];
        const opts = ch.Channel_Banner_Intent_Targets__r.map(it => ({ label: it.Name, value: it.Id }));
        return [{ label: '— None —', value: '' }, ...opts];
    }

    get isAddIntentMode() { return this._intentMode === 'add'; }
    get isEditAllIntentMode() { return this._intentMode === 'editAll'; }
    get intentModalTitle() { return this._intentMode === 'editAll' ? 'Edit All Intents' : 'Add Banner Intents'; }
    get isSingleIntentRow() { return this.intentRows.length === 1; }
    get intentSaveLabel() {
        if (this._intentMode === 'add') {
            const lines = (this._intentPasteText || '').split('\n').filter(l => l.trim()).length;
            return lines > 1 ? `Save ${lines}` : 'Save';
        }
        const n = this.intentRows.filter(r => r.intentValue.trim()).length;
        return n > 1 ? `Save ${n}` : 'Save';
    }
    get intentPasteText() { return this._intentPasteText || ''; }
    get intentPasteTargetId() { return this._intentPasteTargetId || ''; }

    // ── Tab handler ──────────────────────────────────────────────────────

    handleTabActive(event) {
        const channelId = event.currentTarget.dataset.channelid;
        const tabValue = event.target.value;
        if (channelId) this._updateChState(channelId, { activeTab: tabValue });
    }

    // ── Placement sort & search ──────────────────────────────────────────

    handlePlacementSort(event) {
        const channelId = event.currentTarget.dataset.channelid;
        const col = event.currentTarget.dataset.col;
        const state = this._chState[channelId] || defaultChState();
        const sortAsc = state.sortCol === col ? !state.sortAsc : true;
        this._updateChState(channelId, { sortCol: col, sortAsc });
    }

    handlePlacementSearch(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._updateChState(channelId, { placementSearch: event.detail.value });
    }

    handleIntentSort(event) {
        const channelId = event.currentTarget.dataset.channelid;
        const col = event.currentTarget.dataset.col;
        const state = this._chState[channelId] || defaultChState();
        const intentSortAsc = state.intentSortCol === col ? !state.intentSortAsc : true;
        this._updateChState(channelId, { intentSortCol: col, intentSortAsc });
    }

    handleIntentSearch(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._updateChState(channelId, { intentSearch: event.detail.value });
    }

    // ── Channel handlers ─────────────────────────────────────────────────

    handleNewChannel() {
        this.editChannel = EMPTY_CHANNEL();
        this.isChannelModalOpen = true;
    }

    handleEditChannel(event) {
        const found = this._rawChannels.find(c => c.Id === event.currentTarget.dataset.id);
        this.editChannel = found ? { ...found } : EMPTY_CHANNEL();
        this.isChannelModalOpen = true;
    }

    handleChannelFieldChange(event) {
        this.editChannel = { ...this.editChannel, [event.currentTarget.dataset.field]: event.detail.value };
    }

    async handleChannelActiveToggle(event) {
        const channelId = event.target.dataset.id;
        const isActive = event.target.checked;
        const previous = this._rawChannels;
        this._rawChannels = this._rawChannels.map(ch =>
            ch.Id === channelId ? { ...ch, Is_Active__c: isActive } : ch
        );
        try {
            await toggleChannelActive({ channelId, isActive });
            this._showToast(
                'Channel updated',
                `${event.target.dataset.name} is now ${isActive ? 'active' : 'inactive'}.`,
                'success'
            );
            await refreshApex(this._wiredResult);
        } catch (e) {
            this._rawChannels = previous;
            this._showToast('Error', e.body?.message || e.message, 'error');
        }
    }

    async handleSaveChannel() {
        if (!this.editChannel.Name?.trim()) { this._showToast('Validation', 'Channel Name is required', 'error'); return; }
        const icon = this.editChannel.Channel_Icon__c?.trim();
        if (icon && !VALID_ICON.test(icon)) { this._showToast('Validation', 'Icon must be category:name format', 'error'); return; }
        this.isSaving = true;
        try {
            await saveChannelRecord({ record: this.editChannel });
            this._showToast('Success', 'Channel saved', 'success');
            this.isChannelModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
        finally { this.isSaving = false; }
    }

    handleDeleteChannel(event) {
        this._pendingDeleteId = event.currentTarget.dataset.id;
        this._pendingDeleteName = event.currentTarget.dataset.name || 'this channel';
        this._pendingDeleteType = 'channel';
        this.isDeleteModalOpen = true;
    }

    handleCloseChannelModal() { this.isChannelModalOpen = false; }

    // ── Cooldown handlers ────────────────────────────────────────────────

    handleNewCooldown(event) {
        this.editCooldown = { ...EMPTY_COOLDOWN(), Channel__c: event.currentTarget.dataset.channelid };
        this.isCooldownModalOpen = true;
    }

    handleEditCooldown(event) {
        const channelId = event.currentTarget.dataset.channelid;
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const found = ch?.Channel_Cooldowns__r?.find(cd => cd.Id === event.currentTarget.dataset.coolid);
        this.editCooldown = found
            ? { Id: found.Id, Channel__c: channelId, Audience_Type_Dict__c: found.Audience_Type_Dict__c, Cooldown_Days__c: found.Cooldown_Days__c }
            : { ...EMPTY_COOLDOWN(), Channel__c: channelId };
        this.isCooldownModalOpen = true;
    }

    handleCooldownFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        const value = field === 'Cooldown_Days__c' ? Number(event.detail.value) : event.detail.value;
        this.editCooldown = { ...this.editCooldown, [field]: value };
    }

    async handleSaveCooldown() {
        if (!this.editCooldown.Audience_Type_Dict__c) { this._showToast('Validation', 'Audience Type is required', 'error'); return; }
        if (this.editCooldown.Cooldown_Days__c === null || this.editCooldown.Cooldown_Days__c < 0) { this._showToast('Validation', 'Cooldown Days must be 0 or more', 'error'); return; }
        this.isSaving = true;
        try {
            await saveCooldownRecord({ cooldownJson: JSON.stringify(this.editCooldown) });
            this._showToast('Success', 'Cooldown rule saved', 'success');
            this.isCooldownModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
        finally { this.isSaving = false; }
    }

    handleDeleteCooldown(event) {
        this._pendingDeleteId = event.currentTarget.dataset.coolid;
        this._pendingDeleteName = event.currentTarget.dataset.audience || 'this rule';
        this._pendingDeleteType = 'cooldown';
        this.isDeleteModalOpen = true;
    }

    handleCloseCooldownModal() { this.isCooldownModalOpen = false; }

    // ── Weekly Restriction handlers ──────────────────────────────────────

    handleNewDayRule(event) {
        const day = event.currentTarget.dataset.day;
        const channelId = event.currentTarget.dataset.channelid;
        this.editDayRule = EMPTY_DAY_RULE(day, channelId);
        this.isDayRuleModalOpen = true;
    }

    handleEditDayRule(event) {
        const day = event.currentTarget.dataset.day;
        const channelId = event.currentTarget.dataset.channelid;
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const rule = (ch?.Blackout_Day_Rules__r || []).find(r => r.Day_Of_Week__c === day);
        if (rule) {
            this.editDayRule = {
                Id: rule.Id,
                Channel__c: channelId,
                Day_Of_Week__c: rule.Day_Of_Week__c,
                Is_Fully_Blocked__c: !!rule.Is_Fully_Blocked__c,
                Blocked_From_Hour__c: rule.Blocked_From_Hour__c,
                Blocked_To_Hour__c: rule.Blocked_To_Hour__c
            };
            this.isDayRuleModalOpen = true;
        }
    }

    handleDayRuleFieldChange(event) {
        const field = event.target.dataset.field;
        this.editDayRule = { ...this.editDayRule, [field]: Number(event.target.value) };
    }

    handleDayRuleCheckboxChange(event) {
        const field = event.target.dataset.field;
        this.editDayRule = { ...this.editDayRule, [field]: event.target.checked };
    }

    handleCloseDayRuleModal() { this.isDayRuleModalOpen = false; }

    async handleSaveDayRule() {
        const r = this.editDayRule;
        if (!r.Channel__c || !r.Day_Of_Week__c) {
            this._showToast('Validation', 'Channel and day are required.', 'error');
            return;
        }
        if (!r.Is_Fully_Blocked__c) {
            const from = Number(r.Blocked_From_Hour__c);
            const to = Number(r.Blocked_To_Hour__c);
            if (Number.isNaN(from) || Number.isNaN(to) || from < 0 || from > 23 || to < 0 || to > 23) {
                this._showToast('Validation', 'Hours must be between 0 and 23.', 'warning');
                return;
            }
        }
        this.isSaving = true;
        try {
            await saveBlackoutDayRule({ record: this.editDayRule });
            this._showToast('Success', `Rule for ${r.Day_Of_Week__c} saved.`, 'success');
            this.isDayRuleModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleDeleteDayRule(event) {
        this._pendingDeleteId = event.currentTarget.dataset.id;
        this._pendingDeleteName = `for ${event.currentTarget.dataset.day}`;
        this._pendingDeleteType = 'dayRule';
        this.isDeleteModalOpen = true;
    }

    // ── Banner Type handlers ─────────────────────────────────────────────

    handleNewBannerType(event) {
        this._activeBannerChannelId = event.currentTarget.dataset.channelid;
        this._bannerTypeMode = 'add';
        this.bannerTypeRows = [newBTRow(1)];
        this.isBannerTypeModalOpen = true;
    }

    handleEditBannerType(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._activeBannerChannelId = channelId;
        this._bannerTypeMode = 'editOne';
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const found = ch?.Channel_Banner_Types__r?.find(bt => bt.Id === event.currentTarget.dataset.btid);
        this.editBannerType = found
            ? { Id: found.Id, Name: found.Name, Description__c: found.Description__c || '', Image_URL__c: found.Image_URL__c || '' }
            : { Id: event.currentTarget.dataset.btid, Name: event.currentTarget.dataset.name, Description__c: '', Image_URL__c: '' };
        this.isBannerTypeModalOpen = true;
    }

    handleEditBannerTypeFieldChange(event) {
        this.editBannerType = { ...this.editBannerType, [event.currentTarget.dataset.field]: event.detail.value };
    }

    handleBannerTypeRowChange(event) {
        const key = event.currentTarget.dataset.key;
        this.bannerTypeRows = this.bannerTypeRows.map(r => r.key === key ? { ...r, name: event.detail.value } : r);
    }

    handleAddBannerTypeRow() {
        this.bannerTypeRows = [...this.bannerTypeRows, newBTRow(this.bannerTypeRows.length + 1)];
    }

    handleRemoveBannerTypeRow(event) {
        const key = event.currentTarget.dataset.key;
        if (this.bannerTypeRows.length === 1) return;
        this.bannerTypeRows = this.bannerTypeRows.filter(r => r.key !== key).map((r, i) => ({ ...r, label: `Type ${i + 1}` }));
    }

    async handleSaveBannerTypes() {
        this.isSaving = true;
        try {
            if (this._bannerTypeMode === 'editOne') {
                if (!this.editBannerType.Name?.trim()) { this._showToast('Validation', 'Banner type name is required', 'error'); this.isSaving = false; return; }
                await saveBannerType({ bannerTypeJson: JSON.stringify({
                    Id: this.editBannerType.Id,
                    Name: this.editBannerType.Name.trim(),
                    Description__c: this.editBannerType.Description__c?.trim() || null,
                    Image_URL__c: this.editBannerType.Image_URL__c?.trim() || null,
                    Channel__c: this._activeBannerChannelId
                }) });
                this._showToast('Success', 'Banner type saved', 'success');
            } else {
                const filled = this.bannerTypeRows.filter(r => r.name.trim());
                if (!filled.length) { this._showToast('Validation', 'Enter at least one banner type name', 'error'); this.isSaving = false; return; }
                for (const row of filled) {
                    await saveBannerType({ bannerTypeJson: JSON.stringify({ Name: row.name.trim(), Channel__c: this._activeBannerChannelId }) });
                }
                this._showToast('Success', `${filled.length === 1 ? 'Banner type' : filled.length + ' banner types'} saved`, 'success');
            }
            this.isBannerTypeModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
        finally { this.isSaving = false; }
    }

    handleDeleteBannerType(event) {
        this._pendingDeleteId = event.currentTarget.dataset.btid;
        this._pendingDeleteName = event.currentTarget.dataset.name || 'this banner type';
        this._pendingDeleteType = 'bannerType';
        this.isDeleteModalOpen = true;
    }

    handleCloseBannerTypeModal() { this.isBannerTypeModalOpen = false; }

    // ── Banner Placement handlers ────────────────────────────────────────

    handleNewPlacement(event) {
        this._activeBannerChannelId = event.currentTarget.dataset.channelid;
        this._placementMode = 'addRows';
        this.placementRows = [newPlRow()];
        this.isPlacementModalOpen = true;
    }

    handleEditPlacement(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._activeBannerChannelId = channelId;
        this._placementMode = 'editOne';
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const found = ch?.Channel_Banner_Placements__r?.find(p => p.Id === event.currentTarget.dataset.plid);
        this.editPlacement = found ? { ...found, Channel__c: channelId } : { ...EMPTY_PLACEMENT(), Channel__c: channelId };
        this.isPlacementModalOpen = true;
    }

    handleEditAllPlacements(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._activeBannerChannelId = channelId;
        this._placementMode = 'editAll';
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const placements = ch?.Channel_Banner_Placements__r || [];
        this.placementRows = placements.map(p => ({
            key: newKey(),
            id: p.Id,
            placeholderId: p.Name || '',
            appScreen: p.App_Screen__c || '',
            bannerTypeId: p.Banner_Type__c || '',
            description: p.Position_Description__c || ''
        }));
        if (!this.placementRows.length) this.placementRows = [newPlRow()];
        this.isPlacementModalOpen = true;
    }

    handlePlacementFieldChange(event) {
        this.editPlacement = { ...this.editPlacement, [event.currentTarget.dataset.field]: event.detail.value || null };
    }

    handlePlacementRowChange(event) {
        const key = event.currentTarget.dataset.key;
        const rowField = event.currentTarget.dataset.rowfield;
        this.placementRows = this.placementRows.map(r => r.key === key ? { ...r, [rowField]: event.detail.value } : r);
    }

    handleAddPlacementRow() { this.placementRows = [...this.placementRows, newPlRow()]; }

    handleRemovePlacementRow(event) {
        const key = event.currentTarget.dataset.key;
        if (this.placementRows.length === 1) return;
        this.placementRows = this.placementRows.filter(r => r.key !== key);
    }

    async handleSavePlacement() {
        this.isSaving = true;
        try {
            if (this._placementMode === 'editOne') {
                if (!this.editPlacement.Name?.trim()) { this._showToast('Validation', 'Placeholder ID is required', 'error'); this.isSaving = false; return; }
                await saveBannerPlacement({ placementJson: JSON.stringify(this.editPlacement) });
                this._showToast('Success', 'Placeholder saved', 'success');
            } else {
                const filled = this.placementRows.filter(r => r.placeholderId.trim());
                if (!filled.length) { this._showToast('Validation', 'Enter at least one Placeholder ID', 'error'); this.isSaving = false; return; }
                const records = filled.map(r => ({
                    ...(r.id ? { Id: r.id } : {}),
                    Name: r.placeholderId.trim(),
                    App_Screen__c: r.appScreen.trim() || null,
                    Banner_Type__c: r.bannerTypeId || null,
                    Position_Description__c: r.description.trim() || null,
                    Channel__c: this._activeBannerChannelId
                }));
                await saveBannerPlacementsBulk({ placementsJson: JSON.stringify(records) });
                this._showToast('Success', `${filled.length === 1 ? 'Placeholder' : filled.length + ' placeholders'} saved`, 'success');
            }
            this.isPlacementModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
        finally { this.isSaving = false; }
    }

    handleDeletePlacement(event) {
        this._pendingDeleteId = event.currentTarget.dataset.plid;
        this._pendingDeleteName = event.currentTarget.dataset.name || 'this placeholder';
        this._pendingDeleteType = 'placement';
        this.isDeleteModalOpen = true;
    }

    handleClosePlacementModal() { this.isPlacementModalOpen = false; }

    // ── Shared delete ────────────────────────────────────────────────────

    handleCancelDelete() {
        this._pendingDeleteId = null; this._pendingDeleteName = ''; this._pendingDeleteType = '';
        this.isDeleteModalOpen = false;
    }

    async handleConfirmDelete() {
        const id = this._pendingDeleteId;
        const type = this._pendingDeleteType;
        this.isDeleteModalOpen = false;
        this._pendingDeleteId = null; this._pendingDeleteName = ''; this._pendingDeleteType = '';
        try {
            if (type === 'channel') { await deleteDictionaryRecord({ recordId: id }); this._showToast('Success', 'Channel deleted', 'success'); }
            else if (type === 'cooldown') { await deleteCooldownRecord({ cooldownId: id }); this._showToast('Success', 'Cooldown rule deleted', 'success'); }
            else if (type === 'dayRule') { await deleteBlackoutDayRule({ recordId: id }); this._showToast('Success', 'Weekly restriction removed', 'success'); }
            else if (type === 'bannerType') { await deleteBannerType({ recordId: id }); this._showToast('Success', 'Banner type deleted', 'success'); }
            else if (type === 'intentTarget') { await deleteIntentTarget({ recordId: id }); this._showToast('Success', 'Intent target deleted', 'success'); }
            else if (type === 'intent') { await deleteBannerIntent({ recordId: id }); this._showToast('Success', 'Intent deleted', 'success'); }
            else { await deleteBannerPlacement({ recordId: id }); this._showToast('Success', 'Placeholder deleted', 'success'); }
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
    }

    // ── Intent Target handlers ───────────────────────────────────────────────

    handleNewIntentTarget(event) {
        this._activeBannerChannelId = event.currentTarget.dataset.channelid;
        this.intentTargetRows = [newITRow(1)];
        this.isIntentTargetModalOpen = true;
    }

    handleIntentTargetRowChange(event) {
        const key = event.currentTarget.dataset.key;
        this.intentTargetRows = this.intentTargetRows.map(r => r.key === key ? { ...r, name: event.detail.value } : r);
    }

    handleAddIntentTargetRow() {
        this.intentTargetRows = [...this.intentTargetRows, newITRow(this.intentTargetRows.length + 1)];
    }

    handleRemoveIntentTargetRow(event) {
        const key = event.currentTarget.dataset.key;
        if (this.intentTargetRows.length === 1) return;
        this.intentTargetRows = this.intentTargetRows.filter(r => r.key !== key).map((r, i) => ({ ...r, label: `Target ${i + 1}` }));
    }

    async handleSaveIntentTargets() {
        const filled = this.intentTargetRows.filter(r => r.name.trim());
        if (!filled.length) { this._showToast('Validation', 'Enter at least one intent target name', 'error'); return; }
        this.isSaving = true;
        try {
            for (const row of filled) {
                await saveIntentTarget({ intentTargetJson: JSON.stringify({ Name: row.name.trim(), Channel__c: this._activeBannerChannelId }) });
            }
            this._showToast('Success', `${filled.length === 1 ? 'Intent target' : filled.length + ' intent targets'} saved`, 'success');
            this.isIntentTargetModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
        finally { this.isSaving = false; }
    }

    handleDeleteIntentTarget(event) {
        this._pendingDeleteId = event.currentTarget.dataset.itid;
        this._pendingDeleteName = event.currentTarget.dataset.name || 'this intent target';
        this._pendingDeleteType = 'intentTarget';
        this.isDeleteModalOpen = true;
    }

    handleCloseIntentTargetModal() { this.isIntentTargetModalOpen = false; }

    // ── Intent handlers ──────────────────────────────────────────────────────

    handleNewIntent(event) {
        this._activeBannerChannelId = event.currentTarget.dataset.channelid;
        this._intentMode = 'add';
        this._intentPasteText = '';
        this._intentPasteTargetId = '';
        this.isIntentModalOpen = true;
    }

    handleEditAllIntents(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._activeBannerChannelId = channelId;
        this._intentMode = 'editAll';
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const intents = ch?.Channel_Banner_Intents__r || [];
        this.intentRows = intents.map(i => ({
            key: newKey(),
            id: i.Id,
            intentValue: i.Name || '',
            intentTargetId: i.Intent_Target__c || ''
        }));
        if (!this.intentRows.length) this.intentRows = [newIntentRow()];
        this.isIntentModalOpen = true;
    }

    handleIntentPasteTextChange(event) { this._intentPasteText = event.detail.value; }
    handleIntentPasteTargetChange(event) { this._intentPasteTargetId = event.detail.value; }

    handleIntentRowChange(event) {
        const key = event.currentTarget.dataset.key;
        const rowField = event.currentTarget.dataset.rowfield;
        this.intentRows = this.intentRows.map(r => r.key === key ? { ...r, [rowField]: event.detail.value } : r);
    }

    handleAddIntentRow() { this.intentRows = [...this.intentRows, newIntentRow()]; }

    handleRemoveIntentRow(event) {
        const key = event.currentTarget.dataset.key;
        if (this.intentRows.length === 1) return;
        this.intentRows = this.intentRows.filter(r => r.key !== key);
    }

    async handleSaveIntents() {
        this.isSaving = true;
        try {
            if (this._intentMode === 'add') {
                const lines = (this._intentPasteText || '').split('\n').map(l => l.trim()).filter(l => l);
                if (!lines.length) { this._showToast('Validation', 'Enter at least one intent value', 'error'); this.isSaving = false; return; }
                const records = lines.map(val => ({
                    Name: val,
                    Intent_Target__c: this._intentPasteTargetId || null,
                    Channel__c: this._activeBannerChannelId
                }));
                await saveBannerIntentsBulk({ intentsJson: JSON.stringify(records) });
                this._showToast('Success', `${lines.length === 1 ? 'Intent' : lines.length + ' intents'} saved`, 'success');
            } else {
                const filled = this.intentRows.filter(r => r.intentValue.trim());
                if (!filled.length) { this._showToast('Validation', 'Enter at least one intent value', 'error'); this.isSaving = false; return; }
                const records = filled.map(r => ({
                    ...(r.id ? { Id: r.id } : {}),
                    Name: r.intentValue.trim(),
                    Intent_Target__c: r.intentTargetId || null,
                    Channel__c: this._activeBannerChannelId
                }));
                await saveBannerIntentsBulk({ intentsJson: JSON.stringify(records) });
                this._showToast('Success', `${filled.length === 1 ? 'Intent' : filled.length + ' intents'} saved`, 'success');
            }
            this.isIntentModalOpen = false;
            await refreshApex(this._wiredResult);
        } catch (e) { this._showToast('Error', e.body?.message || e.message, 'error'); }
        finally { this.isSaving = false; }
    }

    handleEditIntent(event) {
        const channelId = event.currentTarget.dataset.channelid;
        this._activeBannerChannelId = channelId;
        this._intentMode = 'editAll';
        const ch = this._rawChannels.find(c => c.Id === channelId);
        const found = ch?.Channel_Banner_Intents__r?.find(i => i.Id === event.currentTarget.dataset.intentid);
        this.intentRows = found
            ? [{ key: newKey(), id: found.Id, intentValue: found.Name || '', intentTargetId: found.Intent_Target__c || '' }]
            : [newIntentRow()];
        this.isIntentModalOpen = true;
    }

    handleDeleteIntent(event) {
        this._pendingDeleteId = event.currentTarget.dataset.intentid;
        this._pendingDeleteName = event.currentTarget.dataset.name || 'this intent';
        this._pendingDeleteType = 'intent';
        this.isDeleteModalOpen = true;
    }

    handleCloseIntentModal() { this.isIntentModalOpen = false; }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}