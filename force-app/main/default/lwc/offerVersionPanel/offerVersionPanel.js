import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import OFFER_VERSION_OBJECT from '@salesforce/schema/Offer_Version__c';
import getOfferVersions from '@salesforce/apex/OfferController.getOfferVersions';
import activateVersion from '@salesforce/apex/OfferController.activateVersion';
import markVersionReady from '@salesforce/apex/OfferController.markVersionReady';
import revertVersionToDraft from '@salesforce/apex/OfferController.revertVersionToDraft';
import deleteVersion from '@salesforce/apex/OfferController.deleteVersion';
import withdrawSchedule from '@salesforce/apex/OfferController.withdrawSchedule';

const STATUS_BADGE = {
    'Draft':      'slds-badge slds-badge_lightest',
    'Ready':      'version-badge-ready',
    'Active':     'ver-badge-in-use',
    'Scheduled':  'version-badge-scheduled',
    'Deactivated':'version-badge-deactivated',
};

const SCHEDULE_BADGE = {
    'Scheduled for Activation':   'version-schedule-badge-activation',
    'Scheduled for Deactivation': 'version-schedule-badge-deactivation',
};

const SORT_OPTIONS = [
    { label: 'Version #',         value: 'Version_Number__c' },
    { label: 'Status',            value: 'Version_Status__c' },
    { label: 'Valid From',        value: 'Valid_From__c' },
    { label: 'Valid To',          value: 'Valid_To__c' },
    { label: 'Attractiveness',    value: 'Attractiveness_Score__c' },
    { label: 'Last Modified',     value: 'LastModifiedDate' },
];

const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ordinal(d) {
    const s = ['th','st','nd','rd'], v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTH[m - 1]} ${ordinal(d)} ${y}`;
}

// Parse a date-only "YYYY-MM-DD" field into LOCAL midnight (not UTC midnight,
// which `new Date(iso)` would give). This keeps date comparisons timezone-safe
// so a same-day offer (Valid_To = today) is never treated as expired.
function parseLocalDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function localMidnightToday() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
}

export default class OfferVersionPanel extends LightningElement {
    @api recordId;

    @track displayedVersion = null;
    @track showActivateModal = false;
    @track showOverlapModal = false;
    @track showDeleteModal = false;
    @track _pendingDeleteVersionId = null;
    @track showWizard = false;
    @track wizardMode = null;
    @track wizardSourceVersionId = null;
    @track isLoading = false;
    @track sortField = 'Version_Number__c';
    @track sortAsc = false;
    isLoadingVersions = false;

    _wiredVersionsResult;
    _rawVersions = [];

    // ─── Wire ────────────────────────────────────────────────────────────────

    @wire(getObjectInfo, { objectApiName: OFFER_VERSION_OBJECT })
    versionObjectInfo;

    // Map ISO currency code → a locale that formats it naturally
    static _CURRENCY_LOCALE = {
        'PLN': 'pl-PL', 'EUR': 'de-DE', 'USD': 'en-US',
        'GBP': 'en-GB', 'CHF': 'de-CH',
    };

    // Explicit currency field set — fallback when getObjectInfo cache is stale
    static _CURRENCY_FIELDS = new Set([
        'Minimal_Amount__c', 'Maximum_Amount__c',
        'Commission_Amount_Flat_Fee__c', 'Maximum_Promotional_Amount__c',
    ]);

    // Explicit percent field set — fallback when getObjectInfo cache is stale
    static _PERCENT_FIELDS = new Set([
        'Base_Interest_Rate__c', 'Nominal_Interest_Rate__c',
        'Promotional_Interest_Rate__c', 'RRSO__c', 'Commission_Percentage__c',
    ]);

    // Returns formatted value: currency with symbol, percent with %, or plain string
    _fmt(fieldName, value) {
        if (value == null || value === '') return null;
        const fields = this.versionObjectInfo?.data?.fields;
        // Determine type: prefer live schema, fall back to known sets
        let dt = fields?.[fieldName]?.dataType;
        if (!dt) {
            if (OfferVersionPanel._CURRENCY_FIELDS.has(fieldName)) dt = 'Currency';
            else if (OfferVersionPanel._PERCENT_FIELDS.has(fieldName)) dt = 'Percent';
        }
        if (dt === 'Currency') {
            const raw = (this.displayedVersion?.CurrencyIsoCode
                      || this.displayedVersion?.Currency_Code__c
                      || 'PLN').trim();
            const code = raw.replace(/,+$/, '') || 'PLN';
            const locale = OfferVersionPanel._CURRENCY_LOCALE[code] || 'pl-PL';
            try {
                return new Intl.NumberFormat(locale, {
                    style: 'currency', currency: code,
                    minimumFractionDigits: 0, maximumFractionDigits: 2
                }).format(value);
            } catch(e) {
                return `${value} ${code}`;
            }
        }
        if (dt === 'Percent') {
            return `${value}%`;
        }
        return String(value);
    }

    @wire(getOfferVersions, { offerId: '$recordId' })
    wiredVersions(result) {
        this._wiredVersionsResult = result;
        if (result.data) {
            this._rawVersions = result.data;
            if (!this.displayedVersion) {
                const inUse = result.data.find(v => v.Version_Status__c === 'Active')
                           || result.data.find(v => v.Version_Status__c === 'Scheduled');
                this.displayedVersion = inUse || (result.data.length > 0 ? result.data[0] : null);
            } else {
                const refreshed = result.data.find(v => v.Id === this.displayedVersion.Id);
                if (refreshed) this.displayedVersion = refreshed;
            }
        } else if (result.error) {
            this.showError('Failed to load offer versions.');
        }
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    get versions() {
        const now = localMidnightToday();
        const oneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const mapped = this._rawVersions.map(v => {
            const validTo     = parseLocalDate(v.Valid_To__c);
            const isExpired   = validTo != null && validTo < now;
            const expiresSoon = !isExpired && validTo != null && validTo <= oneWeek;
            const isScheduled     = v.Version_Status__c === 'Scheduled';
            const isScheduledDeact = v.Schedule_Status__c === 'Scheduled for Deactivation';
            // Build the label with date (e.g. "Scheduled for Activation · Sep 1st 2026")
            const scheduleLabel = v.Schedule_Status__c
                ? (v.Schedule_Date__c ? `${v.Schedule_Status__c} · ${fmtDate(v.Schedule_Date__c)}` : v.Schedule_Status__c)
                : null;
            return {
                ...v,
                rowClass: this._rowClass(v),
                statusBadgeClass: STATUS_BADGE[v.Version_Status__c] || 'slds-badge slds-badge_lightest',
                scheduleBadgeClass: v.Schedule_Status__c ? (SCHEDULE_BADGE[v.Schedule_Status__c] || '') : null,
                scheduleStatusLabel: scheduleLabel,
                hasScheduleBadge: !!v.Schedule_Status__c,
                isEditable:       v.Version_Status__c !== 'Deactivated',
                isDeletable:      v.Version_Status__c === 'Draft' || v.Version_Status__c === 'Ready',
                isDraft:          v.Version_Status__c === 'Draft',
                isReady:          v.Version_Status__c === 'Ready',
                isInUse:          v.Version_Status__c === 'Active',
                isScheduled,
                isScheduledDeactivation: isScheduledDeact,
                isDeactivated:    v.Version_Status__c === 'Deactivated',
                isExpired,
                expiresSoon,
                canActivate:      v.Version_Status__c === 'Ready' && !isExpired,
                fmtValidFrom: fmtDate(v.Valid_From__c),
                fmtValidTo:   fmtDate(v.Valid_To__c),
            };
        });

        const field = this.sortField;
        const dir   = this.sortAsc ? 1 : -1;
        return [...mapped].sort((a, b) => {
            const av = a[field] ?? '';
            const bv = b[field] ?? '';
            if (av < bv) return -dir;
            if (av > bv) return  dir;
            return 0;
        });
    }

    get sortOptions() { return SORT_OPTIONS; }

    get sortDirLabel() { return this.sortAsc ? '↑' : '↓'; }

    handleSortFieldChange(event) {
        this.sortField = event.detail.value;
    }

    handleSortDirToggle() {
        this.sortAsc = !this.sortAsc;
    }

    get hasVersions()          { return this._rawVersions.length > 0; }
    get versionCount()         { return this._rawVersions.length; }
    get isNotLoading()         { return !this.isLoading; }
    get isNotLoadingVersions() { return !this.isLoadingVersions; }

    get showNoActiveVersionAlert() {
        return this._rawVersions.length > 0
            && !this._rawVersions.some(v => v.Version_Status__c === 'Active' || v.Version_Status__c === 'Scheduled');
    }

    get showActivateThisVersionButton() {
        if (!this.displayedVersion) return false;
        if (this.displayedVersion.Version_Status__c !== 'Ready') return false;
        // Expired versions cannot be activated
        const validTo = parseLocalDate(this.displayedVersion.Valid_To__c);
        if (validTo != null) {
            const today = localMidnightToday();
            if (validTo < today) return false;
        }
        return true;
    }

    get displayedVersionExpired() {
        if (!this.displayedVersion) return false;
        if (this.displayedVersion.Version_Status__c === 'Active') return false;
        const validTo = parseLocalDate(this.displayedVersion.Valid_To__c);
        if (!validTo) return false;
        const today = localMidnightToday();
        return validTo < today;
    }

    get versionStatusBadgeClass() {
        if (!this.displayedVersion) return 'slds-badge';
        return STATUS_BADGE[this.displayedVersion.Version_Status__c] || 'slds-badge slds-badge_lightest';
    }

    get displayedVersionStatusLabel() {
        return this.displayedVersion?.Version_Status__c || '';
    }

    get displayedScheduleBadgeClass() {
        if (!this.displayedVersion?.Schedule_Status__c) return '';
        return SCHEDULE_BADGE[this.displayedVersion.Schedule_Status__c] || 'slds-badge slds-badge_lightest';
    }

    get displayedScheduleStatusLabel() {
        const v = this.displayedVersion;
        if (!v?.Schedule_Status__c) return '';
        return v.Schedule_Date__c
            ? `${v.Schedule_Status__c} · ${fmtDate(v.Schedule_Date__c)}`
            : v.Schedule_Status__c;
    }

    get displayedValidFrom() { return fmtDate(this.displayedVersion?.Valid_From__c); }
    get displayedValidTo()   { return fmtDate(this.displayedVersion?.Valid_To__c); }

    // Customer-type audience derived from the junction subquery (Customer_Types__r),
    // rendered as a comma-separated list of dictionary names.
    get displayedAudience() {
        const rows = this.displayedVersion?.Customer_Types__r || [];
        const names = rows
            .map(r => r.Customer_Type__r && r.Customer_Type__r.Name)
            .filter(Boolean);
        return names.length > 0 ? names.join(', ') : '';
    }

    // Ordered financial parameter definitions — label + field name
    // New currency/percent fields just need adding here; formatting is automatic
    static _FIN_PARAMS = [
        { field: 'Base_Interest_Rate__c',          label: 'Base Interest Rate' },
        { field: 'Nominal_Interest_Rate__c',        label: 'Nominal Interest Rate' },
        { field: 'Promotional_Interest_Rate__c',    label: 'Promotional Interest Rate' },
        { field: 'RRSO__c',                         label: 'RRSO' },
        { field: 'Minimal_Amount__c',               label: 'Minimal Amount' },
        { field: 'Maximum_Amount__c',               label: 'Maximum Amount' },
        { field: 'Commission_Amount_Flat_Fee__c',   label: 'Commission (Flat Fee)' },
        { field: 'Commission_Percentage__c',        label: 'Commission %' },
        { field: 'Maximum_Promotional_Amount__c',   label: 'Maximum Promotional Amount' },
        { field: 'Duration_Days__c',                label: 'Duration (Days)' },
        { field: 'Maximum_Tenure__c',               label: 'Max Tenure (Months)' },
        { field: 'Deposit_Duration_Months__c',      label: 'Deposit Duration (Months)' },
        { field: 'Grace_Period_Days__c',            label: 'Grace Period' },
        { field: 'Interest_Capitalization__c',      label: 'Interest Capitalization' },
        { field: 'Interest_Type__c',                label: 'Interest Type' },
        { field: 'Max_Owned_Products_Limit__c',     label: 'Max Owned Products' },
        { field: 'Card_Fee__c',                     label: 'Card Fee' },
    ];

    get financialParamRows() {
        if (!this.displayedVersion) return [];
        return OfferVersionPanel._FIN_PARAMS
            .map(p => {
                const raw = this.displayedVersion[p.field];
                if (raw == null || raw === '' || raw === false) return null;
                const display = p.field === 'Card_Fee__c' ? 'Yes' : this._fmt(p.field, raw);
                return display ? { key: p.field, label: p.label, display } : null;
            })
            .filter(Boolean);
    }

    get hasValidityPeriod() {
        return !!(this.displayedVersion?.Valid_From__c || this.displayedVersion?.Valid_To__c);
    }

    get sourceProductList() {
        if (!this.displayedVersion?.Source_Products__c) return [];
        return this.displayedVersion.Source_Products__c.split(',').map(s => s.trim()).filter(Boolean);
    }

    get hasFinancialParams() {
        return this.financialParamRows.length > 0;
    }

    get hasUrls() {
        if (!this.displayedVersion) return false;
        return !!(this.displayedVersion.CTA_URL__c || this.displayedVersion.CTA_DURL__c || this.displayedVersion.Statute_URL__c);
    }

    get currentInUseVersionName() {
        const inUse = this._rawVersions.find(v => v.Version_Status__c === 'Active')
                   || this._rawVersions.find(v => v.Version_Status__c === 'Scheduled');
        return inUse ? inUse.Name : null;
    }

    // ─── Badge area — stop row-selection, then route action ──────────────────

    handleBadgeAreaClick(event) {
        event.stopPropagation(); // don't select the row
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const action    = btn.dataset.action;
        const versionId = btn.dataset.versionId;
        if (!action || !versionId) return;
        if (action === 'markReady')        this._markReady(versionId);
        if (action === 'revertDraft')      this._revertDraft(versionId);
        if (action === 'withdrawSchedule') this._withdrawSchedule(versionId);
    }

    // ─── Row click ───────────────────────────────────────────────────────────

    handleVersionRowClick(event) {
        const versionId = event.currentTarget.dataset.versionId;
        const version = this._rawVersions.find(v => v.Id === versionId);
        if (version) this.displayedVersion = version;
    }

    // ─── Row action buttons ──────────────────────────────────────────────────

    handleRowActionClick(event) {
        event.stopPropagation();
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const action    = btn.dataset.action;
        const versionId = btn.dataset.versionId;
        if (!action || !versionId) return;

        switch (action) {
            case 'edit':        this._openWizard('edit', versionId);   break;
            case 'clone':       this._openWizard('clone', versionId);  break;
            case 'markReady':        this._markReady(versionId);             break;
            case 'revertDraft':      this._revertDraft(versionId);           break;
            case 'withdrawSchedule': this._withdrawSchedule(versionId);      break;
            case 'delete':           this._confirmDelete(versionId);         break;
            default: break;
        }
    }

    // ─── New Version button ──────────────────────────────────────────────────

    handleNewVersion() {
        // Use the In-Use version as the source to prefill; fall back to the first version
        const source = this._rawVersions.find(v => v.Version_Status__c === 'Active')
                    || this._rawVersions[0];
        this._openWizard('new-version', source ? source.Id : null);
    }

    // ─── Wizard helpers ──────────────────────────────────────────────────────

    _openWizard(mode, sourceVersionId) {
        this.wizardMode = mode;
        this.wizardSourceVersionId = sourceVersionId || null;
        this.showWizard = true;
    }

    handleWizardCancel() {
        this._closeWizard();
    }

    async handleWizardSaved() {
        this._closeWizard();
        this.displayedVersion = null;
        await refreshApex(this._wiredVersionsResult);
        notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
    }

    _closeWizard() {
        this.showWizard = false;
        this.wizardMode = null;
        this.wizardSourceVersionId = null;
    }

    // ─── Inline status transitions ───────────────────────────────────────────

    async _markReady(versionId) {
        this.isLoading = true;
        try {
            await markVersionReady({ versionId });
            this.showSuccess('Version marked as Ready.');
            await refreshApex(this._wiredVersionsResult);
        } catch (err) {
            this.showError(err?.body?.message || 'Failed to mark version as Ready.');
        } finally {
            this.isLoading = false;
        }
    }

    async _revertDraft(versionId) {
        this.isLoading = true;
        try {
            await revertVersionToDraft({ versionId });
            this.showSuccess('Version reverted to Draft.');
            await refreshApex(this._wiredVersionsResult);
        } catch (err) {
            this.showError(err?.body?.message || 'Failed to revert version to Draft.');
        } finally {
            this.isLoading = false;
        }
    }

    async _withdrawSchedule(versionId) {
        this.isLoading = true;
        try {
            await withdrawSchedule({ versionId });
            this.showSuccess('Schedule withdrawn. Version is back to Ready.');
            await refreshApex(this._wiredVersionsResult);
        } catch (err) {
            this.showError(err?.body?.message || 'Failed to withdraw schedule.');
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Delete modal ────────────────────────────────────────────────────────

    _confirmDelete(versionId) {
        this._pendingDeleteVersionId = versionId;
        this.showDeleteModal = true;
    }

    handleCancelDelete() {
        this.showDeleteModal = false;
        this._pendingDeleteVersionId = null;
    }

    async handleConfirmDelete() {
        const versionId = this._pendingDeleteVersionId;
        this.showDeleteModal = false;
        this._pendingDeleteVersionId = null;
        this.isLoading = true;
        try {
            await deleteVersion({ versionId });
            if (this.displayedVersion && this.displayedVersion.Id === versionId) {
                this.displayedVersion = null;
            }
            this.showSuccess('Version deleted.');
            await refreshApex(this._wiredVersionsResult);
            notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
        } catch (err) {
            this.showError(err?.body?.message || 'Failed to delete version.');
        } finally {
            this.isLoading = false;
        }
    }

    get pendingDeleteVersionName() {
        if (!this._pendingDeleteVersionId) return '';
        const v = this._rawVersions.find(r => r.Id === this._pendingDeleteVersionId);
        return v ? v.Name : '';
    }

    // ─── Activate modal ──────────────────────────────────────────────────────

    handleActivateThisVersion() {
        // Check for date overlap with the currently Active version
        const activeVer = this._rawVersions.find(v => v.Version_Status__c === 'Active');
        const newVer = this.displayedVersion;
        if (activeVer && newVer && newVer.Valid_From__c && newVer.Valid_To__c
                && activeVer.Valid_From__c && activeVer.Valid_To__c) {
            const newFrom = parseLocalDate(newVer.Valid_From__c);
            const newTo   = parseLocalDate(newVer.Valid_To__c);
            const actFrom = parseLocalDate(activeVer.Valid_From__c);
            const actTo   = parseLocalDate(activeVer.Valid_To__c);
            const overlaps = newFrom <= actTo && newTo >= actFrom;
            // For future-dated new version with overlap — warn user the active will be deactivated on that date
            // For same/past dates — warn that the currently active version will be immediately deactivated
            if (overlaps) {
                this.showOverlapModal = true;
                return;
            }
        }
        this.showActivateModal = true;
    }

    handleCancelActivate()      { this.showActivateModal = false; }
    handleCancelOverlap()       { this.showOverlapModal = false; }

    handleOverlapConfirmProceed() {
        this.showOverlapModal = false;
        this.showActivateModal = true;
    }

    get overlapWarningMessage() {
        const activeVer = this._rawVersions.find(v => v.Version_Status__c === 'Active');
        const newVer = this.displayedVersion;
        if (!activeVer || !newVer) return '';
        const newFrom = parseLocalDate(newVer.Valid_From__c);
        const today = localMidnightToday();
        if (newFrom && newFrom > today) {
            return `The validity period of this version overlaps with the currently Active version "${activeVer.Name}". ` +
                   `If you proceed, the Active version will be automatically scheduled for deactivation on ${fmtDate(newVer.Valid_From__c)}.`;
        }
        return `The validity period of this version overlaps with the currently Active version "${activeVer.Name}". ` +
               `If you proceed, the Active version will be immediately deactivated.`;
    }

    async handleConfirmActivate() {
        this.showActivateModal = false;
        this.isLoading = true;
        try {
            await activateVersion({ offerId: this.recordId, versionId: this.displayedVersion.Id });
            this.showSuccess('Version activated successfully.');
            await refreshApex(this._wiredVersionsResult);
            notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
        } catch (err) {
            this.showError(err?.body?.message || 'Failed to activate version.');
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _rowClass(version) {
        let cls = 'version-list-item';
        if (this.displayedVersion && this.displayedVersion.Id === version.Id) cls += ' version-list-item_selected';
        if (version.Version_Status__c === 'Active')    cls += ' version-list-item_in-use';
        if (version.Version_Status__c === 'Scheduled') cls += ' version-list-item_scheduled';
        return cls;
    }

    showSuccess(message) {
        this.dispatchEvent(new ShowToastEvent({ title: 'Success', message, variant: 'success' }));
    }

    showError(message) {
        this.dispatchEvent(new ShowToastEvent({ title: 'Error', message, variant: 'error', mode: 'sticky' }));
    }
}