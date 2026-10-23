import { LightningElement, api, track, wire } from 'lwc';
import getProductFamilies from '@salesforce/apex/CopyCockpitController.getProductFamilies';
import getActiveOffersByFamily from '@salesforce/apex/CopyCockpitController.getActiveOffersByFamily';
import getPlaceholders from '@salesforce/apex/CopyCockpitController.getPlaceholders';
import getStemVariantInfo from '@salesforce/apex/CopyCockpitController.getStemVariantInfo';
import getMarketingLocales from '@salesforce/apex/CopyCockpitController.getMarketingLocales';
import getSelectableTemplates from '@salesforce/apex/ChannelTemplateController.getSelectableTemplates';
import {
    channelPrefixForType,
    composeFullNameFromLocale,
    composeStemFromLocale,
    nextAvailableVariant,
    parseLocale
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

export default class CopyCockpitAddModal extends LightningElement {

    @api channelName = '';
    @api channelType = '';

    @track localeToken = '';
    @track messageName = '';

    @track version  = 1;
    @track language = 'PL';

    @track productFamilyId   = null;
    @track productFamilyName = null;

    @track offers          = [];
    @track isLoadingOffers = false;
    @track offerId         = '';

    @track selectedPlaceholders = [];

    @track selectedSubtype = null;
    @track sourceTemplateId = '';

    @track isSaving         = false;
    @track variantError     = '';
    @track variantSuggested = false;
    @track isExistingMaster = false;

    _takenVariants    = [];
    _variantCheckStem = '';

    @wire(getProductFamilies)
    _wiredFamilies;

    @wire(getPlaceholders)
    _wiredPlaceholders;

    @wire(getMarketingLocales)
    _wiredLocales;

    @wire(getSelectableTemplates, { channelName: '$channelName', channelType: '$channelType' })
    _wiredTemplates;

    get modalTitle() {
        const label = (this.channelName || this.channelType || 'Channel').trim();
        return `New ${label} Message`;
    }

    get channelPrefix() {
        return channelPrefixForType(this.channelType);
    }

    get versionDisplay() {
        return this.version != null ? String(this.version) : '';
    }

    get nameStem() {
        return composeStemFromLocale(this.channelPrefix, this.localeToken, this.messageName);
    }

    get composedName() {
        return composeFullNameFromLocale(
            this.channelPrefix, this.localeToken, this.messageName, this.version
        );
    }

    get localeOptions() {
        return (this._wiredLocales?.data || []).map(row => ({
            value: row.Name,
            label: row.Topic_Description__c
                ? `${row.Name} — ${row.Topic_Description__c}`
                : row.Name
        }));
    }

    get localesLoading() {
        return !this._wiredLocales?.data && !this._wiredLocales?.error;
    }

    get hasLocaleOptions() {
        return this.localeOptions.length > 0;
    }

    get templateOptions() {
        return (this._wiredTemplates?.data || []).map(template => ({
            value: template.id,
            label: template.packageLabel ? `${template.name} (${template.packageLabel})` : template.name
        }));
    }

    get usesTemplateTiles() {
        return this.channelType !== 'Email' && this.channelType !== 'Push';
    }

    get showSourceTemplatePicker() {
        return !this.usesTemplateTiles;
    }

    get hasTemplateOptions() {
        return this.templateOptions.length > 0;
    }

    get showMissingTemplate() {
        return this.showSourceTemplatePicker && !this.templatesLoading && !this.hasTemplateOptions;
    }

    get showMissingTemplateTiles() {
        return this.usesTemplateTiles && !this.templatesLoading && !this.hasTemplateOptions;
    }

    get templatesLoading() {
        return !this._wiredTemplates?.data && !this._wiredTemplates?.error;
    }

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
        if (this.usesTemplateTiles) {
            return (this._wiredTemplates?.data || []).map(template => ({
                value: template.id,
                label: template.name,
                icon: 'utility:layout',
                description: template.description || template.packageLabel || ''
            }));
        }
        return SUBTYPE_OPTIONS[this.channelType] || [];
    }

    get hasSubtypeOptions() { return this.subtypeOptions.length > 0; }

    get showMessageTypeSection() {
        return this.usesTemplateTiles || this.hasSubtypeOptions;
    }

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

    get variantHint() {
        if (this.isExistingMaster) {
            return `Existing master found — creating Variant ${this.version}.`;
        }
        return 'New message — Variant 1.';
    }

    get isLocaleLocked() {
        return this.isExistingMaster;
    }

    get localeHelp() {
        if (this.isExistingMaster) {
            return 'Locked to the existing master locale. Change it from the master row.';
        }
        if (!this.hasLocaleOptions && !this.localesLoading) {
            return 'Add locales under Marketing Dictionary → Campaigns → Locales.';
        }
        return 'Country and language combination (e.g. pl-PL).';
    }

    get canSave() {
        if (!(this.localeToken || '').trim())  return false;
        if (!(this.messageName || '').trim())  return false;
        if (!this.version || this.version < 1) return false;
        if (!this.sourceTemplateId)            return false;
        if (!this.productFamilyId)             return false;
        if (this.hasDuplicateVariant)          return false;
        if (this.subtypeRequired && !this.selectedSubtype) return false;
        if (this.placeholderMissing)           return false;
        return true;
    }

    get saveDisabled()        { return !this.canSave || this.isSaving; }
    get saveAndEditDisabled() { return !this.canSave || this.isSaving; }

    handleLocaleChange(e) {
        this.localeToken = e.detail?.value || e.target?.value || '';
        const parsed = parseLocale(this.localeToken);
        if (parsed.language) {
            this.language = parsed.language;
        }
        this._onNamePartChanged();
    }

    handleMessageNameChange(e) {
        this.messageName = e.target.value;
        this._onNamePartChanged();
    }

    handleSourceTemplateChange(e) {
        this.sourceTemplateId = e.detail?.value || '';
    }

    handleFamilyChange(e) {
        const familyId = e.detail?.value || e.target?.value || '';
        const familyOption = (this.familyOptions || []).find(f => f.value === familyId);
        this.productFamilyId   = familyId || null;
        this.productFamilyName = familyOption?.label || null;
        this.offerId           = '';
        this.offers            = [];
        if (this.productFamilyName) {
            this._loadOffers(this.productFamilyName);
        }
    }

    handleOfferChange(e) { this.offerId = e.detail?.value || e.target?.value || ''; }

    handlePlaceholderChange(e) { this.selectedPlaceholders = e.detail.value; }

    handleSelectSubtype(e) {
        const value = e.currentTarget.dataset.value;
        this.selectedSubtype = value;
        if (this.usesTemplateTiles) this.sourceTemplateId = value;
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

    _onNamePartChanged() {
        this.variantError     = '';
        this.variantSuggested = false;
        this.isExistingMaster = false;
        this._variantCheckStem = '';
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
        const loc = parseLocale(this.localeToken);
        const selectedTemplate = (this._wiredTemplates?.data || []).find(template => template.id === this.sourceTemplateId);
        this.dispatchEvent(new CustomEvent('save', {
            detail: {
                messageName:       fullName,
                nameStem:          this.nameStem,
                countryCode:       loc.countryCode,
                locale:            this.localeToken.trim(),
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
                sourceTemplateId:  this.sourceTemplateId,
                messageSubtype:    this.usesTemplateTiles ? (selectedTemplate?.name || null) : this.selectedSubtype,
                action,
            },
        }));
    }
}
