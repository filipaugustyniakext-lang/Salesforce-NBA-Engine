import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getCampaignRecords from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignRecords';
import saveCampaignRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignRecord';
import saveCampaignRecordsBulk from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignRecordsBulk';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import getCampaignTiers from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignTiers';
import saveCampaignTier from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignTier';
import deleteCampaignTier from '@salesforce/apex/MarketingDictionaryManagerController.deleteCampaignTier';

const TIER_ATTR_FIELDS = [
    { 
        field: 'Override_Random_Activation_Path__c', 
        label: 'Override Random Activation Path', 
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
        ]
    },
    { 
        field: 'Honor_Marketing_Consents__c',         
        label: 'Honor Marketing Consents', 
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
            { label: 'Defined per Campaign', value: 'Defined per Campaign' },
        ]
    },
    { 
        field: 'Includes_Control_Group__c',           
        label: 'Includes Control Group' , 
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
            { label: 'Defined per Campaign', value: 'Defined per Campaign' },
        ]
    },
    { 
        field: 'Honors_Channel_Cooldowns__c',         
        label: 'Honors Channel Cooldowns', 
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
            { label: 'Defined per Campaign', value: 'Defined per Campaign' },
        ]
    },
    { 
        field: 'Allows_Random_Copy_Assignment__c',    
        label: 'Allows Random Copy Assignment' , 
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
        ]
    },
];

const TIER_EXCL_FIELDS = [
    { field: 'Excl_Manual_Suppressions__c', label: 'Manual Suppressions' }
];

const ATTR_BADGE = { 'Yes': 'slds-badge cd-badge-yes', 'No': 'slds-badge cd-badge-no', 'Defined per Campaign': 'slds-badge cd-badge-dpc' };

const EMPTY_CAMPAIGN_TYPE    = () => ({ Name: '', Dictionary_Sub_Type__c: 'Campaign Type', Include_In_Emergency__c: false, Define_Campaign_Groups__c: false });
const EMPTY_CAMPAIGN_GROUP   = () => ({ Name: '', Dictionary_Sub_Type__c: 'Campaign Group', Campaign_Type_Dict__c: null });
const EMPTY_TOPIC_GROUP      = () => ({ Name: '', Dictionary_Sub_Type__c: 'Topic Group' });
const EMPTY_TOPIC            = () => ({ Name: '', Dictionary_Sub_Type__c: 'Topic', Topic_Group_Dict__c: null, Topic_Description__c: '' });
const EMPTY_PATH             = () => ({ Name: '', Dictionary_Sub_Type__c: 'Activation Path', Is_Active__c: true, Distribution_Percent__c: 0 });
const EMPTY_SALES_PROCESS    = () => ({ Name: '', Dictionary_Sub_Type__c: 'Sales Process Type', Topic_Description__c: '' });
const EMPTY_TIER             = () => ({
    Tier_Number__c: null, Description__c: '', Supported_Campaign_Types__c: '',
    Override_Random_Activation_Path__c: '', Honor_Marketing_Consents__c: '',
    Includes_Control_Group__c: '', Honors_Channel_Cooldowns__c: '',
    Honors_Product_Eligibility__c: '', Allows_Random_Copy_Assignment__c: '',
    Excl_Manual_Suppressions__c: false, Excl_Deceased__c: false, Excl_AML_Fraud__c: false,
    Excl_Debt_Collection__c: false, Excl_Overdue__c: false, Excl_KYC_Risk__c: false,
    Excl_Bailiff_Seizure__c: false, Excl_Restricted_Client__c: false, Excl_Personal_Bankruptcy__c: false
});
const EMPTY_SCORING             = () => ({
    Scoring_Model_Id: '', 
    Scoring_Model_Version: '',
    Scoring_Model_Name: '',  
    Scoring_Model_Description: '', 
    Scoring_Model_Group_Id: '',
    Topic_Id: '',
    FoN_Id: '',
    Product_Family: '',
    Created_Date: '',
    Expiration_Date: '',
    LastModified_Date: ''
});

export default class MarketingDictionaryCampaignTab extends LightningElement {

    @track isLoading = true;
    @track isSaving = false;

    // modal flags
    @track isCampaignTypeModalOpen = false;
    @track isCampaignGroupModalOpen = false;
    @track isScoringModalOpen = false;
    @track isTierModalOpen = false;
    @track isTopicGroupModalOpen = false;
    @track isTopicModalOpen = false;
    @track isPathModalOpen = false;
    @track isSalesProcessTypeModalOpen = false;
    @track isDeleteModalOpen = false;

    // edit state
    @track editCampaignType = EMPTY_CAMPAIGN_TYPE();
    @track editCampaignGroup = EMPTY_CAMPAIGN_GROUP();
    @track editScoring = EMPTY_SCORING();
    @track editTier = EMPTY_TIER();
    @track editTopicGroup = EMPTY_TOPIC_GROUP();
    @track editTopic = EMPTY_TOPIC();
    @track editPath = EMPTY_PATH();
    @track editSalesProcessType = EMPTY_SALES_PROCESS();

    // misc
    @track topicSearch = '';
    @track activeSubTab = 'campaignTypes';
    @track _localPaths = [];  // local copy for unsaved % edits

    deleteTargetName = '';
    _deleteId = null;
    _deleteType = null;

    _wiredCampaignResult;
    _wiredTiersResult;
    _allRecords = [];
    _allTiers = [];

    // ─── Vertical tab navigation ───────────────────────────────────────────

    get isTab() {
        return {
            campaignTypes:    this.activeSubTab === 'campaignTypes',
            scorings:          this.activeSubTab === 'scorings',
            tiers:            this.activeSubTab === 'tiers',
            topics:           this.activeSubTab === 'topics',
            activationPaths:  this.activeSubTab === 'activationPaths',
            salesProcessTypes: this.activeSubTab === 'salesProcessTypes',
        };
    }

    get vtabClass() {
        const base = 'vtab-item';
        const active = base + ' vtab-item_active';
        return {
            campaignTypes:     this.activeSubTab === 'campaignTypes'     ? active : base,
            scorings:          this.activeSubTab === 'scorings'          ? active : base,
            tiers:             this.activeSubTab === 'tiers'             ? active : base,
            topics:            this.activeSubTab === 'topics'            ? active : base,
            activationPaths:   this.activeSubTab === 'activationPaths'   ? active : base,
            salesProcessTypes: this.activeSubTab === 'salesProcessTypes' ? active : base,
        };
    }

    get vtabSelected() {
        return {
            campaignTypes:    this.activeSubTab === 'campaignTypes',
            scorings:         this.activeSubTab === 'scorings',
            tiers:            this.activeSubTab === 'tiers',
            topics:           this.activeSubTab === 'topics',
            activationPaths:  this.activeSubTab === 'activationPaths',
            salesProcessTypes: this.activeSubTab === 'salesProcessTypes',
        };
    }

    handleSubTabClick(e) {
        this.activeSubTab = e.currentTarget.dataset.tab;
    }

    // ─── Wire ──────────────────────────────────────────────────────────────

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

    // ─── Getters: Campaign Types ────────────────────────────────────────────

    get campaignTypes() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Campaign Type'); }
    get hasCampaignTypes() { return this.campaignTypes.length > 0; }
    get campaignTypeCount() { return this.campaignTypes.length; }
    get campaignTypeModalTitle() { return this.editCampaignType.Id ? 'Edit Campaign Type' : 'Add Campaign Type'; }

    // ─── Getters: Campaign Groups ───────────────────────────────────────────

    get allCampaignGroups() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Campaign Group'); }

    // Campaign Types flagged to define groups, each with its own list of groups
    get campaignTypeGroups() {
        const groups = this.allCampaignGroups;
        return this.campaignTypes
            .filter(ct => ct.Define_Campaign_Groups__c)
            .map(ct => {
                const own = groups.filter(g => g.Campaign_Type_Dict__c === ct.Id);
                return { Id: ct.Id, Name: ct.Name, groups: own, hasGroups: own.length > 0 };
            });
    }
    get hasCampaignGroupTypes() { return this.campaignTypeGroups.length > 0; }

    get campaignTypeOptions() {
        return this.campaignTypes.map(ct => ({ label: ct.Name, value: ct.Id }));
    }
    get campaignGroupModalTitle() { return this.editCampaignGroup.Id ? 'Edit Campaign Group' : 'Add Campaign Group'; }

    // ─── Getters: Scorings ────────────────────────────────────────────────────
    
    get scoringModelModalTitle() { return this.editScoring.Id ? 'Edit Scoring Model Properties' : 'Add Scoring Model'; }

    // ─── Getters: Tiers ────────────────────────────────────────────────────

    get hasTiers() { return this._allTiers.length > 0; }
    get tierCount() { return this._allTiers.length; }
    get tierModalTitle() { return this.editTier.Id ? `Edit Tier ${this.editTier.Tier_Number__c}` : 'Add Tier'; }

    get tiers() {
        return this._allTiers.map(t => {
            const attrRows = TIER_ATTR_FIELDS.map(af => ({
                label: af.label,
                value: t[af.field] || '—',
                options: [af.options],
                badgeClass: ATTR_BADGE[t[af.field]] || 'slds-badge slds-badge_lightest'
            }));
            const exclLabels = TIER_EXCL_FIELDS.filter(ef => t[ef.field]).map(ef => ef.label.replace('Exclude ', ''));
            const typeChips = (t.Supported_Campaign_Types__c || '').split(',').map(s => s.trim()).filter(Boolean);
            return { ...t, attrRows, exclusionChips: exclLabels, hasExclusions: exclLabels.length > 0, typeChips, hasTypes: typeChips.length > 0 };
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

    // ─── Getters: Topics ────────────────────────────────────────────────────

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
        const f = this.filteredTopics.length, t = this.topicCount;
        if (f === t) return `${t} topic${t !== 1 ? 's' : ''}`;
        return `Showing ${f} of ${t} topics`;
    }
    get topicModalTitle() { return this.editTopic.Id ? 'Edit Topic' : 'Add Topic'; }

    // ─── Getters: Activation Paths ─────────────────────────────────────────

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

    // ─── Getters: Sales Process Types ──────────────────────────────────────

    get salesProcessTypes() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Sales Process Type'); }
    get hasSalesProcessTypes() { return this.salesProcessTypes.length > 0; }
    get salesProcessTypeCount() { return this.salesProcessTypes.length; }
    get salesProcessTypeModalTitle() { return this.editSalesProcessType.Id ? 'Edit Sales Process Type' : 'Add Sales Process Type'; }

    // ─── Campaign Type handlers ─────────────────────────────────────────────

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

    // ─── Campaign Group handlers ────────────────────────────────────────────

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

    // ─── Scorings handlers ──────────────────────────────────────────────────────

    handleNewScoring() { this.editScoring = EMPTY_SCORING(); this.isScoringModalOpen = true; }
    closeScoringModal() { this.isScoringModalOpen = false; }

    handleEditScoring(e) {
        const rec = this._allScorings.find(t => t.Id === e.currentTarget.dataset.id);
        if (rec) { this.editScoring = { ...rec }; this.isScoringModalOpen = true; }
    }

    handleScoringFieldChange(e) {
        const v = e.target.dataset.field === 'Scoring_Model_Version' ? Number(e.target.value) : e.target.value;
        this.editScoring = { ...this.editScoring, [e.target.dataset.field]: v };
    }

    // ─── Tier handlers ──────────────────────────────────────────────────────

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

    // ─── Topic Group handlers ───────────────────────────────────────────────

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

    // ─── Topic handlers ─────────────────────────────────────────────────────

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

    // ─── Activation Path handlers ───────────────────────────────────────────

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
            // redistribute freed capacity equally among remaining active paths
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

    // ─── Sales Process Type handlers ────────────────────────────────────────

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

    // ─── Shared delete ───────────────────────────────────────────────────────

    handleDeleteCampaignRecord(e) { this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'campaignRecord'); }
    closeDeleteModal() { this.isDeleteModalOpen = false; }

    _openDeleteModal(id, name, type) {
        this._deleteId = id;
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
            } else {
                await deleteDictionaryRecord({ recordId: this._deleteId });
                await refreshApex(this._wiredCampaignResult);
            }
            this._showToast('Success', 'Deleted.', 'success');
        } catch (e) { this._showToast('Error', e.body?.message || 'Delete failed.', 'error'); }
        finally { this.isSaving = false; }
    }

    // ─── Shared save helper ──────────────────────────────────────────────────

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