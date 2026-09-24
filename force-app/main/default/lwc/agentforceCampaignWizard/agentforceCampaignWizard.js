import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { createRecord, updateRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Backend Apex Controllers
import getChannelDictionaryRecords from '@salesforce/apex/MarketingDictionaryController.getChannelDictionaryRecords';
import getTopicDictionaryRecords from '@salesforce/apex/MarketingDictionaryController.getTopicDictionaryRecords';
import getProductFamilyDependencies from '@salesforce/apex/MarketingDictionaryController.getProductFamilyDependencies';
import getProductFamilyByRecordType from '@salesforce/apex/MarketingDictionaryController.getProductFamilyByRecordType';
import getProductFamilyCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getProductFamilyCustomerTypes';
import getFamilyOfNeedsCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getFamilyOfNeedsCustomerTypes';
import getProductOfferingCatalogue from '@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue';
import getCampaignById from '@salesforce/apex/MarketingDictionaryController.getCampaignById';
import getMatchingOffers from '@salesforce/apex/MarketingDictionaryController.getMatchingOffers';
import getCampaignOffers from '@salesforce/apex/MarketingDictionaryController.getCampaignOffers';
import saveCampaignOffers from '@salesforce/apex/MarketingDictionaryController.saveCampaignOffers';
import getOfferSummaries from '@salesforce/apex/MarketingDictionaryController.getOfferSummaries';
import getCampaignTiers from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignTiers';
import getCampaignTypes from '@salesforce/apex/MarketingDictionaryController.getCampaignTypes';
import getScoringModels from '@salesforce/apex/MarketingDictionaryController.getScoringModels';
import {
    parseSupportedCampaignTypes as parseTierCampaignTypes,
    buildTierAttrRows,
    buildTierExclusionChips,
    buildTierTypeChips
} from 'c/nbaTierConfig';

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
    @track allTopicGoals = []; // [{ id, name, label }]
    @track filteredTopicGoals = [];
    @track isTopicDropdownOpen = false;
    @track topicName = '';
    @track selectedTopicId = '';

    // --- STANDARD COMPONENT STATE ---
    @track campaignName = '';
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
    /** Map of tier label → expanded details visibility */
    @track expandedTier = {};

    // --- DYNAMIC CAMPAIGN TYPES ---
    @track _allCampaignTypes = [];

    // --- SUPPRESSION ASSOCIATION (when tier has Excl_Manual_Suppressions__c) ---
    @track suppressionType = '';   // 'campaign' | 'report' | 'segment'
    @track suppressionLookupValue = '';
    @track suppressionLookupDisplay = '';

    // --- SCORING METHOD STATE ---
    @track selectedScoringMethod = 'Pick a Model';
    @track aprioriOverallScore = '';
    @track fromObjectOverallScore = ''; // Fallback A-Priori when Pick a Model
    @track selectedScoringModelId = '';
    @track selectedScoringModelName = '';
    @track _scoringModels = [];

    @track selectAllChecked = false;
    @track channels = [];
    @track channelGroups = [];
    
    // --- DYNAMIC CHECKBOX GRIDS STATE ---
    @track productFamilyOptions = [];
    @track familyOfNeedsOptions = [];

    rawProductFamilies = []; // [{ Id, Name, ... }]
    rawFamilyOfNeeds = [];
    productFamilyById = {};
    familyOfNeedsById = {};
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
        this.loadScoringModels();
        this.loadTopicDictionary();
        this.loadProductOfferingCatalogue();
        document.addEventListener('click', this.handleOutsideClickBound = this.handleOutsideClick.bind(this));
        if (this.recordId) {
            this.isEditMode = true;
            this.loadExistingCampaign();
        }
    }

    disconnectedCallback() {
        document.removeEventListener('click', this.handleOutsideClickBound);
    }

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

    loadScoringModels() {
        getScoringModels()
            .then(data => { this._scoringModels = data || []; })
            .catch(err => console.error('Error loading scoring models:', err));
    }

    loadTopicDictionary() {
        getTopicDictionaryRecords()
            .then(data => {
                const topics = (data || []).map(t => ({
                    id: t.Id,
                    name: t.Name,
                    label: t.Name
                }));
                this.allTopicGoals = topics;
                this.filteredTopicGoals = topics;
                this._resolveTopicSelection();
            })
            .catch(err => console.error('Error loading topics:', err));
    }

    loadProductOfferingCatalogue() {
        getProductOfferingCatalogue()
            .then(rows => {
                const catalogue = rows || [];
                this.rawProductFamilies = catalogue.filter(r => r.Dictionary_Sub_Type__c === 'Product Family');
                this.rawFamilyOfNeeds = catalogue.filter(r => r.Dictionary_Sub_Type__c === 'Family of Needs');
                this.productFamilyById = {};
                this.rawProductFamilies.forEach(r => { this.productFamilyById[r.Id] = r; });
                this.familyOfNeedsById = {};
                this.rawFamilyOfNeeds.forEach(r => { this.familyOfNeedsById[r.Id] = r; });
                this.updateOptionLists();
                this.applyEditOfferingSelections();
            })
            .catch(err => console.error('Error loading product offering catalogue:', err));
    }

    _isSalesforceId(token) {
        return typeof token === 'string' && (token.length === 15 || token.length === 18)
            && /^[a-zA-Z0-9]+$/.test(token);
    }

    _resolveTopicSelection() {
        if (!this.allTopicGoals.length) return;
        if (this.selectedTopicId) {
            const match = this.allTopicGoals.find(t => t.id === this.selectedTopicId);
            if (match) {
                this.topicName = match.name;
                return;
            }
        }
        if (this.topicName) {
            const byName = this.allTopicGoals.find(t => t.name === this.topicName);
            if (byName) {
                this.selectedTopicId = byName.id;
                this.topicName = byName.name;
            }
        }
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

        this.selectedTopicId = campaign.Topic_Dict__c || '';
        this.topicName = campaign.Topic_Dict__r?.Name
            || campaign.Topic_Name__c
            || '';
        this._resolveTopicSelection();
        this.selectedOfferingType = campaign.Offering_Type__c || 'Product Family';
        // Normalize Campaign picklist casing ("Family of needs" → "Family of Needs")
        if ((this.selectedOfferingType || '').toLowerCase() === 'family of needs') {
            this.selectedOfferingType = 'Family of Needs';
        }
        this.selectedPriorityTier = campaign.Priority_Tier__c || '';
        this.isEmergency = campaign.Priority_Tier__c === 'Tier 1';
        this.excludeOnboarding = campaign.Exclude_Onboarding__c === true;
        this.selectedScoringMethod = campaign.Scoring_Method__c || 'Pick a Model';
        this.selectedScoringModelId = campaign.Scoring_Model_Dict__c || '';
        this.selectedScoringModelName = campaign.Scoring_Model_Dict__r
            ? campaign.Scoring_Model_Dict__r.Name
            : '';

        if (this.selectedScoringMethod === 'A-priori') {
            this.aprioriOverallScore = campaign.Overall_Score__c != null ? String(campaign.Overall_Score__c) : '';
            this.fromObjectOverallScore = '';
        } else {
            // Prefer dedicated Fallback_Score__c; fall back to Overall_Score__c for older records.
            const fallback = campaign.Fallback_Score__c != null
                ? campaign.Fallback_Score__c
                : campaign.Overall_Score__c;
            this.fromObjectOverallScore = fallback != null ? String(fallback) : '';
            this.aprioriOverallScore = '';
        }

        if (campaign.Assigned_Channels__c) {
            this.editChannelValues = campaign.Assigned_Channels__c.split(';').map(c => c.trim()).filter(Boolean);
            this.applyEditChannels();
        }

        // Stored as semicolon-separated dictionary Ids (preferred) or legacy Names.
        if (campaign.Product_Family__c) {
            this.editProductFamilyValues = campaign.Product_Family__c
                .split(';').map(p => p.trim()).filter(Boolean);
        }

        if (campaign.Family_of_Needs__c) {
            this.editFamilyOfNeedsValues = campaign.Family_of_Needs__c
                .split(';').map(f => f.trim()).filter(Boolean);
        }

        this.applyEditOfferingSelections();
        this.loadSavedCampaignOffers();
    }

    /**
     * Restores Product Family / Family of Needs checkboxes from edit-mode pending
     * values. Safe to call before or after dictionary wires resolve: applies when
     * options exist, then clears the pending arrays so later user toggles stick.
     */
    applyEditOfferingSelections() {
        let applied = false;

        if (this.editProductFamilyValues && this.productFamilyOptions.length > 0) {
            const selected = new Set();
            const byName = {};
            this.productFamilyOptions.forEach(o => { byName[o.name] = o.value; });
            this.editProductFamilyValues.forEach(token => {
                if (this._isSalesforceId(token) && this.productFamilyById[token]) {
                    selected.add(token);
                } else if (byName[token]) {
                    selected.add(byName[token]);
                }
            });
            this.productFamilyOptions = this.productFamilyOptions.map(opt => ({
                ...opt,
                checked: selected.has(opt.value)
            }));
            this.selectAllProductFamilies = this.productFamilyOptions.every(opt => opt.checked);
            this.buildGroupedOptions();
            this.editProductFamilyValues = null;
            applied = true;
        }

        if (this.editFamilyOfNeedsValues && this.familyOfNeedsOptions.length > 0) {
            const selected = new Set();
            const byName = {};
            this.familyOfNeedsOptions.forEach(o => { byName[o.name] = o.value; });
            this.editFamilyOfNeedsValues.forEach(token => {
                if (this._isSalesforceId(token) && this.familyOfNeedsById[token]) {
                    selected.add(token);
                } else if (byName[token]) {
                    selected.add(byName[token]);
                }
            });
            this.familyOfNeedsOptions = this.familyOfNeedsOptions.map(opt => ({
                ...opt,
                checked: selected.has(opt.value)
            }));
            this.selectAllFamilyOfNeeds = this.familyOfNeedsOptions.every(opt => opt.checked);
            this.editFamilyOfNeedsValues = null;
            applied = true;
        }

        if (applied) {
            this.scheduleFetchOffers();
        }
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

    // Topic + Product Family / FoN catalogues load imperatively (Id + Name SSOT).
    // Keep name-keyed dependency maps from these wires for badges / filters / offer matching.

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
        if (this.rawProductFamilies && this.rawProductFamilies.length > 0
            && typeof this.rawProductFamilies[0] === 'object') {
            this.productFamilyOptions = this.rawProductFamilies.map(rec => {
                const name = rec.Name;
                const existing = this.productFamilyOptions.find(opt => opt.value === rec.Id);
                let isChecked = false;
                if (this.editProductFamilyValues) {
                    isChecked = this.editProductFamilyValues.includes(rec.Id)
                        || this.editProductFamilyValues.includes(name);
                } else if (existing) {
                    isChecked = existing.checked;
                }
                return {
                    label: name,
                    value: rec.Id,
                    name,
                    inputId: `wiz-pf-${rec.Id}`,
                    checked: isChecked,
                    fons: this.productFamilyToFoN[name] || (
                        rec.Related_Family_of_Needs__r?.Name ? [rec.Related_Family_of_Needs__r.Name] : []
                    ),
                    customerTypes: this.productFamilyCustomerTypes[name] || []
                };
            });
            this.selectAllProductFamilies = this.productFamilyOptions.length > 0
                && this.productFamilyOptions.every(opt => opt.checked);
        }

        if (this.rawFamilyOfNeeds && this.rawFamilyOfNeeds.length > 0
            && typeof this.rawFamilyOfNeeds[0] === 'object') {
            this.familyOfNeedsOptions = this.rawFamilyOfNeeds.map(rec => {
                const name = rec.Name;
                const existing = this.familyOfNeedsOptions.find(opt => opt.value === rec.Id);
                let isChecked = false;
                if (this.editFamilyOfNeedsValues) {
                    isChecked = this.editFamilyOfNeedsValues.includes(rec.Id)
                        || this.editFamilyOfNeedsValues.includes(name);
                } else if (existing) {
                    isChecked = existing.checked;
                }
                const relatedFamilies = this.fonToProductFamilies[name] || [];
                return {
                    label: name,
                    value: rec.Id,
                    name,
                    inputId: `wiz-fon-${rec.Id}`,
                    checked: isChecked,
                    families: relatedFamilies,
                    customerTypes: this.fonCustomerTypes[name] || [],
                    tooltip: relatedFamilies.length > 0
                        ? `Product Families: ${relatedFamilies.join(', ')}`
                        : 'No related Product Families'
                };
            });
            this.selectAllFamilyOfNeeds = this.familyOfNeedsOptions.length > 0
                && this.familyOfNeedsOptions.every(opt => opt.checked);
        }
        this.buildGroupedOptions();
        this.applyEditOfferingSelections();
    }

    buildGroupedOptions() {
        if (!this.productFamilyOptions.length) {
            this.groupedProductFamilyOptions = [];
            return;
        }
        const byName = {};
        this.productFamilyOptions.forEach(opt => { byName[opt.name] = opt; });
        const assigned = new Set();
        const groups = [];
        for (const [rtName, familyNames] of Object.entries(this.productFamilyByRecordType || {})) {
            const items = (familyNames || []).map(n => byName[n]).filter(Boolean);
            items.forEach(i => assigned.add(i.value));
            if (items.length) {
                groups.push({ recordType: rtName, items });
            }
        }
        const unassigned = this.productFamilyOptions.filter(opt => !assigned.has(opt.value));
        if (unassigned.length) {
            groups.push({ recordType: 'Other', items: unassigned });
        }
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
        if (this.isTopicDropdownOpen) {
            // Show full catalogue when opening; search narrows from handleTopicSearch.
            if (this.selectedTopicId) {
                this.filteredTopicGoals = this.allTopicGoals;
            }
        }
    }

    handleTopicSearch(event) {
        const raw = event.target.value || '';
        this.topicName = raw;
        // Free-text search clears a prior Id selection until the user picks again.
        this.selectedTopicId = '';
        this.isTopicDropdownOpen = true;

        const needle = raw.toLowerCase();
        this.filteredTopicGoals = this.allTopicGoals.filter(t =>
            (t.name || '').toLowerCase().includes(needle)
        );
        this.clearScoringIfDisabled();
    }

    handleSelectTopic(event) {
        const selectedId = event.currentTarget.dataset.id;
        const match = this.allTopicGoals.find(t => t.id === selectedId);
        if (match) {
            this.selectedTopicId = match.id;
            this.topicName = match.name;
        } else {
            this.selectedTopicId = selectedId || '';
            this.topicName = event.currentTarget.dataset.name || '';
        }
        this.isTopicDropdownOpen = false;
        this.clearScoringIfDisabled();
    }

    handleNameChange(event) {
        this.campaignName = event.target.value; 
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

    handlePriorityChange(event) {
        if (this.isEmergency) return;
        const input = event.target;
        if (!input || input.disabled) return;
        const newTier = input.value;
        if (newTier !== this.selectedPriorityTier) {
            this.selectedPriorityTier = newTier;
            this.suppressionType = '';
            this.suppressionLookupValue = '';
            this.suppressionLookupDisplay = '';
        }
    }

    handleTierDetailsToggle(event) {
        event.preventDefault();
        event.stopPropagation();
        const value = event.currentTarget.dataset.value;
        if (!value) return;
        this.expandedTier = {
            ...this.expandedTier,
            [value]: !this.expandedTier[value]
        };
    }

    handleSuppressionTypeChange(event) {
        this.suppressionType = event.target.value;
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
        this.selectedScoringMethod = event.target.value;
    }

    handleAprioriChange(event) { this.aprioriOverallScore = event.target.value; }
    handleFromObjectChange(event) { this.fromObjectOverallScore = event.target.value; }

    handleScoringModelChange(event) {
        this.selectedScoringModelId = event.detail.value;
        const opt = this.scoringModelOptions.find(o => o.value === this.selectedScoringModelId);
        this.selectedScoringModelName = opt ? opt.label : '';
    }

    clearScoringIfDisabled() {
        if (this.isScoringDisabled) {
            this.aprioriOverallScore = '';
            this.fromObjectOverallScore = '';
            this.selectedScoringModelId = '';
            this.selectedScoringModelName = '';
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
    // Priority & Exclusions lives on step 1. Copy Assignment (3) is a ghost placeholder.
    // Flow: Properties → Topic & Offering → Copy Assignment → Scoring → Summary
    wizardStepData = [
        { label: 'Campaign Properties', value: 1 },
        { label: 'Topic & Offering', value: 2 },
        { label: 'Copy Assignment', value: 3 },
        { label: 'Scoring', value: 4 },
        { label: 'Summary', value: 5 }
    ];

    /**
     * SLDS progress-indicator states per step:
     * - slds-is-completed (+ marker_icon + success icon)
     * - slds-is-active
     * - default incomplete
     * @see https://v1.lightningdesignsystem.com/components/progress-indicator/
     */
    get wizardSteps() {
        return this.wizardStepData.map(step => {
            const isComplete = step.value < this.currentStep;
            const isActive = step.value === this.currentStep;
            let itemClass = 'slds-progress__item';
            let assistiveText = step.label;
            if (isComplete) {
                itemClass += ' slds-is-completed';
                assistiveText = `${step.label} - Completed`;
            } else if (isActive) {
                itemClass += ' slds-is-active';
                assistiveText = `${step.label} - Active`;
            }
            return {
                ...step,
                itemClass,
                isComplete,
                isActive,
                assistiveText
            };
        });
    }

    get progressBarValue() {
        const lastIndex = this.wizardStepData.length - 1;
        if (lastIndex <= 0) return 0;
        return Math.round(((this.currentStep - 1) / lastIndex) * 100);
    }

    get progressBarStyle() {
        return `width: ${this.progressBarValue}%;`;
    }

    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }
    get isStep4() { return this.currentStep === 4; }
    get isStep5() { return this.currentStep === 5; }
    get isLastStep() { return this.currentStep === 5; }
    get showBackButton() { return this.currentStep > 1; }
    get showNextButton() { return this.currentStep < 5; }

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

    get summaryScoringModel() {
        return this.selectedScoringModelName || 'Not set';
    }

    get hasSelectedChannel() {
        return this.channels.some(c => c.checked);
    }

    get hasOfferingSelection() {
        if (this.isOfferingProductFamily) {
            return this.productFamilyOptions.some(opt => opt.checked);
        }
        if (this.isOfferingFamilyOfNeeds) {
            return this.familyOfNeedsOptions.some(opt => opt.checked);
        }
        return false;
    }

    isValidScoreValue(raw) {
        const val = Number(raw);
        return !!raw && Number.isInteger(val) && val >= 1 && val <= 1000;
    }

    get isStep1Valid() {
        if (!this.parentActivationType) return false;
        if (!this.campaignName || this.campaignName.trim() === '') return false;
        if (this.showCampaignGroup && !this.selectedCampaignGroupId) return false;
        if (!this.selectedPriorityTier) return false;
        if (!this.hasSelectedChannel) return false;
        return true;
    }

    get isStep2Valid() {
        if (!this.selectedTopicId && (!this.topicName || this.topicName.trim() === '')) return false;
        if (!this.selectedOfferingType) return false;
        if (!this.hasOfferingSelection) return false;
        return true;
    }

    get isStep3Valid() {
        // Copy Assignment — required “≥1 message variant per channel” once Copy Center is wired.
        return true;
    }

    get isStep4Valid() {
        if (!this.selectedScoringMethod) return false;
        if (this.isScoringAPriori) {
            return this.isValidScoreValue(this.aprioriOverallScore);
        }
        if (this.isScoringFromObject) {
            return !!this.selectedScoringModelId && this.isValidScoreValue(this.fromObjectOverallScore);
        }
        return false;
    }

    /** Draft save only needs a campaign name so a record can be persisted. */
    get isDraftSaveInvalid() {
        return !this.campaignName || this.campaignName.trim() === '';
    }

    /** Full activation gate across all configured wizard rules (Copy Center pending). */
    get isActivationReady() {
        return this.isStep1Valid && this.isStep2Valid && this.isStep3Valid && this.isStep4Valid;
    }

    get isActivationDisabled() {
        return !this.isActivationReady;
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
        if (this.currentStep === 5) {
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
        if (this.isCurrentStepInvalid) return;
        if (this.currentStep < 5) {
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
        if (!Number.isInteger(step) || step < 1) return;
        // Only allow navigating back to completed / current steps.
        if (step <= this.currentStep) {
            this.currentStep = step;
            this.maybeLoadOfferSummaries();
        }
    }

    get isScoringDisabled() {
        const hasTopic = !!(this.selectedTopicId || (this.topicName && this.topicName.trim() !== ''));
        return !hasTopic || !this.selectedOfferingType;
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
                    // Dependency maps are keyed by product Name, not dictionary Id.
                    const types = this.productFamilyCustomerTypes[pf.name] || [];
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
            const types = this.fonCustomerTypes[fon.name] || [];
            return this.fonFilterCustomerTypes.some(ct => types.includes(ct));
        });
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
            const supported = parseTierCampaignTypes(tier.Supported_Campaign_Types__c)
                .map(s => s.toLowerCase());
            const label = this.tierLabel(tier);
            const tierNumber = tier.Tier_Number__c;

            let isAllowed = false;
            if (this.isEmergency) {
                isAllowed = Number(tierNumber) === 1;
            } else if (activationType) {
                // Empty Supported_Campaign_Types means the tier was not scoped — treat as available.
                isAllowed = supported.length === 0 || supported.some(s => s === activationType);
            } else {
                isAllowed = true;
            }

            const isSelected = this.selectedPriorityTier === label;
            const isDetailsExpanded = !!this.expandedTier[label];
            const attrRows = buildTierAttrRows(tier);
            const typeChips = buildTierTypeChips(tier);
            const exclusionChips = buildTierExclusionChips(tier);
            const hasDetails = attrRows.length > 0 || typeChips.length > 0 || exclusionChips.length > 0;
            const description = tier.Description__c || '';

            let pickerClass = 'slds-visual-picker slds-visual-picker_vertical';
            if (!isAllowed) {
                pickerClass += ' tier-picker-disabled';
            }
            if (isDetailsExpanded) {
                pickerClass += ' tier-picker-expanded';
            }

            return {
                label,
                value: label,
                inputId: `priority-tier-${tierNumber != null ? tierNumber : tier.Id}`,
                description,
                attrRows,
                typeChips,
                hasTypes: typeChips.length > 0,
                exclusionChips,
                hasExclusions: exclusionChips.length > 0,
                hasDetails,
                isDetailsExpanded,
                detailsChevron: isDetailsExpanded ? 'utility:chevrondown' : 'utility:chevronright',
                detailsToggleTitle: isDetailsExpanded ? 'Hide tier settings' : 'Show tier settings',
                pickerClass,
                isDisabled: !isAllowed,
                isSelected
            };
        });
    }

    get selectedTierRecord() {
        if (!this.selectedPriorityTier) return null;
        return this._allTiers.find(t => this.tierLabel(t) === this.selectedPriorityTier) || null;
    }

    get showSuppressionSection() {
        const tier = this.selectedTierRecord;
        return !!(tier && tier.Excl_Manual_Suppressions__c);
    }

    get suppressionTypeOptions() {
        return [
            {
                label: 'Salesforce Campaign',
                value: 'campaign',
                inputId: 'suppression-type-campaign',
                isChecked: this.suppressionType === 'campaign'
            },
            {
                label: 'Salesforce Report',
                value: 'report',
                inputId: 'suppression-type-report',
                isChecked: this.suppressionType === 'report'
            },
            {
                label: 'Data360 Segment',
                value: 'segment',
                inputId: 'suppression-type-segment',
                isChecked: this.suppressionType === 'segment'
            }
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
        return this.scoringMethodsData.map(m => ({
            ...m,
            inputId: `scoring-method-${m.value.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
            isChecked: this.selectedScoringMethod === m.value
        }));
    }

    get scoringModelOptions() {
        return (this._scoringModels || []).map(m => {
            const version = m.Version__c != null ? ` v${m.Version__c}` : '';
            const modelId = m.Model_Id__c ? ` (${m.Model_Id__c})` : '';
            return {
                label: `${m.Name}${version}${modelId}`,
                value: m.Id
            };
        });
    }

    get hasScoringModels() {
        return this.scoringModelOptions.length > 0;
    }

    get saveButtonLabel() {
        return 'Save & Close';
    }

    get activateButtonLabel() {
        return 'Activate';
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
            case 1: return !this.isStep1Valid;
            case 2: return !this.isStep2Valid;
            case 3: return !this.isStep3Valid;
            case 4: return !this.isStep4Valid;
            case 5: return false;
            default: return false;
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
        // Options use dictionary Ids as value; offer matching / reasons use Names.
        const selectedNames = checkedFoN
            ? this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.name)
            : this.productFamilyOptions.filter(o => o.checked).map(o => o.name);

        // When in FoN mode a selected FoN pulls in offers through its member product
        // families, so translate the checked FoNs into the families used for matching.
        let selectionFamilies = selectedNames;
        if (checkedFoN) {
            const fam = new Set();
            selectedNames.forEach(fon => {
                (this.fonToProductFamilies[fon] || []).forEach(pf => fam.add(pf));
            });
            selectionFamilies = [...fam];
        }

        const matched = offerFamilies.filter(f => selectionFamilies.includes(f));
        const parts = [];

        if (checkedFoN && selectedNames.length) {
            const pullingFoN = selectedNames.filter(fon =>
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
        // Persist offerings as dictionary Ids, but Offer_Version__c still matches on Names.
        const pfNames = this.productFamilyOptions.filter(o => o.checked).map(o => o.name);
        const checkedFonNames = this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.name);
        const offeringRestorePending = !!(this.editProductFamilyValues || this.editFamilyOfNeedsValues);

        if (pfNames.length === 0 && checkedFonNames.length === 0) {
            this.matchingOffers = [];
            // Do not wipe edit-mode offer IDs while PF/FoN checkboxes are still restoring.
            if (!offeringRestorePending && !this.editSavedOfferIds) {
                this.selectedOfferIds = [];
                this.offerSearchTerm = '';
            }
            return;
        }
        // Offers store a single product family, never a Family of Needs name, so a checked
        // FoN must be expanded into its member product families before matching. An offer
        // shows if ANY of those families matches an active offer version.
        const fonFamilies = new Set();
        checkedFonNames.forEach(fon => {
            (this.fonToProductFamilies[fon] || []).forEach(pf => fonFamilies.add(pf));
        });
        const fons = [...fonFamilies];
        this.isLoadingOffers = true;
        getMatchingOffers({ productFamilies: pfNames, familyOfNeeds: fons })
            .then(data => {
                this.matchingOffers = data || [];
                const matchedIds = new Set(this.matchingOffers.map(o => o.id));

                // Prefer still-pending edit selections, then keep any current selections that match.
                const pendingIds = this.editSavedOfferIds || [];
                const restored = pendingIds.filter(id => matchedIds.has(id));
                const kept = this.selectedOfferIds.filter(id => matchedIds.has(id));
                this.selectedOfferIds = [...new Set([...restored, ...kept])];
                if (this.editSavedOfferIds) {
                    this.editSavedOfferIds = null;
                }
                this.isLoadingOffers = false;
            })
            .catch(() => { this.isLoadingOffers = false; });
    }

    scheduleFetchOffers() {
        clearTimeout(this._offerFetchTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._offerFetchTimer = setTimeout(() => this.fetchMatchingOffers(), 300);
    }

    handleSaveDraft() {
        if (this.isDraftSaveInvalid) return;
        this.isLoading = true;
        this.executeSubCampaignSave({ activate: false });
    }

    handleActivate() {
        if (!this.isActivationReady) return;
        this.isLoading = true;
        this.executeSubCampaignSave({ activate: true });
    }

    /** @deprecated Prefer handleSaveDraft / handleActivate */
    handleSave() {
        this.handleSaveDraft();
    }

    executeSubCampaignSave({ activate = false } = {}) {
        const fields = {};
        const num = (v) => v === '' || v === null || v === undefined ? null : Number(v);

        fields['Name'] = `${this.activationPrefix}${this.toCamelCase(this.campaignName)}`;
        fields['Type'] = 'Standard';
        fields['Status'] = activate ? 'Active' : 'Planned';
        fields['IsActive'] = activate === true;
        fields['Campaign_Group_Dict__c'] = this.showCampaignGroup ? (this.selectedCampaignGroupId || null) : null;
        // Topic Id is SSOT; Topic_Name__c is a denormalized label for list views / legacy.
        this._resolveTopicSelection();
        fields['Topic_Dict__c'] = this.selectedTopicId || null;
        fields['Topic_Name__c'] = this.topicName || null;
        fields['Priority_Tier__c'] = this.selectedPriorityTier || null;
        fields['Activation_Type__c'] = this.parentActivationType || null;
        fields['Exclude_Onboarding__c'] = this.excludeOnboarding;
        fields['Scoring_Method__c'] = this.selectedScoringMethod || null;
        fields['Offering_Type__c'] = this.selectedOfferingType || null;

        if (this.isScoringAPriori) {
            fields['Overall_Score__c'] = num(this.aprioriOverallScore);
            fields['Fallback_Score__c'] = null;
            fields['Scoring_Model_Dict__c'] = null;
        } else if (this.isScoringFromObject) {
            fields['Overall_Score__c'] = null;
            fields['Fallback_Score__c'] = num(this.fromObjectOverallScore);
            fields['Scoring_Model_Dict__c'] = this.selectedScoringModelId || null;
        } else {
            fields['Overall_Score__c'] = null;
            fields['Fallback_Score__c'] = null;
            fields['Scoring_Model_Dict__c'] = null;
        }

        fields['Assigned_Channels__c'] = this.channels.filter(c => c.checked).map(c => c.label).join('; ');

        if (this.isOfferingProductFamily) {
            fields['Product_Family__c'] = this.productFamilyOptions.filter(o => o.checked).map(o => o.value).join('; ');
            fields['Family_of_Needs__c'] = null;
        } else if (this.isOfferingFamilyOfNeeds) {
            fields['Family_of_Needs__c'] = this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.value).join('; ');
            fields['Product_Family__c'] = null;
        }

        const successMessage = activate
            ? 'Campaign activated successfully.'
            : 'Campaign saved as draft (Planned).';

        if (this.isEditMode) {
            fields['Id'] = this.recordId;
            const recordInput = { fields };
            updateRecord(recordInput)
                .then(() => this.persistCampaignOffers(this.recordId))
                .then(() => {
                    this.isLoading = false;
                    this.dispatchEvent(new ShowToastEvent({ title: 'Success!', message: successMessage, variant: 'success' }));
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
                    this.dispatchEvent(new ShowToastEvent({ title: 'Success!', message: successMessage, variant: 'success' }));
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