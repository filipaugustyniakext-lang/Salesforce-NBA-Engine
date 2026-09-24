import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getCampaignRecords from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignRecords';
import saveCampaignRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignRecord';
import saveCampaignRecordsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignRecordsBulk';
import saveScoringModel from '@salesforce/apex/MarketingDictionaryManagerController.saveScoringModel';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import getCampaignTiers from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignTiers';
import saveCampaignTier from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignTier';
import deleteCampaignTier from '@salesforce/apex/MarketingDictionaryManagerController.deleteCampaignTier';
import getProductFamilyDependencies from '@salesforce/apex/MarketingDictionaryController.getProductFamilyDependencies';
import getProductFamilyByRecordType from '@salesforce/apex/MarketingDictionaryController.getProductFamilyByRecordType';
import getProductFamilyCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getProductFamilyCustomerTypes';
import getFamilyOfNeedsCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getFamilyOfNeedsCustomerTypes';
import getProductOfferingCatalogue from '@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue';
import getData360DmoOptions from '@salesforce/apex/MarketingDictionaryManagerController.getData360DmoOptions';
import healCampaignOfferingLabels from '@salesforce/apex/MarketingDictionaryController.healCampaignOfferingLabels';
import {
    TIER_ATTR_FIELDS,
    TIER_EXCL_FIELDS,
    buildTierAttrRows,
    buildTierExclusionChips,
    buildTierTypeChips
} from 'c/nbaTierConfig';

const EMPTY_CAMPAIGN_TYPE    = () => ({ Name: '', Dictionary_Sub_Type__c: 'Campaign Type', Include_In_Emergency__c: false, Define_Campaign_Groups__c: false });
const EMPTY_CAMPAIGN_GROUP   = () => ({ Name: '', Dictionary_Sub_Type__c: 'Campaign Group', Campaign_Type_Dict__c: null });
const EMPTY_TOPIC_GROUP      = () => ({ Name: '', Dictionary_Sub_Type__c: 'Topic Group' });
const EMPTY_TOPIC            = () => ({ Name: '', Dictionary_Sub_Type__c: 'Topic', Topic_Group_Dict__c: null, Topic_Description__c: '' });
const EMPTY_PATH             = () => ({ Name: '', Dictionary_Sub_Type__c: 'Activation Path', Is_Active__c: true, Distribution_Percent__c: 0 });
const EMPTY_SALES_PROCESS    = () => ({ Name: '', Dictionary_Sub_Type__c: 'Sales Process Type', Topic_Description__c: '' });
const EMPTY_MODEL_GROUP      = () => ({ Name: '', Dictionary_Sub_Type__c: 'Scoring Model Group' });
const EMPTY_TIER             = () => ({
    Tier_Number__c: null, Description__c: '', Supported_Campaign_Types__c: '',
    Override_Random_Activation_Path__c: '', Honor_Marketing_Consents__c: '',
    Includes_Control_Group__c: '', Honors_Channel_Cooldowns__c: '',
    Honors_Product_Eligibility__c: '', Allows_Random_Copy_Assignment__c: '',
    Excl_Manual_Suppressions__c: false
});
const EMPTY_SCORING = () => ({
    Name: '',
    Dictionary_Sub_Type__c: 'Scoring Model',
    Version__c: 1,
    Model_Id__c: '',
    Topic_Description__c: '',
    Scoring_Model_Group_Dict__c: null,
    Assigned_Topic_Dict__c: null,
    Scoring_Model_Source_System__c: '',
    Data360_DMO__c: '',
    Offering_Type__c: 'Product Family',
    Product_Family__c: '',
    Family_of_Needs__c: '',
    Model_Expiration_Date__c: null,
    Is_Active__c: false
});

const OFFERING_TYPES = [
    { label: 'Product Family', value: 'Product Family' },
    { label: 'Family of Needs', value: 'Family of Needs' }
];

const SCORING_SOURCE_SYSTEMS = [
    { label: 'GCP', value: 'GCP' },
    { label: 'Salesforce (Einstein)', value: 'Salesforce (Einstein)' }
];

export default class MarketingDictionaryCampaignTab extends LightningElement {

    @track isLoading = true;
    @track isSaving = false;

    @track isCampaignTypeModalOpen = false;
    @track isCampaignGroupModalOpen = false;
    @track isScoringModalOpen = false;
    @track isModelGroupModalOpen = false;
    @track isTierModalOpen = false;
    @track isTopicGroupModalOpen = false;
    @track isTopicModalOpen = false;
    @track isPathModalOpen = false;
    @track isSalesProcessTypeModalOpen = false;
    @track isDeleteModalOpen = false;

    @track editCampaignType = EMPTY_CAMPAIGN_TYPE();
    @track editCampaignGroup = EMPTY_CAMPAIGN_GROUP();
    @track editScoring = EMPTY_SCORING();
    @track editModelGroup = EMPTY_MODEL_GROUP();
    @track editTier = EMPTY_TIER();
    @track editTopicGroup = EMPTY_TOPIC_GROUP();
    @track editTopic = EMPTY_TOPIC();
    @track editPath = EMPTY_PATH();
    @track editSalesProcessType = EMPTY_SALES_PROCESS();

    @track scoringAsNewMaster = true;
    @track scoringNameLocked = false;
    @track data360DmoOptions = [];

    @track productFamilyOptions = [];
    @track familyOfNeedsOptions = [];
    @track groupedProductFamilyOptions = [];
    @track selectAllProductFamilies = false;
    @track selectAllFamilyOfNeeds = false;
    @track pfFilterCustomerTypes = [];
    @track pfFilterRecordTypes = [];
    @track fonFilterCustomerTypes = [];

    rawProductFamilies = []; // [{ Id, Name, ... }]
    rawFamilyOfNeeds = [];
    productFamilyById = {};
    familyOfNeedsById = {};
    productFamilyToFoN = {};
    fonToProductFamilies = {};
    productFamilyByRecordType = {};
    productFamilyCustomerTypes = {};
    fonCustomerTypes = {};

    @track topicSearch = '';
    @track scoringSearch = '';
    @track activeSubTab = 'campaignTypes';
    @track _localPaths = [];

    /** Scoring Models table: expand / sort / multi-select */
    @track expandedScoringMasters = {};
    @track selectedScoringIds = [];
    @track scoringSortField = 'Name';
    @track scoringSortDir = 'asc';

    deleteTargetName = '';
    _deleteId = null;
    _deleteType = null;
    _deleteIds = null; // bulk scoring delete


    _wiredCampaignResult;
    _wiredTiersResult;
    _allRecords = [];
    _allTiers = [];

    connectedCallback() {
        this._loadOfferingOptions();
        this._loadData360DmoOptions();
        // One-shot: migrate Campaign display fields that still show dictionary Ids → Names.
        healCampaignOfferingLabels().catch(() => {});
    }

    handleSubTabClick(e) {
        this.activeSubTab = e.currentTarget.dataset.tab;
        if (this.activeSubTab === 'scorings') {
            // Refresh catalogue so Product Family / FoN renames show immediately.
            this._loadOfferingOptions();
            this._loadData360DmoOptions();
        }
    }

    _loadOfferingOptions() {
        Promise.all([
            getProductOfferingCatalogue().catch(() => []),
            getProductFamilyDependencies().catch(() => ({})),
            getProductFamilyByRecordType().catch(() => ({})),
            getProductFamilyCustomerTypes().catch(() => ({})),
            getFamilyOfNeedsCustomerTypes().catch(() => ({}))
        ]).then(([catalogue, deps, byRt, pfCts, fonCts]) => {
            const rows = catalogue || [];
            this.rawProductFamilies = rows.filter(r => r.Dictionary_Sub_Type__c === 'Product Family');
            this.rawFamilyOfNeeds = rows.filter(r => r.Dictionary_Sub_Type__c === 'Family of Needs');

            this.productFamilyById = {};
            this.rawProductFamilies.forEach(r => { this.productFamilyById[r.Id] = r; });
            this.familyOfNeedsById = {};
            this.rawFamilyOfNeeds.forEach(r => { this.familyOfNeedsById[r.Id] = r; });

            this.productFamilyToFoN = deps || {};
            this.productFamilyByRecordType = byRt || {};
            this.productFamilyCustomerTypes = pfCts || {};
            this.fonCustomerTypes = fonCts || {};

            const inverseMap = {};
            for (const [family, related] of Object.entries(this.productFamilyToFoN)) {
                (related || []).forEach(fon => {
                    if (!inverseMap[fon]) inverseMap[fon] = [];
                    if (!inverseMap[fon].includes(family)) inverseMap[fon].push(family);
                });
            }
            this.fonToProductFamilies = inverseMap;
            this._rebuildOfferingOptionLists();
        });
    }

    _loadData360DmoOptions() {
        getData360DmoOptions()
            .then(rows => {
                const opts = (rows || []).map(r => ({
                    label: r.label,
                    value: r.value
                }));
                // Keep a currently saved value selectable even if not in catalogue.
                const current = this.editScoring?.Data360_DMO__c;
                if (current && !opts.some(o => o.value === current)) {
                    opts.unshift({ label: current, value: current });
                }
                this.data360DmoOptions = opts;
            })
            .catch(() => { this.data360DmoOptions = []; });
    }

    _idSafe(prefix, value) {
        return `${prefix}-${String(value).replace(/[^a-zA-Z0-9]/g, '-')}`;
    }

    _isSalesforceId(token) {
        return typeof token === 'string' && (token.length === 15 || token.length === 18)
            && /^[a-zA-Z0-9]+$/.test(token);
    }

    /** Resolve stored tokens (Ids preferred, legacy Names supported) to option Ids. */
    _resolveStoredOfferingTokens(raw, byId, byName) {
        const selected = new Set();
        this._parseSemiList(raw).forEach(token => {
            if (this._isSalesforceId(token) && byId[token]) {
                selected.add(token);
            } else if (byName[token]) {
                selected.add(byName[token].Id || byName[token].value);
            }
        });
        return selected;
    }

    _rebuildOfferingOptionLists() {
        const pfByName = {};
        this.rawProductFamilies.forEach(r => { pfByName[r.Name] = r; });
        const fonByName = {};
        this.rawFamilyOfNeeds.forEach(r => { fonByName[r.Name] = r; });

        const checkedPf = this._resolveStoredOfferingTokens(
            this.editScoring?.Product_Family__c,
            this.productFamilyById,
            pfByName
        );
        const checkedFon = this._resolveStoredOfferingTokens(
            this.editScoring?.Family_of_Needs__c,
            this.familyOfNeedsById,
            fonByName
        );

        this.productFamilyOptions = this.rawProductFamilies.map(rec => {
            const name = rec.Name;
            return {
                label: name,
                value: rec.Id, // Id SSOT
                name,
                checked: checkedPf.has(rec.Id),
                inputId: this._idSafe('scoring-pf', rec.Id),
                fons: this.productFamilyToFoN[name] || (
                    rec.Related_Family_of_Needs__r?.Name ? [rec.Related_Family_of_Needs__r.Name] : []
                ),
                customerTypes: this.productFamilyCustomerTypes[name] || []
            };
        });
        this.selectAllProductFamilies = this.productFamilyOptions.length > 0
            && this.productFamilyOptions.every(o => o.checked);

        this.familyOfNeedsOptions = this.rawFamilyOfNeeds.map(rec => {
            const name = rec.Name;
            return {
                label: name,
                value: rec.Id,
                name,
                checked: checkedFon.has(rec.Id),
                inputId: this._idSafe('scoring-fon', rec.Id),
                families: this.fonToProductFamilies[name] || [],
                customerTypes: this.fonCustomerTypes[name] || []
            };
        });
        this.selectAllFamilyOfNeeds = this.familyOfNeedsOptions.length > 0
            && this.familyOfNeedsOptions.every(o => o.checked);

        this._buildGroupedProductFamilies();
    }

    _buildGroupedProductFamilies() {
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

    get isTab() {
        return {
            campaignTypes: this.activeSubTab === 'campaignTypes',
            scorings: this.activeSubTab === 'scorings',
            tiers: this.activeSubTab === 'tiers',
            topics: this.activeSubTab === 'topics',
            activationPaths: this.activeSubTab === 'activationPaths',
            salesProcessTypes: this.activeSubTab === 'salesProcessTypes',
        };
    }

    get vtabClass() {
        const base = 'vtab-item';
        const active = `${base} vtab-item_active`;
        return {
            campaignTypes: this.activeSubTab === 'campaignTypes' ? active : base,
            scorings: this.activeSubTab === 'scorings' ? active : base,
            tiers: this.activeSubTab === 'tiers' ? active : base,
            topics: this.activeSubTab === 'topics' ? active : base,
            activationPaths: this.activeSubTab === 'activationPaths' ? active : base,
            salesProcessTypes: this.activeSubTab === 'salesProcessTypes' ? active : base,
        };
    }

    get vtabSelected() {
        return {
            campaignTypes: this.activeSubTab === 'campaignTypes',
            scorings: this.activeSubTab === 'scorings',
            tiers: this.activeSubTab === 'tiers',
            topics: this.activeSubTab === 'topics',
            activationPaths: this.activeSubTab === 'activationPaths',
            salesProcessTypes: this.activeSubTab === 'salesProcessTypes',
        };
    }

    @wire(getCampaignRecords)
    wiredCampaign(result) {
        this._wiredCampaignResult = result;
        this.isLoading = false;
        if (result.data) {
            this._allRecords = result.data;
            this._syncLocalPaths();
        } else if (result.error) {
            this._showToast('Error', 'Failed to load campaign records.', 'error');
        }
    }

    @wire(getCampaignTiers)
    wiredTiers(result) {
        this._wiredTiersResult = result;
        if (result.data) { this._allTiers = result.data; }
        else if (result.error) { this._showToast('Error', 'Failed to load tiers.', 'error'); }
    }

    _syncLocalPaths() {
        const serverPaths = this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Activation Path');
        this._localPaths = serverPaths.map(p => ({ ...p }));
    }

    get campaignTypes() {
        const groups = this.allCampaignGroups;
        return this._allRecords
            .filter(r => r.Dictionary_Sub_Type__c === 'Campaign Type')
            .map(ct => {
                const own = groups.filter(g => g.Campaign_Type_Dict__c === ct.Id);
                return {
                    ...ct,
                    definesGroups: !!ct.Define_Campaign_Groups__c,
                    groups: own,
                    hasGroups: own.length > 0
                };
            });
    }
    get hasCampaignTypes() { return this.campaignTypes.length > 0; }
    get campaignTypeCount() { return this.campaignTypes.length; }
    get campaignTypeModalTitle() { return this.editCampaignType.Id ? 'Edit Campaign Type' : 'Add Campaign Type'; }

    get allCampaignGroups() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Campaign Group'); }

    get campaignTypeOptions() {
        return this.campaignTypes.map(ct => ({ label: ct.Name, value: ct.Id }));
    }
    get campaignGroupModalTitle() { return this.editCampaignGroup.Id ? 'Edit Campaign Group' : 'Add Campaign Group'; }
    get campaignGroupParentName() {
        const typeId = this.editCampaignGroup?.Campaign_Type_Dict__c;
        if (!typeId) return '';
        const ct = this._allRecords.find(r => r.Id === typeId);
        return ct?.Name || '';
    }
    get isCampaignGroupTypeLocked() {
        // Type is set from the Campaign Type row — do not re-pick in the modal.
        return !!this.editCampaignGroup?.Campaign_Type_Dict__c;
    }

    get scoringModelGroups() {
        return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Scoring Model Group');
    }
    get hasScoringModelGroups() { return this.scoringModelGroups.length > 0; }
    get scoringModelGroupOptions() {
        return this.scoringModelGroups.map(g => ({ label: g.Name, value: g.Id }));
    }
    get modelGroupModalTitle() {
        return this.editModelGroup.Id ? 'Edit Model Group' : 'Add Model Group';
    }

    get allScorings() {
        return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Scoring Model');
    }
    get scoringsCount() { return this.allScorings.length; }
    get hasScorings() { return this.scoringMasterRows.length > 0; }

    /** Flat filtered version rows (search only). */
    get _filteredScoringVersions() {
        const q = (this.scoringSearch || '').toLowerCase();
        const rows = this.allScorings.map(r => this._formatScoringRow(r));
        if (!q) return rows;
        return rows.filter(r =>
            (r.Name || '').toLowerCase().includes(q) ||
            (r.Model_Id__c || '').toLowerCase().includes(q) ||
            (r.groupName || '').toLowerCase().includes(q) ||
            (r.topicName || '').toLowerCase().includes(q) ||
            (r.Topic_Description__c || '').toLowerCase().includes(q)
        );
    }

    /**
     * Master rows (one per model Name) with nested version children.
     * Collapsed by default; entire master row toggles expansion.
     */
    get scoringMasterRows() {
        const byName = {};
        for (const row of this._filteredScoringVersions) {
            const key = row.Name || '(unnamed)';
            if (!byName[key]) byName[key] = [];
            byName[key].push(row);
        }

        const masters = Object.keys(byName).map(name => {
            const versions = [...byName[name]].sort((a, b) =>
                (Number(b.Version__c) || 0) - (Number(a.Version__c) || 0)
            );
            const latest = versions[0] || {};
            const versionIds = versions.map(v => v.Id);
            const selectedCount = versionIds.filter(id => this.selectedScoringIds.includes(id)).length;
            const allSelected = versionIds.length > 0 && selectedCount === versionIds.length;
            const someSelected = selectedCount > 0 && !allSelected;
            const isExpanded = !!this.expandedScoringMasters[name];

                    const childRows = versions.map(v => ({
                ...v,
                statusLabel: v.Is_Active__c ? 'Active' : 'Inactive',
                statusBadgeClass: v.Is_Active__c ? 'slds-badge cd-badge-active' : 'slds-badge slds-badge_lightest',
                isSelected: this.selectedScoringIds.includes(v.Id),
                rowClass: this.selectedScoringIds.includes(v.Id)
                    ? 'slds-hint-parent scoring-child-row scoring-row-selected'
                    : 'slds-hint-parent scoring-child-row'
            }));

            const activeCount = versions.filter(v => v.Is_Active__c).length;
            let statusLabel = 'Inactive';
            let statusBadgeClass = 'slds-badge slds-badge_lightest';
            if (activeCount === versions.length) {
                statusLabel = 'Active';
                statusBadgeClass = 'slds-badge cd-badge-active';
            } else if (activeCount > 0) {
                statusLabel = `${activeCount} active`;
                statusBadgeClass = 'slds-badge cd-badge-dpc';
            }

            return {
                key: name,
                name,
                versionCount: versions.length,
                versionCountLabel: `${versions.length} version${versions.length !== 1 ? 's' : ''}`,
                groupName: latest.groupName || '—',
                topicName: latest.topicName || '—',
                offeringLabel: latest.offeringLabel || '—',
                offeringValuesShort: latest.offeringValuesShort || '—',
                statusLabel,
                statusBadgeClass,
                latestId: latest.Id,
                sortName: name,
                sortVersions: versions.length,
                sortGroup: latest.groupName || '',
                sortTopic: latest.topicName || '',
                sortOffering: `${latest.offeringLabel || ''} ${latest.offeringValuesShort || ''}`,
                sortExpires: latest.Model_Expiration_Date__c || '',
                sortStatus: activeCount,
                isExpanded,
                chevronIcon: isExpanded ? 'utility:chevrondown' : 'utility:chevronright',
                isSelected: allSelected,
                isIndeterminate: someSelected,
                checkboxTitle: allSelected
                    ? 'Deselect all versions'
                    : 'Select all versions',
                rowClass: [
                    'slds-hint-parent scoring-master-row',
                    isExpanded ? 'scoring-master-row_expanded' : '',
                    allSelected || someSelected ? 'scoring-row-selected' : ''
                ].filter(Boolean).join(' '),
                versions: childRows
            };
        });

        return this._sortScoringMasters(masters);
    }

    /** Flattened master + expanded child rows for a single for:each (LWC root constraint). */
    get scoringTableRows() {
        const rows = [];
        for (const master of this.scoringMasterRows) {
            rows.push({
                ...master,
                rowKey: `master-${master.key}`,
                rowType: 'master',
                isMaster: true,
                isChild: false,
                ariaExpanded: master.isExpanded ? 'true' : 'false'
            });
            if (master.isExpanded) {
                for (const v of master.versions) {
                    rows.push({
                        ...v,
                        rowKey: `child-${v.Id}`,
                        rowType: 'child',
                        isMaster: false,
                        isChild: true,
                        masterName: master.name,
                        name: master.name,
                        ariaExpanded: null
                    });
                }
            }
        }
        return rows;
    }

    get scoringSortHeaders() {
        const cols = [
            { field: 'Name', label: 'Model Name', sortable: true, widthClass: 'scoring-col-name' },
            { field: 'Versions', label: 'Versions', sortable: true, widthClass: 'scoring-col-versions' },
            { field: 'ModelId', label: 'Model ID', sortable: false, widthClass: 'scoring-col-modelid' },
            { field: 'Group', label: 'Group', sortable: true, widthClass: 'scoring-col-group' },
            { field: 'Topic', label: 'Topic', sortable: true, widthClass: 'scoring-col-topic' },
            { field: 'Offering', label: 'Offering', sortable: true, widthClass: 'scoring-col-offering' },
            { field: 'Expires', label: 'Expires', sortable: true, widthClass: 'scoring-col-expires' },
            { field: 'Status', label: 'Status', sortable: true, widthClass: 'scoring-col-status' }
        ];
        return cols.map(c => {
            const active = this.scoringSortField === c.field;
            return {
                ...c,
                thClass: [
                    c.widthClass,
                    c.sortable ? 'scoring-th-sortable' : ''
                ].filter(Boolean).join(' '),
                ariaSort: !c.sortable ? 'none' : (active
                    ? (this.scoringSortDir === 'asc' ? 'ascending' : 'descending')
                    : 'none'),
                showSortIcon: c.sortable && active,
                sortIcon: this.scoringSortDir === 'asc' ? 'utility:arrowup' : 'utility:arrowdown'
            };
        });
    }

    get scoringSelectedCount() {
        return this.selectedScoringIds.length;
    }

    get hasScoringSelection() {
        return this.selectedScoringIds.length > 0;
    }

    get isAllVisibleScoringsSelected() {
        const ids = this._visibleScoringVersionIds();
        return ids.length > 0 && ids.every(id => this.selectedScoringIds.includes(id));
    }

    get isSomeVisibleScoringsSelected() {
        const ids = this._visibleScoringVersionIds();
        const n = ids.filter(id => this.selectedScoringIds.includes(id)).length;
        return n > 0 && n < ids.length;
    }

    get scoringSelectAllTitle() {
        return this.isAllVisibleScoringsSelected
            ? 'Deselect all versions'
            : 'Select all versions';
    }

    /** @deprecated Prefer scoringMasterRows — kept for any residual callers */
    get filteredScorings() {
        return this._filteredScoringVersions;
    }

    get scoringMasterCount() {
        return new Set(this.allScorings.map(r => r.Name)).size;
    }

    get scoringCountLabel() {
        const masters = this.scoringMasterRows.length;
        const versions = this._filteredScoringVersions.length;
        const totalVersions = this.scoringsCount;
        const totalMasters = this.scoringMasterCount;
        if (versions === totalVersions) {
            return `${totalMasters} model${totalMasters !== 1 ? 's' : ''} · ${totalVersions} version${totalVersions !== 1 ? 's' : ''}`;
        }
        return `Showing ${masters} model${masters !== 1 ? 's' : ''} · ${versions} version${versions !== 1 ? 's' : ''}`;
    }

    _visibleScoringVersionIds() {
        return this.scoringMasterRows.flatMap(m => m.versions.map(v => v.Id));
    }

    _sortScoringMasters(masters) {
        const field = this.scoringSortField || 'Name';
        const dir = this.scoringSortDir === 'desc' ? -1 : 1;
        const keyFn = {
            Name: m => m.sortName,
            Versions: m => m.sortVersions,
            Group: m => m.sortGroup,
            Topic: m => m.sortTopic,
            Offering: m => m.sortOffering,
            Expires: m => m.sortExpires,
            Status: m => m.sortStatus
        }[field] || (m => m.sortName);

        return [...masters].sort((a, b) => {
            const av = keyFn(a);
            const bv = keyFn(b);
            if (typeof av === 'number' && typeof bv === 'number') {
                return (av - bv) * dir;
            }
            return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
        });
    }

    get scoringModelModalTitle() {
        if (this.editScoring.Id) return `Edit Scoring Model — ${this.editScoring.Name} v${this.editScoring.Version__c}`;
        if (this.scoringAsNewMaster) return 'Add Scoring Model Definition';
        return `New Version — ${this.editScoring.Name}`;
    }

    get isScoringNameReadOnly() {
        return this.scoringNameLocked || !!this.editScoring.Id;
    }

    get computedModelIdPreview() {
        const name = (this.editScoring.Name || '').trim();
        const ver = this.editScoring.Version__c != null ? this.editScoring.Version__c : '';
        if (!name || ver === '') return '—';
        return `${name}_${ver}`;
    }

    get offeringTypeOptions() {
        return OFFERING_TYPES.map(o => ({
            ...o,
            uniqueId: `scoring-offering-${o.value.replace(/\s+/g, '-')}`,
            isChecked: this.editScoring.Offering_Type__c === o.value
        }));
    }

    get scoringSourceSystemOptions() {
        return SCORING_SOURCE_SYSTEMS;
    }

    get hasData360DmoCatalogue() {
        return this.data360DmoOptions.length > 0;
    }

    get isScoringOfferingProductFamily() {
        return this.editScoring.Offering_Type__c === 'Product Family';
    }
    get isScoringOfferingFamilyOfNeeds() {
        return this.editScoring.Offering_Type__c === 'Family of Needs';
    }

    get customerTypeFilterOptions() {
        const types = new Set();
        Object.values(this.productFamilyCustomerTypes || {}).forEach(arr => (arr || []).forEach(ct => types.add(ct)));
        return [...types].sort().map(ct => ({
            label: ct,
            value: ct,
            className: `pf-filter-pill ${this.pfFilterCustomerTypes.includes(ct) ? 'pf-filter-pill-active' : ''}`
        }));
    }

    get recordTypeFilterBadgeOptions() {
        return Object.keys(this.productFamilyByRecordType || {}).sort().map(rt => ({
            label: rt,
            value: rt,
            className: `pf-filter-pill ${this.pfFilterRecordTypes.includes(rt) ? 'pf-filter-pill-active' : ''}`
        }));
    }

    get fonCustomerTypeFilterOptions() {
        const types = new Set();
        Object.values(this.fonCustomerTypes || {}).forEach(arr => (arr || []).forEach(ct => types.add(ct)));
        return [...types].sort().map(ct => ({
            label: ct,
            value: ct,
            className: `pf-filter-pill ${this.fonFilterCustomerTypes.includes(ct) ? 'pf-filter-pill-active' : ''}`
        }));
    }

    get filteredGroupedProductFamilyOptions() {
        if (!this.pfFilterCustomerTypes.length && !this.pfFilterRecordTypes.length) {
            return this.groupedProductFamilyOptions;
        }
        const result = [];
        for (const group of this.groupedProductFamilyOptions) {
            if (this.pfFilterRecordTypes.length && !this.pfFilterRecordTypes.includes(group.recordType)) {
                continue;
            }
            const items = group.items.filter(pf => {
                if (!this.pfFilterCustomerTypes.length) return true;
                const types = this.productFamilyCustomerTypes[pf.name] || [];
                return this.pfFilterCustomerTypes.some(ct => types.includes(ct));
            });
            if (items.length) {
                result.push({ recordType: group.recordType, items });
            }
        }
        return result;
    }

    get filteredFamilyOfNeedsOptions() {
        if (!this.fonFilterCustomerTypes.length) return this.familyOfNeedsOptions;
        return this.familyOfNeedsOptions.filter(fon => {
            const types = this.fonCustomerTypes[fon.name] || [];
            return this.fonFilterCustomerTypes.some(ct => types.includes(ct));
        });
    }

    get scoringCreatedByLine() {
        const name = this.editScoring.CreatedBy?.Name
            || this.editScoring.CreatedByName
            || '—';
        const when = this._formatDateTime(this.editScoring.CreatedDate);
        return `${name}, ${when}`;
    }

    get scoringLastModifiedByLine() {
        const name = this.editScoring.LastModifiedBy?.Name
            || this.editScoring.LastModifiedByName
            || this.editScoring.CreatedBy?.Name
            || this.editScoring.CreatedByName
            || '—';
        const when = this._formatDateTime(
            this.editScoring.LastModifiedDate || this.editScoring.CreatedDate
        );
        return `${name}, ${when}`;
    }

    get showScoringAuditFields() {
        return !!this.editScoring.Id;
    }

    get scoringStatusLabel() {
        return this.editScoring.Is_Active__c ? 'Active' : 'Inactive';
    }

    get scoringStatusBadgeClass() {
        return this.editScoring.Is_Active__c
            ? 'slds-badge cd-badge-active'
            : 'slds-badge slds-badge_lightest';
    }

    get scoringActivationHint() {
        if (this.editScoring.Is_Active__c) return '';
        const missing = this._scoringActivationMissingFields();
        if (!missing.length) {
            return 'All required fields are complete. Toggle Active to publish this model.';
        }
        return `Draft — complete to activate: ${missing.join(', ')}`;
    }

    get canActivateScoring() {
        return this._scoringActivationMissingFields().length === 0;
    }

    get scoringSaveButtonLabel() {
        return this.editScoring.Is_Active__c ? 'Save & Activate' : 'Save Draft';
    }

    /** Fields required before a model may be set Active. */
    _scoringActivationMissingFields() {
        const missing = [];
        const s = this.editScoring || {};
        if (!(s.Name || '').trim()) missing.push('Model Name');
        if (s.Version__c == null || s.Version__c === '') missing.push('Model Version');
        if (!this.computedModelIdPreview || this.computedModelIdPreview === '—') missing.push('Model ID');
        if (!s.Scoring_Model_Group_Dict__c) missing.push('Model Group');
        if (!s.Assigned_Topic_Dict__c) missing.push('Topic');
        if (!s.Scoring_Model_Source_System__c) missing.push('Model Source System');
        if (!(s.Data360_DMO__c || '').trim()) missing.push('Data360 DMO');
        if (!s.Offering_Type__c) {
            missing.push('Offering Type');
        } else if (s.Offering_Type__c === 'Product Family'
            && !this._parseSemiList(s.Product_Family__c).length) {
            missing.push('Product Family selection');
        } else if (s.Offering_Type__c === 'Family of Needs'
            && !this._parseSemiList(s.Family_of_Needs__c).length) {
            missing.push('Family of Needs selection');
        }
        return missing;
    }

    _formatScoringRow(r) {
        const offeringValues = r.Offering_Type__c === 'Product Family'
            ? (r.Product_Family__c || '')
            : (r.Family_of_Needs__c || '');
        const byId = r.Offering_Type__c === 'Product Family'
            ? this.productFamilyById
            : this.familyOfNeedsById;
        return {
            ...r,
            groupName: r.Scoring_Model_Group_Dict__r?.Name || '—',
            topicName: r.Assigned_Topic_Dict__r?.Name || '—',
            offeringLabel: r.Offering_Type__c || '—',
            offeringValuesShort: this._formatOfferingLabels(offeringValues, byId),
            createdDisplay: this._formatDateTime(r.CreatedDate),
            modifiedDisplay: this._formatDateTime(r.LastModifiedDate),
            createdByName: r.CreatedBy?.Name || '—',
            expirationDisplay: r.Model_Expiration_Date__c || '—',
            activeLabel: r.Is_Active__c ? 'Active' : 'Inactive'
        };
    }

    /** Resolve stored Ids (or legacy Names) to current dictionary labels. */
    _formatOfferingLabels(raw, byId) {
        if (!raw) return '—';
        const labels = this._parseSemiList(raw).map(token => {
            if (this._isSalesforceId(token) && byId[token]?.Name) {
                return byId[token].Name;
            }
            // Legacy name storage, or Id not yet loaded
            return token;
        }).filter(Boolean);
        if (labels.length === 0) return '—';
        if (labels.length <= 2) return labels.join(', ');
        return `${labels.length} selected`;
    }

    _formatDateTime(value) {
        if (!value) return '—';
        try {
            return new Date(value).toLocaleString();
        } catch (e) {
            return String(value);
        }
    }

    _parseSemiList(raw) {
        return (raw || '').split(';').map(s => s.trim()).filter(Boolean);
    }

    _syncOfferingChecksFromEdit() {
        this._rebuildOfferingOptionLists();
    }

    _persistProductFamilySelection() {
        this.editScoring = {
            ...this.editScoring,
            Product_Family__c: this.productFamilyOptions.filter(o => o.checked).map(o => o.value).join('; ')
        };
        this.selectAllProductFamilies = this.productFamilyOptions.length > 0
            && this.productFamilyOptions.every(o => o.checked);
        this._buildGroupedProductFamilies();
    }

    _persistFonSelection() {
        this.editScoring = {
            ...this.editScoring,
            Family_of_Needs__c: this.familyOfNeedsOptions.filter(o => o.checked).map(o => o.value).join('; ')
        };
        this.selectAllFamilyOfNeeds = this.familyOfNeedsOptions.length > 0
            && this.familyOfNeedsOptions.every(o => o.checked);
    }

    get hasTiers() { return this._allTiers.length > 0; }
    get tierCount() { return this._allTiers.length; }
    get tierModalTitle() { return this.editTier.Id ? `Edit Tier ${this.editTier.Tier_Number__c}` : 'Add Tier'; }

    get tiers() {
        return this._allTiers.map(t => {
            const attrRows = buildTierAttrRows(t);
            const exclusionChips = buildTierExclusionChips(t);
            const typeChips = buildTierTypeChips(t);
            return {
                ...t,
                attrRows,
                exclusionChips,
                hasExclusions: exclusionChips.length > 0,
                typeChips,
                hasTypes: typeChips.length > 0
            };
        });
    }

    get tierAttrFields() {
        return TIER_ATTR_FIELDS.map(af => ({ ...af, value: this.editTier[af.field] || '' }));
    }

    get tierExclusionFields() {
        return TIER_EXCL_FIELDS.map(ef => ({ ...ef, checked: !!this.editTier[ef.field] }));
    }

    get allExclusionsSelected() {
        return TIER_EXCL_FIELDS.every(ef => !!this.editTier[ef.field]);
    }

    get someExclusionsSelected() {
        const checked = TIER_EXCL_FIELDS.filter(ef => !!this.editTier[ef.field]).length;
        return checked > 0 && checked < TIER_EXCL_FIELDS.length;
    }

    get campaignTypeCheckboxes() {
        const selected = (this.editTier.Supported_Campaign_Types__c || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        return this.campaignTypes.map(ct => ({
            name: ct.Name,
            checked: selected.includes(ct.Name)
        }));
    }

    get topicGroups() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Topic Group'); }
    get hasTopicGroups() { return this.topicGroups.length > 0; }
    get topicGroupModalTitle() { return this.editTopicGroup.Id ? 'Edit Topic Group' : 'Add Topic Group'; }
    get topicGroupOptions() {
        const opts = this.topicGroups.map(g => ({ label: g.Name, value: g.Id }));
        return [{ label: '— None —', value: '' }, ...opts];
    }

    get allTopics() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Topic'); }
    get topicOptions() {
        return this.allTopics.map(t => ({ label: t.Name, value: t.Id }));
    }
    get topicCount() { return this.allTopics.length; }
    get hasTopics() { return this.filteredTopics.length > 0; }
    get filteredTopics() {
        const q = (this.topicSearch || '').toLowerCase();
        return q
            ? this.allTopics.filter(t =>
                (t.Name || '').toLowerCase().includes(q) ||
                (t.Topic_Group_Dict__r?.Name || '').toLowerCase().includes(q) ||
                (t.Topic_Description__c || '').toLowerCase().includes(q))
            : this.allTopics;
    }
    get topicCountLabel() {
        const f = this.filteredTopics.length; const t = this.topicCount;
        if (f === t) return `${t} topic${t !== 1 ? 's' : ''}`;
        return `Showing ${f} of ${t} topics`;
    }
    get topicModalTitle() { return this.editTopic.Id ? 'Edit Topic' : 'Add Topic'; }

    get paths() {
        return this._localPaths.map(p => ({
            ...p,
            statusLabel: p.Is_Active__c ? 'Active' : 'Inactive',
            statusBadgeClass: p.Is_Active__c ? 'slds-badge cd-badge-active' : 'slds-badge slds-badge_lightest',
            cardClass: `path-card${p.Is_Active__c ? '' : ' path-card_inactive'}`,
            toggleLabel: p.Name
        }));
    }
    get hasPaths() { return this._localPaths.length > 0; }
    get noActivePaths() { return !this._localPaths.some(p => p.Is_Active__c); }
    get activePathsSum() {
        return parseFloat(
            this._localPaths
                .filter(p => p.Is_Active__c)
                .reduce((s, p) => s + (Number(p.Distribution_Percent__c) || 0), 0)
                .toFixed(2)
        );
    }
    get pathSumWarning() { return this.activePathsSum > 100; }
    get pathModalTitle() { return this.editPath.Id ? 'Edit Activation Path' : 'Add Activation Path'; }

    get salesProcessTypes() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Sales Process Type'); }
    get hasSalesProcessTypes() { return this.salesProcessTypes.length > 0; }
    get salesProcessTypeCount() { return this.salesProcessTypes.length; }
    get salesProcessTypeModalTitle() { return this.editSalesProcessType.Id ? 'Edit Sales Process Type' : 'Add Sales Process Type'; }

    handleNewCampaignType() { this.editCampaignType = EMPTY_CAMPAIGN_TYPE(); this.isCampaignTypeModalOpen = true; }
    closeCampaignTypeModal() { this.isCampaignTypeModalOpen = false; }
    handleEditCampaignType(e) {
        const rec = this._allRecords.find(r => r.Id === e.currentTarget.dataset.id);
        if (rec) { this.editCampaignType = { ...rec }; this.isCampaignTypeModalOpen = true; }
    }
    handleCampaignTypeFieldChange(e) {
        this.editCampaignType = { ...this.editCampaignType, [e.target.dataset.field]: e.target.value };
    }
    handleCampaignTypeCheckboxChange(e) {
        this.editCampaignType = { ...this.editCampaignType, [e.target.dataset.field]: e.target.checked };
    }
    async handleSaveCampaignType() {
        if (!this.editCampaignType.Name?.trim()) { this._showToast('Validation', 'Name is required.', 'warning'); return; }
        await this._saveCampaignRecord(this.editCampaignType, () => { this.isCampaignTypeModalOpen = false; });
    }
    handleDeleteCampaignType(e) { this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'campaignRecord'); }

    handleNewCampaignGroup(e) {
        const typeId = e.currentTarget.dataset.typeId;
        this.editCampaignGroup = { ...EMPTY_CAMPAIGN_GROUP(), Campaign_Type_Dict__c: typeId || null };
        this.isCampaignGroupModalOpen = true;
    }
    closeCampaignGroupModal() { this.isCampaignGroupModalOpen = false; }
    handleEditCampaignGroup(e) {
        const rec = this._allRecords.find(r => r.Id === e.currentTarget.dataset.id);
        if (rec) {
            const { Campaign_Type_Dict__r, ...clean } = rec;
            this.editCampaignGroup = { ...clean };
            this.isCampaignGroupModalOpen = true;
        }
    }
    handleCampaignGroupFieldChange(e) {
        this.editCampaignGroup = { ...this.editCampaignGroup, [e.target.dataset.field]: e.detail?.value ?? e.target.value };
    }
    async handleSaveCampaignGroup() {
        if (!this.editCampaignGroup.Name?.trim()) { this._showToast('Validation', 'Name is required.', 'warning'); return; }
        if (!this.editCampaignGroup.Campaign_Type_Dict__c) { this._showToast('Validation', 'Campaign Type is required.', 'warning'); return; }
        const record = { ...this.editCampaignGroup, Campaign_Type_Dict__c: this.editCampaignGroup.Campaign_Type_Dict__c || null };
        await this._saveCampaignRecord(record, () => { this.isCampaignGroupModalOpen = false; });
    }

    handleNewModelGroup() {
        this.editModelGroup = EMPTY_MODEL_GROUP();
        this.isModelGroupModalOpen = true;
    }
    closeModelGroupModal() { this.isModelGroupModalOpen = false; }
    handleEditModelGroup(e) {
        const rec = this._allRecords.find(r => r.Id === e.currentTarget.dataset.id);
        if (rec) { this.editModelGroup = { ...rec }; this.isModelGroupModalOpen = true; }
    }
    handleModelGroupFieldChange(e) {
        this.editModelGroup = { ...this.editModelGroup, [e.target.dataset.field]: e.target.value };
    }
    async handleSaveModelGroup() {
        if (!this.editModelGroup.Name?.trim()) {
            this._showToast('Validation', 'Group Name is required.', 'warning');
            return;
        }
        await this._saveCampaignRecord(this.editModelGroup, () => { this.isModelGroupModalOpen = false; });
    }
    handleDeleteModelGroup(e) {
        this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'campaignRecord');
    }

    handleScoringSearch(e) {
        this.scoringSearch = e.target.value;
        // Drop selection of versions no longer visible after filter.
        const visible = new Set(this._filteredScoringVersions.map(r => r.Id));
        this.selectedScoringIds = this.selectedScoringIds.filter(id => visible.has(id));
    }

    handleScoringSort(e) {
        const field = e.currentTarget.dataset.field;
        if (!field) return;
        const header = this.scoringSortHeaders.find(h => h.field === field);
        if (!header?.sortable) return;
        if (this.scoringSortField === field) {
            this.scoringSortDir = this.scoringSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.scoringSortField = field;
            this.scoringSortDir = 'asc';
        }
    }

    handleToggleScoringMaster(e) {
        // Ignore clicks that originated on checkbox / action controls.
        if (e.target.closest('.scoring-row-control')) return;
        const name = e.currentTarget.dataset.name;
        if (!name) return;
        this.expandedScoringMasters = {
            ...this.expandedScoringMasters,
            [name]: !this.expandedScoringMasters[name]
        };
    }

    handleScoringRowClick(e) {
        if (e.currentTarget.dataset.rowType !== 'master') return;
        this.handleToggleScoringMaster(e);
    }

    handleScoringMasterCheckbox(e) {
        e.stopPropagation();
        const name = e.currentTarget.dataset.name;
        const master = this.scoringMasterRows.find(m => m.key === name);
        if (!master) return;
        const childIds = master.versions.map(v => v.Id);
        if (e.target.checked) {
            this.selectedScoringIds = [...new Set([...this.selectedScoringIds, ...childIds])];
        } else {
            const drop = new Set(childIds);
            this.selectedScoringIds = this.selectedScoringIds.filter(id => !drop.has(id));
        }
    }

    handleScoringChildCheckbox(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        if (e.target.checked) {
            if (!this.selectedScoringIds.includes(id)) {
                this.selectedScoringIds = [...this.selectedScoringIds, id];
            }
        } else {
            this.selectedScoringIds = this.selectedScoringIds.filter(x => x !== id);
        }
    }

    handleScoringSelectAll(e) {
        const visible = this._visibleScoringVersionIds();
        if (e.target.checked) {
            this.selectedScoringIds = [...new Set([...this.selectedScoringIds, ...visible])];
        } else {
            const drop = new Set(visible);
            this.selectedScoringIds = this.selectedScoringIds.filter(id => !drop.has(id));
        }
    }

    handleClearScoringSelection() {
        this.selectedScoringIds = [];
    }

    handleStopPropagation(e) {
        e.stopPropagation();
    }

    handleBulkDeleteScorings() {
        const n = this.selectedScoringIds.length;
        if (!n) return;
        this._deleteIds = [...this.selectedScoringIds];
        this._deleteId = null;
        this._deleteType = 'scoringBulk';
        this.deleteTargetName = `${n} scoring model version${n !== 1 ? 's' : ''}`;
        this.isDeleteModalOpen = true;
    }

    renderedCallback() {
        // Sync indeterminate state on master / select-all checkboxes.
        this.template.querySelectorAll('input.scoring-master-cb').forEach(el => {
            const name = el.dataset.name;
            const master = this.scoringMasterRows.find(m => m.key === name);
            el.indeterminate = !!(master && master.isIndeterminate);
        });
        const selectAll = this.template.querySelector('input.scoring-select-all-cb');
        if (selectAll) {
            selectAll.indeterminate = this.isSomeVisibleScoringsSelected;
            selectAll.checked = this.isAllVisibleScoringsSelected;
        }
    }

    handleNewScoring() {
        this.scoringAsNewMaster = true;
        this.scoringNameLocked = false;
        this.editScoring = EMPTY_SCORING();
        this._loadOfferingOptions();
        this._loadData360DmoOptions();
        this.isScoringModalOpen = true;
    }

    handleNewScoringVersion(e) {
        const sourceId = e.currentTarget.dataset.id;
        const source = this.allScorings.find(r => r.Id === sourceId);
        if (!source) return;
        const maxVer = this.allScorings
            .filter(r => r.Name === source.Name)
            .reduce((m, r) => Math.max(m, Number(r.Version__c) || 0), 0);
        this.scoringAsNewMaster = false;
        this.scoringNameLocked = true;
        this.editScoring = {
            ...EMPTY_SCORING(),
            Name: source.Name,
            Version__c: maxVer + 1,
            Topic_Description__c: source.Topic_Description__c || '',
            Scoring_Model_Group_Dict__c: source.Scoring_Model_Group_Dict__c || null,
            Assigned_Topic_Dict__c: source.Assigned_Topic_Dict__c || null,
            Scoring_Model_Source_System__c: source.Scoring_Model_Source_System__c || '',
            Data360_DMO__c: source.Data360_DMO__c || '',
            Offering_Type__c: source.Offering_Type__c || 'Product Family',
            Product_Family__c: source.Product_Family__c || '',
            Family_of_Needs__c: source.Family_of_Needs__c || '',
            Model_Expiration_Date__c: null,
            Is_Active__c: false
        };
        this._loadOfferingOptions();
        this._loadData360DmoOptions();
        this.isScoringModalOpen = true;
    }

    closeScoringModal() { this.isScoringModalOpen = false; }

    handleEditScoring(e) {
        const rec = this.allScorings.find(t => t.Id === e.currentTarget.dataset.id);
        if (!rec) return;
        const {
            Scoring_Model_Group_Dict__r,
            Assigned_Topic_Dict__r,
            CreatedBy,
            LastModifiedBy,
            ...clean
        } = rec;
        this.scoringAsNewMaster = false;
        this.scoringNameLocked = true;
        this.editScoring = {
            ...clean,
            CreatedByName: CreatedBy?.Name || '',
            LastModifiedByName: LastModifiedBy?.Name || '',
            CreatedBy,
            LastModifiedBy
        };
        this._loadOfferingOptions();
        this._loadData360DmoOptions();
        this.isScoringModalOpen = true;
    }

    handleScoringFieldChange(e) {
        const field = e.target.dataset.field;
        let value = e.detail?.value ?? e.target.value;
        if (field === 'Is_Active__c') {
            value = e.target.checked;
        }
        this.editScoring = { ...this.editScoring, [field]: value };
    }

    handleScoringActiveToggle(e) {
        const wantActive = e.target.checked === true;
        if (wantActive) {
            const missing = this._scoringActivationMissingFields();
            if (missing.length) {
                // Revert toggle — keep draft until required fields are complete.
                this.editScoring = { ...this.editScoring, Is_Active__c: false };
                this._showToast(
                    'Cannot activate',
                    `Complete required fields first: ${missing.join(', ')}`,
                    'warning'
                );
                return;
            }
        }
        this.editScoring = { ...this.editScoring, Is_Active__c: wantActive };
    }

    handleScoringOfferingTypeChange(e) {
        const value = e.target.value;
        this.pfFilterCustomerTypes = [];
        this.pfFilterRecordTypes = [];
        this.fonFilterCustomerTypes = [];
        this.editScoring = {
            ...this.editScoring,
            Offering_Type__c: value,
            Product_Family__c: value === 'Product Family' ? this.editScoring.Product_Family__c : '',
            Family_of_Needs__c: value === 'Family of Needs' ? this.editScoring.Family_of_Needs__c : ''
        };
        this._syncOfferingChecksFromEdit();
    }

    handleCustomerTypeFilter(e) {
        const val = e.currentTarget.dataset.value;
        if (this.pfFilterCustomerTypes.includes(val)) {
            this.pfFilterCustomerTypes = this.pfFilterCustomerTypes.filter(v => v !== val);
        } else {
            this.pfFilterCustomerTypes = [...this.pfFilterCustomerTypes, val];
        }
    }

    handleRecordTypeFilterBadge(e) {
        const val = e.currentTarget.dataset.value;
        if (this.pfFilterRecordTypes.includes(val)) {
            this.pfFilterRecordTypes = this.pfFilterRecordTypes.filter(v => v !== val);
        } else {
            this.pfFilterRecordTypes = [...this.pfFilterRecordTypes, val];
        }
    }

    handleFonCustomerTypeFilter(e) {
        const val = e.currentTarget.dataset.value;
        if (this.fonFilterCustomerTypes.includes(val)) {
            this.fonFilterCustomerTypes = this.fonFilterCustomerTypes.filter(v => v !== val);
        } else {
            this.fonFilterCustomerTypes = [...this.fonFilterCustomerTypes, val];
        }
    }

    handleSelectAllProductFamilies(e) {
        const checked = e.target.checked;
        this.selectAllProductFamilies = checked;
        this.productFamilyOptions = this.productFamilyOptions.map(o => ({ ...o, checked }));
        this._persistProductFamilySelection();
    }

    handleSelectAllFamilyOfNeeds(e) {
        const checked = e.target.checked;
        this.selectAllFamilyOfNeeds = checked;
        this.familyOfNeedsOptions = this.familyOfNeedsOptions.map(o => ({ ...o, checked }));
        this._persistFonSelection();
    }

    handleScoringProductFamilyToggle(e) {
        const value = e.target.dataset.value;
        const checked = e.target.checked;
        this.productFamilyOptions = this.productFamilyOptions.map(o =>
            o.value === value ? { ...o, checked } : o
        );
        this._persistProductFamilySelection();
    }

    handleScoringFonToggle(e) {
        const value = e.target.dataset.value;
        const checked = e.target.checked;
        this.familyOfNeedsOptions = this.familyOfNeedsOptions.map(o =>
            o.value === value ? { ...o, checked } : o
        );
        this._persistFonSelection();
    }

    async handleSaveScoring() {
        const name = (this.editScoring.Name || '').trim();
        if (!name) {
            this._showToast('Validation', 'Model Name is required.', 'warning');
            return;
        }

        const isActive = this.editScoring.Is_Active__c === true;
        if (isActive) {
            const missing = this._scoringActivationMissingFields();
            if (missing.length) {
                this._showToast(
                    'Cannot activate',
                    `Complete required fields to activate: ${missing.join(', ')}`,
                    'warning'
                );
                return;
            }
        }

        const {
            Scoring_Model_Group_Dict__r,
            Assigned_Topic_Dict__r,
            CreatedBy,
            CreatedByName,
            LastModifiedBy,
            LastModifiedByName,
            CreatedDate,
            LastModifiedDate,
            groupName,
            topicName,
            offeringLabel,
            offeringValuesShort,
            createdDisplay,
            modifiedDisplay,
            createdByName,
            expirationDisplay,
            activeLabel,
            statusLabel,
            statusBadgeClass,
            ...record
        } = this.editScoring;

        this.isSaving = true;
        try {
            await saveScoringModel({
                record: {
                    ...record,
                    Name: name,
                    Dictionary_Sub_Type__c: 'Scoring Model',
                    Scoring_Model_Group_Dict__c: record.Scoring_Model_Group_Dict__c || null,
                    Assigned_Topic_Dict__c: record.Assigned_Topic_Dict__c || null,
                    Is_Active__c: isActive
                },
                asNewMaster: this.scoringAsNewMaster && !record.Id
            });
            this._showToast(
                'Success',
                isActive ? 'Scoring Model activated.' : 'Scoring Model saved as draft.',
                'success'
            );
            this.isScoringModalOpen = false;
            await refreshApex(this._wiredCampaignResult);
        } catch (err) {
            this._showToast('Error', err.body?.message || 'Save failed.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleNewTier() { this.editTier = EMPTY_TIER(); this.isTierModalOpen = true; }
    closeTierModal() { this.isTierModalOpen = false; }
    handleEditTier(e) {
        const rec = this._allTiers.find(t => t.Id === e.currentTarget.dataset.id);
        if (rec) { this.editTier = { ...rec }; this.isTierModalOpen = true; }
    }
    handleTierFieldChange(e) {
        const v = e.target.dataset.field === 'Tier_Number__c' ? Number(e.target.value) : e.target.value;
        this.editTier = { ...this.editTier, [e.target.dataset.field]: v };
    }
    handleTierAttrChange(e) {
        this.editTier = { ...this.editTier, [e.target.dataset.field]: e.detail.value };
    }
    handleTierExclusionChange(e) {
        this.editTier = { ...this.editTier, [e.target.dataset.field]: e.target.checked };
    }

    handleSelectAllExclusions(e) {
        const checked = e.target.checked;
        const updates = {};
        TIER_EXCL_FIELDS.forEach(ef => { updates[ef.field] = checked; });
        this.editTier = { ...this.editTier, ...updates };
    }
    handleTierCampaignTypeToggle(e) {
        const name = e.target.dataset.name;
        const checked = e.target.checked;
        const current = (this.editTier.Supported_Campaign_Types__c || '').split(',').map(s => s.trim()).filter(Boolean);
        const updated = checked ? [...current.filter(n => n !== name), name] : current.filter(n => n !== name);
        this.editTier = { ...this.editTier, Supported_Campaign_Types__c: updated.join(', ') };
    }
    async handleSaveTier() {
        if (!this.editTier.Tier_Number__c) { this._showToast('Validation', 'Tier Number is required.', 'warning'); return; }
        this.isSaving = true;
        try {
            await saveCampaignTier({ record: this.editTier });
            this._showToast('Success', 'Tier saved.', 'success');
            this.isTierModalOpen = false;
            await refreshApex(this._wiredTiersResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Save failed.', 'error'); }
        finally { this.isSaving = false; }
    }
    handleDeleteTier(e) { this._openDeleteModal(e.currentTarget.dataset.id, `Tier ${e.currentTarget.dataset.num}`, 'tier'); }

    handleNewTopicGroup() { this.editTopicGroup = EMPTY_TOPIC_GROUP(); this.isTopicGroupModalOpen = true; }
    closeTopicGroupModal() { this.isTopicGroupModalOpen = false; }
    handleEditTopicGroup(e) {
        const rec = this._allRecords.find(r => r.Id === e.currentTarget.dataset.id);
        if (rec) { this.editTopicGroup = { ...rec }; this.isTopicGroupModalOpen = true; }
    }
    handleTopicGroupFieldChange(e) {
        this.editTopicGroup = { ...this.editTopicGroup, [e.target.dataset.field]: e.target.value };
    }
    async handleSaveTopicGroup() {
        if (!this.editTopicGroup.Name?.trim()) { this._showToast('Validation', 'Name is required.', 'warning'); return; }
        await this._saveCampaignRecord(this.editTopicGroup, () => { this.isTopicGroupModalOpen = false; });
    }
    handleDeleteTopicGroup(e) { this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'campaignRecord'); }

    handleTopicSearch(e) { this.topicSearch = e.target.value; }
    handleNewTopic() { this.editTopic = EMPTY_TOPIC(); this.isTopicModalOpen = true; }
    closeTopicModal() { this.isTopicModalOpen = false; }
    handleEditTopic(e) {
        const rec = this._allRecords.find(r => r.Id === e.currentTarget.dataset.id);
        if (rec) {
            const { Topic_Group_Dict__r, ...clean } = rec;
            this.editTopic = { ...clean };
            this.isTopicModalOpen = true;
        }
    }
    handleTopicFieldChange(e) {
        this.editTopic = { ...this.editTopic, [e.target.dataset.field]: e.detail?.value ?? e.target.value };
    }
    async handleSaveTopic() {
        if (!this.editTopic.Name?.trim()) { this._showToast('Validation', 'Topic Name is required.', 'warning'); return; }
        const record = { ...this.editTopic, Topic_Group_Dict__c: this.editTopic.Topic_Group_Dict__c || null };
        await this._saveCampaignRecord(record, () => { this.isTopicModalOpen = false; });
    }

    handleNewPath() { this.editPath = EMPTY_PATH(); this.isPathModalOpen = true; }
    closePathModal() { this.isPathModalOpen = false; }
    handleEditPath(e) {
        const rec = this._localPaths.find(p => p.Id === e.currentTarget.dataset.id);
        if (rec) { this.editPath = { ...rec }; this.isPathModalOpen = true; }
    }
    handlePathFieldChange(e) {
        this.editPath = { ...this.editPath, [e.target.dataset.field]: e.target.value };
    }
    handlePathCheckboxChange(e) {
        this.editPath = { ...this.editPath, [e.target.dataset.field]: e.target.checked };
    }
    async handleSavePath() {
        if (!this.editPath.Name?.trim()) { this._showToast('Validation', 'Name is required.', 'warning'); return; }
        await this._saveCampaignRecord(this.editPath, () => { this.isPathModalOpen = false; });
    }

    handlePathToggle(e) {
        const id = e.target.dataset.id;
        const checked = e.target.checked;
        this._localPaths = this._localPaths.map(p => p.Id === id ? { ...p, Is_Active__c: checked } : p);
        if (!checked) {
            this._redistributeOnDeactivate();
        }
    }

    handlePathPercentChange(e) {
        const id = e.target.dataset.id;
        const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
        this._localPaths = this._localPaths.map(p => p.Id === id ? { ...p, Distribution_Percent__c: val } : p);
    }

    handleAllocateEqually() {
        const active = this._localPaths.filter(p => p.Is_Active__c);
        if (!active.length) return;
        const each = parseFloat((100 / active.length).toFixed(2));
        this._localPaths = this._localPaths.map(p =>
            p.Is_Active__c ? { ...p, Distribution_Percent__c: each } : p
        );
    }

    _redistributeOnDeactivate() {
        const active = this._localPaths.filter(p => p.Is_Active__c);
        if (!active.length) return;
        const each = parseFloat((100 / active.length).toFixed(2));
        this._localPaths = this._localPaths.map(p =>
            p.Is_Active__c ? { ...p, Distribution_Percent__c: each } : { ...p, Distribution_Percent__c: 0 }
        );
    }

    async handleSaveDistribution() {
        if (this.pathSumWarning) { this._showToast('Validation', 'Sum of active path percentages exceeds 100%.', 'warning'); return; }
        this.isSaving = true;
        try {
            await saveCampaignRecordsBulk({ records: this._localPaths });
            this._showToast('Success', 'Distribution saved.', 'success');
            await refreshApex(this._wiredCampaignResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Save failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    handleNewSalesProcessType() { this.editSalesProcessType = EMPTY_SALES_PROCESS(); this.isSalesProcessTypeModalOpen = true; }
    closeSalesProcessTypeModal() { this.isSalesProcessTypeModalOpen = false; }
    handleEditSalesProcessType(e) {
        const rec = this._allRecords.find(r => r.Id === e.currentTarget.dataset.id);
        if (rec) { this.editSalesProcessType = { ...rec }; this.isSalesProcessTypeModalOpen = true; }
    }
    handleSalesProcessTypeFieldChange(e) {
        this.editSalesProcessType = { ...this.editSalesProcessType, [e.target.dataset.field]: e.target.value };
    }
    async handleSaveSalesProcessType() {
        if (!this.editSalesProcessType.Name?.trim()) { this._showToast('Validation', 'Name is required.', 'warning'); return; }
        await this._saveCampaignRecord(this.editSalesProcessType, () => { this.isSalesProcessTypeModalOpen = false; });
    }

    handleDeleteCampaignRecord(e) { this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'campaignRecord'); }
    closeDeleteModal() {
        this.isDeleteModalOpen = false;
        this._deleteIds = null;
    }

    _openDeleteModal(id, name, type) {
        this._deleteId = id;
        this._deleteIds = null;
        this._deleteType = type;
        this.deleteTargetName = name;
        this.isDeleteModalOpen = true;
    }

    async handleConfirmDelete() {
        this.isDeleteModalOpen = false;
        this.isSaving = true;
        try {
            if (this._deleteType === 'tier') {
                await deleteCampaignTier({ recordId: this._deleteId });
                await refreshApex(this._wiredTiersResult);
            } else if (this._deleteType === 'scoringBulk' && this._deleteIds?.length) {
                for (const recordId of this._deleteIds) {
                    await deleteDictionaryRecord({ recordId });
                }
                this.selectedScoringIds = [];
                this._deleteIds = null;
                await refreshApex(this._wiredCampaignResult);
            } else {
                await deleteDictionaryRecord({ recordId: this._deleteId });
                this.selectedScoringIds = this.selectedScoringIds.filter(id => id !== this._deleteId);
                await refreshApex(this._wiredCampaignResult);
            }
            this._showToast('Success', 'Deleted.', 'success');
        } catch (e) { this._showToast('Error', e.body?.message || 'Delete failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    async _saveCampaignRecord(record, onSuccess) {
        this.isSaving = true;
        try {
            await saveCampaignRecord({ record });
            this._showToast('Success', 'Saved.', 'success');
            if (onSuccess) onSuccess();
            await refreshApex(this._wiredCampaignResult);
        } catch (e) { this._showToast('Error', e.body?.message || 'Save failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
