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
import healCampaignOfferingLabels from '@salesforce/apex/MarketingDictionaryController.healCampaignOfferingLabels';
import getMatchingOffers from '@salesforce/apex/MarketingDictionaryController.getMatchingOffers';
import getCampaignOffers from '@salesforce/apex/MarketingDictionaryController.getCampaignOffers';
import saveCampaignOffers from '@salesforce/apex/MarketingDictionaryController.saveCampaignOffers';
import getCampaignCopyVariants from '@salesforce/apex/MarketingDictionaryController.getCampaignCopyVariants';
import saveCampaignCopyVariants from '@salesforce/apex/MarketingDictionaryController.saveCampaignCopyVariants';
import getOfferSummaries from '@salesforce/apex/MarketingDictionaryController.getOfferSummaries';
import getPublishedVariantsForWizard from '@salesforce/apex/CopyCockpitController.getPublishedVariantsForWizard';
import getAprioriContext from '@salesforce/apex/CampaignScoringAprioriController.getAprioriContext';
import publishAprioriScores from '@salesforce/apex/CampaignScoringAprioriController.publishAprioriScores';
import { parseFullName } from 'c/copyMessageNaming';
import getCampaignTiers from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignTiers';
import getCampaignTypes from '@salesforce/apex/MarketingDictionaryController.getCampaignTypes';
import getCampaignRecords from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignRecords';
import getExclusionOptions from '@salesforce/apex/CampaignExclusionController.getExclusionOptions';
import searchSuppressionCampaigns from '@salesforce/apex/MarketingDictionaryController.searchSuppressionCampaigns';
import searchSuppressionReports from '@salesforce/apex/MarketingDictionaryController.searchSuppressionReports';
import {
    parseSupportedCampaignTypes as parseTierCampaignTypes,
    buildTierAttrRows,
    buildTierExclusionChips,
    buildTierTypeChips
} from 'c/nbaTierConfig';

const COPY_STATUS_BADGE_CLASS = {
    draft: 'slds-badge slds-theme_lightest',
    ready: 'slds-badge slds-theme_info',
    published: 'slds-badge slds-theme_success',
    archived: 'slds-badge slds-theme_shade'
};

function copyStatusBadgeClass(status) {
    return COPY_STATUS_BADGE_CLASS[(status || '').toLowerCase()] || 'slds-badge slds-theme_lightest';
}

const EXCLUSION_SOURCE_OPTIONS = [
    { label: 'Salesforce Campaign', shortLabel: 'Campaigns', value: 'campaign', icon: 'standard:campaign' },
    { label: 'Salesforce Report', shortLabel: 'Reports', value: 'report', icon: 'standard:report' },
    { label: 'Data360 Segment', shortLabel: 'Segment', value: 'segment', icon: 'standard:segments' },
    { label: 'Data360 DMO', shortLabel: 'DMO', value: 'dmo', icon: 'standard:data_model' },
    { label: 'Data360 DLO', shortLabel: 'DLO', value: 'dlo', icon: 'standard:data_lake_objects' }
];

function newExclusionRow(overrides = {}) {
    const selectedCampaignIds = overrides.selectedCampaignIds
        ? [...overrides.selectedCampaignIds]
        : [];
    const selectedReportIds = overrides.selectedReportIds
        ? [...overrides.selectedReportIds]
        : [];
    const selectedSegmentIds = overrides.selectedSegmentIds
        ? [...overrides.selectedSegmentIds]
        : [];
    const selectedDmoIds = overrides.selectedDmoIds
        ? [...overrides.selectedDmoIds]
        : [];
    const selectedDloIds = overrides.selectedDloIds
        ? [...overrides.selectedDloIds]
        : [];
    return {
        id: `excl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: '',
        value: '',
        display: '',
        searchTerm: '',
        lookupOptions: [],
        campaignOptions: [],
        selectedCampaignIds,
        campaignSearchTerm: '',
        campaignPickerOpen: false,
        reportOptions: [],
        selectedReportIds,
        reportSearchTerm: '',
        reportPickerOpen: false,
        segmentOptions: [],
        selectedSegmentIds,
        segmentSearchTerm: '',
        segmentPickerOpen: false,
        dmoOptions: [],
        selectedDmoIds,
        dmoSearchTerm: '',
        dmoPickerOpen: false,
        dloOptions: [],
        selectedDloIds,
        dloSearchTerm: '',
        dloPickerOpen: false,
        ...overrides,
        selectedCampaignIds,
        selectedReportIds,
        selectedSegmentIds,
        selectedDmoIds,
        selectedDloIds
    };
}

function mapReportOptionsFromApex(results) {
    return (results || []).map(r => ({
        id: r.id,
        name: r.name,
        format: r.format || ''
    }));
}

function reportDisplayLabel(r) {
    if (!r) return '';
    return r.format ? `${r.name} (${r.format})` : r.name;
}

function buildReportExclusionDisplay(selectedIds, reportOptions) {
    const options = reportOptions || [];
    const labels = (selectedIds || []).map(id => {
        const match = options.find(o => o.id === id);
        return match ? reportDisplayLabel(match) : id;
    });
    return labels.join('; ');
}

function mapSegmentOptionsFromApex(results) {
    return (results || []).map(s => ({
        id: s.id,
        name: s.name,
        status: s.status || ''
    }));
}

function mapDataCloudCatalogFromApex(results) {
    return (results || []).map(d => ({
        id: d.apiName,
        apiName: d.apiName,
        label: d.label || d.apiName
    }));
}

function segmentDisplayLabel(s) {
    if (!s) return '';
    return s.status ? `${s.name} (${s.status})` : s.name;
}

function dataCloudCatalogDisplayLabel(d) {
    if (!d) return '';
    return d.label && d.apiName && d.label !== d.apiName
        ? `${d.label} (${d.apiName})`
        : (d.label || d.apiName);
}

function buildSegmentExclusionDisplay(selectedIds, segmentOptions) {
    const options = segmentOptions || [];
    return (selectedIds || []).map(id => {
        const match = options.find(o => o.id === id);
        return match ? segmentDisplayLabel(match) : id;
    }).join('; ');
}

function buildDataCloudCatalogExclusionDisplay(selectedIds, catalogOptions) {
    const options = catalogOptions || [];
    return (selectedIds || []).map(id => {
        const match = options.find(o => o.id === id);
        return match ? dataCloudCatalogDisplayLabel(match) : id;
    }).join('; ');
}

function parseMultiExclusionValues(row) {
    if (Array.isArray(row.values) && row.values.length) {
        return row.values.map(v => String(v));
    }
    if (row.value) {
        return String(row.value).split(',').map(v => v.trim()).filter(Boolean);
    }
    return [];
}

function buildExclusionSourcePickerOptions(selectedSource) {
    return EXCLUSION_SOURCE_OPTIONS.map(opt => ({
        ...opt,
        btnClass: `slds-button exclusion-source-btn${selectedSource === opt.value ? ' exclusion-source-btn--selected' : ''}`
    }));
}

function campaignMetaLine(status, groupName) {
    const parts = [];
    if (status) parts.push(status);
    if (groupName) parts.push(groupName);
    return parts.join(' · ');
}

function mapCampaignOptionsFromApex(results) {
    return (results || []).map(r => ({
        id: r.id,
        name: r.name,
        status: r.status || '',
        groupId: r.groupId || '',
        groupName: r.groupName || '',
        groupKey: r.groupKey || ''
    }));
}

function campaignDisplayLabel(c) {
    if (!c) return '';
    const meta = campaignMetaLine(c.status, c.groupName);
    return meta ? `${c.name} (${meta})` : c.name;
}

function buildCampaignExclusionDisplay(selectedIds, campaignOptions) {
    const options = campaignOptions || [];
    const labels = (selectedIds || []).map(id => {
        const match = options.find(o => o.id === id);
        return match ? campaignDisplayLabel(match) : id;
    });
    return labels.join('; ');
}

function wizardMessageNameFromRow(row) {
    if (row.MessageName__c) {
        return String(row.MessageName__c).trim();
    }
    const parsed = parseFullName(row.Name);
    if (parsed.messageName) {
        return parsed.messageName;
    }
    return row.Name || '—';
}

function wizardMessageVariantFromRow(row) {
    if (row.MessageVariant__c != null && row.MessageVariant__c !== '') {
        return String(row.MessageVariant__c);
    }
    if (row.Message_Variant__c != null && row.Message_Variant__c !== '') {
        return String(row.Message_Variant__c);
    }
    if (row.Version__c != null) {
        return String(row.Version__c);
    }
    const parsed = parseFullName(row.Name);
    if (parsed.variant != null) {
        return String(parsed.variant);
    }
    return '—';
}

function wizardMessageTypeFromRow(row) {
    if (row.MessageType__c) {
        return String(row.MessageType__c).trim();
    }
    if (row.Message_Type__c) {
        return String(row.Message_Type__c).trim();
    }
    if (row.Channel_Type__c) {
        return String(row.Channel_Type__c).trim();
    }
    return '';
}

function formatVariantWeight(manual, computed) {
    if (manual !== null && manual !== undefined && manual !== '') {
        return String(manual);
    }
    if (computed !== null && computed !== undefined && computed !== '') {
        return String(computed);
    }
    return '—';
}

function variantWeightNumeric(manual, computed) {
    const raw = manual !== null && manual !== undefined && manual !== ''
        ? manual
        : computed;
    if (raw === null || raw === undefined || raw === '') {
        return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatNormalizedWeightPercent(variantWeight, selectedWeightSum, selectedCount) {
    if (!selectedCount) {
        return '—';
    }
    if (selectedWeightSum > 0) {
        return `${((variantWeight / selectedWeightSum) * 100).toFixed(1)}%`;
    }
    return `${(100 / selectedCount).toFixed(1)}%`;
}

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
    @track activeFrom = '';
    @track activeTo = '';
    @track campaignDurationDays = '';
    @track selectedOfferingType = 'Product Family';
    @track selectedPriorityTier = '';
    // --- EMERGENCY STATE CONTROL ---
    @track isEmergency = false;

    // --- DYNAMIC TIERS ---
    @track _allTiers = [];
    @track _tiersLoaded = false;
    /** Map of tier label → expanded details visibility */
    @track expandedTier = {};

    // --- DYNAMIC CAMPAIGN TYPES ---
    @track _allCampaignTypes = [];

    // --- EXCLUSIONS (tier-gated: manual definitions + other marketing activations) ---
    @track exclusionDefinitions = [];
    @track excludeOtherMarketingActivations = false;
    _data360ExclusionCatalogLoaded = false;
    _data360ExclusionCatalogPromise = null;
    _exclusionSearchTimers = {};

    // --- SCORING (tiers 4+): model picklist or apriori slider ---
    @track scoringConfigurationMethod = 'model';
    @track aprioriScore = 500;
    @track aprioriBaselineScore = null;
    @track aprioriHasSharedState = false;
    @track aprioriHasMixedSharedScores = false;
    @track aprioriChangeConfirmed = false;
    @track showAprioriChangePopover = false;
    @track pendingAprioriScore = null;
    aprioriSliderResetKey = 0;
    _aprioriScoreCommitTimer = null;
    @track selectedScoringModelId = '';
    @track selectedScoringModelName = '';
    @track _scoringModels = [];
    scoringModelLoadError = '';

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

    // --- COPY ASSIGNMENT -- 
    @track activeCopyChannelValue = '';
    /** Channel type → enabled for copy assignment (replaces step 1 channel selection). */
    @track copyChannelEnabledByType = {};
    /** Ordered Channel_Type__c values from active Marketing Dictionary channels. */
    @track activeCopyChannelTypes = [];
    @track copyVariantData = []; // Raw fetched variants matching step 2
    @track selectedCopyVariantIds = []; // Master list of assigned variants across all channels
    @track isLoadingCopy = false;

    // Offers saved on the campaign (edit mode). Restored active-only from junction.
    editSavedOfferIds = null;
    editSavedCopyVariantIds = null;

    /** Channel type → dictionary Channel_Icon__c (first row wins per type). */
    channelIconByType = {};

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


    offeringTypesData = [
        { label: 'Product Family', value: 'Product Family' },
        { label: 'Family of Needs', value: 'Family of Needs' }
    ];

    // --- LIFECYCLE HOOKS ---
    connectedCallback() {
        this.loadTiers();
        this.loadCampaignTypes();
        this.loadScoringModels();
        this.loadTopicDictionary();
        this.loadProductOfferingCatalogue();
        // Migrate any Campaign rows still showing Ids in display fields → Names.
        healCampaignOfferingLabels().catch(() => {});
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

    _ensureData360ExclusionCatalog() {
        if (this._data360ExclusionCatalogLoaded) {
            return Promise.resolve();
        }
        if (this._data360ExclusionCatalogPromise) {
            return this._data360ExclusionCatalogPromise;
        }
        this._data360ExclusionCatalogPromise = getExclusionOptions()
            .then(data => {
                const segmentOptions = mapSegmentOptionsFromApex(data?.segments);
                const dmoOptions = mapDataCloudCatalogFromApex(data?.dataModelObjects);
                const dloOptions = mapDataCloudCatalogFromApex(data?.dataLakeObjects);
                this.exclusionDefinitions = this.exclusionDefinitions.map(row => {
                    if (row.source === 'segment') {
                        return { ...row, segmentOptions };
                    }
                    if (row.source === 'dmo') {
                        return { ...row, dmoOptions };
                    }
                    if (row.source === 'dlo') {
                        return { ...row, dloOptions };
                    }
                    return row;
                });
                this._data360ExclusionCatalogLoaded = true;
            })
            .catch(err => {
                console.error('Data360 exclusion catalogue load failed:', err);
                this._data360ExclusionCatalogLoaded = true;
            });
        return this._data360ExclusionCatalogPromise;
    }

    _tierRecordForLabel(tierLabel) {
        if (!tierLabel) return null;
        return this._allTiers.find(t => this.tierLabel(t) === tierLabel) || null;
    }

    _tierAllowsManualExclusions(tierLabel) {
        const tier = this._tierRecordForLabel(tierLabel);
        return !!(tier && tier.Excl_Manual_Suppressions__c);
    }

    _tierAllowsOtherMarketingActivations(tierLabel) {
        const tier = this._tierRecordForLabel(tierLabel);
        return !!(tier && tier.Excl_Other_Marketing_Activations__c);
    }

    _hydrateExclusionsFromCampaign(campaign) {
        this.exclusionDefinitions = [];
        if (!campaign) return;

        let parsed = [];
        const rawJson = campaign.Campaign_Exclusions_JSON__c;
        if (rawJson) {
            try {
                const data = JSON.parse(rawJson);
                if (Array.isArray(data)) {
                    parsed = data.filter(row => row && row.source);
                }
            } catch (e) {
                console.warn('Could not parse Campaign_Exclusions_JSON__c', e);
            }
        }

        if (!parsed.length) {
            if (campaign.Suppression_Campaign__c) {
                parsed.push({
                    source: 'campaign',
                    value: campaign.Suppression_Campaign__c,
                    display: campaign.Suppression_Campaign__r?.Name || campaign.Suppression_Campaign__c
                });
            }
            if (campaign.Suppression_Report_Id__c) {
                parsed.push({
                    source: 'report',
                    value: campaign.Suppression_Report_Id__c,
                    display: campaign.Suppression_Report_Id__c
                });
            }
            if (campaign.Suppression_Segment__c) {
                parsed.push({
                    source: 'segment',
                    value: campaign.Suppression_Segment__c,
                    display: campaign.Suppression_Segment__c
                });
            }
        }

        this.exclusionDefinitions = parsed.map(row => {
            const lookupOptions = row.value
                ? [{ label: row.display || row.value, value: row.value }]
                : [];
            let selectedCampaignIds = [];
            let selectedReportIds = [];
            let selectedSegmentIds = [];
            let selectedDmoIds = [];
            let selectedDloIds = [];
            if (row.source === 'campaign') {
                selectedCampaignIds = parseMultiExclusionValues(row);
            }
            if (row.source === 'report') {
                selectedReportIds = parseMultiExclusionValues(row);
            }
            if (row.source === 'segment') {
                selectedSegmentIds = parseMultiExclusionValues(row);
            }
            if (row.source === 'dmo') {
                selectedDmoIds = parseMultiExclusionValues(row);
            }
            if (row.source === 'dlo') {
                selectedDloIds = parseMultiExclusionValues(row);
            }
            return newExclusionRow({
                source: row.source,
                value: row.value || '',
                display: row.display || row.value || '',
                lookupOptions,
                selectedCampaignIds,
                selectedReportIds,
                selectedSegmentIds,
                selectedDmoIds,
                selectedDloIds
            });
        });
        if (this.exclusionDefinitions.some(row => row.source === 'segment' || row.source === 'dmo' || row.source === 'dlo')) {
            this._ensureData360ExclusionCatalog();
        }
        if (this.exclusionDefinitions.some(row => row.source === 'campaign')) {
            this._loadCampaignOptionsForAllRows();
        }
        if (this.exclusionDefinitions.some(row => row.source === 'report')) {
            this._loadReportOptionsForAllRows();
        }
        this.excludeOtherMarketingActivations = !!campaign.Exclude_Other_Marketing_Activations__c;
    }

    _serializeExclusionDefinitions() {
        return (this.exclusionDefinitions || [])
            .filter(row => {
                if (!row.source) return false;
                if (row.source === 'campaign') {
                    return (row.selectedCampaignIds || []).length > 0;
                }
                if (row.source === 'report') {
                    return (row.selectedReportIds || []).length > 0;
                }
                if (row.source === 'segment') {
                    return (row.selectedSegmentIds || []).length > 0;
                }
                if (row.source === 'dmo') {
                    return (row.selectedDmoIds || []).length > 0;
                }
                if (row.source === 'dlo') {
                    return (row.selectedDloIds || []).length > 0;
                }
                return (row.value || '').toString().trim();
            })
            .map(row => {
                if (row.source === 'campaign') {
                    const ids = [...(row.selectedCampaignIds || [])];
                    const display = buildCampaignExclusionDisplay(ids, row.campaignOptions);
                    return {
                        source: 'campaign',
                        value: ids.join(','),
                        values: ids,
                        display
                    };
                }
                if (row.source === 'report') {
                    const ids = [...(row.selectedReportIds || [])];
                    const display = buildReportExclusionDisplay(ids, row.reportOptions);
                    return {
                        source: 'report',
                        value: ids.join(','),
                        values: ids,
                        display
                    };
                }
                if (row.source === 'segment') {
                    const ids = [...(row.selectedSegmentIds || [])];
                    const display = buildSegmentExclusionDisplay(ids, row.segmentOptions);
                    return {
                        source: 'segment',
                        value: ids.join(','),
                        values: ids,
                        display
                    };
                }
                if (row.source === 'dmo') {
                    const ids = [...(row.selectedDmoIds || [])];
                    const display = buildDataCloudCatalogExclusionDisplay(ids, row.dmoOptions);
                    return {
                        source: 'dmo',
                        value: ids.join(','),
                        values: ids,
                        display
                    };
                }
                if (row.source === 'dlo') {
                    const ids = [...(row.selectedDloIds || [])];
                    const display = buildDataCloudCatalogExclusionDisplay(ids, row.dloOptions);
                    return {
                        source: 'dlo',
                        value: ids.join(','),
                        values: ids,
                        display
                    };
                }
                return {
                    source: row.source,
                    value: (row.value || '').toString().trim(),
                    display: row.display || row.value
                };
            });
    }

    _applyExclusionsToSaveFields(fields) {
        const defs = this._serializeExclusionDefinitions();
        fields['Campaign_Exclusions_JSON__c'] = defs.length ? JSON.stringify(defs) : null;
        fields['Suppression_Campaign__c'] = null;
        fields['Suppression_Report_Id__c'] = null;
        fields['Suppression_Segment__c'] = null;

        const first = (source) => defs.find(d => d.source === source);
        const campaign = first('campaign');
        const report = first('report');
        const segment = first('segment');
        if (campaign) {
            const firstId = Array.isArray(campaign.values) && campaign.values.length
                ? campaign.values[0]
                : (campaign.value || '').split(',')[0];
            fields['Suppression_Campaign__c'] = firstId || null;
        }
        if (report) {
            const firstReportId = Array.isArray(report.values) && report.values.length
                ? report.values[0]
                : (report.value || '').split(',')[0];
            fields['Suppression_Report_Id__c'] = firstReportId || null;
        }
        if (segment) {
            const firstSegment = Array.isArray(segment.values) && segment.values.length
                ? segment.values[0]
                : (segment.value || '').split(',')[0];
            fields['Suppression_Segment__c'] = firstSegment || null;
        }
        fields['Exclude_Other_Marketing_Activations__c'] = this.showOtherMarketingActivationsOption
            ? this.excludeOtherMarketingActivations === true
            : false;
    }

    loadScoringModels() {
        this.scoringModelLoadError = '';
        // Same catalogue as Marketing Dictionary → Scoring → Model Definitions.
        getCampaignRecords()
            .then(data => {
                this._scoringModels = (data || []).filter(r => r.Dictionary_Sub_Type__c === 'Scoring Model');
                this._syncSelectedScoringModel();
            })
            .catch(err => {
                console.error('Error loading scoring models:', err);
                this._scoringModels = [];
                this.scoringModelLoadError = err?.body?.message || err?.message || 'Could not load model definitions.';
                this._syncSelectedScoringModel();
            });
    }

    /** Refresh the label when the chosen model is still in Model Definitions. */
    _syncSelectedScoringModel() {
        if (!this.selectedScoringModelId) {
            this.selectedScoringModelName = '';
            return;
        }
        const match = (this._scoringModels || []).find(m => m.Id === this.selectedScoringModelId);
        if (!match) {
            this.selectedScoringModelId = '';
            this.selectedScoringModelName = '';
            return;
        }
        const version = match.Version__c != null ? ` v${match.Version__c}` : '';
        const modelId = match.Model_Id__c ? ` (${match.Model_Id__c})` : '';
        const source = match.Scoring_Model_Source_System__c
            ? ` · ${match.Scoring_Model_Source_System__c}`
            : '';
        const inactive = match.Is_Active__c ? '' : ' · Inactive';
        this.selectedScoringModelName = `${match.Name}${version}${modelId}${source}${inactive}`;
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
        this.activeFrom = campaign.Active_From__c || '';
        this.activeTo = campaign.Active_To__c || '';
        this.campaignDurationDays = campaign.Duration_Days__c != null
            ? String(campaign.Duration_Days__c)
            : '';

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
        this._hydrateExclusionsFromCampaign(campaign);
        this.selectedScoringModelId = campaign.Scoring_Model_Dict__c || '';
        this.selectedScoringModelName = campaign.Scoring_Model_Dict__r
            ? campaign.Scoring_Model_Dict__r.Name
            : '';

        if (campaign.Scoring_Method__c === 'A-priori') {
            this.scoringConfigurationMethod = 'apriori';
            const score = campaign.Overall_Score__c;
            this.aprioriScore = this.isValidScoreValue(score) ? Number(score) : 500;
        } else {
            this.scoringConfigurationMethod = 'model';
            this.aprioriScore = 500;
        }

        if (campaign.Assigned_Channels__c) {
            this.editChannelValues = campaign.Assigned_Channels__c.split(';').map(c => c.trim()).filter(Boolean);
            this.applyEditChannels();
        }

        // Id SSOT preferred; fall back to display field (legacy Names or mid-migrate Ids).
        if (campaign.Product_Family_Ids__c || campaign.Product_Family__c) {
            this.editProductFamilyValues = (campaign.Product_Family_Ids__c || campaign.Product_Family__c)
                .split(';').map(p => p.trim()).filter(Boolean);
        }

        if (campaign.Family_of_Needs_Ids__c || campaign.Family_of_Needs__c) {
            this.editFamilyOfNeedsValues = (campaign.Family_of_Needs_Ids__c || campaign.Family_of_Needs__c)
                .split(';').map(f => f.trim()).filter(Boolean);
        }

        this.applyEditOfferingSelections();
        this.loadSavedCampaignOffers();
        this.loadSavedCampaignCopyVariants();
        this.loadScoringModels();
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
            this.loadScoringModels();
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

    loadSavedCampaignCopyVariants() {
        if (!this.recordId) return;
        getCampaignCopyVariants({ campaignId: this.recordId })
            .then(data => {
                this.editSavedCopyVariantIds = (data || []).map(row => row.id);
                this.selectedCopyVariantIds = [...this.editSavedCopyVariantIds];
            })
            .catch(err => console.error('Error loading saved campaign copy variants:', err));
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
        if (!this.matchedCampaignType?.Include_In_Emergency__c) {
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

            const iconByType = {};
            data.forEach(rec => {
                if (rec.Is_Active__c !== true) {
                    return;
                }
                const type = rec.Channel_Type__c || 'Other';
                const icon = rec.Channel_Icon__c || 'utility:connected_apps';
                if (!iconByType[type]) {
                    iconByType[type] = icon;
                }
                const disabled = false;
                if (!groupMap[type]) {
                    groupMap[type] = { type, icon, items: [] };
                }
                // New campaigns start with channels unchecked to avoid accidental all-channel selection.
                // Edit mode restores the campaign's previously assigned channels.
                const isActive = this.editChannelValues
                    ? this.editChannelValues.includes(rec.Name)
                    : false;
                allChannels.push({
                    label: rec.Name,
                    value: rec.Name,
                    channelType: type,
                    icon,
                    checked: isActive,
                    disabled
                });
                groupMap[type].items.push({
                    label: rec.Name,
                    value: rec.Name,
                    channelType: type,
                    icon: rec.Channel_Icon__c || 'utility:connected_apps',
                    active: isActive,
                    disabled,
                    buttonClass: disabled
                        ? 'slds-button slds-button_neutral channel-btn channel-btn-disabled'
                        : (isActive ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive'),
                    iconClass: isActive ? 'channel-icon-active' : 'channel-icon-inactive',
                    title: disabled ? `${rec.Name} is inactive in Marketing Dictionary` : rec.Name
                });
            });

            this.channelIconByType = iconByType;
            this.channelGroups = Object.values(groupMap);
            this.channels = allChannels;
            const enabledChannels = allChannels.filter(c => !c.disabled);
            this.selectAllChecked = enabledChannels.length > 0 && enabledChannels.every(c => c.checked);
            this._refreshActiveCopyChannelTypes(data);
            this._initializeCopyChannelEnables();
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
                    buttonClass: ch.disabled
                        ? 'slds-button slds-button_neutral channel-btn channel-btn-disabled'
                        : (isActive ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive'),
                    iconClass: isActive ? 'channel-icon-active' : 'channel-icon-inactive',
                    icon: ch.icon
                };
            })
        }));
        this.channels = this.channels.map(ch => ({
            ...ch,
            checked: this.editChannelValues.includes(ch.label)
        }));
        const enabledChannels = this.channels.filter(c => !c.disabled);
        this.selectAllChecked = enabledChannels.length > 0 && enabledChannels.every(c => c.checked);
        this._initializeCopyChannelEnables();
    }

    _refreshActiveCopyChannelTypes(records) {
        const types = [];
        const seen = new Set();
        (records || []).forEach(rec => {
            if (rec.Is_Active__c !== true) return;
            const type = (rec.Channel_Type__c || 'Other').trim() || 'Other';
            if (seen.has(type)) return;
            seen.add(type);
            types.push(type);
        });
        this.activeCopyChannelTypes = types;
    }

    _initializeCopyChannelEnables() {
        const next = { ...this.copyChannelEnabledByType };
        (this.activeCopyChannelTypes || []).forEach(type => {
            if (next[type] === undefined) {
                next[type] = false;
            }
        });
        if (this.editChannelValues?.length) {
            this.channels.forEach(ch => {
                if (!ch.disabled && ch.checked && ch.channelType) {
                    next[ch.channelType] = true;
                }
            });
        }
        this.copyChannelEnabledByType = next;
        this._syncChannelChecksFromCopyEnables();
    }

    _syncChannelChecksFromCopyEnables() {
        this.channels = this.channels.map(ch => ({
            ...ch,
            checked: !ch.disabled && !!this.copyChannelEnabledByType[ch.channelType]
        }));
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => {
                const active = !ch.disabled && !!this.copyChannelEnabledByType[ch.channelType];
                return {
                    ...ch,
                    active,
                    buttonClass: ch.disabled
                        ? 'slds-button slds-button_neutral channel-btn channel-btn-disabled'
                        : (active ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive'),
                    iconClass: active ? 'channel-icon-active' : 'channel-icon-inactive'
                };
            })
        }));
        const enabledChannels = this.channels.filter(c => !c.disabled);
        this.selectAllChecked = enabledChannels.length > 0 && enabledChannels.every(c => c.checked);
    }

    _isCopyChannelTypeEnabled(channelType) {
        return !!this.copyChannelEnabledByType[channelType];
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
        this.loadScoringModels();
        if (this.scoringConfigurationMethod === 'apriori') {
            this.loadAprioriContextFromState();
        }
    }

    handleSelectAllFamilyOfNeeds(event) {
        this.selectAllFamilyOfNeeds = event.target.checked;
        this.familyOfNeedsOptions = this.familyOfNeedsOptions.map(opt => ({
            ...opt,
            checked: this.selectAllFamilyOfNeeds
        }));
        this.scheduleFetchOffers();
        this.loadScoringModels();
    }

    // --- COMBOBOX INTERACTION HANDLERS ---
    handleOutsideClick(event) {
        if (!event.target.closest('.slds-combobox_container')) {
            this.isTopicDropdownOpen = false;
        }
        if (!event.target.closest('.exclusion-multi-picker')) {
            this._closeAllExclusionPickers();
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
        if (this.scoringConfigurationMethod === 'apriori') {
            this.loadAprioriContextFromState();
        }
    }

    handleNameChange(event) {
        this.campaignName = event.target.value;
    }

    handleActiveFromChange(event) {
        this.activeFrom = event.target.value;
    }

    handleActiveToChange(event) {
        this.activeTo = event.target.value;
    }

    handleCampaignDurationChange(event) {
        this.campaignDurationDays = event.target.value;
    }
        
    handleOfferingTypeChange(event) {
        this.selectedOfferingType = event.target.value; 
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
        if (this.scoringConfigurationMethod === 'apriori') {
            this.loadAprioriContextFromState();
        }
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
        const stepKey = this.currentStepKey;

        if (this.isEmergency) {
            this.selectedPriorityTier = this.tierLabelForNumber(1);
        } else {
            this.selectedPriorityTier = '';
        }
        this._syncWizardStepAfterTierChange(stepKey);
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
            const stepKey = this.currentStepKey;
            this.selectedPriorityTier = newTier;
            if (!this._tierAllowsManualExclusions(newTier)) {
                this.exclusionDefinitions = [];
            }
            if (!this._tierAllowsOtherMarketingActivations(newTier)) {
                this.excludeOtherMarketingActivations = false;
            }
            this._syncWizardStepAfterTierChange(stepKey);
        }
    }

    handleOtherMarketingActivationsChange(event) {
        this.excludeOtherMarketingActivations = event.target.checked;
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

    handleAddExclusionDefinition() {
        this.exclusionDefinitions = [...this.exclusionDefinitions, newExclusionRow()];
    }

    handleRemoveExclusionDefinition(event) {
        const rowId = event.currentTarget.dataset.rowId;
        this.exclusionDefinitions = this.exclusionDefinitions.filter(row => row.id !== rowId);
    }

    handleExclusionSourcePick(event) {
        const rowId = event.currentTarget.dataset.rowId;
        const source = event.currentTarget.dataset.value;
        if (!rowId || !source) return;
        this.exclusionDefinitions = this.exclusionDefinitions.map(row => {
            if (row.id !== rowId) return row;
            return newExclusionRow({ id: row.id, source });
        });
        if (source === 'campaign') {
            this._ensureCampaignCatalogForRow(rowId);
        } else if (source === 'report') {
            this._ensureReportCatalogForRow(rowId);
        } else if (source === 'segment' || source === 'dmo' || source === 'dlo') {
            this._ensureData360ExclusionCatalog().then(() => {
                if (source === 'segment') {
                    this._openSegmentPicker(rowId);
                } else if (source === 'dmo') {
                    this._openDmoPicker(rowId);
                } else {
                    this._openDloPicker(rowId);
                }
            });
        }
    }

    _loadCampaignOptionsForAllRows() {
        searchSuppressionCampaigns({ searchTerm: '' })
            .then(results => {
                const campaignOptions = mapCampaignOptionsFromApex(results);
                this.exclusionDefinitions = this.exclusionDefinitions.map(row =>
                    row.source === 'campaign' ? { ...row, campaignOptions } : row
                );
            })
            .catch(err => console.error('Campaign exclusion catalogue load failed:', err));
    }

    _ensureCampaignCatalogForRow(rowId) {
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        if ((row.campaignOptions || []).length) {
            this._updateExclusionRow(rowId, { campaignPickerOpen: true });
            return;
        }
        searchSuppressionCampaigns({ searchTerm: '' })
            .then(results => {
                const campaignOptions = mapCampaignOptionsFromApex(results);
                this.exclusionDefinitions = this.exclusionDefinitions.map(r =>
                    r.id === rowId ? { ...r, campaignOptions, campaignPickerOpen: true } : r
                );
            })
            .catch(err => console.error('Campaign exclusion catalogue load failed:', err));
    }

    _loadReportOptionsForAllRows() {
        searchSuppressionReports({ searchTerm: '' })
            .then(results => {
                const reportOptions = mapReportOptionsFromApex(results);
                this.exclusionDefinitions = this.exclusionDefinitions.map(row =>
                    row.source === 'report' ? { ...row, reportOptions } : row
                );
            })
            .catch(err => console.error('Report exclusion catalogue load failed:', err));
    }

    _ensureReportCatalogForRow(rowId) {
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        if ((row.reportOptions || []).length) {
            this._updateExclusionRow(rowId, { reportPickerOpen: true });
            return;
        }
        searchSuppressionReports({ searchTerm: '' })
            .then(results => {
                const reportOptions = mapReportOptionsFromApex(results);
                this.exclusionDefinitions = this.exclusionDefinitions.map(r =>
                    r.id === rowId ? { ...r, reportOptions, reportPickerOpen: true } : r
                );
            })
            .catch(err => console.error('Report exclusion catalogue load failed:', err));
    }

    _closeAllExclusionPickers() {
        const hasOpen = (this.exclusionDefinitions || []).some(
            row => row.campaignPickerOpen || row.reportPickerOpen
                || row.segmentPickerOpen || row.dmoPickerOpen || row.dloPickerOpen
        );
        if (!hasOpen) return;
        this.exclusionDefinitions = this.exclusionDefinitions.map(row => ({
            ...row,
            campaignPickerOpen: false,
            reportPickerOpen: false,
            segmentPickerOpen: false,
            dmoPickerOpen: false,
            dloPickerOpen: false
        }));
    }

    _closeOtherExclusionPickers(rowId) {
        return (this.exclusionDefinitions || []).map(r => {
            if (r.id === rowId) return r;
            if (r.campaignPickerOpen || r.reportPickerOpen || r.segmentPickerOpen || r.dmoPickerOpen
                || r.dloPickerOpen) {
                return {
                    ...r,
                    campaignPickerOpen: false,
                    reportPickerOpen: false,
                    segmentPickerOpen: false,
                    dmoPickerOpen: false,
                    dloPickerOpen: false
                };
            }
            return r;
        });
    }

    _openSegmentPicker(rowId) {
        this.exclusionDefinitions = this._closeOtherExclusionPickers(rowId).map(r =>
            r.id === rowId ? { ...r, segmentPickerOpen: true } : r
        );
    }

    _openDmoPicker(rowId) {
        this.exclusionDefinitions = this._closeOtherExclusionPickers(rowId).map(r =>
            r.id === rowId ? { ...r, dmoPickerOpen: true } : r
        );
    }

    _openDloPicker(rowId) {
        this.exclusionDefinitions = this._closeOtherExclusionPickers(rowId).map(r =>
            r.id === rowId ? { ...r, dloPickerOpen: true } : r
        );
    }

    _updateExclusionRow(rowId, patch) {
        this.exclusionDefinitions = this.exclusionDefinitions.map(row =>
            row.id === rowId ? { ...row, ...patch } : row
        );
    }

    handleCampaignPickerToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const opening = !row.campaignPickerOpen;
        this.exclusionDefinitions = this._closeOtherExclusionPickers(rowId).map(r =>
            r.id === rowId
                ? { ...r, campaignPickerOpen: opening, reportPickerOpen: false, segmentPickerOpen: false, dmoPickerOpen: false, dloPickerOpen: false }
                : r
        );
        if (opening) {
            this._ensureCampaignCatalogForRow(rowId);
        }
    }

    handleCampaignPickerSearch(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const term = event.target.value || '';
        this._updateExclusionRow(rowId, { campaignSearchTerm: term, campaignPickerOpen: true });
    }

    handleCampaignExclusionToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const campaignId = event.currentTarget.dataset.campaignId;
        const checked = event.target.checked;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row || !campaignId) return;
        const selected = new Set(row.selectedCampaignIds || []);
        if (checked) {
            selected.add(campaignId);
        } else {
            selected.delete(campaignId);
        }
        const selectedCampaignIds = [...selected];
        this._updateExclusionRow(rowId, {
            selectedCampaignIds,
            value: selectedCampaignIds.join(','),
            display: buildCampaignExclusionDisplay(selectedCampaignIds, row.campaignOptions)
        });
    }

    handleSelectAllCampaignsInGroup(event) {
        event.preventDefault();
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const groupKey = event.currentTarget.dataset.groupKey;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row || !groupKey) return;
        const selected = new Set(row.selectedCampaignIds || []);
        (row.campaignOptions || []).forEach(c => {
            if (c.groupKey === groupKey) {
                selected.add(c.id);
            }
        });
        const selectedCampaignIds = [...selected];
        this._updateExclusionRow(rowId, {
            selectedCampaignIds,
            value: selectedCampaignIds.join(','),
            display: buildCampaignExclusionDisplay(selectedCampaignIds, row.campaignOptions)
        });
    }

    handleRemoveCampaignExclusionPill(event) {
        const rowId = event.currentTarget.dataset.rowId;
        const campaignId = event.currentTarget.dataset.campaignId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const selectedCampaignIds = (row.selectedCampaignIds || []).filter(id => id !== campaignId);
        this._updateExclusionRow(rowId, {
            selectedCampaignIds,
            value: selectedCampaignIds.join(','),
            display: buildCampaignExclusionDisplay(selectedCampaignIds, row.campaignOptions)
        });
    }

    handleReportPickerToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const opening = !row.reportPickerOpen;
        this.exclusionDefinitions = this._closeOtherExclusionPickers(rowId).map(r =>
            r.id === rowId
                ? { ...r, reportPickerOpen: opening, campaignPickerOpen: false, segmentPickerOpen: false, dmoPickerOpen: false, dloPickerOpen: false }
                : r
        );
        if (opening) {
            this._ensureReportCatalogForRow(rowId);
        }
    }

    handleSegmentPickerToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const opening = !row.segmentPickerOpen;
        if (opening) {
            this._ensureData360ExclusionCatalog().then(() => this._openSegmentPicker(rowId));
        } else {
            this._updateExclusionRow(rowId, { segmentPickerOpen: false });
        }
    }

    handleSegmentPickerSearch(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        this._updateExclusionRow(rowId, { segmentSearchTerm: event.target.value || '', segmentPickerOpen: true });
    }

    handleSegmentExclusionToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const segmentId = event.currentTarget.dataset.segmentId;
        const checked = event.target.checked;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row || !segmentId) return;
        const selected = new Set(row.selectedSegmentIds || []);
        if (checked) selected.add(segmentId);
        else selected.delete(segmentId);
        const selectedSegmentIds = [...selected];
        this._updateExclusionRow(rowId, {
            selectedSegmentIds,
            value: selectedSegmentIds.join(','),
            display: buildSegmentExclusionDisplay(selectedSegmentIds, row.segmentOptions)
        });
    }

    handleRemoveSegmentExclusionPill(event) {
        const rowId = event.currentTarget.dataset.rowId;
        const segmentId = event.currentTarget.dataset.segmentId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const selectedSegmentIds = (row.selectedSegmentIds || []).filter(id => id !== segmentId);
        this._updateExclusionRow(rowId, {
            selectedSegmentIds,
            value: selectedSegmentIds.join(','),
            display: buildSegmentExclusionDisplay(selectedSegmentIds, row.segmentOptions)
        });
    }

    handleDmoPickerToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const opening = !row.dmoPickerOpen;
        if (opening) {
            this._ensureData360ExclusionCatalog().then(() => this._openDmoPicker(rowId));
        } else {
            this._updateExclusionRow(rowId, { dmoPickerOpen: false });
        }
    }

    handleDmoPickerSearch(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        this._updateExclusionRow(rowId, { dmoSearchTerm: event.target.value || '', dmoPickerOpen: true });
    }

    handleDmoExclusionToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const dmoId = event.currentTarget.dataset.dmoId;
        const checked = event.target.checked;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row || !dmoId) return;
        const selected = new Set(row.selectedDmoIds || []);
        if (checked) selected.add(dmoId);
        else selected.delete(dmoId);
        const selectedDmoIds = [...selected];
        this._updateExclusionRow(rowId, {
            selectedDmoIds,
            value: selectedDmoIds.join(','),
            display: buildDataCloudCatalogExclusionDisplay(selectedDmoIds, row.dmoOptions)
        });
    }

    handleRemoveDmoExclusionPill(event) {
        const rowId = event.currentTarget.dataset.rowId;
        const dmoId = event.currentTarget.dataset.dmoId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const selectedDmoIds = (row.selectedDmoIds || []).filter(id => id !== dmoId);
        this._updateExclusionRow(rowId, {
            selectedDmoIds,
            value: selectedDmoIds.join(','),
            display: buildDataCloudCatalogExclusionDisplay(selectedDmoIds, row.dmoOptions)
        });
    }

    handleDloPickerToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const opening = !row.dloPickerOpen;
        if (opening) {
            this._ensureData360ExclusionCatalog().then(() => this._openDloPicker(rowId));
        } else {
            this._updateExclusionRow(rowId, { dloPickerOpen: false });
        }
    }

    handleDloPickerSearch(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        this._updateExclusionRow(rowId, { dloSearchTerm: event.target.value || '', dloPickerOpen: true });
    }

    handleDloExclusionToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const dloId = event.currentTarget.dataset.dloId;
        const checked = event.target.checked;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row || !dloId) return;
        const selected = new Set(row.selectedDloIds || []);
        if (checked) selected.add(dloId);
        else selected.delete(dloId);
        const selectedDloIds = [...selected];
        this._updateExclusionRow(rowId, {
            selectedDloIds,
            value: selectedDloIds.join(','),
            display: buildDataCloudCatalogExclusionDisplay(selectedDloIds, row.dloOptions)
        });
    }

    handleRemoveDloExclusionPill(event) {
        const rowId = event.currentTarget.dataset.rowId;
        const dloId = event.currentTarget.dataset.dloId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const selectedDloIds = (row.selectedDloIds || []).filter(id => id !== dloId);
        this._updateExclusionRow(rowId, {
            selectedDloIds,
            value: selectedDloIds.join(','),
            display: buildDataCloudCatalogExclusionDisplay(selectedDloIds, row.dloOptions)
        });
    }

    handleReportPickerSearch(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const term = event.target.value || '';
        this._updateExclusionRow(rowId, { reportSearchTerm: term, reportPickerOpen: true });
    }

    handleReportExclusionToggle(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const reportId = event.currentTarget.dataset.reportId;
        const checked = event.target.checked;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row || !reportId) return;
        const selected = new Set(row.selectedReportIds || []);
        if (checked) {
            selected.add(reportId);
        } else {
            selected.delete(reportId);
        }
        const selectedReportIds = [...selected];
        this._updateExclusionRow(rowId, {
            selectedReportIds,
            value: selectedReportIds.join(','),
            display: buildReportExclusionDisplay(selectedReportIds, row.reportOptions)
        });
    }

    handleRemoveReportExclusionPill(event) {
        const rowId = event.currentTarget.dataset.rowId;
        const reportId = event.currentTarget.dataset.reportId;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (!row) return;
        const selectedReportIds = (row.selectedReportIds || []).filter(id => id !== reportId);
        this._updateExclusionRow(rowId, {
            selectedReportIds,
            value: selectedReportIds.join(','),
            display: buildReportExclusionDisplay(selectedReportIds, row.reportOptions)
        });
    }

    handleExclusionLookupSelect(event) {
        const rowId = event.target.dataset.rowId;
        const value = event.detail.value;
        const row = this.exclusionDefinitions.find(r => r.id === rowId);
        if (row?.source === 'campaign' || row?.source === 'report'
            || row?.source === 'segment' || row?.source === 'dmo' || row?.source === 'dlo') {
            return;
        }
        let display = value;
        const opt = (row.lookupOptions || []).find(o => o.value === value);
        display = opt ? opt.label : value;
        this.exclusionDefinitions = this.exclusionDefinitions.map(r =>
            r.id === rowId ? { ...r, value, display } : r
        );
    }

    handleScoringConfigurationMethodChange(event) {
        this.scoringConfigurationMethod = event.detail.value;
        if (this.scoringConfigurationMethod === 'apriori') {
            this.loadAprioriContextFromState();
        }
    }

    handleAprioriScoreChange(event) {
        const next = Number(event.detail.value);
        if (Number.isNaN(next)) {
            return;
        }
        const clamped = Math.min(1000, Math.max(0, Math.round(next)));
        // Keep the thumb moving while dragging; confirm only after the user pauses on a new value.
        this.aprioriScore = clamped;
        clearTimeout(this._aprioriScoreCommitTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._aprioriScoreCommitTimer = setTimeout(() => {
            this.finalizeAprioriScoreSelection(clamped);
        }, 400);
    }

    finalizeAprioriScoreSelection(clamped) {
        const baseline = this.aprioriBaselineScore;
        const needsSharedScoreConfirm = this.aprioriHasSharedState
            && baseline !== null
            && baseline !== undefined
            && clamped !== baseline
            && !this.aprioriChangeConfirmed;
        if (!needsSharedScoreConfirm) {
            this.showAprioriChangePopover = false;
            this.pendingAprioriScore = null;
            return;
        }
        this.pendingAprioriScore = clamped;
        this.showAprioriChangePopover = true;
    }

    handleAprioriPopoverConfirm() {
        if (this.pendingAprioriScore !== null && this.pendingAprioriScore !== undefined) {
            this.aprioriScore = this.pendingAprioriScore;
        }
        this.aprioriChangeConfirmed = true;
        this.showAprioriChangePopover = false;
        this.pendingAprioriScore = null;
    }

    handleAprioriPopoverCancel() {
        this.aprioriScore = this.aprioriBaselineScore;
        this.aprioriSliderResetKey += 1;
        this.showAprioriChangePopover = false;
        this.pendingAprioriScore = null;
    }

    get aprioriPopoverPendingScoreLabel() {
        if (this.pendingAprioriScore === null || this.pendingAprioriScore === undefined) {
            return '';
        }
        return String(this.pendingAprioriScore);
    }

    get aprioriProductFamilyIds() {
        if (!this.isOfferingProductFamily) {
            return [];
        }
        return this.productFamilyOptions.filter(o => o.checked).map(o => o.value);
    }

    get aprioriContextReady() {
        return !!this.selectedTopicId && this.aprioriProductFamilyIds.length > 0;
    }

    loadAprioriContextFromState() {
        if (!this.isAprioriScoreConfiguration || !this.aprioriContextReady) {
            this._resetAprioriSharedStateFlags(false);
            return;
        }
        getAprioriContext({
            topicId: this.selectedTopicId,
            productFamilyIds: this.aprioriProductFamilyIds
        })
            .then(result => {
                this.aprioriHasMixedSharedScores = !!result?.hasMixedScores;
                this.aprioriHasSharedState = !!result?.hasExistingState;
                this.aprioriChangeConfirmed = false;
                if (this.aprioriHasMixedSharedScores) {
                    this.aprioriBaselineScore = null;
                    return;
                }
                if (this.aprioriHasSharedState && result.suggestedScore !== null && result.suggestedScore !== undefined) {
                    this.aprioriBaselineScore = Number(result.suggestedScore);
                    this.aprioriScore = this.aprioriBaselineScore;
                } else {
                    this.aprioriBaselineScore = null;
                }
            })
            .catch(err => {
                console.error('Apriori context load failed:', err);
                this._resetAprioriSharedStateFlags(false);
            });
    }

    _resetAprioriSharedStateFlags(resetScore) {
        this.aprioriHasSharedState = false;
        this.aprioriHasMixedSharedScores = false;
        this.aprioriBaselineScore = null;
        this.aprioriChangeConfirmed = false;
        if (resetScore) {
            this.aprioriScore = 500;
        }
    }

    handleScoringModelChange(event) {
        this.selectedScoringModelId = event.detail.value;
        const opt = this.scoringModelOptions.find(o => o.value === this.selectedScoringModelId);
        this.selectedScoringModelName = opt ? opt.label : '';
    }

    handleSelectAllChange(event) {
        this.selectAllChecked = event.target.checked;
        this.channels = this.channels.map(c => ({
            ...c,
            checked: c.disabled ? c.checked : this.selectAllChecked
        }));
        this.channelGroups = this.channelGroups.map(group => ({
            ...group,
            items: group.items.map(ch => ({
                ...ch,
                active: ch.disabled ? ch.active : this.selectAllChecked,
                buttonClass: ch.disabled
                    ? 'slds-button slds-button_neutral channel-btn channel-btn-disabled'
                    : (this.selectAllChecked ? 'slds-button slds-button_neutral channel-btn channel-btn-active' : 'slds-button slds-button_neutral channel-btn channel-btn-inactive'),
                iconClass: !ch.disabled && this.selectAllChecked ? 'channel-icon-active' : 'channel-icon-inactive'
            }))
        }));
    }

    handleChannelTileToggle(event) {
        const val = event.currentTarget.dataset.value;
        const current = this.channels.find(c => c.value === val);
        if (!current || current.disabled) return;
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
        const enabledChannels = this.channels.filter(c => !c.disabled);
        this.selectAllChecked = enabledChannels.length > 0 && enabledChannels.every(c => c.checked);
    }

    handleChannelChange(event) {
        const val = event.target.dataset.value;
        const channel = this.channels.find(c => c.value === val);
        if (!channel || channel.disabled) return;
        this.channels = this.channels.map(c => c.value === val ? { ...c, checked: event.target.checked } : c);
        const enabledChannels = this.channels.filter(c => !c.disabled);
        this.selectAllChecked = enabledChannels.length > 0 && enabledChannels.every(c => c.checked);
    }

    // --- WIZARD STEP NAVIGATION ---
    // Priority & Exclusions lives on step 1. Scoring applies only when tier number > 3.
    get isScoringStepRequired() {
        const tier = this.selectedTierRecord;
        if (!tier || tier.Tier_Number__c == null) {
            return false;
        }
        const tierNum = Number(tier.Tier_Number__c);
        return !Number.isNaN(tierNum) && tierNum > 3;
    }

    get wizardStepData() {
        const steps = [
            { label: 'Campaign Properties', value: 1, key: 'properties' },
            { label: 'Topic & Offering', value: 2, key: 'topic' },
            { label: 'Channels & Copy', value: 3, key: 'copy' }
        ];
        let nextValue = 4;
        if (this.isScoringStepRequired) {
            steps.push({ label: 'Scoring', value: nextValue, key: 'scoring' });
            nextValue += 1;
        }
        steps.push({ label: 'Summary', value: nextValue, key: 'summary' });
        return steps;
    }

    get currentStepKey() {
        const match = this.wizardStepData.find(step => step.value === this.currentStep);
        return match ? match.key : '';
    }

    get maxWizardStep() {
        const steps = this.wizardStepData;
        return steps.length ? steps[steps.length - 1].value : 1;
    }

    _syncWizardStepAfterTierChange(preserveKey) {
        if (!preserveKey) {
            return;
        }
        const next = this.wizardStepData.find(step => step.key === preserveKey);
        if (next) {
            this.currentStep = next.value;
            return;
        }
        if (preserveKey === 'scoring') {
            const summary = this.wizardStepData.find(step => step.key === 'summary');
            if (summary) {
                this.currentStep = summary.value;
            }
        }
    }

    /**
     * lightning-progress-indicator current-step must match a progress-step value (string).
     * @see https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-progress-step.html
     */
    get wizardSteps() {
        return this.wizardStepData.map(step => ({
            ...step,
            progressValue: String(step.value)
        }));
    }

    get wizardCurrentStepValue() {
        return String(this.currentStep);
    }

    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }
    get isStep4() { return this.currentStepKey === 'scoring'; }
    get isStep5() { return this.currentStepKey === 'summary'; }
    get isLastStep() { return this.currentStep === this.maxWizardStep; }
    get showBackButton() { return this.currentStep > 1; }
    get showNextButton() { return this.currentStep < this.maxWizardStep; }

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
        const enabled = (this.activeCopyChannelTypes || []).filter(type => this._isCopyChannelTypeEnabled(type));
        if (!enabled.length) return 'None';
        return enabled.join(', ');
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

    get exclusionSourceOptions() {
        return EXCLUSION_SOURCE_OPTIONS;
    }

    get exclusionDefinitionRows() {
        return (this.exclusionDefinitions || []).map((row, index) => {
            const base = {
                ...row,
                isCampaign: row.source === 'campaign',
                isReport: row.source === 'report',
                isSegment: row.source === 'segment',
                isDmo: row.source === 'dmo',
                isDlo: row.source === 'dlo',
                showRemove: this.exclusionDefinitions.length > 1 || index > 0,
                exclusionSourceOptions: buildExclusionSourcePickerOptions(row.source)
            };
            if (row.source === 'report') {
                const term = (row.reportSearchTerm || '').trim().toLowerCase();
                const options = row.reportOptions || [];
                const filtered = options.filter(r => {
                    if (!term) return true;
                    return (r.name || '').toLowerCase().includes(term)
                        || (r.format || '').toLowerCase().includes(term);
                });
                const selectedSet = new Set(row.selectedReportIds || []);
                const filteredReportPickerRows = filtered.map(r => ({
                    id: r.id,
                    name: r.name,
                    metaLine: r.format || '',
                    isSelected: selectedSet.has(r.id)
                }));
                const selectedReportPills = (row.selectedReportIds || []).map(id => {
                    const match = options.find(o => o.id === id);
                    return { id, label: match ? reportDisplayLabel(match) : id };
                });
                return {
                    ...base,
                    reportPickerContainerClass: `custom-dropdown-container exclusion-multi-picker exclusion-report-picker ${row.reportPickerOpen ? 'slds-is-open' : ''}`,
                    filteredReportPickerRows,
                    selectedReportPills,
                    hasSelectedReports: selectedReportPills.length > 0
                };
            }
            if (row.source === 'segment') {
                const term = (row.segmentSearchTerm || '').trim().toLowerCase();
                const options = row.segmentOptions || [];
                const filtered = options.filter(s => {
                    if (!term) return true;
                    return (s.name || '').toLowerCase().includes(term)
                        || (s.status || '').toLowerCase().includes(term);
                });
                const selectedSet = new Set(row.selectedSegmentIds || []);
                const filteredSegmentPickerRows = filtered.map(s => ({
                    id: s.id,
                    name: s.name,
                    metaLine: s.status || '',
                    isSelected: selectedSet.has(s.id)
                }));
                const selectedSegmentPills = (row.selectedSegmentIds || []).map(id => {
                    const match = options.find(o => o.id === id);
                    return { id, label: match ? segmentDisplayLabel(match) : id };
                });
                return {
                    ...base,
                    segmentPickerContainerClass: `custom-dropdown-container exclusion-multi-picker exclusion-segment-picker ${row.segmentPickerOpen ? 'slds-is-open' : ''}`,
                    filteredSegmentPickerRows,
                    selectedSegmentPills,
                    hasSelectedSegments: selectedSegmentPills.length > 0
                };
            }
            if (row.source === 'dmo') {
                const term = (row.dmoSearchTerm || '').trim().toLowerCase();
                const options = row.dmoOptions || [];
                const filtered = options.filter(d => {
                    if (!term) return true;
                    return (d.label || '').toLowerCase().includes(term)
                        || (d.apiName || '').toLowerCase().includes(term);
                });
                const selectedSet = new Set(row.selectedDmoIds || []);
                const filteredDmoPickerRows = filtered.map(d => ({
                    id: d.id,
                    name: d.label || d.apiName,
                    metaLine: d.apiName || '',
                    isSelected: selectedSet.has(d.id)
                }));
                const selectedDmoPills = (row.selectedDmoIds || []).map(id => {
                    const match = options.find(o => o.id === id);
                    return { id, label: match ? dataCloudCatalogDisplayLabel(match) : id };
                });
                return {
                    ...base,
                    dmoPickerContainerClass: `custom-dropdown-container exclusion-multi-picker exclusion-dmo-picker ${row.dmoPickerOpen ? 'slds-is-open' : ''}`,
                    filteredDmoPickerRows,
                    selectedDmoPills,
                    hasSelectedDmos: selectedDmoPills.length > 0
                };
            }
            if (row.source === 'dlo') {
                const term = (row.dloSearchTerm || '').trim().toLowerCase();
                const options = row.dloOptions || [];
                const filtered = options.filter(d => {
                    if (!term) return true;
                    return (d.label || '').toLowerCase().includes(term)
                        || (d.apiName || '').toLowerCase().includes(term);
                });
                const selectedSet = new Set(row.selectedDloIds || []);
                const filteredDloPickerRows = filtered.map(d => ({
                    id: d.id,
                    name: d.label || d.apiName,
                    metaLine: d.apiName || '',
                    isSelected: selectedSet.has(d.id)
                }));
                const selectedDloPills = (row.selectedDloIds || []).map(id => {
                    const match = options.find(o => o.id === id);
                    return { id, label: match ? dataCloudCatalogDisplayLabel(match) : id };
                });
                return {
                    ...base,
                    dloPickerContainerClass: `custom-dropdown-container exclusion-multi-picker exclusion-dlo-picker ${row.dloPickerOpen ? 'slds-is-open' : ''}`,
                    filteredDloPickerRows,
                    selectedDloPills,
                    hasSelectedDlos: selectedDloPills.length > 0
                };
            }
            if (row.source !== 'campaign') {
                return base;
            }
            const term = (row.campaignSearchTerm || '').trim().toLowerCase();
            const options = row.campaignOptions || [];
            const filtered = options.filter(c => {
                if (!term) return true;
                return (c.name || '').toLowerCase().includes(term)
                    || (c.status || '').toLowerCase().includes(term)
                    || (c.groupName || '').toLowerCase().includes(term);
            });
            const selectedSet = new Set(row.selectedCampaignIds || []);
            const filteredCampaignPickerRows = filtered.map(c => ({
                id: c.id,
                name: c.name,
                metaLine: campaignMetaLine(c.status, c.groupName),
                groupKey: c.groupKey,
                isSelected: selectedSet.has(c.id),
                showGroupAction: !!c.groupKey
            }));
            const selectedCampaignPills = (row.selectedCampaignIds || []).map(id => {
                const match = options.find(o => o.id === id);
                return {
                    id,
                    label: match ? campaignDisplayLabel(match) : id
                };
            });
            return {
                ...base,
                campaignPickerContainerClass: `custom-dropdown-container exclusion-multi-picker exclusion-campaign-picker ${row.campaignPickerOpen ? 'slds-is-open' : ''}`,
                filteredCampaignPickerRows,
                selectedCampaignPills,
                hasSelectedCampaigns: selectedCampaignPills.length > 0,
                campaignPickerSummary: selectedCampaignPills.length
                    ? `${selectedCampaignPills.length} campaign(s) selected`
                    : 'Select campaigns...'
            };
        });
    }

    get addExclusionButtonLabel() {
        return this.exclusionDefinitions.length === 0
            ? 'Add Exclusion Definition'
            : 'Add Exclusion';
    }

    get summaryExclusionsLabel() {
        const parts = [];
        if (this.showOtherMarketingActivationsOption && this.excludeOtherMarketingActivations) {
            parts.push('Other Marketing Activations');
        }
        const defs = this._serializeExclusionDefinitions();
        if (defs.length) {
            parts.push(...defs.map(d => {
                const sourceLabel = EXCLUSION_SOURCE_OPTIONS.find(o => o.value === d.source)?.label || d.source;
                return `${sourceLabel}: ${d.display || d.value}`;
            }));
        }
        return parts.join('; ');
    }

    get summaryAprioriScore() {
        return this.isValidScoreValue(this.aprioriScore) ? String(this.aprioriScore) : 'Not set';
    }

    get summaryScoringModel() {
        return this.selectedScoringModelName || 'Not set';
    }

    get summaryScoringMethod() {
        if (this.scoringConfigurationMethod === 'apriori') {
            return 'Provide Apriori Score';
        }
        return 'Assign Scoring Model';
    }

    get isScoringModelConfiguration() {
        return this.scoringConfigurationMethod === 'model';
    }

    get isAprioriScoreConfiguration() {
        return this.scoringConfigurationMethod === 'apriori';
    }

    get showAprioriSummaryChangeAlert() {
        if (!this.isAprioriScoreConfiguration || !this.isScoringStepRequired) {
            return false;
        }
        const baseline = this.aprioriBaselineScore;
        if (!this.aprioriHasSharedState || baseline === null || baseline === undefined) {
            return false;
        }
        return this.aprioriScore !== baseline;
    }

    get aprioriSummaryChangeAlertMessage() {
        const baseline = this.aprioriBaselineScore;
        const current = this.aprioriScore;
        if (baseline === null || baseline === undefined) {
            return 'This apriori score will be stored for all campaigns sharing the same Topic and Product Family combination.';
        }
        return `Apriori score changed from ${baseline} to ${current}. Saving or activating updates the shared score for every campaign with this Topic and Product Family combination.`;
    }

    get aprioriSharedStateHint() {
        if (this.aprioriHasMixedSharedScores) {
            return 'Selected product families have different shared apriori scores for this topic. Resolve in Marketing Dictionary or adjust selections.';
        }
        if (this.aprioriHasSharedState && this.aprioriBaselineScore !== null) {
            return `A shared apriori score (${this.aprioriBaselineScore}) already exists for this topic and product family selection. Changing it updates all campaigns using the same combination.`;
        }
        return 'No shared apriori score exists yet for this topic and product family selection. You can set a value from 0 to 1000.';
    }

    get scoringConfigurationOptions() {
        return [
            { label: 'Assign Scoring Model', value: 'model' },
            { label: 'Provide Apriori Score', value: 'apriori' }
        ];
    }

    get hasSelectedChannel() {
        return (this.activeCopyChannelTypes || []).some(type => this._isCopyChannelTypeEnabled(type));
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
        if (raw === '' || raw === null || raw === undefined) {
            return false;
        }
        const val = Number(raw);
        return Number.isInteger(val) && val >= 0 && val <= 1000;
    }

    get isAlwaysOnActivation() {
        const key = (this.parentActivationType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return key === 'alwayson';
    }

    get hasValidActiveWindow() {
        if (!this.activeFrom || !this.activeTo) {
            return false;
        }
        const fromMs = new Date(this.activeFrom).getTime();
        const toMs = new Date(this.activeTo).getTime();
        if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
            return false;
        }
        return toMs >= fromMs;
    }

    _issue(id, message) {
        return { id, message };
    }

    get basicPropertiesActivationIssues() {
        const issues = [];
        if (!this.parentActivationType) {
            issues.push(this._issue('activation-type', 'Select an activation type.'));
        }
        if (!this.campaignName || this.campaignName.trim() === '') {
            issues.push(this._issue('campaign-name', 'Enter a campaign name.'));
        }
        if (!this.activeFrom) {
            issues.push(this._issue('active-from', 'Set Active From.'));
        }
        if (!this.activeTo) {
            issues.push(this._issue('active-to', 'Set Active To.'));
        }
        if (this.activeFrom && this.activeTo && !this.hasValidActiveWindow) {
            issues.push(this._issue('active-window', 'Active To must be on or after Active From.'));
        }
        if (this.isAlwaysOnActivation) {
            const days = Number(this.campaignDurationDays);
            if (!this.campaignDurationDays || !Number.isInteger(days) || days < 1) {
                issues.push(this._issue('duration', 'Enter Campaign Duration (Days) for Always-on campaigns.'));
            }
        }
        if (this.showCampaignGroup && !this.selectedCampaignGroupId) {
            issues.push(this._issue('campaign-group', 'Select a campaign group.'));
        }
        return issues;
    }

    get priorityActivationIssues() {
        const issues = [];
        if (!this.selectedPriorityTier) {
            issues.push(this._issue('priority-tier', 'Assign a priority tier.'));
        }
        return issues;
    }

    get channelsActivationIssues() {
        const issues = [];
        if (!this.hasSelectedChannel) {
            issues.push(this._issue('channels', 'Enable at least one channel on Channels & Copy.'));
        }
        return issues;
    }

    get topicOfferingActivationIssues() {
        const issues = [];
        if (!this.selectedTopicId && (!this.topicName || this.topicName.trim() === '')) {
            issues.push(this._issue('topic', 'Choose a topic name.'));
        }
        if (!this.selectedOfferingType) {
            issues.push(this._issue('offering-type', 'Select an offering type.'));
        }
        return issues;
    }

    get copyAssignmentActivationIssues() {
        const issues = [];
        if (!this.hasSelectedChannel) {
            issues.push(this._issue('channels', 'Enable at least one channel for copy assignment.'));
            return issues;
        }
        if (!this.selectedCopyVariantIds || this.selectedCopyVariantIds.length === 0) {
            issues.push(this._issue('copy', 'Assign at least one message variant (any channel).'));
        }
        return issues;
    }

    get scoringActivationIssues() {
        if (!this.isScoringStepRequired) {
            return [];
        }
        const issues = [];
        if (this.scoringConfigurationMethod === 'model') {
            if (!this.selectedScoringModelId) {
                issues.push(this._issue('scoring-model', 'Select a scoring model.'));
            }
        } else {
            if (!this.isOfferingProductFamily || this.aprioriProductFamilyIds.length === 0) {
                issues.push(this._issue('apriori-pf', 'Select at least one Product Family for apriori scoring.'));
            }
            if (!this.selectedTopicId) {
                issues.push(this._issue('apriori-topic', 'Select a Topic for apriori scoring.'));
            }
            if (this.aprioriHasMixedSharedScores) {
                issues.push(this._issue('apriori-mixed', 'Selected product families have different shared apriori scores. Align states before continuing.'));
            }
            if (this.aprioriHasSharedState
                && this.aprioriBaselineScore !== null
                && this.aprioriScore !== this.aprioriBaselineScore
                && !this.aprioriChangeConfirmed) {
                issues.push(this._issue('apriori-confirm', 'Confirm the shared apriori score change in the popover before activating.'));
            }
            if (!this.isValidScoreValue(this.aprioriScore)) {
                issues.push(this._issue('apriori-score', 'Set an apriori score between 0 and 1000.'));
            }
        }
        return issues;
    }

    _summarySectionState(issues) {
        const isValid = !issues || issues.length === 0;
        return {
            isValid,
            issues: issues || [],
            sectionClass: isValid
                ? 'summary-section summary-section--valid'
                : 'summary-section summary-section--invalid'
        };
    }

    get basicPropertiesSummaryState() {
        return this._summarySectionState(this.basicPropertiesActivationIssues);
    }

    get prioritySummaryState() {
        return this._summarySectionState(this.priorityActivationIssues);
    }

    get channelsSummaryState() {
        return this._summarySectionState(this.channelsActivationIssues);
    }

    get topicOfferingSummaryState() {
        return this._summarySectionState(this.topicOfferingActivationIssues);
    }

    get copyAssignmentSummaryState() {
        return this._summarySectionState(this.copyAssignmentActivationIssues);
    }

    get scoringSummaryState() {
        return this._summarySectionState(this.scoringActivationIssues);
    }

    get isStep1Valid() {
        return this.basicPropertiesActivationIssues.length === 0
            && this.priorityActivationIssues.length === 0;
    }

    get isStep2Valid() {
        return this.topicOfferingActivationIssues.length === 0;
    }

    get selectedChannelTypes() {
        return (this.activeCopyChannelTypes || []).filter(type => this._isCopyChannelTypeEnabled(type));
    }

    get isStep3Valid() {
        return this.copyAssignmentActivationIssues.length === 0;
    }

    get isStep4Valid() {
        if (!this.isScoringStepRequired) {
            return true;
        }
        return this.scoringActivationIssues.length === 0;
    }

    /** Full activation gate — all wizard steps must pass validation. */
    get isActivationReady() {
        return this.isStep1Valid && this.isStep2Valid && this.isStep3Valid && this.isStep4Valid;
    }

    get isActivationDisabled() {
        return !this.isActivationReady;
    }

    get showSummaryActivationBlocker() {
        return this.isStep5 && !this.isActivationReady;
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
        if (this.currentStepKey === 'summary') {
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
        if (this.currentStep < this.maxWizardStep) {
            this.currentStep++;
            this._onStepChanged();
        }
    }

    handlePreviousStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this._onStepChanged();
        }
    }

    handleWizardStepFocus(event) {
        const index = parseInt(event.detail.index, 10);
        if (Number.isNaN(index)) {
            return;
        }
        const step = this.wizardStepData[index];
        if (!step) {
            return;
        }
        if (step.value !== this.currentStep) {
            this.currentStep = step.value;
            this._onStepChanged();
        }
    }

    handleWizardStepBlur(event) {
        const stepIndex = event.detail.index;
        // Optional: react when a step loses focus (see progress-step docs).
        if (stepIndex === undefined || stepIndex === null) {
            return;
        }
    }

    _onStepChanged() {
        this.maybeLoadOfferSummaries();
        if (this.currentStepKey === 'copy') {
            this.fetchCopyVariantsForStep3();
        }
        // Refresh Model Definitions when entering Scoring so dictionary edits are visible.
        if (this.currentStepKey === 'scoring') {
            this.loadScoringModels();
            if (this.scoringConfigurationMethod === 'apriori') {
                this.loadAprioriContextFromState();
            }
        }
    }

    get topicDropdownContainerClass() {
        return `custom-dropdown-container topic-dropdown-container ${this.isTopicDropdownOpen ? 'slds-is-open' : ''}`;
    }

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
        const ct = this.matchedCampaignType;
        return !!(ct && ct.Include_In_Emergency__c);
    }

    get hasActivationTypeOptions() {
        return (this._allCampaignTypes || []).length > 0;
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
            } else if (Number(tierNumber) === 1) {
                // Tier 1 is reserved for emergency One-Off campaigns only.
                isAllowed = false;
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
            const showLearnMore = !!description || hasDetails;

            let pickerClass = 'slds-visual-picker slds-visual-picker_vertical tier-picker-compact';
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
                detailsToggleTitle: isDetailsExpanded ? 'Show less tier detail' : 'Show tier detail',
                showLearnMore,
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

    get showExclusionsSection() {
        return this.showManualExclusionDefinitions || this.showOtherMarketingActivationsOption;
    }

    get showManualExclusionDefinitions() {
        const tier = this.selectedTierRecord;
        return !!(tier && tier.Excl_Manual_Suppressions__c);
    }

    get showOtherMarketingActivationsOption() {
        const tier = this.selectedTierRecord;
        return !!(tier && tier.Excl_Other_Marketing_Activations__c);
    }

    get activationOptions() {
        return (this._allCampaignTypes || []).map(ct => {
            const label = ct.Name || '';
            const value = ct.Name || '';
            const typeKey = value.toLowerCase().replace(/[^a-z0-9]/g, '') || 'type';
            const selected = this.parentActivationType === value;
            const icon = (ct.Campaign_Type_Icon__c || 'utility:campaign').trim();
            return {
                label,
                value,
                icon,
                btnClass: `slds-button activation-btn activation-btn--${typeKey}${selected ? ' activation-btn--selected' : ''}`,
                iconClass: `activation-btn-icon activation-btn-icon--${typeKey}`
            };
        });
    }

    get scoringModelOptions() {
        return (this._scoringModels || []).map(m => {
            const version = m.Version__c != null ? ` v${m.Version__c}` : '';
            const modelId = m.Model_Id__c ? ` (${m.Model_Id__c})` : '';
            const source = m.Scoring_Model_Source_System__c
                ? ` · ${m.Scoring_Model_Source_System__c}`
                : '';
            const inactive = m.Is_Active__c ? '' : ' · Inactive';
            return {
                label: `${m.Name}${version}${modelId}${source}${inactive}`,
                value: m.Id
            };
        });
    }

    get hasScoringModels() {
        return this.scoringModelOptions.length > 0;
    }

    get scoringModelEmptyMessage() {
        return this.scoringModelLoadError
            || 'No model definitions yet. Add them in Marketing Dictionary → Scoring → Model Definitions.';
    }

    get activateButtonLabel() {
        return 'Activate Campaign';
    }

    /** Campaign Name for persistence; draft save may auto-generate when empty. */
    _resolveCampaignBaseNameForSave() {
        const trimmed = (this.campaignName || '').trim();
        if (trimmed) {
            return trimmed;
        }
        return `Draft${Date.now()}`;
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

    // --- STEP 3: COPY ASSIGNMENT LOGIC ---

    _iconForChannelType(channelType) {
        return this.channelIconByType[channelType] || 'utility:connected_apps';
    }

    get copyChannelTabs() {
        return (this.activeCopyChannelTypes || []).map(type => {
            const enabled = this._isCopyChannelTypeEnabled(type);
            const isActive = this.activeCopyChannelValue === type;
            const selectedCount = this.copyVariantData.filter(
                v => v.channel === type && this.selectedCopyVariantIds.includes(v.id)
            ).length;
            return {
                label: type,
                value: type,
                enabled,
                isActiveTab: isActive,
                selectedCount: selectedCount > 0 ? selectedCount : null,
                rowClass: `copy-channel-sidebar-row${isActive ? ' slds-is-active' : ''}${enabled ? '' : ' copy-channel-sidebar-row_disabled'}`,
                linkClass: `slds-vertical-tabs__link copy-channel-tab-link${enabled ? '' : ' copy-channel-tab-link_disabled'}`,
                icon: this._iconForChannelType(type)
            };
        });
    }

    get isActiveCopyChannelEnabled() {
        return this._isCopyChannelTypeEnabled(this.activeCopyChannelValue);
    }

    get copyChannelDisabledHint() {
        return `Enable ${this.activeCopyChannelLabel} using the toggle to load published message variants.`;
    }

    get activeCopyChannelLabel() {
        return this.activeCopyChannelValue || '';
    }

    get activeChannelSelectedCopyCount() {
        return this.copyVariantData.filter(
            v => v.channel === this.activeCopyChannelValue && this.selectedCopyVariantIds.includes(v.id)
        ).length;
    }

    get activeChannelCopyVariants() {
        const channel = this.activeCopyChannelValue;
        if (!channel || !this._isCopyChannelTypeEnabled(channel)) {
            return [];
        }
        const channelVariants = this.copyVariantData.filter(v => v.channel === channel);
        const selectedInChannel = channelVariants.filter(v => this.selectedCopyVariantIds.includes(v.id));
        const selectedWeightSum = selectedInChannel.reduce(
            (sum, v) => sum + (v.weightNumeric ?? 0),
            0
        );
        const selectedCount = selectedInChannel.length;

        return channelVariants.map(v => {
            const selected = this.selectedCopyVariantIds.includes(v.id);
            const normalizedWeight = selected
                ? formatNormalizedWeightPercent(v.weightNumeric ?? 0, selectedWeightSum, selectedCount)
                : '—';
            return {
                ...v,
                selected,
                normalizedWeight,
                rowClass: selected ? 'slds-hint-parent offer-row-selected' : 'slds-hint-parent',
                toggleIcon: selected ? 'utility:check' : 'utility:add',
                toggleTitle: selected ? 'Remove variant' : 'Add variant',
                toggleAssistive: selected ? `Remove ${v.messageName}` : `Add ${v.messageName}`,
                statusClass: copyStatusBadgeClass(v.status)
            };
        });
    }

    handleCopyVariantPreview(event) {
        const variantId = event.currentTarget.dataset.id;
        if (!variantId) {
            return;
        }
        const variant = this.copyVariantData.find(v => v.id === variantId);
        const messageType = variant?.messageType || variant?.channel || '';
        const pageRef = {
            type: 'standard__navItemPage',
            attributes: { apiName: 'Copy_Cockpit_Editor' },
            state: {
                c__RecordID: variantId,
                c__MessageType: messageType
            }
        };
        this[NavigationMixin.GenerateUrl](pageRef)
            .then(url => {
                const opened = window.open(url, '_blank', 'noopener,noreferrer');
                if (!opened) {
                    this[NavigationMixin.Navigate](pageRef);
                }
            })
            .catch(() => {
                this[NavigationMixin.Navigate](pageRef);
            });
    }

    handleCopyChannelSelect(event) {
        const value = event.currentTarget.dataset.value;
        if (!value) return;
        this.activeCopyChannelValue = value;
    }

    handleCopyChannelEnableToggle(event) {
        event.stopPropagation();
        const type = event.currentTarget.dataset.value;
        if (!type) return;
        const enabled = event.target.checked;
        this.copyChannelEnabledByType = { ...this.copyChannelEnabledByType, [type]: enabled };
        this._syncChannelChecksFromCopyEnables();
        if (!enabled) {
            this.selectedCopyVariantIds = this.selectedCopyVariantIds.filter(id => {
                const variant = this.copyVariantData.find(v => v.id === id);
                return !variant || variant.channel !== type;
            });
        }
        if (enabled) {
            this.activeCopyChannelValue = type;
        }
        this.fetchCopyVariantsForStep3();
    }

    handleCopyVariantToggle(event) {
        const variantId = event.currentTarget.dataset.id;
        if (this.selectedCopyVariantIds.includes(variantId)) {
            this.selectedCopyVariantIds = this.selectedCopyVariantIds.filter(id => id !== variantId);
        } else {
            this.selectedCopyVariantIds = [...this.selectedCopyVariantIds, variantId];
        }
    }

    // Hook this into `_onStepChanged()` in your JS so it queries when Step 3 opens:
    _ensureActiveCopyChannel() {
        const catalog = this.activeCopyChannelTypes || [];
        if (!catalog.length) {
            this.activeCopyChannelValue = '';
            return;
        }
        if (!catalog.includes(this.activeCopyChannelValue)) {
            const firstEnabled = catalog.find(type => this._isCopyChannelTypeEnabled(type));
            this.activeCopyChannelValue = firstEnabled || catalog[0];
        }
    }

    fetchCopyVariantsForStep3() {
        this._ensureActiveCopyChannel();
        const channelTypes = this.selectedChannelTypes;
        const productFamilyNames = this.productFamilyOptions.filter(o => o.checked).map(o => o.name);
        const offerIds = this.selectedOfferIds || [];

        if (channelTypes.length === 0 || (productFamilyNames.length === 0 && offerIds.length === 0)) {
            this.copyVariantData = [];
            this.isLoadingCopy = false;
            return;
        }

        this.isLoadingCopy = true;
        getPublishedVariantsForWizard({ channelTypes, productFamilyNames, offerIds })
            .then(rows => {
                this.copyVariantData = (rows || []).map(row => {
                    const messageName = wizardMessageNameFromRow(row);
                    const variantNumber = wizardMessageVariantFromRow(row);
                    const messageType = wizardMessageTypeFromRow(row);
                    return {
                        id: row.Id,
                        channel: row.Channel_Type__c,
                        name: row.Name,
                        messageName,
                        messageType,
                        variantNumber,
                        weight: formatVariantWeight(
                            row.Display_Probability_Manual__c,
                            row.Display_Probability__c
                        ),
                        weightNumeric: variantWeightNumeric(
                            row.Display_Probability_Manual__c,
                            row.Display_Probability__c
                        ),
                        language: row.Language__c || '—',
                        status: row.Status__c
                    };
                });
                const validIds = new Set(this.copyVariantData.map(v => v.id));
                const pending = this.editSavedCopyVariantIds || [];
                const restored = pending.filter(id => validIds.has(id));
                const kept = this.selectedCopyVariantIds.filter(id => validIds.has(id));
                this.selectedCopyVariantIds = [...new Set([...restored, ...kept])];
                if (this.editSavedCopyVariantIds) {
                    this.editSavedCopyVariantIds = null;
                }
            })
            .catch(() => {
                this.copyVariantData = [];
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Channels & Copy',
                        message: 'Could not load published message variants.',
                        variant: 'error'
                    })
                );
            })
            .finally(() => {
                this.isLoadingCopy = false;
            });
    }

    get summaryCopyAssignment() {
        const channelTypes = this.selectedChannelTypes;
        if (!this.selectedCopyVariantIds.length) {
            return 'None selected';
        }
        const parts = channelTypes.map(type => {
            const count = this.copyVariantData.filter(
                v => v.channel === type && this.selectedCopyVariantIds.includes(v.id)
            ).length;
            return `${type}: ${count}`;
        });
        return parts.join('; ');
    }

    get summaryActiveFrom() {
        return this.formatSummaryDateTime(this.activeFrom);
    }

    get summaryActiveTo() {
        return this.formatSummaryDateTime(this.activeTo);
    }

    get summaryCampaignDuration() {
        if (!this.isAlwaysOnActivation) {
            return '—';
        }
        return this.campaignDurationDays || '—';
    }

    formatSummaryDateTime(value) {
        if (!value) {
            return '—';
        }
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) {
            return value;
        }
        return d.toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    handleSave() {
        this.isLoading = true;
        this.executeSubCampaignSave({ activate: false, closeOnSuccess: false });
    }

    handleSaveAndClose() {
        this.isLoading = true;
        this.executeSubCampaignSave({ activate: false, closeOnSuccess: true });
    }

    handleActivate() {
        if (!this.isActivationReady) return;
        this.isLoading = true;
        this.executeSubCampaignSave({ activate: true, closeOnSuccess: true });
    }

    executeSubCampaignSave({ activate = false, closeOnSuccess = true } = {}) {
        const fields = {};
        const num = (v) => v === '' || v === null || v === undefined ? null : Number(v);

        const baseName = this._resolveCampaignBaseNameForSave();
        fields['Name'] = `${this.activationPrefix}${this.toCamelCase(baseName)}`;
        fields['Type'] = 'Standard';
        // Org picklist uses Planned for draft campaigns (no separate Draft value).
        fields['Status'] = activate ? 'Active' : 'Planned';
        fields['IsActive'] = activate === true;
        fields['Campaign_Group_Dict__c'] = this.showCampaignGroup ? (this.selectedCampaignGroupId || null) : null;
        // Topic Id is SSOT; Topic_Name__c is a denormalized label for list views / legacy.
        this._resolveTopicSelection();
        fields['Topic_Dict__c'] = this.selectedTopicId || null;
        fields['Topic_Name__c'] = this.topicName || null;
        fields['Priority_Tier__c'] = this.selectedPriorityTier || null;
        fields['Activation_Type__c'] = this.parentActivationType || null;
        fields['Active_From__c'] = this.activeFrom || null;
        fields['Active_To__c'] = this.activeTo || null;
        fields['Duration_Days__c'] = this.isAlwaysOnActivation
            ? num(this.campaignDurationDays)
            : null;
        this._applyExclusionsToSaveFields(fields);
        fields['Offering_Type__c'] = this.selectedOfferingType || null;
        if (this.isScoringStepRequired) {
            if (this.scoringConfigurationMethod === 'apriori') {
                fields['Scoring_Method__c'] = 'A-priori';
                fields['Overall_Score__c'] = num(this.aprioriScore);
                fields['Fallback_Score__c'] = null;
                fields['Scoring_Model_Dict__c'] = null;
            } else {
                fields['Scoring_Method__c'] = 'Pick a Model';
                fields['Overall_Score__c'] = null;
                fields['Fallback_Score__c'] = null;
                fields['Scoring_Model_Dict__c'] = this.selectedScoringModelId || null;
            }
        } else {
            fields['Scoring_Method__c'] = null;
            fields['Overall_Score__c'] = null;
            fields['Fallback_Score__c'] = null;
            fields['Scoring_Model_Dict__c'] = null;
        }

        fields['Assigned_Channels__c'] = this.channels
            .filter(c => c.checked && !c.disabled)
            .map(c => c.label)
            .join('; ');

        if (this.isOfferingProductFamily) {
            const selected = this.productFamilyOptions.filter(o => o.checked);
            // Ids in background; Names on the record page / list views.
            fields['Product_Family_Ids__c'] = selected.map(o => o.value).join('; ') || null;
            fields['Product_Family__c'] = selected.map(o => o.name).join('; ') || null;
            fields['Family_of_Needs_Ids__c'] = null;
            fields['Family_of_Needs__c'] = null;
        } else if (this.isOfferingFamilyOfNeeds) {
            const selected = this.familyOfNeedsOptions.filter(o => o.checked);
            fields['Family_of_Needs_Ids__c'] = selected.map(o => o.value).join('; ') || null;
            fields['Family_of_Needs__c'] = selected.map(o => o.name).join('; ') || null;
            fields['Product_Family_Ids__c'] = null;
            fields['Product_Family__c'] = null;
        }

        const successMessage = activate
            ? 'Campaign activated successfully.'
            : (closeOnSuccess ? 'Campaign saved as draft.' : 'Progress saved. You can continue in the wizard.');

        const finishSuccess = (campId) => {
            this.isLoading = false;
            this.dispatchEvent(new ShowToastEvent({ title: 'Success!', message: successMessage, variant: 'success' }));
            if (closeOnSuccess || activate) {
                this.navigateToRecord(campId);
            } else {
                this.recordId = campId;
                this.isEditMode = true;
            }
        };

        if (this.isEditMode) {
            fields['Id'] = this.recordId;
            const recordInput = { fields };
            updateRecord(recordInput)
                .then(() => this.persistCampaignOffers(this.recordId))
                .then(() => this.persistCampaignCopyVariants(this.recordId))
                .then(() => this.persistAprioriScoresIfNeeded(this.recordId))
                .then(() => finishSuccess(this.recordId))
                .catch(err => {
                    this.isLoading = false;
                    this.showErrorToast(err);
                });
        } else {
            createRecord({ apiName: 'Campaign', fields })
                .then(camp => this.persistCampaignOffers(camp.id)
                    .then(() => this.persistCampaignCopyVariants(camp.id))
                    .then(() => this.persistAprioriScoresIfNeeded(camp.id))
                    .then(() => camp.id))
                .then(campId => finishSuccess(campId))
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

    persistCampaignCopyVariants(campaignId) {
        return saveCampaignCopyVariants({
            campaignId,
            messageVariantIds: this.selectedCopyVariantIds || []
        });
    }

    persistAprioriScoresIfNeeded(campaignId) {
        if (!this.isScoringStepRequired || this.scoringConfigurationMethod !== 'apriori') {
            return Promise.resolve();
        }
        if (!this.aprioriContextReady || this.aprioriHasMixedSharedScores) {
            return Promise.resolve();
        }
        if (!this.isValidScoreValue(this.aprioriScore)) {
            return Promise.resolve();
        }
        const campaignName = `${this.activationPrefix}${this.toCamelCase(this._resolveCampaignBaseNameForSave())}`;
        return publishAprioriScores({
            topicId: this.selectedTopicId,
            productFamilyIds: this.aprioriProductFamilyIds,
            score: this.aprioriScore,
            campaignId,
            campaignName
        });
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