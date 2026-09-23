import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getActiveProducts from '@salesforce/apex/OfferController.getActiveProducts';
import getProductFamilyValues from '@salesforce/apex/OfferController.getProductFamilyValues';
import getCustomerTypeOptions from '@salesforce/apex/OfferController.getCustomerTypeOptions';
import saveNewOffer from '@salesforce/apex/OfferController.saveNewOffer';
import createNewVersion from '@salesforce/apex/OfferController.createNewVersion';
import updateVersion from '@salesforce/apex/OfferController.updateVersion';
import updateVersionCtaFields from '@salesforce/apex/OfferController.updateVersionCtaFields';
import updateVersionDatesAndUrls from '@salesforce/apex/OfferController.updateVersionDatesAndUrls';
import updateMasterOffer from '@salesforce/apex/OfferController.updateMasterOffer';
import getOfferById from '@salesforce/apex/OfferController.getOfferById';
import getVersionById from '@salesforce/apex/OfferController.getVersionById';
import getOfferVersions from '@salesforce/apex/OfferController.getOfferVersions';
import activateOffer from '@salesforce/apex/OfferController.activateOfferVersion';
import activateVersion from '@salesforce/apex/OfferController.activateVersion';
import deactivateOffer from '@salesforce/apex/OfferController.deactivateOffer';
import decommissionOffer from '@salesforce/apex/OfferController.decommissionOffer';
import markVersionReady from '@salesforce/apex/OfferController.markVersionReady';
import revertVersionToDraft from '@salesforce/apex/OfferController.revertVersionToDraft';
import checkDateOverlap from '@salesforce/apex/OfferController.checkDateOverlap';
import resolveDateOverlap from '@salesforce/apex/OfferController.resolveDateOverlap';
import getOfferAttributesForFamily from '@salesforce/apex/OfferAttributeController.getOfferAttributesForFamily';

// Offer_Version__c parameter fields copied into offerParams when prefilling an
// existing version (edit / clone / new-version). This is NOT a rendering catalog:
// Step 2 fields, labels, required-ness, types and picklist options all come from
// the Marketing Dictionary (mdAttributes). This list only tells prefill which
// version fields carry offer-parameter values worth restoring into the form.
const VERSION_PARAM_FIELDS = [
    'Minimal_Amount__c', 'Maximum_Amount__c', 'Maximum_Tenure__c', 'RRSO__c',
    'Commission_Amount_Flat_Fee__c', 'Representative_Example__c', 'Duration_Days__c',
    'Nominal_Interest_Rate__c', 'Interest_Capitalization__c', 'Max_Owned_Products_Limit__c',
    'Deposit_Duration_Months__c', 'Base_Interest_Rate__c', 'Promotional_Interest_Rate__c',
    'Grace_Period_Days__c', 'Commission_Percentage__c', 'Card_Fee__c',
    'Maximum_Promotional_Amount__c', 'Earlier_Repayment_Fee__c', 'Interest_Type__c',
    'Sales_Process__c', 'NO_Fees_Conditions_Simplicity__c', 'Additional_VAS__c',
    'Own_Input_Percentage__c', 'Product_Id__c'
];

const SCORE_REFERENCE = {
    'Cash Loan': { amountMin: 1000, amountMax: 250000, tenureMin: 0, tenureMax: 120, refRate: 14.5 },
    'Consolidation Loan': { amountMin: 1000, amountMax: 250000, tenureMin: 0, tenureMax: 120, refRate: 14.5 },
    'Credit Card': { amountMin: 0, amountMax: 100000, tenureMin: 0, tenureMax: 0, refRate: 14.5 },
    'Mortgage': { amountMin: 0, amountMax: 0, tenureMin: 0, tenureMax: 360, refRate: 14.5 },
    'Home Equity Loan': { amountMin: 0, amountMax: 0, tenureMin: 0, tenureMax: 360, refRate: 14.5 },
    'Term Deposit': { amountMin: 0, amountMax: 0, tenureMin: 0, tenureMax: 0, refRate: 3.75 },
    'Term Deposit FX': { amountMin: 0, amountMax: 0, tenureMin: 0, tenureMax: 0, refRate: 3.75 },
    'Saving Account': { amountMin: 0, amountMax: 0, tenureMin: 0, tenureMax: 0, refRate: 3.75 },
    'Saving Account FX': { amountMin: 0, amountMax: 0, tenureMin: 0, tenureMax: 0, refRate: 3.75 }
};

const SCORE_WEIGHTS = {
    'Cash Loan': { Nominal_Interest_Rate__c: 0.45, Sales_Process__c: 0.15, Maximum_Amount__c: 0.10, Maximum_Tenure__c: 0.10, Earlier_Repayment_Fee__c: 0.10, Interest_Type__c: 0.10 },
    'Consolidation Loan': { Nominal_Interest_Rate__c: 0.45, Sales_Process__c: 0.15, Maximum_Amount__c: 0.10, Maximum_Tenure__c: 0.10, Earlier_Repayment_Fee__c: 0.10, Interest_Type__c: 0.10 },
    'Credit Card': { NO_Fees_Conditions_Simplicity__c: 0.35, Grace_Period_Days__c: 0.20, Sales_Process__c: 0.15, Additional_VAS__c: 0.15, Nominal_Interest_Rate__c: 0.10, Maximum_Amount__c: 0.05 },
    'Mortgage': { Nominal_Interest_Rate__c: 0.50, Earlier_Repayment_Fee__c: 0.15, Own_Input_Percentage__c: 0.15, Interest_Type__c: 0.10, Sales_Process__c: 0.05, Maximum_Tenure__c: 0.05 },
    'Home Equity Loan': { Nominal_Interest_Rate__c: 0.65, Earlier_Repayment_Fee__c: 0.15, Interest_Type__c: 0.10, Sales_Process__c: 0.05, Maximum_Tenure__c: 0.05 },
    'Term Deposit': { Nominal_Interest_Rate__c: 0.65, Maximum_Promotional_Amount__c: 0.25, Interest_Type__c: 0.10 },
    'Term Deposit FX': { Nominal_Interest_Rate__c: 0.65, Maximum_Promotional_Amount__c: 0.25, Interest_Type__c: 0.10 },
    'Saving Account': { Nominal_Interest_Rate__c: 0.65, Maximum_Promotional_Amount__c: 0.35 },
    'Saving Account FX': { Nominal_Interest_Rate__c: 0.65, Maximum_Promotional_Amount__c: 0.35 }
};

const SCORE_CATEGORICAL = {
    Earlier_Repayment_Fee__c: { YES: 0, NO: 1 },
    Interest_Type__c: { variable: 0.5, fixed: 1 },
    Sales_Process__c: { branch: 0.5, omnichannel: 0.75, online: 1 },
    Grace_Period_Days__c: { short: 0.25, standard: 0.5, long: 0.75 },
    Additional_VAS__c: { none: 0, poor: 0.2, fair: 0.4, good: 0.6, excellent: 0.8, outstanding: 1 },
    NO_Fees_Conditions_Simplicity__c: { 'no fee': 1, easy: 0.75, medium: 0.5, difficult: 0.25, 'not possible': 0 },
    Own_Input_Percentage__c: { '10%': 1, '10-20%': 0.75, '20%+': 0.25 }
};

export default class OfferManager extends NavigationMixin(LightningElement) {
    /** Set to true when embedded inside another component (e.g. offerVersionPanel).
     *  Suppresses all NavigationMixin calls — parent handles routing via events. */
    @api hosted = false;

    /**
     * 'new-version' — blank wizard pre-seeded with offer name (read-only) + next version number.
     *                  Source version supplies product family / params as defaults; dates cleared.
     * 'clone'       — wizard pre-filled from sourceVersionId; all fields editable; dates cleared & validated.
     * 'edit'        — wizard pre-filled from sourceVersionId; all fields editable (same as clone but intent is update).
     * null / unset  — create brand-new offer from scratch.
     */
    @api wizardMode = null;

    _sourceVersionId = '';
    @api
    get sourceVersionId() { return this._sourceVersionId; }
    set sourceVersionId(value) {
        this._sourceVersionId = value;
        if (value) {
            Promise.resolve().then(() => this.loadSourceVersion());
        }
    }

    _recordId = '';
    @api
    get recordId() { return this._recordId; }
    set recordId(value) {
        this._recordId = value;
        if (value && !this._sourceVersionId) {
            Promise.resolve().then(() => this.loadExistingOffer());
        }
    }

    _versionId = '';
    @api
    get versionId() { return this._versionId; }
    set versionId(value) {
        this._versionId = value;
        if (value) {
            Promise.resolve().then(() => this.loadExistingVersion());
        }
    }

    @track currentStep = 1;
    @track isLoading = false;
    @track offerParams = {};

    @track offerName = '';
    @track existingOfferName = '';
    @track countryCode = '';
    @track offerStatus = 'Draft';
    @track isActive = false;
    @track isPromo = false;
    @track currentVersionId = '';
    @track currentVersionSfId = '';
    @track currentVersionStatus = 'Draft';
    @track currentScheduleStatus = null;
    @track statusLocked = true;
    @track showDecommissionConfirm = false;

    @track validFrom = '';
    @track validTo = '';

    @track ctaUrl = '';
    @track ctaDurl = '';
    @track ctaIntent = '';
    @track regUrl = '';

    @track showOverlapConfirm = false;
    @track overlapCurrentValidFrom = '';
    @track overlapCurrentValidTo = '';

    // selectedCustomerTypes holds Marketing_Dictionary__c Ids (Id-based junction selection).
    @track selectedCustomerTypes = [];
    // Customer Type dictionary entries [{id, name}] driving the badge options; ctNameById maps
    // an Id back to its name for name-based product matching and summary display.
    @track customerTypeDictOptions = [];
    ctNameById = {};
    @track selectedProductFamily = '';
    @track selectedProductIds = [];

    @track allProducts = [];
    @track allProductFamilies = [];

    @track showDeactivateConfirm = false;
    @track pendingStatusValue = '';

    @track showValidationErrors = false;
    @track showOptionalParams = false;
    @track mdAttributes = [];
    // MERGE 2026-09-14: loading flag for Step 2 attribute fetch (from Filip's version).
    // To revert: remove this line and the isLoadingAttributes usages in loadMdAttributes/hasVisibleParams.
    @track isLoadingAttributes = false;
    @track _pendingSourceProducts = '';

    totalSteps = 3;



    async loadExistingOffer() {
        if (this._sourceVersionId) return; // loadSourceVersion handles this path
        this.isLoading = true;
        try {
            const offer = await getOfferById({ offerId: this.recordId });
            if (offer) {
                this.existingOfferName = offer.Name || '';
                this.offerName = offer.Name || '';
                this.countryCode = offer.Country_Code__c || this.parseCountryCodeFromName(offer.Name) || '';
                this.offerStatus = offer.Offer_Status__c || 'Draft';
                this.isActive = offer.Is_Active__c || false;
                this.isPromo = offer.Is_Promo__c || false;
                this.currentVersionId = offer.Offer_Version_Id__c || '';
                this.selectedProductFamily = offer.Product_Family_Name__c || '';
                this.validFrom = offer.Valid_From__c || '';
                this.validTo = offer.Valid_To__c || '';
                this._pendingSourceProducts = offer.Source_Products__c || '';
                this.resolveSourceProductIds();
                this.hydrateAdditionalParams(offer.Additional_Parameters__c);
            }

            const versions = await getOfferVersions({ offerId: this.recordId });
            if (versions && versions.length > 0) {
                const latest = versions[0];
                this.currentVersionSfId = latest.Id || '';
                this.currentVersionStatus = latest.Version_Status__c || 'Draft';
                this.currentScheduleStatus = latest.Schedule_Status__c || null;
                this.prefillFromVersion(latest);
            }
            this.loadMdAttributes();
        } catch (error) {
            console.error('Error loading offer:', error);
        } finally {
            this.isLoading = false;
        }
    }

    async loadExistingVersion() {
        this.isLoading = true;
        try {
            const version = await getVersionById({ versionId: this._versionId });
            if (version) {
                // The parent Offer__c is accessed via the lookup
                this._recordId = version.Offer_Lookup__c || '';
                this.currentVersionSfId = version.Id || '';
                this.currentVersionId = version.Offer_Version_Id__c || '';
                this.currentVersionStatus = version.Version_Status__c || 'Draft';
                this.currentScheduleStatus = version.Schedule_Status__c || null;

                // Load parent offer for status/name
                if (this._recordId) {
                    const offer = await getOfferById({ offerId: this._recordId });
                    if (offer) {
                        this.existingOfferName = offer.Name || '';
                        this.offerName = offer.Name || '';
                        this.offerStatus = offer.Offer_Status__c || 'Draft';
                        this.isActive = offer.Is_Active__c || false;
                        this.countryCode = offer.Country_Code__c || this.parseCountryCodeFromName(offer.Name) || '';
                    }
                }

                this.prefillFromVersion(version);
                this._pendingSourceProducts = version.Source_Products__c || '';
                this.resolveSourceProductIds();
            }
        } catch (error) {
            console.error('Error loading version:', error);
        } finally {
            this.isLoading = false;
        }
    }

    async loadSourceVersion() {
        if (!this._sourceVersionId) return;
        this.isLoading = true;
        try {
            const version = await getVersionById({ versionId: this._sourceVersionId });
            if (!version) return;

            // Load parent offer for name / status
            if (version.Offer_Lookup__c) {
                this._recordId = version.Offer_Lookup__c;
                const offer = await getOfferById({ offerId: version.Offer_Lookup__c });
                if (offer) {
                    this.existingOfferName = offer.Name || '';
                    this.offerName = offer.Name || '';
                    this.offerStatus = offer.Offer_Status__c || 'Draft';
                    this.isActive = offer.Is_Active__c || false;
                    this.countryCode = offer.Country_Code__c
                        ? offer.Country_Code__c.replace(/,+$/, '')
                        : this.parseCountryCodeFromName(offer.Name) || '';
                }
            }

            // Prefill fields from source version
            this.prefillFromVersion(version);
            this._pendingSourceProducts = version.Source_Products__c || '';
            this.resolveSourceProductIds();
            this.loadMdAttributes();

            if (this.wizardMode === 'new-version' || this.wizardMode === 'clone') {
                // Clear dates so user must set new valid period
                this.validFrom = '';
                this.validTo = '';
                // Force validation errors visible so user knows dates are required
                this.showValidationErrors = true;
            }

            // new-version: fields fully editable, treat as new (no currentVersionSfId)
            if (this.wizardMode === 'new-version') {
                this.currentVersionSfId = '';
                this.currentVersionStatus = 'Draft';
                this.currentScheduleStatus = null;
                this.statusLocked = false;
            }

            // edit: load as if editing that specific version
            if (this.wizardMode === 'edit') {
                this.currentVersionSfId = version.Id || '';
                this.currentVersionStatus = version.Version_Status__c || 'Draft';
                this.currentScheduleStatus = version.Schedule_Status__c || null;
                this.statusLocked = false;
            }

            // clone: same as new-version
            if (this.wizardMode === 'clone') {
                this.currentVersionSfId = '';
                this.currentVersionStatus = 'Draft';
                this.currentScheduleStatus = null;
                this.statusLocked = false;
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('loadSourceVersion error:', error);
        } finally {
            this.isLoading = false;
        }
    }

    // --- WIRES ---

    @wire(getActiveProducts)
    wiredProducts({ data, error }) {
        if (data) {
            // MERGE 2026-09-14 FIX: OfferController.getActiveProducts returns a pre-assembled map
            // (customerType joined from the junction, productTypeName as a string) — NOT raw Product2
            // fields. Reading p.Customer_Type__c / p.RecordType here left customerType empty, which
            // made the customer-type filter reject every product family. Read the map keys instead.
            this.allProducts = data.map(p => ({
                id: p.Id,
                name: p.Name,
                family: p.Family,
                familyOfNeeds: p.Family_of_Needs__c,
                customerType: p.customerType || '',
                recordType: p.productTypeName || ''
            }));
            this.resolveSourceProductIds();
        }
        if (error) {
            console.error('Error loading products:', error);
        }
    }

    resolveSourceProductIds() {
        if (!this._pendingSourceProducts || this.allProducts.length === 0) return;
        const names = this._pendingSourceProducts.split(',').map(n => n.trim()).filter(Boolean);
        this.selectedProductIds = this.allProducts
            .filter(p => names.includes(p.name))
            .map(p => p.id);
        this._pendingSourceProducts = '';
    }

    @wire(getProductFamilyValues)
    wiredFamilies({ data, error }) {
        if (data) {
            this.allProductFamilies = data;
        }
        if (error) {
            console.error('Error loading product families:', error);
        }
    }

    @wire(getCustomerTypeOptions)
    wiredCustomerTypes({ data, error }) {
        if (data) {
            this.customerTypeDictOptions = data;
            this.ctNameById = data.reduce((acc, o) => {
                acc[o.id] = o.name;
                return acc;
            }, {});
        }
        if (error) {
            console.error('Error loading customer types:', error);
        }
    }

    // --- GETTERS ---

    get modalTitle() {
        if (this.wizardMode === 'new-version') return `New version — ${this.existingOfferName}`;
        if (this.wizardMode === 'clone')       return `Clone — ${this.existingOfferName}`;
        if (this.wizardMode === 'edit')        return `Edit — ${this.existingOfferName}`;
        return this.isExistingOffer ? this.existingOfferName : this.generatedOfferName;
    }

    get isExistingOffer() {
        return !!this._recordId || !!this._versionId;
    }

    get isOfferNameReadOnly() {
        return this.isIdentityReadOnly || this.areFieldsReadOnly;
    }

    get isVersionContext() {
        return !!this._versionId;
    }

    get isStatusLocked() {
        return this.statusLocked;
    }

    get isStatusUnlocked() {
        return !this.statusLocked;
    }

    get lockButtonClass() {
        return this.statusLocked
            ? 'lock-toggle-btn lock-toggle-locked'
            : 'lock-toggle-btn lock-toggle-unlocked';
    }

    get lockToggleTitle() {
        return this.statusLocked ? 'Click to unlock status controls' : 'Click to lock status controls';
    }

    get canEditStatus() {
        return this.isExistingOffer && !this.statusLocked;
    }

    // Version status is editable only when unlocked AND the version is not In Use (or effectively in use)
    get canEditVersionStatus() {
        return this.isExistingOffer && !this.statusLocked && !this.isVersionEffectivelyInUse && !this.isVersionScheduledActivation && !this.isVersionDeactivated;
    }

    get versionStatusOptions() {
        const all = [
            { label: 'Draft', value: 'Draft' },
            { label: 'Ready', value: 'Ready' }
        ];
        return all.map(o => ({ ...o, selected: o.value === this.currentVersionStatus }));
    }

    get isActiveLocked() {
        if (!this.isExistingOffer) return true;
        return this.statusLocked;
    }

    get statusBadgeClass() {
        const base = 'status-badge';
        if (this.offerStatus === 'Active') return base + ' status-active';
        if (this.offerStatus === 'Inactive') return base + ' status-inactive';
        if (this.offerStatus === 'Decommissioned') return base + ' status-decommissioned';
        return base + ' status-draft';
    }

    get statusDisplayLabel() {
        return this.offerStatus === 'Draft' ? 'Draft' : this.offerStatus;
    }

    get offerStatusOptions() {
        const options = [
            { label: 'Draft', value: 'Draft' },
            { label: 'Active', value: 'Active' },
            { label: 'Inactive', value: 'Inactive' },
            { label: 'Decommissioned', value: 'Decommissioned' }
        ];
        return options.map(o => ({
            ...o,
            selected: o.value === this.offerStatus
        }));
    }

    // Version status getters
    get versionStatusBadgeClass() {
        const base = 'version-status-badge';
        if (this.currentVersionStatus === 'Active')      return base + ' version-active';
        if (this.currentVersionStatus === 'Ready')       return base + ' version-ready';
        if (this.currentVersionStatus === 'Scheduled')   return base + ' version-scheduled-activation';
        if (this.currentVersionStatus === 'Deactivated') return base + ' version-deactivated';
        if (this.currentScheduleStatus === 'Scheduled for Deactivation') return base + ' version-scheduled-deactivation';
        return base + ' version-draft';
    }

    get isVersionInUse() {
        return this.currentVersionStatus === 'Active';
    }

    get isVersionReady() {
        return this.currentVersionStatus === 'Ready';
    }

    get isVersionDraft() {
        return this.currentVersionStatus === 'Draft';
    }

    get isVersionScheduledActivation() {
        return this.currentVersionStatus === 'Scheduled';
    }

    get isVersionScheduledDeactivation() {
        return this.currentScheduleStatus === 'Scheduled for Deactivation';
    }

    get isVersionDeactivated() {
        return this.currentVersionStatus === 'Deactivated';
    }

    // A version tagged for deactivation is still serving live traffic — treat as In Use for read-only purposes
    get isVersionEffectivelyInUse() {
        return this.isVersionInUse || this.isVersionScheduledDeactivation;
    }

    get areFieldsReadOnly() {
        return this.isVersionEffectivelyInUse || this.isVersionReady
            || this.isVersionScheduledActivation || this.isVersionDeactivated;
    }

    // True when the version is non-Draft but still allows date + URL edits.
    // ScheduledDeactivation versions are read-only — no edits permitted.
    get isLimitedEditMode() {
        return this.wizardMode === 'edit'
            && (this.isVersionReady || this.isVersionScheduledActivation);
    }

    // Modify action on a live (Active) version: CTA/REG stay editable and Valid To
    // can be extended or shortened (future dates only). Valid From and all Properties
    // stay locked — this is a direct overwrite in place, no new version is created.
    get isActiveModifyMode() {
        return this.wizardMode === 'edit' && this.isVersionInUse;
    }

    get areDatesReadOnly() {
        if (this.isLimitedEditMode) return false;
        return this.areFieldsReadOnly;
    }

    // Valid From is never editable on a live version — it is already in the past.
    get isValidFromReadOnly() {
        return this.areDatesReadOnly;
    }

    // Valid To is editable in limited-edit mode and on an active-modify (extend/shorten).
    get isValidToReadOnly() {
        if (this.isActiveModifyMode) return false;
        return this.areDatesReadOnly;
    }

    get showMarkReadyButton() {
        return this.isExistingOffer && this.isVersionDraft && !this.statusLocked;
    }

    get showRevertToDraftButton() {
        return this.isExistingOffer && this.isVersionReady && !this.statusLocked;
    }

    get showActivateButton() {
        // Cannot activate Deactivated versions or ones already scheduled/in-use
        return this.isExistingOffer
            && (this.isVersionReady || this.isVersionDraft)
            && !this.statusLocked
            && !this.isVersionDeactivated;
    }

    get areCtaFieldsReadOnly() {
        if (!this.isExistingOffer) return false;
        if (this.isLimitedEditMode) return false;
        if (this.isActiveModifyMode) return false;
        return this.isVersionEffectivelyInUse || this.isVersionScheduledActivation || this.isVersionDeactivated;
    }

    get showCtaUpdateButton() {
        return this.isExistingOffer && (this.isVersionDraft || this.isVersionReady) && this.currentVersionSfId;
    }

    get countryCodeOptions() {
        return [
            { label: 'PL', value: 'PL' },
            { label: 'PT', value: 'PT' },
            { label: 'ES', value: 'ES' }
        ];
    }

    // Offer Identity fields (Name, CountryCode, CurrencyCode) are only editable
    // when creating a brand-new offer (no recordId, no versionId).
    get isIdentityReadOnly() {
        return !!this._recordId || !!this._versionId || this.wizardMode === 'new-version' || this.wizardMode === 'clone' || this.wizardMode === 'edit';
    }


    get generatedOfferName() {
        const cc = this.countryCode || '{{CountryCode}}';
        const pf = this.selectedProductFamily ? this.toCamelCase(this.selectedProductFamily) : '{{ProductFamily}}';
        const name = this.offerName ? this.toCamelCase(this.offerName) : '{{OfferName}}';
        return `OFR_${cc}_${pf}_${name}`;
    }

    // Date getters
    get todayDate() {
        return new Date().toISOString().split('T')[0];
    }

    get tomorrowDate() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    }

    get validToMin() {
        // Active-modify: Valid To must be a future date (> today), whether extending or shortening.
        if (this.isActiveModifyMode) return this.tomorrowDate;
        return this.validFrom || this.todayDate;
    }

    get dateValidationError() {
        if (!this.showValidationErrors) return '';
        if (!this.validFrom) return 'Valid From date is required.';
        if (!this.validTo) return 'Valid To date is required.';
        if (!this.isExistingOffer && this.validFrom < this.todayDate) return 'Valid From cannot be in the past.';
        if (!this.isExistingOffer && this.validTo < this.todayDate) return 'Valid To cannot be in the past.';
        if (this.isActiveModifyMode && this.validTo <= this.todayDate) return 'Valid To must be a future date.';
        if (this.validTo < this.validFrom) return 'Valid To cannot be earlier than Valid From.';
        return '';
    }

    get customerTypeError() {
        if (!this.showValidationErrors) return false;
        return this.selectedCustomerTypes.length === 0;
    }

    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }

    // ---- Step 2 editable properties, sourced from the Marketing Dictionary ----

    // Maps Marketing Dictionary Parameter_Type__c → the input widget rendered in Step 2.
    // Number / Currency / Percent all use the number input (the wizard's existing
    // entry pattern); Picklist → combobox; Checkbox → checkbox; everything else → text.
    buildMdParamViewModel(a) {
        const type = a.type || 'Text';
        const isNumber = type === 'Number' || type === 'Currency' || type === 'Percent';
        const isPicklist = type === 'Picklist';
        const isCheckbox = type === 'Checkbox';
        const isDate = type === 'Date';
        // MERGE 2026-09-14: textarea widget + per-param read-only + description (from Filip's version).
        // isReadOnly covers Apriori (pre-defined) attributes whose values are system-managed.
        // Reference attributes (Autopopulate) are prefilled from the reference value but remain
        // editable in the wizard, so they are intentionally excluded from isReadOnly.
        // To revert: drop isTextarea/isReadOnly/description here and in the template.
        const isTextarea = type === 'Textarea';
        // RANGE: a Range attribute renders a dual-handle slider hard-clamped to the reference
        // [min,max]. Its value is stored as two fields (<base>_Min__c/<base>_Max__c) by naming
        // convention, not under the base fieldApiName, so it is excluded from the isText fallback.
        const isRange = type === 'Range';
        const isText = !isNumber && !isPicklist && !isCheckbox && !isDate && !isTextarea && !isRange;
        const isReadOnly = a.valueSource === 'Apriori';
        const field = a.fieldApiName;
        const stored = field !== undefined && field !== null ? this.offerParams[field] : undefined;
        // RANGE: derive the paired field names + clamp bounds; seed the current selection from
        // stored values, falling back to the reference bounds (full range) when unset.
        const { minField, maxField } = this._rangeFieldNames(field);
        const referenceMin = a.referenceValueMin;
        const referenceMax = a.referenceValueMax;
        const storedMin = minField ? this.offerParams[minField] : undefined;
        const storedMax = maxField ? this.offerParams[maxField] : undefined;
        return {
            key: a.ruleId || a.attributeId,
            field,
            label: a.label,
            helpText: a.helpText,
            description: a.description,
            isRequired: a.isRequired === true,
            // RANGE: range values persist via their dedicated Min/Max fields, so treat them as
            // mapped regardless of whether the base fieldApiName resolves to a writable field.
            isMapped: isRange ? true : (a.isMapped === true),
            isNumber,
            isPicklist,
            isCheckbox,
            isDate,
            isTextarea,
            isRange,
            isText,
            isReadOnly,
            // MERGE 2026-09-14: disabled = wizard-wide lock OR this attribute being system-managed.
            disabled: this.areFieldsReadOnly || isReadOnly,
            currentValue: stored !== undefined ? stored : (isCheckbox ? false : ''),
            comboOptions: (a.picklistOptions || []).map(o => ({ label: o, value: o })),
            // RANGE slider bindings (hard clamp = reference [min,max]).
            minField,
            maxField,
            referenceMin,
            referenceMax,
            currentMin: storedMin !== undefined && storedMin !== null ? storedMin : referenceMin,
            currentMax: storedMax !== undefined && storedMax !== null ? storedMax : referenceMax
        };
    }

    // RANGE: build the paired Offer_Version__c field names from a base fieldApiName by naming
    // convention (decision 2a): "Foo__c" → { minField: "Foo_Min__c", maxField: "Foo_Max__c" }.
    // TEST WIRING: until per-attribute _Min__c/_Max__c fields are created, a Range attribute
    // whose Parameter_API_Name__c is one of these existing amount fields reuses the existing
    // Minimal_Amount__c / Maximum_Amount__c pair (already in save + prefill paths), so the
    // full flow can be exercised with zero new metadata. Remove this map when going live.
    _rangeFieldNames(baseField) {
        if (!baseField) return { minField: null, maxField: null };
        const overrides = {
            minimal_amount__c: { minField: 'Minimal_Amount__c', maxField: 'Maximum_Amount__c' },
            maximum_amount__c: { minField: 'Minimal_Amount__c', maxField: 'Maximum_Amount__c' }
        };
        const override = overrides[baseField.toLowerCase()];
        if (override) return override;
        const stem = baseField.replace(/__c$/i, '');
        return { minField: `${stem}_Min__c`, maxField: `${stem}_Max__c` };
    }

    // All visible MD attributes for the family as editable view-models, in rule order.
    get mdParamViewModels() {
        return (this.mdAttributes || [])
            .filter(a => a.fieldApiName)
            .map(a => this.buildMdParamViewModel(a));
    }

    get requiredParams() {
        return this.mdParamViewModels.filter(p => p.isRequired);
    }

    get optionalParams() {
        return this.mdParamViewModels.filter(p => !p.isRequired);
    }

    get hasRequiredParams() {
        return this.requiredParams.length > 0;
    }

    get hasOptionalParams() {
        return this.optionalParams.length > 0;
    }

    get hasVisibleParams() {
        // MERGE 2026-09-14: keep the section visible during the async fetch so the spinner shows.
        return this.mdParamViewModels.length > 0 || this.isLoadingAttributes;
    }

    // Custom attributes that have no dedicated Offer_Version__c field. Their values
    // are persisted as JSON in Additional_Parameters__c, keyed by fieldApiName.
    get unmappedParams() {
        return this.mdParamViewModels.filter(p => !p.isMapped);
    }

    get optionalToggleLabel() {
        return this.showOptionalParams ? 'Hide Optional properties' : 'Show Optional properties';
    }

    get optionalToggleIcon() {
        return this.showOptionalParams ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get summaryParams() {
        const rows = [];
        this.mdParamViewModels.forEach(p => {
            if (p.isRange) {
                // RANGE: values live under the Min/Max fields, not the base field.
                const lo = this.offerParams[p.minField];
                const hi = this.offerParams[p.maxField];
                if ((lo !== undefined && lo !== null) || (hi !== undefined && hi !== null)) {
                    rows.push({
                        field: p.field || p.key,
                        label: p.label,
                        displayValue: `${lo ?? '?'} – ${hi ?? '?'}`
                    });
                }
                return;
            }
            const val = this.offerParams[p.field];
            if (val !== undefined && val !== '' && val !== null && val !== false) {
                rows.push({ field: p.field, label: p.label, displayValue: String(val) });
            }
        });
        return rows;
    }

    // Reference Properties card: read-only benchmark values from the Marketing Dictionary.
    // Only attributes with a linked reference value belong here — custom attributes
    // without a benchmark are captured as editable inputs above, not reference values.
    get mdAttributeViewModels() {
        return (this.mdAttributes || [])
            .filter(a => a.referenceValue !== null && a.referenceValue !== undefined && a.referenceValue !== '')
            .map(a => ({
                key: a.ruleId || a.attributeId,
                label: a.label,
                helpText: a.helpText,
                displayValue: a.referenceValue
            }));
    }

    get hasMdAttributes() {
        return this.mdAttributeViewModels.length > 0;
    }
    get isLastStep() { return this.currentStep === this.totalSteps; }
    get showBackButton() { return this.currentStep > 1; }
    get showNextButton() { return this.currentStep < this.totalSteps; }

    // ---- Attractiveness scoring (mirror of OfferAttractivenessCalculator.cls) ----

    get attractivenessScore() {
        return this.computeAttractiveness();
    }

    get hasAttractivenessScore() {
        return this.attractivenessScore !== null;
    }

    get attractivenessScoreDisplay() {
        const s = this.attractivenessScore;
        return s === null ? '0' : s.toFixed(6);
    }

    computeAttractiveness() {
        const family = this.selectedProductFamily;
        const weights = SCORE_WEIGHTS[family];
        if (!weights) return null;
        const ref = SCORE_REFERENCE[family];
        const isDepositLike = family.startsWith('Term Deposit') || family.startsWith('Saving Account');

        let total = 0;
        Object.keys(weights).forEach(field => {
            let sub = this.scoreSubField(field, this.offerParams[field], ref, isDepositLike);
            if (sub === null || sub === undefined) sub = 0;
            total += weights[field] * sub;
        });
        return Math.round(total * 1e6) / 1e6;
    }

    scoreSubField(field, raw, ref, isDepositLike) {
        const CAT = SCORE_CATEGORICAL;
        if (CAT[field]) {
            const v = raw === null || raw === undefined ? null : String(raw);
            return v !== null && v in CAT[field] ? CAT[field][v] : 0;
        }
        const num = this.toNumberOrNull(raw);
        if (field === 'Nominal_Interest_Rate__c') return this.rateScore(num, ref, isDepositLike);
        if (field === 'Maximum_Amount__c') return this.minMax(num, ref.amountMin, ref.amountMax);
        if (field === 'Maximum_Tenure__c') return this.minMax(num, ref.tenureMin, ref.tenureMax);
        if (field === 'Maximum_Promotional_Amount__c') return this.depositAmountBucket(num);
        return 0;
    }

    minMax(x, lo, hi) {
        if (x === null || hi === null || lo === null || hi <= lo) return 0;
        const z = (x - lo) / (hi - lo);
        return z < 0 ? 0 : (z > 1 ? 1 : z);
    }

    rateScore(offered, ref, isDepositLike) {
        if (offered === null || !ref) return 0;
        const diff = isDepositLike ? (offered - ref.refRate) : (ref.refRate - offered);
        return isDepositLike ? this.depositRateBucket(diff) : this.loanRateBucket(diff);
    }

    loanRateBucket(d) {
        if (d <= 1) return 0.1;
        if (d <= 2) return 0.2;
        if (d <= 3) return 0.3;
        if (d <= 4) return 0.4;
        if (d <= 5) return 0.5;
        if (d <= 6) return 0.6;
        if (d <= 7) return 0.7;
        if (d <= 8) return 0.8;
        if (d <= 9) return 0.9;
        return 1;
    }

    depositRateBucket(d) {
        if (d < 0) return 0;
        if (d === 0) return 0.1;
        if (d <= 1) return 0.2;
        if (d <= 2) return 0.3;
        if (d <= 3) return 0.4;
        if (d <= 4) return 0.6;
        if (d <= 5) return 0.8;
        return 1;
    }

    depositAmountBucket(a) {
        if (a === null) return 0;
        if (a <= 25000) return 0.1;
        if (a <= 50000) return 0.2;
        if (a <= 100000) return 0.3;
        if (a <= 150000) return 0.4;
        if (a <= 200000) return 0.5;
        if (a <= 300000) return 0.6;
        if (a <= 400000) return 0.7;
        if (a <= 500000) return 0.8;
        return 1;
    }

    toNumberOrNull(raw) {
        if (raw === null || raw === undefined || raw === '') return null;
        const n = Number(raw);
        return isNaN(n) ? null : n;
    }

    get progressBarValue() {
        return Math.round(((this.currentStep - 1) / (this.totalSteps - 1)) * 100);
    }

    get progressBarStyle() {
        return `width: ${this.progressBarValue}%`;
    }

    get wizardSteps() {
        const labels = ['Basic Setup', 'Properties', 'Summary'];
        return labels.map((label, idx) => {
            const stepNum = idx + 1;
            const isComplete = stepNum < this.currentStep;
            const isActive = stepNum === this.currentStep;
            let className = 'slds-progress__item';
            if (isComplete) className += ' slds-is-completed';
            else if (isActive) className += ' slds-is-active';
            return { value: stepNum, label, className, isComplete, isActive };
        });
    }

    // Customer Type — options come from the Marketing Dictionary; value is the dictionary Id.
    get customerTypeOptions() {
        return this.customerTypeDictOptions.map(o => ({
            value: o.id,
            label: o.name,
            className: this.selectedCustomerTypes.includes(o.id)
                ? 'ct-badge ct-badge-selected'
                : 'ct-badge ct-badge-unselected'
        }));
    }

    get summaryCustomerType() {
        if (this.selectedCustomerTypes.length === 0) return 'None';
        return this.selectedCustomerTypes
            .map(id => this.ctNameById[id] || id)
            .join(', ');
    }

    // Product Families filtered by customer type
    get filteredProductFamilyOptions() {
        let families = [...this.allProductFamilies];

        if (this.selectedCustomerTypes.length > 0) {
            const validFamilies = new Set();
            this.allProducts.forEach(p => {
                if (this.productMatchesCustomerType(p)) {
                    if (p.family) validFamilies.add(p.family);
                }
            });
            families = families.filter(f => validFamilies.has(f));
        }

        return families.map(f => ({ label: f, value: f }));
    }

    get hasProductFamilySelected() {
        return !!this.selectedProductFamily;
    }

    get availableProductOptions() {
        let products = this.allProducts.filter(p => p.family === this.selectedProductFamily);

        if (this.selectedCustomerTypes.length > 0) {
            products = products.filter(p => this.productMatchesCustomerType(p));
        }

        return products.map(p => ({ label: p.name, value: p.id }));
    }

    get lockedProductIds() {
        const options = this.availableProductOptions;
        if (options.length === 1) {
            return options.map(p => p.value);
        }
        return [];
    }

    get summarySourceProducts() {
        if (!this.selectedProductIds || this.selectedProductIds.length === 0) return 'None';
        const names = this.allProducts
            .filter(p => this.selectedProductIds.includes(p.id))
            .map(p => p.name);
        return names.length > 3
            ? names.slice(0, 3).join(', ') + ` (+${names.length - 3} more)`
            : names.join(', ');
    }

    // --- HELPERS ---

    productMatchesCustomerType(product) {
        if (!product.customerType) return false;
        const productTypes = product.customerType.split(';').map(t => t.trim());
        // selectedCustomerTypes are dictionary Ids; product customer types are names.
        const selectedNames = this.selectedCustomerTypes.map(id => this.ctNameById[id]);
        return selectedNames.some(name => name && productTypes.includes(name));
    }

    toCamelCase(str) {
        if (!str) return '';
        return str.trim().split(/\s+/).map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join('');
    }

    parseCountryCodeFromName(name) {
        if (!name) return '';
        const parts = name.split('_');
        return parts.length >= 2 ? parts[1] : '';
    }

    validateStep1() {
        this.showValidationErrors = true;

        if (!this.offerName) return false;
        if (!this.countryCode) return false;
        if (!this.validFrom) return false;
        if (!this.validTo) return false;
        if (!this.isExistingOffer && this.validFrom < this.todayDate) return false;
        if (!this.isExistingOffer && this.validTo < this.todayDate) return false;
        if (this.isActiveModifyMode && this.validTo <= this.todayDate) return false;
        if (this.validTo < this.validFrom) return false;
        if (this.selectedCustomerTypes.length === 0) return false;
        if (!this.selectedProductFamily) return false;
        if (!this.selectedProductIds || this.selectedProductIds.length === 0) return false;

        return true;
    }

    validateStep2() {
        const required = this.requiredParams;
        if (required.length === 0) return true;
        return required.every(p => {
            if (p.isCheckbox) return true; // a boolean is always "filled"
            if (p.isRange) {
                // RANGE: valid when both bounds are set (seeded to the reference range by default).
                const lo = this.offerParams[p.minField];
                const hi = this.offerParams[p.maxField];
                return lo !== undefined && lo !== null && hi !== undefined && hi !== null;
            }
            const val = this.offerParams[p.field];
            return val !== undefined && val !== '' && val !== null;
        });
    }

    // --- HANDLERS: Lock/Unlock ---

    handleLockToggle() {
        this.statusLocked = !this.statusLocked;
    }

    // --- HANDLERS: Status Control ---

    handleStatusChange(event) {
        const newValue = event.target.value;

        if (newValue === 'Inactive') {
            this.pendingStatusValue = newValue;
            this.showDeactivateConfirm = true;
            event.target.value = this.offerStatus;
            return;
        }

        if (newValue === 'Decommissioned') {
            this.pendingStatusValue = newValue;
            this.showDecommissionConfirm = true;
            event.target.value = this.offerStatus;
            return;
        }

        if (newValue === 'Active') {
            this.performActivation();
            return;
        }

        this.offerStatus = newValue;
        this.isActive = false;
    }

    async handleVersionStatusChange(event) {
        const newValue = event.target.value;
        if (newValue === 'Ready') {
            await this.handleMarkVersionReady();
        } else if (newValue === 'Draft') {
            await this.handleRevertToDraft();
        }
    }

    handleActiveToggle(event) {
        if (this.statusLocked) return;

        const checked = event.target.checked;

        if (checked && this.offerStatus !== 'Active') {
            this.offerStatus = 'Active';
            this.performActivation();
        } else if (!checked) {
            this.isActive = false;
            if (this.offerStatus === 'Active') {
                this.offerStatus = 'Inactive';
                this.performDeactivation();
            }
        }
    }

    handlePromoToggle(event) {
        this.isPromo = event.target.checked;
    }

    handleDeactivateCancel() {
        this.showDeactivateConfirm = false;
        this.pendingStatusValue = '';
    }

    async handleDeactivateConfirm() {
        this.showDeactivateConfirm = false;
        await this.performDeactivation();
    }

    async performDeactivation() {
        this.isLoading = true;
        try {
            if (this.recordId) {
                await deactivateOffer({ offerId: this.recordId });
            }
            this.offerStatus = 'Inactive';
            this.isActive = false;
            this.currentVersionStatus = 'Deactivated';
            this.currentScheduleStatus = null;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Deactivated',
                message: 'This offer is now Inactive. The current version is marked Ready and can be reactivated.',
                variant: 'warning'
            }));
        } catch (error) {
            this.offerStatus = 'Active';
            this.isActive = true;
            const msg = error?.body?.message || error?.message || 'Unknown error';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    handleDecommissionCancel() {
        this.showDecommissionConfirm = false;
        this.pendingStatusValue = '';
    }

    async handleDecommissionConfirm() {
        this.showDecommissionConfirm = false;
        this.isLoading = true;
        try {
            if (this.recordId) {
                await decommissionOffer({ offerId: this.recordId });
            }
            this.offerStatus = 'Decommissioned';
            this.isActive = false;
            this.statusLocked = true;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Decommissioned',
                message: 'This offer has been permanently decommissioned and cannot be activated again.',
                variant: 'warning',
                mode: 'sticky'
            }));
        } catch (error) {
            const msg = error?.body?.message || error?.message || 'Unknown error';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    async performActivation() {
        this.isLoading = true;
        try {
            if (this.recordId && this.currentVersionId) {
                await activateOffer({ offerId: this.recordId, versionUuid: this.currentVersionId });
            }
            this.offerStatus = 'Active';
            this.isActive = true;
            this.currentVersionStatus = 'Active';
            this.currentScheduleStatus = null;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Activated',
                message: 'This offer version is now Active. The previous active version has been deactivated.',
                variant: 'success'
            }));
        } catch (error) {
            this.offerStatus = 'Draft';
            this.isActive = false;
            const msg = error?.body?.message || error?.message || 'Unknown error';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    async handleMarkVersionReady() {
        if (!this.currentVersionSfId) return;
        this.isLoading = true;
        try {
            await markVersionReady({ versionId: this.currentVersionSfId });
            this.currentVersionStatus = 'Ready';
            this.dispatchEvent(new ShowToastEvent({
                title: 'Version Ready',
                message: 'This version is now marked as Ready and its attributes are locked.',
                variant: 'success'
            }));
        } catch (error) {
            const msg = error?.body?.message || error?.message || 'Unknown error';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    async handleRevertToDraft() {
        if (!this.currentVersionSfId) return;
        this.isLoading = true;
        try {
            await revertVersionToDraft({ versionId: this.currentVersionSfId });
            this.currentVersionStatus = 'Draft';
            this.dispatchEvent(new ShowToastEvent({
                title: 'Version Reverted',
                message: 'This version has been reverted to Draft and can now be edited.',
                variant: 'info'
            }));
        } catch (error) {
            const msg = error?.body?.message || error?.message || 'Unknown error';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    // --- HANDLERS: Date fields ---

    handleValidFromChange(event) {
        this.validFrom = event.target.value;
        if (this.validTo && this.validTo < this.validFrom) {
            this.validTo = '';
        }
    }

    handleValidToChange(event) {
        this.validTo = event.target.value;
    }

    handleCtaUrlChange(event)    { this.ctaUrl    = event.target.value; }
    handleCtaDurlChange(event)   { this.ctaDurl   = event.target.value; }
    handleCtaIntentChange(event) { this.ctaIntent = event.target.value; }
    handleRegUrlChange(event)    { this.regUrl    = event.target.value; }

    async handleSaveCtaFields() {
        if (!this.currentVersionSfId) return;
        this.isLoading = true;
        try {
            await updateVersionCtaFields({
                versionId: this.currentVersionSfId,
                ctaUrl:    this.ctaUrl    || null,
                ctaDurl:   this.ctaDurl   || null,
                ctaIntent: this.ctaIntent || null,
                regUrl:    this.regUrl    || null
            });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Saved',
                message: 'CTA fields updated successfully.',
                variant: 'success'
            }));
        } catch (error) {
            const msg = error?.body?.message || error?.message || 'Unknown error';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    // --- HANDLERS: Date overlap ---

    handleOverlapCancel() {
        this.showOverlapConfirm = false;
    }

    handleOverlapConfirmAndContinue() {
        this.showOverlapConfirm = false;
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
        }
    }

    // --- HANDLERS: Navigation ---

    handleStepClick(event) {
        const step = parseInt(event.currentTarget.dataset.step, 10);
        if (step < this.currentStep) {
            this.currentStep = step;
        }
    }

    async handleNextStep() {
        if (this.currentStep === 1) {
            if (!this.validateStep1()) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Required Fields',
                    message: 'Please complete all required fields before proceeding.',
                    variant: 'error'
                }));
                return;
            }
            this.showValidationErrors = false;

            // Check for date overlap with currently active version when creating/editing versions
            if (this._recordId && this.validFrom && this.validTo) {
                try {
                    const overlap = await checkDateOverlap({
                        offerId: this._recordId,
                        newValidFrom: this.validFrom,
                        newValidTo: this.validTo
                    });
                    if (overlap && overlap.hasOverlap) {
                        this.overlapCurrentValidFrom = overlap.currentValidFrom || '';
                        this.overlapCurrentValidTo   = overlap.currentValidTo   || '';
                        this.showOverlapConfirm = true;
                        return; // hold on step 1 until user resolves
                    }
                } catch (e) {
                    // non-blocking: skip overlap check on error
                }
            }
        }
        if (this.currentStep === 2) {
            if (!this.validateStep2()) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Required Fields',
                    message: 'Please fill in all required (*) parameters before proceeding.',
                    variant: 'error'
                }));
                return;
            }
        }
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
        }
    }

    handlePreviousStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
        }
    }

    // --- HANDLERS: Step 1 ---

    handleOfferNameChange(event) { this.offerName = event.target.value; }
    handleCountryCodeChange(event) { this.countryCode = event.detail.value; }

    handleCustomerTypeToggle(event) {
        const value = event.currentTarget.dataset.value;
        if (this.selectedCustomerTypes.includes(value)) {
            this.selectedCustomerTypes = this.selectedCustomerTypes.filter(t => t !== value);
        } else {
            this.selectedCustomerTypes = [...this.selectedCustomerTypes, value];
        }

        if (this.selectedProductFamily) {
            const validFamilies = this.filteredProductFamilyOptions.map(f => f.value);
            if (!validFamilies.includes(this.selectedProductFamily)) {
                this.selectedProductFamily = '';
                this.selectedProductIds = [];
            } else {
                this.autoSelectProducts();
            }
        }
    }

    handleProductFamilyChange(event) {
        this.selectedProductFamily = event.detail.value;
        this.offerParams = {};
        this.autoSelectProducts();
        this.loadMdAttributes();
    }

    loadMdAttributes() {
        const family = this.selectedProductFamily;
        if (!family) {
            this.mdAttributes = [];
            return;
        }
        // MERGE 2026-09-14: show loading spinner during fetch and seed autopopulate/predefined
        // values into offerParams (from Filip's version). To revert: remove the isLoadingAttributes
        // assignments and the seedAutoValues call.
        this.isLoadingAttributes = true;
        getOfferAttributesForFamily({ familyName: family })
            .then(rows => {
                // Only reflect the response if the family hasn't changed since the call.
                if (this.selectedProductFamily === family) {
                    this.mdAttributes = rows || [];
                    this.seedAutoValues(this.mdAttributes);
                }
            })
            .catch(() => {
                if (this.selectedProductFamily === family) {
                    this.mdAttributes = [];
                }
            })
            .finally(() => {
                if (this.selectedProductFamily === family) {
                    this.isLoadingAttributes = false;
                }
            });
    }

    // MERGE 2026-09-14: pre-fill offerParams for Autopopulate (referenceValue) and Apriori
    // (defaultValue) attributes when the user hasn't already entered a value.
    seedAutoValues(rows) {
        (rows || []).forEach(a => {
            const field = a.fieldApiName;
            if (!field) return;
            const seed = a.valueSource === 'Autopopulate' ? a.referenceValue
                : a.valueSource === 'Apriori' ? (a.defaultValue ?? null)
                : null;
            if (seed !== null && seed !== undefined && seed !== '') {
                const cur = this.offerParams[field];
                if (cur === undefined || cur === '') {
                    this.offerParams = { ...this.offerParams, [field]: seed };
                }
            }
            // RANGE: seed the slider selection to the full reference range when the operator
            // hasn't set one yet, so an untouched range still saves and validates.
            if (a.type === 'Range') {
                const { minField, maxField } = this._rangeFieldNames(field);
                if (minField && (this.offerParams[minField] === undefined || this.offerParams[minField] === null)
                        && a.referenceValueMin !== undefined && a.referenceValueMin !== null) {
                    this.offerParams = { ...this.offerParams, [minField]: a.referenceValueMin };
                }
                if (maxField && (this.offerParams[maxField] === undefined || this.offerParams[maxField] === null)
                        && a.referenceValueMax !== undefined && a.referenceValueMax !== null) {
                    this.offerParams = { ...this.offerParams, [maxField]: a.referenceValueMax };
                }
            }
        });
    }

    handleProductSelectionChange(event) {
        this.selectedProductIds = event.detail.value;
    }

    handleParamChange(event) {
        const field = event.target.dataset.field;
        let value;
        if (event.target.type === 'checkbox') {
            value = event.target.checked;
        } else if (event.detail && event.detail.value !== undefined) {
            value = event.detail.value;
        } else {
            value = event.target.value;
        }
        this.offerParams = { ...this.offerParams, [field]: value };
    }

    // RANGE: the dual slider emits { min, max }; persist each bound to its dedicated
    // Offer_Version__c field (decision 2a). The slider itself hard-clamps to the
    // reference [min,max], so no extra bounds check is needed here.
    handleRangeChange(event) {
        const minField = event.target.dataset.minField;
        const maxField = event.target.dataset.maxField;
        const { min, max } = event.detail || {};
        const next = { ...this.offerParams };
        if (minField) next[minField] = min;
        if (maxField) next[maxField] = max;
        this.offerParams = next;
    }

    handleToggleOptionalParams() {
        this.showOptionalParams = !this.showOptionalParams;
    }

    prefillFromVersion(version) {
        if (!version) return;

        this.selectedProductFamily = version.Product_Family_Name__c || this.selectedProductFamily;
        this.isPromo = version.Is_Promo__c || false;
        this.validFrom = version.Valid_From__c || this.validFrom;
        this.validTo = version.Valid_To__c || this.validTo;
        this.ctaUrl    = version.CTA_URL__c    || '';
        this.ctaDurl   = version.CTA_DURL__c   || '';
        this.ctaIntent = version.CTA_Intent__c || '';
        this.regUrl    = version.REG_URL__c    || '';

        const junctionRows = version.Customer_Types__r || [];
        if (junctionRows.length > 0) {
            this.selectedCustomerTypes = junctionRows.map(j => j.Customer_Type__c);
        }

        const filled = {};
        VERSION_PARAM_FIELDS.forEach(field => {
            const val = version[field];
            if (val !== undefined && val !== null) {
                filled[field] = val;
            }
        });
        this.offerParams = filled;

        this.hydrateAdditionalParams(version.Additional_Parameters__c);
    }

    // Merge saved custom-attribute values (Additional_Parameters__c JSON) back into
    // offerParams so their editable inputs render with the stored value.
    hydrateAdditionalParams(raw) {
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return;
            const restored = { ...this.offerParams };
            data.forEach(item => {
                if (item && item.key !== undefined && item.value !== undefined) {
                    restored[String(item.key)] = item.value;
                }
            });
            this.offerParams = restored;
        } catch (e) {
            // ignore malformed JSON
        }
    }

    // Serialize values for custom attributes that have no dedicated Offer_Version__c
    // field into Additional_Parameters__c JSON: [{ key: fieldApiName, value }].
    serializeAdditionalParams() {
        const filled = this.unmappedParams
            .map(p => ({ key: p.field, value: this.offerParams[p.field] }))
            .filter(e => e.key && e.value !== undefined && e.value !== null && e.value !== '' && e.value !== false)
            .map(e => ({ key: String(e.key), value: String(e.value) }));
        return filled.length > 0 ? JSON.stringify(filled) : null;
    }

    autoSelectProducts() {
        const available = this.availableProductOptions;
        this.selectedProductIds = available.map(p => p.value);
    }

    // --- HANDLERS: Cancel & Save ---

    handleCancel() {
        this.dispatchEvent(new CustomEvent('wizardcancel'));
        if (this.hosted) return;

        if (this._recordId) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: { recordId: this._recordId, objectApiName: 'Offer__c', actionName: 'view' }
            });
        } else {
            this[NavigationMixin.Navigate]({
                type: 'standard__objectPage',
                attributes: { objectApiName: 'Offer__c', actionName: 'list' },
                state: { filterName: 'Recent' }
            });
        }
    }

    handleContainerClick(event) {
        // Keep clicks inside the wizard from bubbling to the backdrop.
        event.stopPropagation();
    }

    handleBackdropClick() {
        this.handleCancel();
    }

    handleSaveInPlace() {
        this.handleSave(false, false, false);
    }

    handleSaveDraft() {
        this.handleSave(false, true, false);
    }

    handleSaveAsReady() {
        this.handleSave(false, true, true);
    }

    handleSaveAndActivate() {
        this.handleSave(true, true, false);
    }

    saveSuccessMessage(isEditMode, activated, asReady) {
        if (this.wizardMode === 'edit')        return 'Version updated successfully.';
        if (this.wizardMode === 'new-version') return activated ? 'New version created and activated.' : asReady ? 'New version saved as Ready.' : 'New version saved as draft.';
        if (this.wizardMode === 'clone')       return activated ? 'Clone created and activated.' : asReady ? 'Clone saved as Ready.' : 'Clone saved as draft.';
        if (isEditMode)                        return activated ? 'New version created and activated.' : asReady ? 'New version saved as Ready.' : 'New version saved as draft.';
        return activated ? 'Offer created and activated.' : asReady ? 'Offer saved as Ready.' : 'Offer saved as draft.';
    }

    async handleSave(activateImmediately, closeAfter, saveAsReady) {
        if (!this.validateStep1()) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Required Fields',
                message: 'Please complete all required fields before saving.',
                variant: 'error'
            }));
            return;
        }

        this.isLoading = true;
        let _step = 'init';
        try {
            _step = 'build-product-names';
            const sourceProductNames = this.allProducts
                .filter(p => this.selectedProductIds.includes(p.id))
                .map(p => p.name)
                .join(',');

            _step = 'build-offerdata';
            const isEditMode = !!this.recordId;
            const isVersionMode = this.wizardMode === 'new-version' || this.wizardMode === 'clone' || this.wizardMode === 'edit';

            // Identity fields (Name, CountryCode, Currency) are owned by the master Offer__c.
            // Only include them when creating a brand-new offer from scratch.
            const identityFields = isVersionMode || isEditMode
                ? {}
                : {
                    Name: this.generatedOfferName,
                    Country_Code__c: this.countryCode || null,
                    Currency_Code__c: this.countryCode === 'PL' ? 'PLN' : 'EUR'
                };

            const offerData = {
                ...identityFields,
                Product_Family_Name__c: this.selectedProductFamily || null,
                Source_Products__c: sourceProductNames || null,
                Customer_Type_Ids: [...this.selectedCustomerTypes],
                Is_Promo__c: this.isPromo,
                Valid_From__c: this.validFrom || null,
                Valid_To__c: this.validTo || null,
                CTA_URL__c:    this.ctaUrl    || null,
                CTA_DURL__c:   this.ctaDurl   || null,
                CTA_Intent__c: this.ctaIntent || null,
                REG_URL__c:    this.regUrl    || null,
                Additional_Parameters__c: this.serializeAdditionalParams(),
                ...this.offerParams
            };

            let offerId;
            let savedVersionSfId = null;

            if (this.wizardMode === 'edit' && this._sourceVersionId && (this.isLimitedEditMode || this.isActiveModifyMode)) {
                // Limited/active-modify edit: only dates + URLs overwritten in place, no new version
                _step = 'updateVersionDatesAndUrls';
                await updateVersionDatesAndUrls({
                    versionId: this._sourceVersionId,
                    validFrom:  this.validFrom  || null,
                    validTo:    this.validTo    || null,
                    ctaUrl:     this.ctaUrl     || null,
                    ctaDurl:    this.ctaDurl    || null,
                    ctaIntent:  this.ctaIntent  || null,
                    regUrl:     this.regUrl     || null
                });
                offerId = this.recordId;
            } else if (this.wizardMode === 'edit' && this._sourceVersionId) {
                // Full edit: Draft version — all fields
                _step = 'updateVersion';
                await updateVersion({
                    versionId: this._sourceVersionId,
                    versionData: offerData
                });
                offerId = this.recordId;
                if (activateImmediately === true) {
                    _step = 'activateVersion';
                    await activateVersion({ offerId, versionId: this._sourceVersionId });
                } else if (saveAsReady === true) {
                    _step = 'markVersionReady';
                    await markVersionReady({ versionId: this._sourceVersionId });
                }
            } else if (this.currentVersionSfId && !isVersionMode) {
                // Bug 3 fix: a prior in-place save already created a version this session —
                // update it instead of inserting another one, then apply any status transition.
                _step = 'updateVersion';
                await updateVersion({
                    versionId: this.currentVersionSfId,
                    versionData: offerData
                });
                offerId = this.recordId;
                if (activateImmediately === true) {
                    _step = 'activateVersion';
                    await activateVersion({ offerId, versionId: this.currentVersionSfId });
                } else if (saveAsReady === true) {
                    _step = 'markVersionReady';
                    await markVersionReady({ versionId: this.currentVersionSfId });
                }
            } else if (isVersionMode || isEditMode) {
                // Create a new version record on an existing offer
                _step = 'createNewVersion';
                savedVersionSfId = await createNewVersion({
                    offerId: this.recordId,
                    versionData: offerData,
                    activateImmediately: activateImmediately === true,
                    saveAsReady: saveAsReady === true
                });
                offerId = this.recordId;
            } else {
                // Brand-new offer from scratch
                _step = 'saveNewOffer';
                offerId = await saveNewOffer({
                    offerData,
                    activateImmediately: activateImmediately === true,
                    saveAsReady: saveAsReady === true
                });
                // AC-S3-009: saveNewOffer returns only the Offer__c Id, not the created
                // version. When the wizard stays open (in-place Save), capture the newly
                // created version's Id so subsequent saves update it in place instead of
                // inserting a duplicate version.
                if (!closeAfter) {
                    _step = 'capture-new-version';
                    const versions = await getOfferVersions({ offerId });
                    if (versions && versions.length > 0) {
                        savedVersionSfId = versions[0].Id;
                    }
                }
            }

            _step = 'dispatch-toast';
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: this.saveSuccessMessage(isEditMode, activateImmediately === true, saveAsReady === true),
                variant: 'success'
            }));

            _step = 'dispatch-wizardsaved';
            this.dispatchEvent(new CustomEvent('wizardsaved', { detail: { offerId, closeAfter } }));

            if (closeAfter) {
                if (!this.hosted) {
                    _step = 'navigate';
                    this[NavigationMixin.Navigate]({
                        type: 'standard__recordPage',
                        attributes: { recordId: offerId, objectApiName: 'Offer__c', actionName: 'view' }
                    });
                }
                return;
            }

            _step = 'post-save-state';
            if (!isEditMode) {
                this._recordId = offerId;
                this.existingOfferName = this.generatedOfferName;
            }
            // Bug 3 fix: after a createNewVersion in-place save, lock subsequent saves
            // to update that version rather than creating yet another one.
            if (savedVersionSfId && !closeAfter) {
                this.currentVersionSfId = savedVersionSfId;
                this.currentVersionStatus = 'Draft';
            }
        } catch (error) {
            const bodyMsg    = error?.body?.message;
            const outputErrs = error?.body?.output?.errors?.map(e => e.message).join('; ');
            const fieldErrs  = (() => {
                try {
                    const fe = error?.body?.output?.fieldErrors;
                    if (!fe) return null;
                    return Object.entries(fe)
                        .flatMap(([field, errs]) => errs.map(e => `${field}: ${e.message}`))
                        .join('; ');
                } catch(e2) { return null; }
            })();
            const jsMsg      = error?.message;
            const strErr     = typeof error === 'string' ? error : null;
            const rawJson    = (() => { try { return JSON.stringify(error); } catch(e2) { return '(not serialisable)'; } })();

            const msg = bodyMsg || outputErrs || fieldErrs || jsMsg || strErr
                || `Unknown error at step [${_step}] — raw: ${rawJson}`;

            this.dispatchEvent(new ShowToastEvent({
                title: `Error at: ${_step}`,
                message: msg,
                variant: 'error',
                mode: 'sticky'
            }));
        } finally {
            this.isLoading = false;
        }
    }
}