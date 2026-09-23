import { LightningElement, api, track, wire } from 'lwc';
import getProductFamilies from '@salesforce/apex/CopyCockpitController.getProductFamilies';
import getActiveOffersByFamily from '@salesforce/apex/CopyCockpitController.getActiveOffersByFamily';
import getPlaceholders from '@salesforce/apex/CopyCockpitController.getPlaceholders';
import getExistingVariants from '@salesforce/apex/CopyCockpitController.getExistingVariants';

const CHANNEL_PREFIX_MAP = {
    'Email':             'EMA',
    'SMS':               'SMS',
    'Push':              'PUSH',
    'Banner':            'BAN',
    'In-App':            'INAPP',
    'AI Agent Inbound':  'AII',
    'AI Agent Outbound': 'AIO',
    'Branch Agent':      'BRA',
    'WhatsApp':          'WHP',
};

const SUBTYPE_OPTIONS = {
    Email: [
        { value: 'from_scratch', label: 'From Scratch',      icon: 'utility:text',         description: 'Start with a blank canvas' },
        { value: 'template',     label: 'Business Template', icon: 'utility:layout',       description: 'Use a pre-approved layout' },
    ],
    Push: [
        { value: 'standard', label: 'Standard', icon: 'utility:notification', description: 'Single-image push message' },
        { value: 'carousel', label: 'Carousel', icon: 'utility:carousel',     description: 'Multi-card swipeable push' },
    ],
};

const LANGUAGE_OPTIONS = [
    { label: 'PL', value: 'PL' },
    { label: 'EN', value: 'EN' },
    { label: 'ES', value: 'ES' },
];

function nextAvailableVariant(takenVariants) {
    const taken = new Set((takenVariants || []).map(Number));
    let v = 1;
    while (taken.has(v)) v++;
    return v;
}

export default class CopyCockpitAddModal extends LightningElement {

    @api channelName = '';
    @api channelType = '';
    @api bannerTypes = [];

    // Composed name parts
    @track countryCode = '';
    @track messageName = '';

    // Variant + language
    @track version  = 1;
    @track language = 'PL';

    // Product family
    @track productFamilyId   = null;
    @track productFamilyName = null;

    // Offers — lazy loaded after family selection
    @track offers          = [];
    @track isLoadingOffers = false;
    @track offerId         = '';

    // Placeholders — Banner only
    @track selectedPlaceholders = [];

    // Per-channel subtype
    @track selectedSubtype = null;

    @track isSaving         = false;
    @track variantError     = '';
    @track variantSuggested = false;

    _takenVariants    = [];
    _variantCheckName = '';

    @wire(getProductFamilies)
    _wiredFamilies;

    @wire(getPlaceholders)
    _wiredPlaceholders;

    // ── derived ───────────────────────────────────────────────────────────────

    get channelPrefix() {
        return CHANNEL_PREFIX_MAP[this.channelType] || this.channelType || '';
    }

    get composedName() {
        const cc = (this.countryCode || '').trim().toUpperCase();
        const mn = (this.messageName || '').trim();
        if (!cc || !mn) return '';
        return `${this.channelPrefix}_${cc}_${mn}`;
    }

    get composedNamePreview() {
        const cc = (this.countryCode || '').trim().toUpperCase() || '<CountryCode>';
        const mn = (this.messageName || '').trim() || '<MessageName>';
        return `${this.channelPrefix}_${cc}_${mn}`;
    }

    get languageOptions() { return LANGUAGE_OPTIONS; }

    get familyOptions() {
        if (!this._wiredFamilies.data) return [];
        return this._wiredFamilies.data.map(f => ({ value: f.Id, label: f.Name }));
    }

    get isFamiliesLoading() {
        return !this._wiredFamilies.data && !this._wiredFamilies.error;
    }

    get offerOptions() { return this.offers; }

    get showOfferSection() { return !!this.productFamilyId; }

    get isBannerChannel() { return this.channelType === 'Banner'; }

    get placeholderOptions() {
        if (!this._wiredPlaceholders.data) return [];
        return this._wiredPlaceholders.data.map(p => ({ value: p.Id, label: p.Name }));
    }

    get placeholderMissing() {
        return this.isBannerChannel && this.selectedPlaceholders.length === 0;
    }

    get subtypeOptions() {
        if (this.channelType === 'Banner' || this.channelType === 'In-App') {
            return (this.bannerTypes || []).map(bt => ({
                value: bt.Id,
                label: bt.Name,
                icon: 'utility:image',
                description: bt.Description__c || '',
            }));
        }
        return SUBTYPE_OPTIONS[this.channelType] || [];
    }

    get hasSubtypeOptions() { return this.subtypeOptions.length > 0; }

    get subtypeLabel() {
        if (this.channelType === 'Email') return 'Email Creation Method';
        if (this.channelType === 'Push')  return 'Push Format';
        return 'Message Type';
    }

    get subtypeTiles() {
        return this.subtypeOptions.map(o => ({
            ...o,
            tileClass: `add-modal-tile${this.selectedSubtype === o.value ? ' add-modal-tile_selected' : ''}`,
        }));
    }

    get subtypeRequired() { return this.hasSubtypeOptions; }

    get subtypeValidationMsg() {
        if (this.subtypeRequired && !this.selectedSubtype) {
            return `Please select a ${this.subtypeLabel.toLowerCase()}.`;
        }
        return '';
    }

    get hasDuplicateVariant() { return !!this.variantError; }
    get versionError()        { return this.variantError; }
    get versionSuggested()    { return this.variantSuggested; }

    get canSave() {
        if (!(this.countryCode || '').trim())  return false;
        if (!(this.messageName || '').trim())  return false;
        if (!this.version || this.version < 1) return false;
        if (!this.language)                    return false;
        if (!this.productFamilyId)             return false;
        if (this.hasDuplicateVariant)          return false;
        if (this.subtypeRequired && !this.selectedSubtype) return false;
        if (this.placeholderMissing)           return false;
        return true;
    }

    get saveDisabled()        { return !this.canSave || this.isSaving; }
    get saveAndEditDisabled() { return !this.canSave || this.isSaving; }

    // ── handlers ──────────────────────────────────────────────────────────────

    handleCountryCodeChange(e) {
        this.countryCode = e.target.value;
        this._onNamePartChanged();
    }

    handleMessageNameChange(e) {
        this.messageName = e.target.value;
        this._onNamePartChanged();
    }

    handleVersionChange(e) {
        this.version = Number(e.target.value);
        this._validateVariant();
    }

    handleLanguageChange(e) { this.language = e.detail.value; }

    handleFamilyChange(e) {
        const familyId = e.detail.value;
        const familyOption = (this.familyOptions || []).find(f => f.value === familyId);
        this.productFamilyId   = familyId || null;
        this.productFamilyName = familyOption?.label || null;
        this.offerId           = '';
        this.offers            = [];
        if (this.productFamilyName) {
            this._loadOffers(this.productFamilyName);
        }
    }

    handleOfferChange(e) { this.offerId = e.detail.value; }

    handlePlaceholderChange(e) { this.selectedPlaceholders = e.detail.value; }

    handleSelectSubtype(e) {
        this.selectedSubtype = e.currentTarget.dataset.value;
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleSaveDraft() {
        if (!this.canSave) return;
        this._dispatchSave('draft');
    }

    handleSaveAndEdit() {
        if (!this.canSave) return;
        this._dispatchSave('edit');
    }

    @api resetSaving() { this.isSaving = false; }

    // ── private ───────────────────────────────────────────────────────────────

    _onNamePartChanged() {
        this.variantError    = '';
        this.variantSuggested = false;
        this._checkNameVariants();
    }

    _loadOffers(familyName) {
        this.isLoadingOffers = true;
        this.offers = [];
        getActiveOffersByFamily({ familyName })
            .then(result => {
                this.offers          = (result || []).map(o => ({ value: o.Id, label: o.Name }));
                this.isLoadingOffers = false;
            })
            .catch(() => { this.isLoadingOffers = false; });
    }

    _checkNameVariants() {
        const name = this.composedName;
        if (!name || name === this._variantCheckName) return;
        this._variantCheckName = name;

        getExistingVariants({ messageName: name, channelType: this.channelType })
            .then(variants => {
                if (this._variantCheckName !== this.composedName) return;
                this._takenVariants = variants || [];
                if (this._takenVariants.length > 0) {
                    const next = nextAvailableVariant(this._takenVariants);
                    this.version        = next;
                    this.variantSuggested = true;
                    this.variantError   = '';
                } else {
                    this.version        = 1;
                    this.variantSuggested = false;
                    this.variantError   = '';
                }
            })
            .catch(() => {});
    }

    _validateVariant() {
        const v     = Number(this.version);
        const taken = new Set(this._takenVariants.map(Number));
        if (taken.has(v)) {
            this.variantError = `Variant ${v} already exists for "${this.composedName}". Use variant ${nextAvailableVariant(this._takenVariants)} instead.`;
        } else {
            this.variantError = '';
        }
        this.variantSuggested = false;
    }

    _dispatchSave(action) {
        this.isSaving = true;
        this.dispatchEvent(new CustomEvent('save', {
            detail: {
                messageName:      this.composedName,
                version:          Number(this.version),
                language:         this.language,
                offerId:          this.offerId || null,
                productFamilyId:  this.productFamilyId || null,
                productFamilyName: this.productFamilyName || null,
                placeholders:     this.isBannerChannel ? [...this.selectedPlaceholders] : [],
                channelName:      this.channelName,
                channelType:      this.channelType,
                messageSubtype:   this.selectedSubtype,
                action,
            },
        }));
    }
}