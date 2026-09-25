import { LightningElement, api, track, wire } from 'lwc';
import getProductFamilies from '@salesforce/apex/CopyCockpitController.getProductFamilies';
import getActiveOffersByFamily from '@salesforce/apex/CopyCockpitController.getActiveOffersByFamily';
import getPlaceholders from '@salesforce/apex/CopyCockpitController.getPlaceholders';
import getStemVariantInfo from '@salesforce/apex/CopyCockpitController.getStemVariantInfo';
import {
    channelPrefixForType,
    composeFullName,
    composeStem,
    nextAvailableVariant
} from 'c/copyMessageNaming';

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

export default class CopyCockpitAddModal extends LightningElement {

    @api channelName = '';
    @api channelType = '';
    @api bannerTypes = [];

    // Editable name parts (master-level)
    @track countryCode = '';
    @track messageName = '';

    // Auto parts
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
    @track isExistingMaster = false;

    _takenVariants    = [];
    _variantCheckStem = '';
    _variantCheckTimer = null;

    disconnectedCallback() {
        window.clearTimeout(this._variantCheckTimer);
    }

    @wire(getProductFamilies)
    _wiredFamilies;

    @wire(getPlaceholders)
    _wiredPlaceholders;

    // ── derived ───────────────────────────────────────────────────────────────

    get channelPrefix() {
        return channelPrefixForType(this.channelType);
    }

    get nameStem() {
        return composeStem(this.channelPrefix, this.countryCode, this.messageName);
    }

    get composedName() {
        return composeFullName(this.channelPrefix, this.countryCode, this.messageName, this.version);
    }

    get composedNamePreview() {
        const cc = (this.countryCode || '').trim().toUpperCase() || '<CountryCode>';
        const mn = (this.messageName || '').trim() || '<MessageName>';
        const v  = this.version != null ? this.version : '<Variant>';
        return `${this.channelPrefix}_${cc}_${mn}_${v}`;
    }

    get namingConventionHint() {
        return 'ChannelPrefix_CountryCode_MessageName_VariantNumber';
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

    get variantHint() {
        if (this.isExistingMaster) {
            return `Existing master found — creating Variant ${this.version}.`;
        }
        return 'New message — Variant 1.';
    }

    get isLanguageLocked() {
        return this.isExistingMaster;
    }

    get languageHelp() {
        return this.isExistingMaster
            ? 'Locked to the existing master message language. Change it from the master row.'
            : 'Shared by all variants of this message. Change later from the master row.';
    }

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
        this.variantError     = '';
        this.variantSuggested = false;
        this.isExistingMaster = false;
        // Preview re-renders immediately; the variant lookup is debounced per keystroke.
        window.clearTimeout(this._variantCheckTimer);
        this._variantCheckTimer = window.setTimeout(() => this._checkNameVariants(), 300);
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
        const stem = this.nameStem;
        if (!stem || stem === this._variantCheckStem) return;
        this._variantCheckStem = stem;

        getStemVariantInfo({ nameStem: stem, channelType: this.channelType })
            .then(info => {
                if (this._variantCheckStem !== this.nameStem) return;
                const variants = info?.variants || [];
                this._takenVariants = variants;
                if (variants.length > 0) {
                    const next = nextAvailableVariant(variants);
                    this.version          = next;
                    this.isExistingMaster = true;
                    this.variantSuggested = true;
                    this.variantError     = '';
                    if (info.language) this.language = info.language;
                } else {
                    this.version          = 1;
                    this.isExistingMaster = false;
                    this.variantSuggested = false;
                    this.variantError     = '';
                }
            })
            .catch(() => {});
    }

    _dispatchSave(action) {
        this.isSaving = true;
        const fullName = this.composedName;
        this.dispatchEvent(new CustomEvent('save', {
            detail: {
                messageName:       fullName,
                nameStem:          this.nameStem,
                countryCode:       (this.countryCode || '').trim().toUpperCase(),
                messageNamePart:   (this.messageName || '').trim(),
                channelPrefix:     this.channelPrefix,
                version:           Number(this.version),
                language:          this.language,
                offerId:           this.offerId || null,
                productFamilyId:   this.productFamilyId || null,
                productFamilyName: this.productFamilyName || null,
                placeholders:      this.isBannerChannel ? [...this.selectedPlaceholders] : [],
                channelName:       this.channelName,
                channelType:       this.channelType,
                messageSubtype:    this.selectedSubtype,
                action,
            },
        }));
    }
}
