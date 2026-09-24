import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getBlackoutWindows from '@salesforce/apex/MarketingDictionaryManagerController.getBlackoutWindows';
import saveBlackoutWindow from '@salesforce/apex/MarketingDictionaryManagerController.saveBlackoutWindow';
import deleteBlackoutWindow from '@salesforce/apex/MarketingDictionaryManagerController.deleteBlackoutWindow';
import getChannelDictionaryRecords from '@salesforce/apex/MarketingDictionaryController.getChannelDictionaryRecords';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
    if (!iso) return '';
    const [year, month, day] = iso.split('-').map(Number);
    const d = day;
    const suffix = d === 1 || d === 21 || d === 31 ? 'st'
        : d === 2 || d === 22 ? 'nd'
        : d === 3 || d === 23 ? 'rd'
        : 'th';
    return `${MONTHS[month - 1]} ${d}${suffix} ${year}`;
}

function parseChannelList(raw) {
    if (!raw) return [];
    return String(raw).split(';').map(s => s.trim()).filter(Boolean);
}

const EMPTY_BLACKOUT = () => ({
    Name: '',
    Blackout_Date__c: null,
    Blackout_End_Date__c: null,
    Blackout_Type__c: 'Public Holiday',
    Is_Recurring_Annually__c: false,
    Description__c: '',
    Assigned_Channels__c: ''
});

export default class MarketingDictionaryBlackoutTab extends LightningElement {

    @track isLoading = false;
    @track isBlackoutModalOpen = false;
    @track isDeleteModalOpen = false;
    @track editBlackout = EMPTY_BLACKOUT();
    @track blackoutSearch = '';
    @track blackoutSortCol = 'Blackout_Date__c';
    @track blackoutSortAsc = true;
    @track channelGroups = [];
    @track selectAllChannels = false;

    _wiredBlackoutsResult;
    _rawBlackouts = [];
    _channelCatalogue = [];
    _deleteId = null;
    deleteTargetName = '';

    @wire(getBlackoutWindows)
    wiredBlackouts(result) {
        this._wiredBlackoutsResult = result;
        if (result.data) {
            this._rawBlackouts = result.data;
        } else if (result.error) {
            this._showToast('Error', 'Failed to load blackout dates.', 'error');
        }
    }

    @wire(getChannelDictionaryRecords)
    wiredChannels({ data, error }) {
        if (data) {
            this._channelCatalogue = data || [];
            this._rebuildChannelGroups([]);
        } else if (error) {
            console.error('Error loading channels for blackout form', error);
        }
    }

    get hasBlackouts() {
        return this.filteredBlackouts.length > 0;
    }

    get filteredBlackouts() {
        const q = this.blackoutSearch.toLowerCase();
        let list = q
            ? this._rawBlackouts.filter(b =>
                (b.Name || '').toLowerCase().includes(q) ||
                (b.Blackout_Date__c || '').toLowerCase().includes(q) ||
                (b.Blackout_Type__c || '').toLowerCase().includes(q) ||
                (b.Assigned_Channels__c || '').toLowerCase().includes(q) ||
                formatDate(b.Blackout_Date__c).toLowerCase().includes(q))
            : [...this._rawBlackouts];

        const col = this.blackoutSortCol;
        const asc = this.blackoutSortAsc ? 1 : -1;
        list.sort((a, b) => {
            const va = (a[col] || '').toString().toLowerCase();
            const vb = (b[col] || '').toString().toLowerCase();
            return va < vb ? -asc : va > vb ? asc : 0;
        });

        return list.map(b => {
            const channels = parseChannelList(b.Assigned_Channels__c);
            return {
                ...b,
                formattedDate: this._formatDateRange(b.Blackout_Date__c, b.Blackout_End_Date__c),
                isRange: !!b.Blackout_End_Date__c,
                channelLabels: channels,
                channelsSummary: channels.length
                    ? (channels.length <= 3 ? channels.join(', ') : `${channels.slice(0, 3).join(', ')} +${channels.length - 3}`)
                    : '—'
            };
        });
    }

    _formatDateRange(start, end) {
        if (!start) return '';
        if (!end) return formatDate(start);
        return `${formatDate(start)} – ${formatDate(end)}`;
    }

    get blackoutCount() {
        return this._rawBlackouts.length;
    }

    get blackoutCountLabel() {
        const f = this.filteredBlackouts.length;
        const t = this._rawBlackouts.length;
        if (f === t) return `${t} date${t !== 1 ? 's' : ''}`;
        return `Showing ${f} of ${t} matching "${this.blackoutSearch}"`;
    }

    get blackoutSortIcons() {
        const icon = (col) => {
            if (this.blackoutSortCol !== col) return 'utility:sort';
            return this.blackoutSortAsc ? 'utility:arrowup' : 'utility:arrowdown';
        };
        return {
            date: icon('Blackout_Date__c'),
            name: icon('Name'),
            type: icon('Blackout_Type__c')
        };
    }

    get blackoutTypeOptions() {
        return [
            { label: 'Public Holiday', value: 'Public Holiday' },
            { label: 'Maintenance Window', value: 'Maintenance Window' },
            { label: 'Business Decision', value: 'Business Decision' },
            { label: 'Other', value: 'Other' }
        ];
    }

    get blackoutModalTitle() {
        return this.editBlackout.Id ? 'Edit Blackout' : 'Add Blackout';
    }

    get hasChannelCatalogue() {
        return this.channelGroups.length > 0;
    }

    get selectedChannelCount() {
        return this.channelGroups.reduce(
            (n, g) => n + g.items.filter(c => c.active).length, 0
        );
    }

    _rebuildChannelGroups(selectedNames) {
        const selected = new Set(selectedNames || []);
        const groupMap = {};
        (this._channelCatalogue || []).forEach(rec => {
            const type = rec.Channel_Type__c || 'Other';
            if (!groupMap[type]) {
                groupMap[type] = { type, items: [] };
            }
            const isActive = selected.has(rec.Name);
            groupMap[type].items.push({
                label: rec.Name,
                value: rec.Name,
                icon: rec.Channel_Icon__c || 'utility:connected_apps',
                active: isActive,
                buttonClass: isActive
                    ? 'slds-button slds-button_neutral channel-btn channel-btn-active'
                    : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                iconClass: isActive ? 'channel-icon-active' : 'channel-icon-inactive'
            });
        });
        this.channelGroups = Object.values(groupMap);
        const all = this.channelGroups.flatMap(g => g.items);
        this.selectAllChannels = all.length > 0 && all.every(c => c.active);
    }

    _selectedChannelNames() {
        return this.channelGroups.flatMap(g => g.items.filter(c => c.active).map(c => c.value));
    }

    handleBlackoutSearch(event) {
        this.blackoutSearch = event.target.value;
    }

    handleSortBlackout(event) {
        const col = event.currentTarget.dataset.col;
        if (this.blackoutSortCol === col) {
            this.blackoutSortAsc = !this.blackoutSortAsc;
        } else {
            this.blackoutSortCol = col;
            this.blackoutSortAsc = true;
        }
    }

    handleNewBlackout() {
        this.editBlackout = EMPTY_BLACKOUT();
        this._rebuildChannelGroups([]);
        this.isBlackoutModalOpen = true;
    }

    handleEditBlackout(event) {
        const id = event.currentTarget.dataset.id;
        const rec = this._rawBlackouts.find(b => b.Id === id);
        if (rec) {
            this.editBlackout = { ...rec };
            this._rebuildChannelGroups(parseChannelList(rec.Assigned_Channels__c));
            this.isBlackoutModalOpen = true;
        }
    }

    handleBlackoutFieldChange(event) {
        const field = event.target.dataset.field;
        this.editBlackout = { ...this.editBlackout, [field]: event.target.value || null };
    }

    handleBlackoutCheckboxChange(event) {
        const field = event.target.dataset.field;
        this.editBlackout = { ...this.editBlackout, [field]: event.target.checked };
    }

    handleSelectAllChannels(event) {
        const checked = event.target.checked;
        this.selectAllChannels = checked;
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => ({
                ...ch,
                active: checked,
                buttonClass: checked
                    ? 'slds-button slds-button_neutral channel-btn channel-btn-active'
                    : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                iconClass: checked ? 'channel-icon-active' : 'channel-icon-inactive'
            }))
        }));
    }

    handleChannelTileToggle(event) {
        const value = event.currentTarget.dataset.value;
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => {
                if (ch.value !== value) return ch;
                const active = !ch.active;
                return {
                    ...ch,
                    active,
                    buttonClass: active
                        ? 'slds-button slds-button_neutral channel-btn channel-btn-active'
                        : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                    iconClass: active ? 'channel-icon-active' : 'channel-icon-inactive'
                };
            })
        }));
        const all = this.channelGroups.flatMap(g => g.items);
        this.selectAllChannels = all.length > 0 && all.every(c => c.active);
    }

    closeBlackoutModal() {
        this.isBlackoutModalOpen = false;
    }

    async handleSaveBlackout() {
        if (!this.editBlackout.Name || !this.editBlackout.Blackout_Date__c) {
            this._showToast('Validation', 'Name and Start Date are required.', 'warning');
            return;
        }
        if (this.editBlackout.Blackout_End_Date__c &&
            this.editBlackout.Blackout_End_Date__c < this.editBlackout.Blackout_Date__c) {
            this._showToast('Validation', 'End Date must be on or after Start Date.', 'warning');
            return;
        }
        const channels = this._selectedChannelNames();
        if (!channels.length) {
            this._showToast('Validation', 'Select at least one channel for this blackout date.', 'warning');
            return;
        }
        this.isLoading = true;
        try {
            const record = {
                ...this.editBlackout,
                Assigned_Channels__c: channels.join(';')
            };
            await saveBlackoutWindow({ record });
            this._showToast('Success', 'Blackout saved.', 'success');
            this.isBlackoutModalOpen = false;
            await refreshApex(this._wiredBlackoutsResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || 'Save failed.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    handleDeleteBlackout(event) {
        this._deleteId = event.currentTarget.dataset.id;
        this.deleteTargetName = event.currentTarget.dataset.name;
        this.isDeleteModalOpen = true;
    }

    closeDeleteModal() {
        this.isDeleteModalOpen = false;
    }

    async handleConfirmDelete() {
        this.isLoading = true;
        this.isDeleteModalOpen = false;
        try {
            await deleteBlackoutWindow({ recordId: this._deleteId });
            this._showToast('Success', 'Blackout deleted.', 'success');
            await refreshApex(this._wiredBlackoutsResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || 'Delete failed.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
