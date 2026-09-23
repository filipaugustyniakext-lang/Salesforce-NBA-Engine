import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getBlackoutWindows from '@salesforce/apex/MarketingDictionaryManagerController.getBlackoutWindows';
import getBlackoutDayRules from '@salesforce/apex/MarketingDictionaryManagerController.getBlackoutDayRules';
import saveBlackoutWindow from '@salesforce/apex/MarketingDictionaryManagerController.saveBlackoutWindow';
import deleteBlackoutWindow from '@salesforce/apex/MarketingDictionaryManagerController.deleteBlackoutWindow';
import saveBlackoutDayRule from '@salesforce/apex/MarketingDictionaryManagerController.saveBlackoutDayRule';
import deleteBlackoutDayRule from '@salesforce/apex/MarketingDictionaryManagerController.deleteBlackoutDayRule';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats an ISO date string (YYYY-MM-DD) as "Dec 24th 2026"
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

const EMPTY_BLACKOUT = () => ({
    Name: '',
    Blackout_Date__c: null,
    Blackout_End_Date__c: null,
    Blackout_Type__c: 'Public Holiday',
    Is_Recurring_Annually__c: false,
    Description__c: ''
});

const EMPTY_DAY_RULE = (day) => ({
    Day_Of_Week__c: day || '',
    Is_Fully_Blocked__c: false,
    Blocked_From_Hour__c: 22,
    Blocked_To_Hour__c: 8
});

export default class MarketingDictionaryBlackoutTab extends LightningElement {

    @track activeSubTab = 'dates';

    get isTab() {
        return { dates: this.activeSubTab === 'dates', weekly: this.activeSubTab === 'weekly' };
    }
    get vtabClass() {
        const base = 'vtab-item', active = base + ' vtab-item_active';
        return { dates: this.activeSubTab === 'dates' ? active : base, weekly: this.activeSubTab === 'weekly' ? active : base };
    }
    get vtabSelected() {
        return { dates: this.activeSubTab === 'dates', weekly: this.activeSubTab === 'weekly' };
    }
    handleSubTabClick(e) { this.activeSubTab = e.currentTarget.dataset.tab; }

    @track isLoading = false;
    @track isBlackoutModalOpen = false;
    @track isDayRuleModalOpen = false;
    @track isDeleteModalOpen = false;
    @track editBlackout = EMPTY_BLACKOUT();
    @track editDayRule = EMPTY_DAY_RULE();
    @track blackoutSearch = '';
    @track blackoutSortCol = 'Blackout_Date__c';
    @track blackoutSortAsc = true;

    _wiredBlackoutsResult;
    _wiredDayRulesResult;
    _rawBlackouts = [];
    _rawDayRules = [];
    _deleteType = null;
    _deleteId = null;
    deleteTargetName = '';

    // ─── Wire ───────────────────────────────────────────────────────────────

    @wire(getBlackoutWindows)
    wiredBlackouts(result) {
        this._wiredBlackoutsResult = result;
        if (result.data) {
            this._rawBlackouts = result.data;
        } else if (result.error) {
            this._showToast('Error', 'Failed to load blackout dates.', 'error');
        }
    }

    @wire(getBlackoutDayRules)
    wiredDayRules(result) {
        this._wiredDayRulesResult = result;
        if (result.data) {
            this._rawDayRules = result.data;
        } else if (result.error) {
            this._showToast('Error', 'Failed to load day rules.', 'error');
        }
    }

    // ─── Getters ────────────────────────────────────────────────────────────

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
                formatDate(b.Blackout_Date__c).toLowerCase().includes(q))
            : [...this._rawBlackouts];

        const col = this.blackoutSortCol;
        const asc = this.blackoutSortAsc ? 1 : -1;
        list.sort((a, b) => {
            const va = (a[col] || '').toString().toLowerCase();
            const vb = (b[col] || '').toString().toLowerCase();
            return va < vb ? -asc : va > vb ? asc : 0;
        });

        // Attach formatted display fields
        return list.map(b => ({
            ...b,
            formattedDate: this._formatDateRange(b.Blackout_Date__c, b.Blackout_End_Date__c),
            isRange: !!b.Blackout_End_Date__c
        }));
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

    get weekDays() {
        const rulesMap = {};
        this._rawDayRules.forEach(r => { rulesMap[r.Day_Of_Week__c] = r; });

        return DAYS.map(day => {
            const rule = rulesMap[day] || null;
            const isWeekend = day === 'Saturday' || day === 'Sunday';
            let cardClass = 'bo-day-card';
            if (rule && rule.Is_Fully_Blocked__c) cardClass += ' bo-day-card_blocked';
            else if (rule) cardClass += ' bo-day-card_partial';
            else if (isWeekend) cardClass += ' bo-day-card_weekend';
            return { name: day, rule, cardClass, isWeekend };
        });
    }

    get showHourRange() {
        return !this.editDayRule.Is_Fully_Blocked__c;
    }

    get dayRuleModalTitle() {
        return `Restrictions for ${this.editDayRule.Day_Of_Week__c}`;
    }

    // ─── Blackout dates handlers ─────────────────────────────────────────────

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
        this.isBlackoutModalOpen = true;
    }

    handleEditBlackout(event) {
        const id = event.currentTarget.dataset.id;
        const rec = this._rawBlackouts.find(b => b.Id === id);
        if (rec) {
            this.editBlackout = { ...rec };
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
        this.isLoading = true;
        try {
            await saveBlackoutWindow({ record: this.editBlackout });
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
        this._deleteType = 'blackout';
        this._deleteId = event.currentTarget.dataset.id;
        this.deleteTargetName = event.currentTarget.dataset.name;
        this.isDeleteModalOpen = true;
    }

    // ─── Day Rule handlers ────────────────────────────────────────────────────

    handleNewDayRule(event) {
        const day = event.currentTarget.dataset.day;
        this.editDayRule = EMPTY_DAY_RULE(day);
        this.isDayRuleModalOpen = true;
    }

    handleEditDayRule(event) {
        const day = event.currentTarget.dataset.day;
        const rule = this._rawDayRules.find(r => r.Day_Of_Week__c === day);
        if (rule) {
            this.editDayRule = { ...rule };
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

    closeDayRuleModal() {
        this.isDayRuleModalOpen = false;
    }

    async handleSaveDayRule() {
        const r = this.editDayRule;
        if (!r.Is_Fully_Blocked__c) {
            const from = Number(r.Blocked_From_Hour__c);
            const to = Number(r.Blocked_To_Hour__c);
            if (from < 0 || from > 23 || to < 0 || to > 23) {
                this._showToast('Validation', 'Hours must be between 0 and 23.', 'warning');
                return;
            }
        }
        this.isLoading = true;
        try {
            await saveBlackoutDayRule({ record: this.editDayRule });
            this._showToast('Success', `Rule for ${this.editDayRule.Day_Of_Week__c} saved.`, 'success');
            this.isDayRuleModalOpen = false;
            await refreshApex(this._wiredDayRulesResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || 'Save failed.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    handleDeleteDayRule(event) {
        this._deleteType = 'dayRule';
        this._deleteId = event.currentTarget.dataset.id;
        this.deleteTargetName = `rule for ${event.currentTarget.dataset.day}`;
        this.isDeleteModalOpen = true;
    }

    // ─── Shared delete ────────────────────────────────────────────────────────

    closeDeleteModal() {
        this.isDeleteModalOpen = false;
    }

    async handleConfirmDelete() {
        this.isLoading = true;
        this.isDeleteModalOpen = false;
        try {
            if (this._deleteType === 'blackout') {
                await deleteBlackoutWindow({ recordId: this._deleteId });
                this._showToast('Success', 'Blackout deleted.', 'success');
                await refreshApex(this._wiredBlackoutsResult);
            } else {
                await deleteBlackoutDayRule({ recordId: this._deleteId });
                this._showToast('Success', 'Day rule removed.', 'success');
                await refreshApex(this._wiredDayRulesResult);
            }
        } catch (e) {
            this._showToast('Error', e.body?.message || 'Delete failed.', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Toast helper ─────────────────────────────────────────────────────────

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}