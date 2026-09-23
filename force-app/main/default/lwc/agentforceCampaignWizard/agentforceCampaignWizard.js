import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { createRecord, updateRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Backend Apex Controllers
import getChannelDictionaryRecords from '@salesforce/apex/MarketingDictionaryController.getChannelDictionaryRecords';
import getTopicGoalValues from '@salesforce/apex/MarketingDictionaryController.getTopicGoalValues';
import getProductFamilyValues from '@salesforce/apex/MarketingDictionaryController.getProductFamilyValues';
import getFamilyOfNeedsValues from '@salesforce/apex/MarketingDictionaryController.getFamilyOfNeedsValues';
import getProductFamilyDependencies from '@salesforce/apex/MarketingDictionaryController.getProductFamilyDependencies';
import getProductFamilyByRecordType from '@salesforce/apex/MarketingDictionaryController.getProductFamilyByRecordType';
import getProductFamilyCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getProductFamilyCustomerTypes';
import getFamilyOfNeedsCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getFamilyOfNeedsCustomerTypes';
import getCampaignById from '@salesforce/apex/MarketingDictionaryController.getCampaignById';
import getMatchingOffers from '@salesforce/apex/MarketingDictionaryController.getMatchingOffers';
import getCampaignOffers from '@salesforce/apex/MarketingDictionaryController.getCampaignOffers';
import saveCampaignOffers from '@salesforce/apex/MarketingDictionaryController.saveCampaignOffers';
import getOfferSummaries from '@salesforce/apex/MarketingDictionaryController.getOfferSummaries';
import getCampaignTiers from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignTiers';
import getCampaignTypes from '@salesforce/apex/MarketingDictionaryController.getCampaignTypes';

export default class AgentforceCampaignWizard extends NavigationMixin(LightningElement) {
    @api recordId;
    @track isLoading = false;
    @track isEditMode = false;
    @track editRecordLoaded = false;

    // --- ACTIVATION TYPE + CAMPAIGN GROUP STATE ---
    @track parentActivationType = '';        // the campaign's own Activation_Type__c
    @track selectedCampaignGroupId = '';     // Campaign.Campaign_Group_Dict__c (dictionary Id)
    @track selectedCampaignGroupName = '';

    @track selectAllProductFamilies = true;
    @track selectAllFamilyOfNeeds = true;

    // --- TOPIC DROPDOWN STATE ---
    @track allTopicGoals = [];
    @track filteredTopicGoals = [];
    @track isTopicDropdownOpen = false;

    // --- STANDARD COMPONENT STATE ---
    @track campaignName = '';
    @track topicName = ''; 
    @track selectedOfferingType = 'Product Family';
    @track selectedPriorityTier = '';
    // --- EXCLUSION SETTINGS (replaces the old timing-reference block) ---
    @track excludeOnboarding = false;      // persisted to Campaign.Exclude_Onboarding__c
    @track excludeOtherMarketing = false;  // visual only — no persistence yet

    // --- EMERGENCY STATE CONTROL ---
    @track isEmergency = false;

    // --- DYNAMIC TIERS ---
    @track _allTiers = [];
    @track _tiersLoaded = false;

    // --- DYNAMIC CAMPAIGN TYPES ---
    @track _allCampaignTypes = [];

    // --- SUPPRESSION ASSOCIATION (when tier has Excl_Manual_Suppressions__c) ---
    @track suppressionType = '';   // 'campaign' | 'report' | 'segment'
    @track suppressionLookupValue = '';
    @track suppressionLookupDisplay = '';

    // --- SCORING METHOD STATE ---
    @track selectedScoringMethod = 'Pick a Model'; 
    @track aprioriOverallScore = '';
    @track fromObjectOverallScore = '';

    @track selectAllChecked = false;
    @track channels = [];
    @track channelGroups = [];
    
    // --- DYNAMIC CHECKBOX GRIDS STATE ---
    @track productFamilyOptions = [];
    @track familyOfNeedsOptions = [];

    rawProductFamilies = [];
    rawFamilyOfNeeds = [];
    @track productFamilyToFoN = {};
    @track fonToProductFamilies = {};
    @track productFamilyByRecordType = {};
    @track productFamilyCustomerTypes = {};
    @track fonCustomerTypes = {};
    @track groupedProductFamilyOptions = [];

    // --- MATCHING OFFERS LIST BUILDER ---
    @track matchingOffers = [];
    @track isLoadingOffers = false;
    @track offerSearchTerm = '';
    @track selectedOfferIds = [];
    _offerFetchTimer = null;

    // --- SELECTED-OFFER SUMMARY (shown on the Summary step) ---
    @track offerSummaries = [];
    @track expandedOfferParams = {};

    // Offers saved on the campaign (edit mode). Restored active-only from junction.
    editSavedOfferIds = null;

    // --- EDIT MODE PRE-SELECTED VALUES ---
    editProductFamilyValues = null;
    editFamilyOfNeedsValues = null;
    editChannelValues = null;

    // --- PRODUCT FAMILY FILTER STATE ---
    @track pfFilterCustomerTypes = [];
    @track pfFilterRecordTypes = [];
    @track pfFilterFon = '';

    // --- FAMILY OF NEEDS FILTER STATE ---
    @track fonFilterCustomerTypes = [];

    // --- WIZARD STEP STATE ---
    @track currentStep = 1;
    @track isProductFamilySectionOpen = true;
    @track isFonSectionOpen = true;


    // Static Asset Structs
    activationData = [
        { label: 'Always-on', value: 'Always-on', icon: 'utility:real_time' },
        { label: 'One-Off', value: 'One-Off', icon: 'utility:send' },
        { label: 'Triggered', value: 'Triggered', icon: 'utility:events' }
    ];

    scoringMethodsData = [
        { label: 'Pick a Model', value: 'Pick a Model' },
        { label: 'A-Priori', value: 'A-priori' }
    ];

    offeringTypesData = [
        { label: 'Product Family', value: 'Product Family' },
        { label: 'Family of Needs', value: 'Family of Needs' }
    ];

    suppressionTypesData = [
        { label: 'Salesforce Campaign', value: 'campaign' },
        { label: 'Salesforce Report', value: 'report' },
        { label: 'Data360 Segment', value: 'segment' }
    ];

    // --- LIFECYCLE HOOKS ---
    connectedCallback() {
        this.loadTiers();
        this.loadCampaignTypes();
        document.addEventListener('click', this.handleOutsideClickBound = this.handleOutsideClick.bind(this));
        if (this.recordId) {
            this.isEditMode = true;
            this.loadExistingCampaign();
        }
    }

    disconnectedCallback() {
    document.removeEventListener('click', this.handleOutsideClickBound)}
    ;

    loadTiers() {
        getCampaignTiers()
            .then(data => {
                this._allTiers = data || [];
                this._tiersLoaded = true;
            })
            .catch(err => console.error('Error loading tiers:', err));
    }

    loadCampaignTypes() {
        getCampaignTypes()
            .then(data => { this._allCampaignTypes = data || []; })
            .catch(err => console.error('Error loading campaign types:', err));
    }

    loadExistingCampaign() {
        this.isLoading = true;
        getCampaignById({ campaignId: this.recordId })
            .then(campaign => {
                if (!campaign) {
                    this.isLoading = false;
                    return;
                }
                this.populateFromRecord(campaign);
                this.editRecordLoaded = true;
                this.isLoading = false;
            })
            .catch(err => {
                this.isLoading = false;
                console.error('Error loading campaign:', err);
            });
    }

    populateFromRecord(campaign) {
        this.parentActivationType = campaign.Activation_Type__c || '';
        this.selectedCampaignGroupId = campaign.Campaign_Group_Dict__c || '';
        this.selectedCampaignGroupName = campaign.Campaign_Group_Dict__r ? campaign.Campaign_Group_Dict__r.Name : '';

        const fullName = campaign.Name || '';
        const prefixes = ['CMP_AO_', 'CMP_TR_', 'CMP_OO_', 'CMP_EM_', 'CMP_'];
        let baseName = fullName;
        for (const pfx of prefixes) {
            if (fullName.startsWith(pfx)) {
                baseName = fullName.substring(pfx.length);
                break;
            }
        }
        this.campaignName = baseName;

        this.topicName = campaign.Topic_Name__c || '';
        this.selectedOfferingType = campaign.Offering_Type__c || 'Product Family';
        this.selectedPriorityTier = campaign.Priority_Tier__c || '';
        this.isEmergency = campaign.Priority_Tier__c === 'Tier 1';
        this.excludeOnboarding = campaign.Exclude_Onboarding__c === true;
        this.selectedScoringMethod = campaign.Scoring_Method__c || 'Pick a Model';

        if (this.selectedScoringMethod === 'A-priori') {
            this.aprioriOverallScore = campaign.Overall_Score__c != null ? String(campaign.Overall_Score__c) : '';
        } else {
            this.fromObjectOverallScore = campaign.Overall_Score__c != null ? String(campaign.Overall_Score__c) : '';
        }

        if (campaign.Assigned_Channels__c) {
            this.editChannelValues = campaign.Assigned_Channels__c.split(';').map(c => c.trim());
            this.applyEditChannels();
        }

        if (campaign.Product_Family__c) {
            const selectedPFs = campaign.Product_Family__c.split(';').map(p => p.trim());
            this.editProductFamilyValues = selectedPFs;
        }

        if (campaign.Family_of_Needs__c) {
            const selectedFoNs = campaign.Family_of_Needs__c.split(';').map(f => f.trim());
            this.editFamilyOfNeedsValues = selectedFoNs;
        }

        this.loadSavedCampaignOffers();
    }

    loadSavedCampaignOffers() {
        if (!this.recordId) return;
        getCampaignOffers({ campaignId: this.recordId })
            .then(data => {
                // Only currently-active offers are returned; expired/inactive ones are dropped.
                this.editSavedOfferIds = (data || []).map(o => o.id);
                this.selectedOfferIds = [...this.editSavedOfferIds];
                this.scheduleFetchOffers();
            })
            .catch(err => console.error('Error loading saved campaign offers:', err));
    }

    // --- CAMPAIGN TYPE / GROUP DERIVATION ---
    get matchedCampaignType() {
        const key = (this.parentActivationType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key) return null;
        return this._allCampaignTypes.find(ct =>
            (ct.Name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === key
        ) || null;
    }

    get showCampaignGroup() {
        const ct = this.matchedCampaignType;
        return !!(ct && ct.Define_Campaign_Groups__c);
    }

    get campaignGroupOptions() {
        const ct = this.matchedCampaignType;
        if (!ct || !ct.Campaign_Groups_by_Type__r) return [];
        return ct.Campaign_Groups_by_Type__r.map(g => ({ label: g.Name, value: g.Id }));
    }

    handleSelectActivation(event) {
        const value = event.currentTarget.dataset.value;
        if (value === this.parentActivationType) return;
        this.parentActivationType = value;
        this.selectedCampaignGroupId = '';
        this.selectedCampaignGroupName = '';
        if ((value || '').toLowerCase() !== 'one-off') {
            this.isEmergency = false;
        }
        this.selectedPriorityTier = this.isEmergency ? this.tierLabelForNumber(1) : '';
    }

    handleCampaignGroupChange(event) {
        this.selectedCampaignGroupId = event.detail.value;
        const opt = this.campaignGroupOptions.find(o => o.value === this.selectedCampaignGroupId);
        this.selectedCampaignGroupName = opt ? opt.label : '';
    }

    @wire(getChannelDictionaryRecords)
    wiredChannelDictionary({ error, data }) {
        if (data) {
            const groupMap = {};
            const allChannels = [];

            data.forEach(rec => {
                const type = rec.Channel_Type__c || 'Other';
                const icon = rec.Channel_Icon__c || 'utility:connected_apps';
                if (!groupMap[type]) {
                    groupMap[type] = { type, icon, items: [] };
                }
                // New campaigns start with channels unchecked to avoid accidental all-channel selection.
                // Edit mode restores the campaign's previously assigned channels.
                const isActive = this.editChannelValues
                    ? this.editChannelValues.includes(rec.Name)
                    : false;
                allChannels.push({ label: rec.Name, value: rec.Name, checked: isActive });
                groupMap[type].items.push({
                    label: rec.Name,
                    value: rec.Name,
                    icon: rec.Channel_Icon__c || 'utility:connected_apps',
                    active: isActive,
                    buttonClass: isActive ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                    iconClass: isActive ? 'channel-icon-active' : 'channel-icon-inactive'
                });
            });

            this.channelGroups = Object.values(groupMap);
            this.channels = allChannels;
            this.selectAllChecked = allChannels.length > 0 && allChannels.every(c => c.checked);
        } else if (error) {
            console.error('Error fetching channel dictionary records:', error);
        }
    }

    applyEditChannels() {
        if (!this.editChannelValues || !this.channelGroups.length) return;
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => {
                const isActive = this.editChannelValues.includes(ch.label);
                return {
                    ...ch,
                    active: isActive,
                    buttonClass: isActive ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                    iconClass: isActive ? 'channel-icon-active' : 'channel-icon-inactive',
                    icon: ch.icon
                };
            })
        }));
        this.channels = this.channels.map(ch => ({
            ...ch,
            checked: this.editChannelValues.includes(ch.label)
        }));
        this.selectAllChecked = this.channels.every(c => c.checked);
    }

    @wire(getTopicGoalValues)
    wiredTopicGoals({ error, data }) {
        if (data) {
            this.allTopicGoals = data;
            this.filteredTopicGoals = data;
        } else if (error) {
            console.error('Error fetching topic goals:', error);
        }
    }

    @wire(getProductFamilyValues)
    wiredProductFamilies({ error, data }) {
        if (data) {
            this.rawProductFamilies = data;
            this.updateOptionLists();
        }
    }

    @wire(getFamilyOfNeedsValues)
    wiredFamilyOfNeeds({ error, data }) {
        if (data) {
            this.rawFamilyOfNeeds = data;
            this.updateOptionLists();
        }
    }

    @wire(getProductFamilyByRecordType)
    wiredRecordTypeMap({ error, data }) {
        if (data) {
            this.productFamilyByRecordType = data;
            this.buildGroupedOptions();
        } else if (error) {
            console.error('Error fetching record type map:', error);
        }
    }

    @wire(getProductFamilyCustomerTypes)
    wiredCustomerTypes({ error, data }) {
        if (data) {
            this.productFamilyCustomerTypes = data;
            this.updateOptionLists();
        } else if (error) {
            console.error('Error fetching customer types:', error);
        }
    }

    @wire(getFamilyOfNeedsCustomerTypes)
    wiredFonCustomerTypes({ error, data }) {
        if (data) {
            this.fonCustomerTypes = data;
            this.updateOptionLists();
        } else if (error) {
            console.error('Error fetching FoN customer types:', error);
        }
    }

    @wire(getProductFamilyDependencies)
    wiredDependencies({ error, data }) {
        if (data) {
            this.productFamilyToFoN = data;
            const inverseMap = {};
            for (const [family, fons] of Object.entries(data)) {
                if (fons && Array.isArray(fons)) {
                    fons.forEach(fon => {
                        if (!inverseMap[fon]) inverseMap[fon] = [];
                        if (!inverseMap[fon].includes(family)) inverseMap[fon].push(family);
                    });
                }
            }
            this.fonToProductFamilies = inverseMap;
            this.updateOptionLists();
        } else if (error) {
            console.error('Error fetching dependencies:', error);
        }
    }

    updateOptionLists() {
        if (this.rawProductFamilies && this.rawProductFamilies.length > 0) {
            this.productFamilyOptions = this.rawProductFamilies.filter(val => val !== 'None').map(val => {
                const relatedFons = this.productFamilyToFoN[val] || [];
                const customerTypes = this.productFamilyCustomerTypes[val] || [];
                const existing = this.productFamilyOptions.find(opt => opt.value === val);
                let isChecked;
                if (existing) {
                    isChecked = existing.checked;
                } else if (this.editProductFamilyValues) {
                    isChecked = this.editProductFamilyValues.includes(val);
                } else {
                    isChecked = false;
                }
                return { label: val, value: val, checked: isChecked, fons: relatedFons, customerTypes };
            });
            this.selectAllProductFamilies = this.productFamilyOptions.every(opt => opt.checked);
        }

        if (this.rawFamilyOfNeeds && this.rawFamilyOfNeeds.length > 0) {
            this.familyOfNeedsOptions = this.rawFamilyOfNeeds.map(val => {
                const relatedFamilies = this.fonToProductFamilies[val] || [];
                const customerTypes = this.fonCustomerTypes[val] || [];
                const existing = this.familyOfNeedsOptions.find(opt => opt.value === val);
                let isChecked;
                if (existing) {
                    isChecked = existing.checked;
                } else if (this.editFamilyOfNeedsValues) {
                    isChecked = this.editFamilyOfNeedsValues.includes(val);
                } else {
                    isChecked = false;
                }
                return {
                    label: val, value: val, checked: isChecked, families: relatedFamilies,
                    customerTypes,
                    tooltip: relatedFamilies.length > 0 ? `Product Families: ${relatedFamilies.join(', ')}` : 'No related Product Families'
                };
            });
            this.selectAllFamilyOfNeeds = this.familyOfNeedsOptions.every(opt => opt.checked);
        }

        this.buildGroupedOptions();
    }

    buildGroupedOptions() {
        if (!this.productFamilyOptions.length || !Object.keys(this.productFamilyByRecordType).length) return;

        const groups = [];
        const pfOptionsMap = {};
        this.productFamilyOptions.forEach(opt => { pfOptionsMap[opt.value] = opt; });
        const assigned = new Set();

        for (const [rtName, families] of Object.entries(this.productFamilyByRecordType)) {
            const items = [];
            for (const family of families) {
                if (pfOptionsMap[family] && !assigned.has(family)) {
                    const opt = pfOptionsMap[family];
                    const primaryFon = (opt.fons && opt.fons.length > 0) ? opt.fons[0] : '';
                    items.push({ ...opt, sortKey: primaryFon });
                    assigned.add(family);
                }
            }
            items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
            if (items.length > 0) groups.push({ recordType: rtName, items });
        }

        const unassigned = this.productFamilyOptions.filter(opt => !assigned.has(opt.value));
        if (unassigned.length > 0) groups.push({ recordType: 'Other', items: unassigned });

        this.groupedProductFamilyOptions = groups;
    }

    // FIXED: Added "Select All" master toggles
    handleSelectAllProductFamilies(event) {
        this.selectAllProductFamilies = event.target.checked;
        this.productFamilyOptions = this.productFamilyOptions.map(opt => ({
            ...opt,
            checked: this.selectAllProductFamilies
        }));
        this.buildGroupedOptions();
        this.scheduleFetchOffers();
    }

    handleSelectAllFamilyOfNeeds(event) {
        this.selectAllFamilyOfNeeds = event.target.checked;
        this.familyOfNeedsOptions = this.familyOfNeedsOptions.map(opt => ({
            ...opt,
            checked: this.selectAllFamilyOfNeeds
        }));
        this.scheduleFetchOffers();
    }

    // --- COMBOBOX INTERACTION HANDLERS ---
    handleOutsideClick(event) {
        if (!event.target.closest('.slds-combobox_container')) {
            this.isTopicDropdownOpen = false;
        }
    }

    // Place this method next to your other event handlers (e.g., near handleFamilyOfNeedsChange)
    handleIconClick(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // Add this getter to control the combobox visibility
    get comboboxClass() {
        return `slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click ${this.isTopicDropdownOpen ? 'slds-is-open' : ''}`;
    }

    handleTopicDropdownToggle(event) {
        event.stopPropagation();
        this.isTopicDropdownOpen = !this.isTopicDropdownOpen;
    }

    handleTopicSearch(event) {
        const value = event.target.value.toLowerCase();
        this.topicName = event.target.value;
        
        // Ensure the dropdown opens when the user starts typing
        this.isTopicDropdownOpen = true;

        this.filteredTopicGoals = this.allTopicGoals.filter(val => 
            val.toLowerCase().includes(value)
        );
        this.clearScoringIfDisabled();
    }

    handleSelectTopic(event) {
        const selectedVal = event.currentTarget.dataset.value;
        this.topicName = selectedVal;
        this.isTopicDropdownOpen = false; // Close the dropdown on selection
        this.clearScoringIfDisabled();
    }

    handleNameChange(event) {
        this.campaignName = event.target.value; 
    }
    
    handleTopicChange(event) { 
        this.topicName = event.target.value; 
        this.clearScoringIfDisabled();
    }
        
    handleOfferingTypeChange(event) {
        this.selectedOfferingType = event.target.value; 
        this.clearScoringIfDisabled();
        this.matchingOffers = [];
        this.scheduleFetchOffers();
    }

    handleProductFamilyChange(event) {
        const val = event.target.dataset.value;
        this.productFamilyOptions = this.productFamilyOptions.map(item =>
            item.value === val ? { ...item, checked: event.target.checked } : item
        );
        this.selectAllProductFamilies = this.productFamilyOptions.every(opt => opt.checked);
        this.buildGroupedOptions();
        this.scheduleFetchOffers();
    }

    handleCustomerTypeFilter(event) {
        const val = event.currentTarget.dataset.value;
        if (this.pfFilterCustomerTypes.includes(val)) {
            this.pfFilterCustomerTypes = this.pfFilterCustomerTypes.filter(v => v !== val);
        } else {
            this.pfFilterCustomerTypes = [...this.pfFilterCustomerTypes, val];
        }
    }

    handleRecordTypeFilterBadge(event) {
        const val = event.currentTarget.dataset.value;
        if (this.pfFilterRecordTypes.includes(val)) {
            this.pfFilterRecordTypes = this.pfFilterRecordTypes.filter(v => v !== val);
        } else {
            this.pfFilterRecordTypes = [...this.pfFilterRecordTypes, val];
        }
    }

    handleFonFilter(event) {
        this.pfFilterFon = event.target.value;
    }

    handleFonCustomerTypeFilter(event) {
        const val = event.currentTarget.dataset.value;
        if (this.fonFilterCustomerTypes.includes(val)) {
            this.fonFilterCustomerTypes = this.fonFilterCustomerTypes.filter(v => v !== val);
        } else {
            this.fonFilterCustomerTypes = [...this.fonFilterCustomerTypes, val];
        }
    }

    handleFamilyOfNeedsChange(event) {
        const val = event.target.dataset.value;
        this.familyOfNeedsOptions = this.familyOfNeedsOptions.map(item =>
            item.value === val ? { ...item, checked: event.target.checked } : item
        );
        this.selectAllFamilyOfNeeds = this.familyOfNeedsOptions.every(opt => opt.checked);
        this.scheduleFetchOffers();
    }

    handleEmergencyToggle() {
        this.isEmergency = !this.isEmergency;
        
        if (this.isEmergency) {
            this.selectedPriorityTier = this.tierLabelForNumber(1);
        } else {
            this.selectedPriorityTier = '';
        }
    }

    /** Display / picklist label for a Campaign_Tier__c row (Name is AutoNumber TIER-000). */
    tierLabelForNumber(tierNumber) {
        return tierNumber != null ? `Tier ${tierNumber}` : '';
    }

    tierLabel(tier) {
        return this.tierLabelForNumber(tier && tier.Tier_Number__c);
    }

    /** Dictionary stores Supported_Campaign_Types__c as comma-separated Campaign Type names. */
    parseSupportedCampaignTypes(raw) {
        return (raw || '')
            .split(/[,;]/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
    }

    isTierAttributeEnabled(value) {
        return value === true || value === 'Yes';
    }

    handlePriorityChange(event) {
        if (this.isEmergency) return;
        if (event.currentTarget.classList.contains('tier-disabled')) return;
        const newTier = event.currentTarget.dataset.value;
        if (newTier !== this.selectedPriorityTier) {
            this.selectedPriorityTier = newTier;
            this.suppressionType = '';
            this.suppressionLookupValue = '';
            this.suppressionLookupDisplay = '';
        }
    }

    handleSuppressionTypeChange(event) {
        this.suppressionType = event.currentTarget.dataset.value;
        this.suppressionLookupValue = '';
        this.suppressionLookupDisplay = '';
    }

    handleSuppressionLookupChange(event) {
        this.suppressionLookupValue = event.target.value;
        this.suppressionLookupDisplay = event.target.value;
    }

    handleExcludeOnboardingChange(event) { this.excludeOnboarding = event.target.checked; }
    handleExcludeOtherMarketingChange(event) { this.excludeOtherMarketing = event.target.checked; }

    // "Exclude other marketing" is intended to apply only to Tier 1-3 campaigns, but the
    // tier data model is mid-change, so the checkbox is shown unconditionally for now.
    get showExcludeOtherMarketing() {
        return true;
    }

    handleScoringMethodChange(event) { 
        if (this.isScoringDisabled) return;
        this.selectedScoringMethod = event.currentTarget.dataset.value; 
    }

    handleAprioriChange(event) { this.aprioriOverallScore = event.target.value; }
    handleFromObjectChange(event) { this.fromObjectOverallScore = event.target.value; }

    clearScoringIfDisabled() {
        if (this.isScoringDisabled) {
            this.aprioriOverallScore = '';
            this.fromObjectOverallScore = '';
        }
    }

    handleSelectAllChange(event) {
        this.selectAllChecked = event.target.checked;
        this.channels = this.channels.map(c => ({ ...c, checked: this.selectAllChecked }));
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => ({
                ...ch,
                active: this.selectAllChecked,
                buttonClass: this.selectAllChecked ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                iconClass: this.selectAllChecked ? 'channel-icon-active' : 'channel-icon-inactive'
            }))
        }));
    }

    handleChannelTileToggle(event) {
        const val = event.currentTarget.dataset.value;
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => {
                if (ch.value === val) {
                    const newActive = !ch.active;
                    return {
                        ...ch,
                        active: newActive,
                        buttonClass: newActive ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive',
                        iconClass: newActive ? 'channel-icon-active' : 'channel-icon-inactive'
                    };
                }
                return ch;
            })
        }));
        this.channels = this.channels.map(c => c.value === val ? { ...c, checked: !c.checked } : c);
        this.selectAllChecked = this.channels.every(c => c.checked);
    }

    handleChannelChange(event) {
        const val = event.target.dataset.value;
        this.channels = this.channels.map(c => c.value === val ? { ...c, checked: event.target.checked } : c);
        this.selectAllChecked = this.channels.every(c => c.checked);
    }

    // --- WIZARD STEP NAVIGATION ---
    // Step 3 (Copy Assignment) is a ghost placeholder until Copy Center wiring lands.
    wizardStepData = [
        { label: 'Campaign Properties', value: 1 },
        { label: 'Topic & Offering', value: 2 },
        { label: 'Copy Assignment', value: 3 },
        { label: 'Priority & Exclusions', value: 4 },
        { label: 'Scoring', value: 5 },
        { label: 'Summary', value: 6 }
    ];

    get wizardSteps() {
        return this.wizardStepData.map(step => {
            let className = 'slds-progress__item';
            if (step.value < this.currentStep) className += ' slds-is-completed';
            else if (step.value === this.currentStep) className += ' slds-is-active';
            return {
                ...step,
                className,
                isComplete: step.value < this.currentStep
            };
        });
    }

    get progressBarValue() {
        return ((this.currentStep - 1) / (this.wizardStepData.length - 1)) * 100;
    }

    get progressBarStyle() {
        return `width: ${this.progressBarValue}%;`;
    }

    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }
    get isStep4() { return this.currentStep === 4; }
    get isStep5() { return this.currentStep === 5; }
    get isStep6() { return this.currentStep === 6; }
    get isLastStep() { return this.currentStep === 6; }
    get showBackButton() { return this.currentStep > 1; }
    get showNextButton() { return this.currentStep < 6; }

    get pfSectionChevron() {
        return this.isProductFamilySectionOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get fonSectionChevron() {
        return this.isFonSectionOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get pfSectionClass() {
        return `slds-section ${this.isProductFamilySectionOpen ? 'slds-is-open' : ''}`;
    }

    get fonSectionClass() {
        return `slds-section ${this.isFonSectionOpen ? 'slds-is-open' : ''}`;
    }

    // --- SUMMARY GETTERS ---
    get summaryChannels() {
        const selected = this.channels.filter(c => c.checked).map(c => c.label);
        if (selected.length === this.channels.length) return 'All Channels';
        if (selected.length === 0) return 'None';
        return selected.join(', ');
    }

    get summaryOfferingItems() {
        if (this.isOfferingProductFamily) {
            const selected = this.productFamilyOptions.filter(o => o.checked);
            if (selected.length === this.productFamilyOptions.length) return `All Product Families (${selected.length})`;
            if (selected.length === 0) return 'None';
            if (selected.length <= 5) return selected.map(o => o.label).join(', ');
            return `${selected.length} Product Families selected`;
        }
        const selected = this.familyOfNeedsOptions.filter(o => o.checked);
        if (selected.length === this.familyOfNeedsOptions.length) return `All Families of Needs (${selected.length})`;
        if (selected.length === 0) return 'None';
        if (selected.length <= 5) return selected.map(o => o.label).join(', ');
        return `${selected.length} Families of Needs selected`;
    }

    get excludeOnboardingLabel() {
        return this.excludeOnboarding ? 'Yes' : 'No';
    }

    get excludeOtherMarketingLabel() {
        return this.excludeOtherMarketing ? 'Yes' : 'No';
    }

    get summaryScore() {
        if (this.isScoringAPriori) return this.aprioriOverallScore || 'Not set';
        return this.fromObjectOverallScore || 'Not set';
    }

    get summaryFallbackScoreLabel() {
        return this.isScoringFromObject ? 'Fallback A-Priori Score' : 'Overall Score';
    }

    // Only render the offer panel when a matching offer was selected during offering
    // and its summary has loaded.
    get hasSelectedOfferSummary() {
        return this.offerSummaries && this.offerSummaries.length > 0;
    }

    // Shapes each loaded offer summary for the Summary-step panel: key rows always
    // visible, plus a collapsible attractiveness & properties section.
    get selectedOfferSummaries() {
        return (this.offerSummaries || []).map(o => {
            const expanded = !!this.expandedOfferParams[o.id];
            const params = o.parameters || [];
            return {
                id: o.id,
                name: o.name,
                status: o.status || '—',
                keyInfo: [
                    { label: 'Product Family', value: o.productFamily || '—' },
                    { label: 'Source Products', value: o.sourceProducts || '—' },
                    { label: 'Target Audience', value: o.targetAudience || '—' },
                    { label: 'Validity Period', value: this.formatValidity(o.validFrom, o.validTo) },
                    { label: 'Version', value: (o.versionNumber !== null && o.versionNumber !== undefined) ? String(o.versionNumber) : '—' },
                    { label: 'Currency', value: o.currencyCode || '—' }
                ],
                attractivenessScore: (o.attractivenessScore !== null && o.attractivenessScore !== undefined) ? String(o.attractivenessScore) : '—',
                parameters: params,
                paramsCount: params.length,
                isParamsExpanded: expanded,
                paramsChevron: expanded ? 'utility:chevrondown' : 'utility:chevronright',
                paramsSectionClass: `slds-section offer-params-section ${expanded ? 'slds-is-open' : ''}`
            };
        });
    }

    formatValidity(from, to) {
        if (from && to) return `${from} → ${to}`;
        return from || to || '—';
    }

    loadOfferSummaries() {
        if (!this.selectedOfferIds || this.selectedOfferIds.length === 0) {
            this.offerSummaries = [];
            return;
        }
        getOfferSummaries({ offerIds: this.selectedOfferIds })
            .then(data => { this.offerSummaries = data || []; })
            .catch(() => { this.offerSummaries = []; });
    }

    maybeLoadOfferSummaries() {
        if (this.currentStep === 6) {
            this.loadOfferSummaries();
        }
    }

    handleToggleOfferParams(event) {
        const offerId = event.currentTarget.dataset.id;
        if (!offerId) return;
        this.expandedOfferParams = {
            ...this.expandedOfferParams,
            [offerId]: !this.expandedOfferParams[offerId]
        };
    }

    handleToggleProductFamilySection() {
        this.isProductFamilySectionOpen = !this.isProductFamilySectionOpen;
    }

    handleToggleFonSection() {
        this.isFonSectionOpen = !this.isFonSectionOpen;
    }

    handleNextStep() {
        if (this.currentStep < 6) {
            this.currentStep++;
            this.maybeLoadOfferSummaries();
        }
    }

    handlePreviousStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.maybeLoadOfferSummaries();
        }
    }

    handleStepClick(event) {
        const step = parseInt(event.currentTarget.dataset.step, 10);
        if (step <= this.currentStep) {
            this.currentStep = step;
            this.maybeLoadOfferSummaries();
        }
    }

    get isScoringDisabled() {
        return !this.topicName || this.topicName.trim() === '' || !this.selectedOfferingType;
    }

    get topicDropdownContainerClass() {
        return `custom-dropdown-container topic-dropdown-container ${this.isTopicDropdownOpen ? 'slds-is-open' : ''}`;
    }

    get isScoringFromObject() { return this.selectedScoringMethod === 'Pick a Model'; }
    get isScoringAPriori() { return this.selectedScoringMethod === 'A-priori'; }
    
    get isOfferingProductFamily() { return this.selectedOfferingType === 'Product Family'; }
    get isOfferingFamilyOfNeeds() { return this.selectedOfferingType === 'Family of Needs'; }

    get customerTypeFilterOptions() {
        const types = new Set();
        Object.values(this.productFamilyCustomerTypes).forEach(arr => arr.forEach(ct => types.add(ct)));
        return [...types].sort().map(ct => ({
            label: ct,
            value: ct,
            className: `pf-filter-pill ${this.pfFilterCustomerTypes.includes(ct) ? 'pf-filter-pill-active' : ''}`
        }));
    }

    get recordTypeFilterBadgeOptions() {
        return Object.keys(this.productFamilyByRecordType).sort().map(rt => ({
            label: rt,
            value: rt,
            className: `pf-filter-pill ${this.pfFilterRecordTypes.includes(rt) ? 'pf-filter-pill-active' : ''}`
        }));
    }

    get fonFilterOptions() {
        const fons = new Set();
        Object.values(this.productFamilyToFoN).forEach(arr => arr.forEach(f => fons.add(f)));
        return [...fons].sort();
    }

    get filteredGroupedProductFamilyOptions() {
        if (!this.pfFilterCustomerTypes.length && !this.pfFilterRecordTypes.length && !this.pfFilterFon) {
            return this.groupedProductFamilyOptions;
        }
        const filtered = [];
        for (const group of this.groupedProductFamilyOptions) {
            if (this.pfFilterRecordTypes.length && !this.pfFilterRecordTypes.includes(group.recordType)) continue;
            const items = group.items.filter(pf => {
                if (this.pfFilterCustomerTypes.length) {
                    const types = this.productFamilyCustomerTypes[pf.value] || [];
                    if (!this.pfFilterCustomerTypes.some(ct => types.includes(ct))) return false;
                }
                if (this.pfFilterFon) {
                    if (!(pf.fons || []).includes(this.pfFilterFon)) return false;
                }
                return true;
            });
            if (items.length > 0) filtered.push({ recordType: group.recordType, items });
        }
        return filtered;
    }

    get fonCustomerTypeFilterOptions() {
        const types = new Set();
        Object.values(this.fonCustomerTypes).forEach(arr => arr.forEach(ct => types.add(ct)));
        return [...types].sort().map(ct => ({
            label: ct,
            value: ct,
            className: `pf-filter-pill ${this.fonFilterCustomerTypes.includes(ct) ? 'pf-filter-pill-active' : ''}`
        }));
    }

    get filteredFamilyOfNeedsOptions() {
        if (!this.fonFilterCustomerTypes.length) return this.familyOfNeedsOptions;
        return this.familyOfNeedsOptions.filter(fon => {
            const types = this.fonCustomerTypes[fon.value] || [];
            return this.fonFilterCustomerTypes.some(ct => types.includes(ct));
        });
    }

    get saveButtonLabel() {
        return this.isEditMode ? 'Update' : 'Save';
    }

    get showEmergencyToggle() {
        if (!this.parentActivationType) return false;
        const type = this.parentActivationType.toLowerCase();
        return type === 'one-off';
    }

    get emergencyButtonClass() {
        return this.isEmergency 
            ? 'slds-button slds-button_icon slds-button_icon-border emergency-btn-active' 
            : 'slds-button slds-button_icon slds-button_icon-border emergency-btn-inactive';
    }

    get emergencyIconVariant() {
        return this.isEmergency ? 'warning' : '';
    }

    get priorityTierOptions() {
        const activationType = this.parentActivationType
            ? this.parentActivationType.toLowerCase().trim()
            : '';

        return this._allTiers.map(tier => {
            const supported = this.parseSupportedCampaignTypes(tier.Supported_Campaign_Types__c);
            const label = this.tierLabel(tier);

            let isAllowed = false;
            if (this.isEmergency) {
                isAllowed = Number(tier.Tier_Number__c) === 1;
            } else if (activationType) {
                // Empty Supported_Campaign_Types means the tier was not scoped — treat as available.
                isAllowed = supported.length === 0 || supported.some(s => s === activationType);
            } else {
                isAllowed = true;
            }

            let className = 'priority-list-item';
            if (!isAllowed) {
                className += ' tier-disabled';
            } else if (this.selectedPriorityTier === label) {
                className += ' priority-item-selected';
            }

            return {
                label,
                value: label,
                className,
                isDisabled: !isAllowed,
                tooltip: tier.Description__c || ''
            };
        });
    }

    get selectedTierRecord() {
        if (!this.selectedPriorityTier) return null;
        return this._allTiers.find(t => this.tierLabel(t) === this.selectedPriorityTier) || null;
    }

    get selectedTierBehaviouralBadges() {
        const tier = this.selectedTierRecord;
        if (!tier) return [];
        const fields = [
            { field: 'Honor_Marketing_Consents__c', label: 'Honor Marketing Consents' },
            { field: 'Honors_Channel_Cooldowns__c', label: 'Honors Channel Cooldowns' },
            { field: 'Honors_Product_Eligibility__c', label: 'Honors Product Eligibility' },
            { field: 'Includes_Control_Group__c', label: 'Includes Control Group' },
            { field: 'Override_Random_Activation_Path__c', label: 'Override Random Activation Path' },
            { field: 'Allows_Random_Copy_Assignment__c', label: 'Allows Random Copy Assignment' }
        ];
        return fields
            .filter(f => this.isTierAttributeEnabled(tier[f.field]))
            .map(f => ({ label: f.label, key: f.field }));
    }

    get selectedTierExclusionBadges() {
        const tier = this.selectedTierRecord;
        if (!tier) return [];
        const fields = [
            { field: 'Excl_Deceased__c', label: 'Deceased' },
            { field: 'Excl_AML_Fraud__c', label: 'AML/Fraud' },
            { field: 'Excl_Debt_Collection__c', label: 'Debt Collection' },
            { field: 'Excl_Overdue__c', label: 'Overdue' },
            { field: 'Excl_KYC_Risk__c', label: 'KYC Risk' },
            { field: 'Excl_Bailiff_Seizure__c', label: 'Bailiff Seizure' },
            { field: 'Excl_Restricted_Client__c', label: 'Restricted Client' },
            { field: 'Excl_Personal_Bankruptcy__c', label: 'Personal Bankruptcy' }
        ];
        return fields.filter(f => tier[f.field] === true).map(f => ({ label: f.label, key: f.field }));
    }

    get showSuppressionSection() {
        const tier = this.selectedTierRecord;
        return !!(tier && tier.Excl_Manual_Suppressions__c);
    }

    get suppressionTypeOptions() {
        return [
            { label: 'Salesforce Campaign', value: 'campaign', className: `segment-item ${this.suppressionType === 'campaign' ? 'segment-selected' : ''}` },
            { label: 'Salesforce Report', value: 'report', className: `segment-item ${this.suppressionType === 'report' ? 'segment-selected' : ''}` },
            { label: 'Data360 Segment', value: 'segment', className: `segment-item ${this.suppressionType === 'segment' ? 'segment-selected' : ''}` }
        ];
    }

    get activationOptions() {
        return this.activationData.map(opt => {
            const typeKey = opt.value.toLowerCase().replace(/[^a-z0-9]/g, '');
            const selected = this.parentActivationType === opt.value;
            return {
                ...opt,
                btnClass: `slds-button activation-btn activation-btn--${typeKey}${selected ? ' activation-btn--selected' : ''}`,
                iconClass: `activation-btn-icon activation-btn-icon--${typeKey}`
            };
        });
    }

    get scoringMethodOptions() {
        return this.scoringMethodsData.map(m => ({ ...m, className: `segment-item ${this.selectedScoringMethod === m.value ? 'segment-selected' : ''}` }));
    }

    get offeringTypeOptions() {
    return this.offeringTypesData.map(o => ({
        ...o,
        uniqueId: `offering-radio-${o.value}`,
        // Add a boolean to control the checked state of the radio input
        isChecked: this.selectedOfferingType === o.value
    }));
    }
    toCamelCase(str) {
        if (!str) return '';
        return str.trim().split(/\s+/).map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join('');
    }

    get activationPrefix() {
        const typeKey = (this.parentActivationType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        switch (typeKey) {
            case 'alwayson':   return 'CMP_AO_';
            case 'triggered':  return 'CMP_TR_';
            case 'oneoff':     return 'CMP_OO_';
            case 'emergency':  return 'CMP_EM_';
            default:           return 'CMP_';
        }
    }

    get modalTitle() {
        const prefix = this.activationPrefix;
        const camelName = this.toCamelCase(this.campaignName);
        if (camelName) return `${prefix}${camelName}`;
        return this.isEditMode ? 'Edit Campaign' : `${prefix}{YourCampaignName}`;
    }

    get isCurrentStepInvalid() {
        switch (this.currentStep) {
            case 1:
                if (this.campaignName.trim() === '' || !this.parentActivationType) return true;
                if (this.showCampaignGroup && !this.selectedCampaignGroupId) return true;
                return false;
            case 2:
                if (!this.topicName || this.topicName.trim() === '' || !this.selectedOfferingType) return true;
                if (this.isOfferingProductFamily) {
                    if (!this.productFamilyOptions.some(opt => opt.checked)) return true;
                }
                if (this.isOfferingFamilyOfNeeds) {
                    if (!this.familyOfNeedsOptions.some(opt => opt.checked)) return true;
                }
                return false;
            case 3:
                // Copy Assignment ghost step — no validation until Copy Center is wired in.
                return false;
            case 4:
                if (this.selectedPriorityTier === '') return true;
                return false;
            case 5:
                if (this.isScoringAPriori) {
                    const val = Number(this.aprioriOverallScore);
                    if (!this.aprioriOverallScore || !Number.isInteger(val) || val < 1 || val > 1000) return true;
                }
                if (this.isScoringFromObject) {
                    // Fallback a-priori score is mandatory when a scoring model is selected
                    // (covers customers with no row in the model output table).
                    const val = Number(this.fromObjectOverallScore);
                    if (!this.fromObjectOverallScore || !Number.isInteger(val) || val < 1 || val > 1000) return true;
                }
                return false;
            case 6:
                return false;
            default:
                return false;
        }
    }

    get filteredMatchingOffers() {
        const q = (this.offerSearchTerm || '').toLowerCase();
        const list = q
            ? this.matchingOffers.filter(o => o.name.toLowerCase().includes(q))
            : this.matchingOffers;
        return list.map(o => {
            const selected = this.selectedOfferIds.includes(o.id);
            return {
                ...o,
                selected,
                matchReason: this.buildOfferMatchReason(o),
                rowClass: selected ? 'slds-hint-parent offer-row-selected' : 'slds-hint-parent',
                toggleIcon: selected ? 'utility:check' : 'utility:add',
                toggleTitle: selected ? 'Remove offer' : 'Add offer',
                toggleAssistive: selected ? 'Remove offer' : 'Add offer'
            };
        });
    }

    buildOfferMatchReason(offer) {
        const offerFamilies = (offer.productFamilies || '')
            .split(';').map(s => s.trim()).filter(Boolean);
        const offerProducts = (offer.sourceProducts || '')
            .split(';').map(s => s.trim()).filter(Boolean);

        const checkedFoN = this.isOfferingFamilyOfNeeds;
        const selectedValues = checkedFoN
            ? this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.value)
            : this.productFamilyOptions.filter(o => o.checked).map(o => o.value);

        // When in FoN mode a selected FoN pulls in offers through its member product
        // families, so translate the checked FoNs into the families used for matching.
        let selectionFamilies = selectedValues;
        if (checkedFoN) {
            const fam = new Set();
            selectedValues.forEach(fon => {
                (this.fonToProductFamilies[fon] || []).forEach(pf => fam.add(pf));
            });
            selectionFamilies = [...fam];
        }

        const matched = offerFamilies.filter(f => selectionFamilies.includes(f));
        const parts = [];

        if (checkedFoN && selectedValues.length) {
            const pullingFoN = selectedValues.filter(fon =>
                (this.fonToProductFamilies[fon] || []).some(pf => offerFamilies.includes(pf))
            );
            if (pullingFoN.length) {
                parts.push(`Matches your selection — Family of Needs: ${pullingFoN.join(', ')}`);
            }
        }

        if (matched.length) {
            parts.push(`Matches your selection — Product Families: ${matched.join(', ')}`);
        } else if (offerFamilies.length) {
            parts.push(`Matched on Product Family: ${offerFamilies.join(', ')}`);
        }

        if (offerProducts.length) {
            parts.push(`Products: ${offerProducts.join(', ')}`);
        }

        const others = offerFamilies.filter(f => !matched.includes(f));
        if (matched.length && others.length) {
            parts.push(`Also covers: ${others.join(', ')}`);
        }

        return parts.length ? parts.join('\n') : `Active offer matching your current selection.`;
    }

    get selectedOffersCount() {
        return this.selectedOfferIds.length;
    }

    handleOfferSearch(event) {
        this.offerSearchTerm = event.target.value;
    }

    handleOfferToggle(event) {
        const offerId = event.currentTarget.dataset.id;
        if (this.selectedOfferIds.includes(offerId)) {
            this.selectedOfferIds = this.selectedOfferIds.filter(id => id !== offerId);
        } else {
            this.selectedOfferIds = [...this.selectedOfferIds, offerId];
        }
    }

    // Modify is navigation only: open the existing Offer record page (which hosts the
    // Offer wizard) for this offer, preferring a new tab so the in-progress Campaign
    // wizard and its unsaved Step 2 selection survive.
    handleModifyOffer(event) {
        const offerId = event.currentTarget.dataset.id;
        if (!offerId) return;
        const pageRef = {
            type: 'standard__recordPage',
            attributes: {
                recordId: offerId,
                objectApiName: 'Offer__c',
                actionName: 'view'
            }
        };
        this[NavigationMixin.GenerateUrl](pageRef)
            .then(url => {
                const opened = window.open(url, '_blank');
                if (!opened) {
                    // Popup blocked or host disallows new tabs — fall back to same-tab navigation.
                    this[NavigationMixin.Navigate](pageRef);
                }
            })
            .catch(() => {
                this[NavigationMixin.Navigate](pageRef);
            });
    }

    fetchMatchingOffers() {
        const pfs  = this.productFamilyOptions.filter(o => o.checked).map(o => o.value);
        const checkedFons = this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.value);
        if (pfs.length === 0 && checkedFons.length === 0) {
            this.matchingOffers = [];
            this.selectedOfferIds = [];
            this.offerSearchTerm = '';
            return;
        }
        // Offers store a single product family, never a Family of Needs name, so a checked
        // FoN must be expanded into its member product families before matching. An offer
        // shows if ANY of those families matches an active offer version.
        const fonFamilies = new Set();
        checkedFons.forEach(fon => {
            (this.fonToProductFamilies[fon] || []).forEach(pf => fonFamilies.add(pf));
        });
        const fons = [...fonFamilies];
        this.isLoadingOffers = true;
        getMatchingOffers({ productFamilies: pfs, familyOfNeeds: fons })
            .then(data => {
                this.matchingOffers = data;
                // Drop any selected offers that no longer match / are no longer active.
                const matchedIds = new Set(data.map(o => o.id));
                this.selectedOfferIds = this.selectedOfferIds.filter(id => matchedIds.has(id));
                this.isLoadingOffers = false;
            })
            .catch(() => { this.isLoadingOffers = false; });
    }

    scheduleFetchOffers() {
        clearTimeout(this._offerFetchTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._offerFetchTimer = setTimeout(() => this.fetchMatchingOffers(), 300);
    }

    handleSave() {
        this.isLoading = true;
        this.executeSubCampaignSave();
    }

    executeSubCampaignSave() {
        const fields = {};
        const num = (v) => v === '' || v === null ? null : Number(v);

        fields['Name'] = `${this.activationPrefix}${this.toCamelCase(this.campaignName)}`;
        fields['Type'] = 'Standard';
        fields['Campaign_Group_Dict__c'] = this.showCampaignGroup ? (this.selectedCampaignGroupId || null) : null;
        fields['Topic_Name__c'] = this.topicName || null;
        fields['Priority_Tier__c'] = this.selectedPriorityTier;
        fields['Activation_Type__c'] = this.parentActivationType;
        fields['Exclude_Onboarding__c'] = this.excludeOnboarding;
        fields['Scoring_Method__c'] = this.selectedScoringMethod;
        fields['Offering_Type__c'] = this.selectedOfferingType;

        if (this.isScoringAPriori) fields['Overall_Score__c'] = num(this.aprioriOverallScore);
        else if (this.isScoringFromObject) fields['Overall_Score__c'] = num(this.fromObjectOverallScore);

        fields['Assigned_Channels__c'] = this.channels.filter(c => c.checked).map(c => c.label).join('; ');

        if (this.isOfferingProductFamily) {
            fields['Product_Family__c'] = this.productFamilyOptions.filter(o => o.checked).map(o => o.value).join('; ');
            fields['Family_of_Needs__c'] = null;
        } else if (this.isOfferingFamilyOfNeeds) {
            fields['Family_of_Needs__c'] = this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.value).join('; ');
            fields['Product_Family__c'] = null;
        }

        if (this.isEditMode) {
            fields['Id'] = this.recordId;
            const recordInput = { fields };
            updateRecord(recordInput)
                .then(() => this.persistCampaignOffers(this.recordId))
                .then(() => {
                    this.isLoading = false;
                    this.dispatchEvent(new ShowToastEvent({ title: 'Success!', message: 'Campaign updated successfully.', variant: 'success' }));
                    this.navigateToRecord(this.recordId);
                })
                .catch(err => {
                    this.isLoading = false;
                    this.showErrorToast(err);
                });
        } else {
            createRecord({ apiName: 'Campaign', fields })
                .then(camp => this.persistCampaignOffers(camp.id).then(() => camp.id))
                .then(campId => {
                    this.isLoading = false;
                    this.dispatchEvent(new ShowToastEvent({ title: 'Success!', message: 'Standard Campaign record committed successfully.', variant: 'success' }));
                    this.navigateToRecord(campId);
                })
                .catch(err => {
                    this.isLoading = false;
                    this.showErrorToast(err);
                });
        }
    }

    persistCampaignOffers(campaignId) {
        const offerIds = this.isOfferingProductFamily || this.isOfferingFamilyOfNeeds
            ? this.selectedOfferIds
            : [];
        return saveCampaignOffers({ campaignId, offerIds });
    }

    navigateToRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: recordId, objectApiName: 'Campaign', actionName: 'view' }
        });
        this.dispatchEvent(new CustomEvent('close'));
    }

    showErrorToast(error) {
        let msg = 'Database transaction runtime failure.';
        if (error?.body?.message) {
            msg = error.body.message;
        } else if (error?.body?.output?.errors && error.body.output.errors.length > 0) {
            msg = error.body.output.errors.map(e => e.message).join('; ');
        } else if (error?.body?.fieldErrors) {
            const fieldMsgs = [];
            for (const [field, errs] of Object.entries(error.body.fieldErrors)) {
                errs.forEach(e => fieldMsgs.push(`${field}: ${e.message}`));
            }
            msg = fieldMsgs.join('; ') || msg;
        } else if (error?.message) {
            msg = error.message;
        }
        console.error('Campaign save error:', JSON.stringify(error));
        this.dispatchEvent(new ShowToastEvent({ title: 'System Error', message: msg, variant: 'error', mode: 'sticky' }));
    }

    handleContainerClick(event) {
        // Keep clicks inside the wizard from bubbling to the backdrop.
        event.stopPropagation();
    }

    handleBackdropClick() {
        this.handleCancel();
    }

    handleCancel() {
        if (this.isEditMode) {
            this.navigateToRecord(this.recordId);
        } else {
            this.dispatchEvent(new CustomEvent('close'));
        }
    }

    handleSwitchToClassic() {
        if (this.isEditMode) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: { recordId: this.recordId, objectApiName: 'Campaign', actionName: 'edit' }
            });
        } else {
            this[NavigationMixin.Navigate]({ type: 'standard__objectPage', attributes: { objectApiName: 'Campaign', actionName: 'new' }, state: { nooverride: '1' } });
        }
    }
}