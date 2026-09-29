import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getCampaignRecords from '@salesforce/apex/MarketingDictionaryManagerController.getCampaignRecords';
import saveCampaignRecord from '@salesforce/apex/MarketingDictionaryManagerController.saveCampaignRecord';
import saveScoringModel from '@salesforce/apex/MarketingDictionaryManagerController.saveScoringModel';
import deleteDictionaryRecord from '@salesforce/apex/MarketingDictionaryManagerController.deleteDictionaryRecord';
import getProductFamilyDependencies from '@salesforce/apex/MarketingDictionaryController.getProductFamilyDependencies';
import getProductFamilyByRecordType from '@salesforce/apex/MarketingDictionaryController.getProductFamilyByRecordType';
import getProductFamilyCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getProductFamilyCustomerTypes';
import getFamilyOfNeedsCustomerTypes from '@salesforce/apex/MarketingDictionaryController.getFamilyOfNeedsCustomerTypes';
import getProductOfferingCatalogue from '@salesforce/apex/MarketingDictionaryManagerController.getProductOfferingCatalogue';
import getData360DmoOptions from '@salesforce/apex/MarketingDictionaryManagerController.getData360DmoOptions';
import getData360DmoFields from '@salesforce/apex/MarketingDictionaryManagerController.getData360DmoFields';
import getScoringModelSettings from '@salesforce/apex/MarketingDictionaryManagerController.getScoringModelSettings';
import saveScoringModelSetting from '@salesforce/apex/MarketingDictionaryManagerController.saveScoringModelSetting';
import deleteScoringModelSetting from '@salesforce/apex/MarketingDictionaryManagerController.deleteScoringModelSetting';

const EMPTY_MODEL_GROUP = () => ({ Name: '', Dictionary_Sub_Type__c: 'Scoring Model Group' });
const EMPTY_SCORING = () => ({
    Name: '',
    Dictionary_Sub_Type__c: 'Scoring Model',
    Model_Id__c: '',
    Topic_Description__c: '',
    Scoring_Model_Group_Dict__c: null,
    Assigned_Topic_Dict__c: null,
    Offering_Type__c: 'Product Family',
    Product_Family__c: '',
    Family_of_Needs__c: '',
    Model_Expiration_Date__c: null,
    Is_Active__c: false
});
const EMPTY_MODEL_SETTING = () => ({
    Scoring_Model__c: null,
    Data360_DMO__c: '',
    Source_Model_Id_Column__c: '',
    Model_Source__c: '',
    Base_Score_Column__c: '',
    Base_Score_Formula_Mode__c: 'AsIs',
    Base_Score_Factor__c: null,
    Calibrated_Base_Score_Column__c: '',
    Calibrated_Score_Formula_Mode__c: 'AsIs',
    Calibrated_Score_Factor__c: null,
    Model_From_Date__c: null,
    Model_To_Date__c: null
});
const OFFERING_TYPES = [
    { label: 'Product Family', value: 'Product Family' },
    { label: 'Family of Needs', value: 'Family of Needs' }
];

export default class MarketingDictionaryScoringTab extends LightningElement {
    @track activeSubTab = 'definitions';
    @track isLoading = true;
    @track isSaving = false;
    @track isScoringModalOpen = false;
    @track isModelGroupModalOpen = false;
    @track isExpireConfirmOpen = false;
    @track isDeleteModalOpen = false;
    @track editScoring = EMPTY_SCORING();
    @track editModelGroup = EMPTY_MODEL_GROUP();
    @track scoringAsNewMaster = true;
    @track scoringNameLocked = false;
    @track data360DmoOptions = [];
    @track modelSettings = [];
    @track modelSettingsLoading = true;
    @track isConfigureModalOpen = false;
    @track isLoadingDmoFields = false;
    @track editSetting = EMPTY_MODEL_SETTING();
    @track dmoColumnOptions = [];
    @track dmoNumericColumnOptions = [];
    @track expandedScoringMasters = {};
    @track productFamilyOptions = [];
    @track familyOfNeedsOptions = [];
    @track groupedProductFamilyOptions = [];
    @track selectAllProductFamilies = false;
    @track selectAllFamilyOfNeeds = false;
    @track pfFilterCustomerTypes = [];
    @track pfFilterRecordTypes = [];
    @track fonFilterCustomerTypes = [];
    rawProductFamilies = [];
    rawFamilyOfNeeds = [];
    productFamilyById = {};
    familyOfNeedsById = {};
    productFamilyToFoN = {};
    fonToProductFamilies = {};
    productFamilyByRecordType = {};
    productFamilyCustomerTypes = {};
    fonCustomerTypes = {};
    @track scoringSearch = '';
    @track selectedScoringIds = [];
    @track scoringSortField = 'Name';
    @track scoringSortDir = 'asc';
    deleteTargetName = '';
    _deleteId = null;
    _deleteType = null;
    _deleteIds = null;
    _wiredCampaignResult;
    _wiredSettingsResult;
    _allRecords = [];

    get isDefinitions() { return this.activeSubTab === 'definitions'; }
    get isSettings() { return this.activeSubTab === 'settings'; }
    get definitionsClass() { return 'vtab-item' + (this.isDefinitions ? ' vtab-item_active' : ''); }
    get settingsClass() { return 'vtab-item' + (this.isSettings ? ' vtab-item_active' : ''); }

    handleSubTabClick(event) {
        this.activeSubTab = event.currentTarget.dataset.tab;
        if (this.activeSubTab === 'definitions') this._loadOfferingOptions();
    }

    connectedCallback() {
        this._loadOfferingOptions();
    }

    @wire(getCampaignRecords)
    wiredCampaign(result) {
        this._wiredCampaignResult = result;
        this.isLoading = false;
        if (result.data) this._allRecords = result.data;
        else if (result.error) this._showToast('Error', 'Failed to load scoring records.', 'error');
    }

    @wire(getScoringModelSettings)
    wiredModelSettings(result) {
        this._wiredSettingsResult = result;
        this.modelSettingsLoading = false;
        if (result.data) this.modelSettings = result.data;
        else if (result.error) this._showToast('Error', 'Failed to load model settings.', 'error');
    }

    get allTopics() { return this._allRecords.filter(r => r.Dictionary_Sub_Type__c === 'Topic'); }
    get topicOptions() { return this.allTopics.map(t => ({ label: t.Name, value: t.Id })); }


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
                const current = this.editSetting?.Data360_DMO__c || this.editScoring?.Data360_DMO__c;
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
    get hasScorings() { return this._filteredScoringVersions.length > 0; }

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

    get scoringTableRows() {
        const dir = this.scoringSortDir === 'desc' ? -1 : 1;
        const field = this.scoringSortField;
        const valueOf = (row) => {
            if (field === 'ModelId') return Number(row.Model_Id__c) || 0;
            if (field === 'Group') return row.groupName || '';
            if (field === 'Topic') return row.topicName || '';
            if (field === 'Offering') return `${row.offeringLabel || ''} ${row.offeringValuesShort || ''}`;
            if (field === 'Expires') return row.Model_Expiration_Date__c || '';
            if (field === 'Status') return row.Is_Active__c ? 1 : 0;
            return row.Name || '';
        };
        return [...this._filteredScoringVersions]
            .sort((a, b) => {
                const av = valueOf(a);
                const bv = valueOf(b);
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
            })
            .map(row => ({
                ...row,
                rowKey: row.Id,
                isSelected: this.selectedScoringIds.includes(row.Id),
                statusLabel: row.Is_Active__c ? 'Active' : 'Inactive',
                statusBadgeClass: row.Is_Active__c ? 'slds-badge cd-badge-active' : 'slds-badge slds-badge_lightest',
                rowClass: this.selectedScoringIds.includes(row.Id)
                    ? 'slds-hint-parent scoring-row-selected'
                    : 'slds-hint-parent'
            }));
    }

    get scoringSortHeaders() {
        const cols = [
            { field: 'Name', label: 'Model Name', sortable: true, widthClass: 'scoring-col-name' },
            { field: 'ModelId', label: 'Model ID', sortable: true, widthClass: 'scoring-col-modelid' },
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
        return this.isAllVisibleScoringsSelected ? 'Deselect all' : 'Select all';
    }

    /** @deprecated Prefer scoringMasterRows — kept for any residual callers */
    get filteredScorings() {
        return this._filteredScoringVersions;
    }

    get scoringMasterCount() {
        return new Set(this.allScorings.map(r => r.Name)).size;
    }

    get scoringCountLabel() {
        const shown = this._filteredScoringVersions.length;
        const total = this.scoringsCount;
        if (shown === total) return `${total} model definition${total !== 1 ? 's' : ''}`;
        return `Showing ${shown} of ${total} model definitions`;
    }

    _visibleScoringVersionIds() {
        return this._filteredScoringVersions.map(row => row.Id);
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
        return this.editScoring.Id ? `Edit Model Definition — ${this.editScoring.Name}` : 'Add Model Definition';
    }

    get computedModelIdPreview() {
        if (this.editScoring.Id && this.editScoring.Model_Id__c) return this.editScoring.Model_Id__c;
        return this._nextModelId();
    }

    get expireNowDisabled() {
        return this.editScoring.Is_Active__c !== true;
    }

    _nextModelId() {
        let maxId = 0;
        for (const row of this.allScorings) {
            const raw = String(row.Model_Id__c || '').trim();
            if (/^\d+$/.test(raw)) maxId = Math.max(maxId, Number(raw));
        }
        return String(maxId + 1);
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
        const missing = this._scoringActivationMissingFields();
        return missing.length ? `Complete required fields: ${missing.join(', ')}` : '';
    }

    get canActivateScoring() {
        return this._scoringActivationMissingFields().length === 0;
    }

    get scoringSaveButtonLabel() {
        return 'Save';
    }

    /** Fields required to save a model definition. */
    _scoringActivationMissingFields() {
        const missing = [];
        const s = this.editScoring || {};
        if (!(s.Name || '').trim()) missing.push('Model Name');
        if (!this.computedModelIdPreview) missing.push('Model ID');
        if (!s.Scoring_Model_Group_Dict__c) missing.push('Model Group');
        if (!s.Assigned_Topic_Dict__c) missing.push('Model Topic');
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
        this.deleteTargetName = `${n} model definition${n !== 1 ? 's' : ''}`;
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

    handleRequestExpire() {
        this.isExpireConfirmOpen = true;
    }

    handleCancelExpire() {
        this.isExpireConfirmOpen = false;
    }

    async handleConfirmExpire() {
        this.isExpireConfirmOpen = false;
        this.editScoring = { ...this.editScoring, Is_Active__c: false };
        if (this.editScoring.Id) await this.handleSaveScoring();
    }

    async handleSaveScoring() {
        const name = (this.editScoring.Name || '').trim();
        const missing = this._scoringActivationMissingFields();
        if (missing.length) {
            this._showToast('Validation', `Complete required fields: ${missing.join(', ')}`, 'warning');
            return;
        }
        const isActive = this.editScoring.Is_Active__c === true;

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
            this._showToast('Success', 'Model definition saved.', 'success');
            this.isScoringModalOpen = false;
            await refreshApex(this._wiredCampaignResult);
        } catch (err) {
            this._showToast('Error', err.body?.message || 'Save failed.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleDeleteCampaignRecord(e) { this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'campaignRecord'); }
    closeDeleteModal() { this.isDeleteModalOpen = false; this._deleteIds = null; }
    _openDeleteModal(id, name, type) {
        this._deleteId = id; this._deleteIds = null; this._deleteType = type; this.deleteTargetName = name; this.isDeleteModalOpen = true;
    }
    async handleConfirmDelete() {
        this.isDeleteModalOpen = false;
        this.isSaving = true;
        try {
            if (this._deleteType === 'modelSetting') {
                await deleteScoringModelSetting({ recordId: this._deleteId });
                await refreshApex(this._wiredSettingsResult);
            } else if (this._deleteType === 'scoringBulk' && this._deleteIds?.length) {
                for (const recordId of this._deleteIds) await deleteDictionaryRecord({ recordId });
                this.selectedScoringIds = [];
                this._deleteIds = null;
                await refreshApex(this._wiredCampaignResult);
            } else {
                await deleteDictionaryRecord({ recordId: this._deleteId });
                this.selectedScoringIds = this.selectedScoringIds.filter(id => id !== this._deleteId);
                await refreshApex(this._wiredCampaignResult);
            }
            this._showToast('Success', 'Deleted.', 'success');
        } catch (e) {
            this._showToast('Error', e.body?.message || 'Delete failed.', 'error');
        } finally { this.isSaving = false; }
    }
    async _saveCampaignRecord(record, onSuccess) {
        this.isSaving = true;
        try {
            await saveCampaignRecord({ record });
            this._showToast('Success', 'Saved.', 'success');
            if (onSuccess) onSuccess();
            await refreshApex(this._wiredCampaignResult);
        } catch (e) {
            this._showToast('Error', e.body?.message || 'Save failed.', 'error');
        } finally { this.isSaving = false; }
    }
    get modelSourceOptions() {
        return [
            { label: 'GCP', value: 'GCP' },
            { label: 'Einstein', value: 'Einstein' },
            { label: 'Other', value: 'Other' }
        ];
    }

    get scoreFormulaModeOptions() {
        return [
            { label: 'Use source value', value: 'AsIs' },
            { label: 'Multiply by', value: 'Multiply' },
            { label: 'Divide by', value: 'Divide' }
        ];
    }

    get modelDefinitionOptions() {
        return this.allScorings
            .slice()
            .sort((a, b) => (a.Name || '').localeCompare(b.Name || ''))
            .map(r => ({
                label: r.Model_Id__c ? `${r.Name} (${r.Model_Id__c})` : r.Name,
                value: r.Id
            }));
    }

    get hasModelSettings() { return this.modelSettingRows.length > 0; }
    get settingsCount() { return this.modelSettingRows.length; }
    get showColumnMapping() { return !!this.editSetting?.Data360_DMO__c; }
    get hasDmoColumns() { return this.dmoColumnOptions.length > 0; }
    get hasNoNumericColumns() { return this.hasDmoColumns && this.dmoNumericColumnOptions.length === 0; }
    get showBaseScoreFactor() { return this._formulaNeedsFactor(this.editSetting?.Base_Score_Formula_Mode__c); }
    get showCalibratedScoreFactor() { return this._formulaNeedsFactor(this.editSetting?.Calibrated_Score_Formula_Mode__c); }
    get baseScoreFormulaPreview() {
        return this._scoreFormulaPreview(
            this.editSetting?.Base_Score_Column__c,
            this.editSetting?.Base_Score_Formula_Mode__c,
            this.editSetting?.Base_Score_Factor__c
        );
    }
    get calibratedScoreFormulaPreview() {
        return this._scoreFormulaPreview(
            this.editSetting?.Calibrated_Base_Score_Column__c,
            this.editSetting?.Calibrated_Score_Formula_Mode__c,
            this.editSetting?.Calibrated_Score_Factor__c
        );
    }
    get configureModalTitle() {
        return this.editSetting?.Id ? 'Edit Model Setting' : 'Configure Model';
    }
    get isConfigureSaveDisabled() { return this.isSaving || this.isLoadingDmoFields; }

    get modelSettingRows() {
        return (this.modelSettings || []).map(row => ({
            ...row,
            modelName: row.Scoring_Model__r?.Name || row.Name || '',
            modelId: row.Scoring_Model__r?.Model_Id__c || '',
            fromDisplay: this._formatSettingDate(row.Model_From_Date__c),
            toDisplay: this._formatSettingDate(row.Model_To_Date__c)
        }));
    }

    handleNewModelSetting() {
        this.editSetting = EMPTY_MODEL_SETTING();
        this.dmoColumnOptions = [];
        this.dmoNumericColumnOptions = [];
        this.isLoadingDmoFields = false;
        this._loadData360DmoOptions();
        this.isConfigureModalOpen = true;
    }

    handleEditModelSetting(e) {
        const row = (this.modelSettings || []).find(r => r.Id === e.currentTarget.dataset.id);
        if (!row) return;
        this.editSetting = {
            Id: row.Id,
            Scoring_Model__c: row.Scoring_Model__c,
            Data360_DMO__c: row.Data360_DMO__c || '',
            Source_Model_Id_Column__c: row.Source_Model_Id_Column__c || '',
            Model_Source__c: row.Model_Source__c || '',
            Base_Score_Column__c: row.Base_Score_Column__c || '',
            Base_Score_Formula_Mode__c: row.Base_Score_Formula_Mode__c || 'AsIs',
            Base_Score_Factor__c: row.Base_Score_Factor__c,
            Calibrated_Base_Score_Column__c: row.Calibrated_Base_Score_Column__c || '',
            Calibrated_Score_Formula_Mode__c: row.Calibrated_Score_Formula_Mode__c || 'AsIs',
            Calibrated_Score_Factor__c: row.Calibrated_Score_Factor__c,
            Model_From_Date__c: row.Model_From_Date__c,
            Model_To_Date__c: row.Model_To_Date__c
        };
        this._loadData360DmoOptions();
        this._loadDmoFields(this.editSetting.Data360_DMO__c);
        this.isConfigureModalOpen = true;
    }

    closeConfigureModal() { this.isConfigureModalOpen = false; }

    handleDeleteModelSetting(e) {
        this._openDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, 'modelSetting');
    }

    handleSettingFieldChange(e) {
        const field = e.target.dataset.field;
        const value = e.detail?.value ?? e.target.value;
        const next = { ...this.editSetting, [field]: value || null };
        if (field === 'Data360_DMO__c') {
            next.Data360_DMO__c = value || '';
            if (value !== this.editSetting.Data360_DMO__c) {
                next.Source_Model_Id_Column__c = '';
                next.Base_Score_Column__c = '';
                next.Calibrated_Base_Score_Column__c = '';
                this.dmoColumnOptions = [];
                this.dmoNumericColumnOptions = [];
                this.editSetting = next;
                this._loadDmoFields(value);
                return;
            }
        }
        if (field === 'Base_Score_Formula_Mode__c' && value === 'AsIs') next.Base_Score_Factor__c = null;
        if (field === 'Calibrated_Score_Formula_Mode__c' && value === 'AsIs') next.Calibrated_Score_Factor__c = null;
        if (field === 'Source_Model_Id_Column__c' || field === 'Base_Score_Column__c' || field === 'Calibrated_Base_Score_Column__c' || field === 'Model_Source__c') {
            next[field] = value || '';
        }
        this.editSetting = next;
    }

    handleSettingFactorChange(e) {
        const field = e.target.dataset.field;
        const raw = e.detail?.value;
        if (raw === '' || raw == null) {
            this.editSetting = { ...this.editSetting, [field]: null };
            return;
        }
        const num = Number(raw);
        this.editSetting = { ...this.editSetting, [field]: Number.isFinite(num) ? num : null };
    }

    async handleSaveModelSetting() {
        const s = this.editSetting || {};
        const missing = [];
        if (!s.Data360_DMO__c) missing.push('Data360 DMO');
        if (!s.Scoring_Model__c) missing.push('Model ID');
        if (!s.Source_Model_Id_Column__c) missing.push('Source Model ID');
        if (!s.Model_Source__c) missing.push('Model Source');
        if (!s.Base_Score_Column__c) missing.push('Base Score column');
        if (!s.Calibrated_Base_Score_Column__c) missing.push('Calibrated Base Score column');
        if (!s.Model_From_Date__c) missing.push('Model From Date');
        if (!s.Model_To_Date__c) missing.push('Model To Date');
        if (this._formulaNeedsFactor(s.Base_Score_Formula_Mode__c) && !this._isNonZeroFactor(s.Base_Score_Factor__c)) {
            missing.push('Base Score factor');
        }
        if (this._formulaNeedsFactor(s.Calibrated_Score_Formula_Mode__c) && !this._isNonZeroFactor(s.Calibrated_Score_Factor__c)) {
            missing.push('Calibrated Base Score factor');
        }
        if (missing.length) {
            this._showToast('Validation', `Complete required fields: ${missing.join(', ')}`, 'warning');
            return;
        }
        if (s.Model_From_Date__c > s.Model_To_Date__c) {
            this._showToast('Validation', 'Model From Date must be on or before Model To Date.', 'warning');
            return;
        }
        this.isSaving = true;
        try {
            await saveScoringModelSetting({
                record: {
                    Id: s.Id || null,
                    Scoring_Model__c: s.Scoring_Model__c,
                    Data360_DMO__c: s.Data360_DMO__c,
                    Source_Model_Id_Column__c: s.Source_Model_Id_Column__c,
                    Model_Source__c: s.Model_Source__c,
                    Base_Score_Column__c: s.Base_Score_Column__c,
                    Base_Score_Formula_Mode__c: s.Base_Score_Formula_Mode__c || 'AsIs',
                    Base_Score_Factor__c: this._formulaNeedsFactor(s.Base_Score_Formula_Mode__c) ? s.Base_Score_Factor__c : null,
                    Calibrated_Base_Score_Column__c: s.Calibrated_Base_Score_Column__c,
                    Calibrated_Score_Formula_Mode__c: s.Calibrated_Score_Formula_Mode__c || 'AsIs',
                    Calibrated_Score_Factor__c: this._formulaNeedsFactor(s.Calibrated_Score_Formula_Mode__c) ? s.Calibrated_Score_Factor__c : null,
                    Model_From_Date__c: s.Model_From_Date__c,
                    Model_To_Date__c: s.Model_To_Date__c
                }
            });
            this._showToast('Success', 'Model setting saved.', 'success');
            this.isConfigureModalOpen = false;
            await refreshApex(this._wiredSettingsResult);
        } catch (err) {
            this._showToast('Error', err.body?.message || 'Save failed.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    _loadDmoFields(dmoApiName) {
        this.dmoColumnOptions = [];
        this.dmoNumericColumnOptions = [];
        if (!dmoApiName) {
            this.isLoadingDmoFields = false;
            return;
        }
        this.isLoadingDmoFields = true;
        getData360DmoFields({ dmoApiName })
            .then(rows => {
                if (this.editSetting?.Data360_DMO__c !== dmoApiName) return;
                const all = [];
                const numeric = [];
                (rows || []).forEach(r => {
                    const opt = { label: r.label, value: r.value };
                    all.push(opt);
                    if (r.numeric === 'true') numeric.push({ ...opt });
                });
                this.dmoColumnOptions = all;
                this.dmoNumericColumnOptions = numeric;
            })
            .catch(err => {
                if (this.editSetting?.Data360_DMO__c !== dmoApiName) return;
                this.dmoColumnOptions = [];
                this.dmoNumericColumnOptions = [];
                this._showToast('Error', err.body?.message || 'Could not load DMO columns.', 'error');
            })
            .finally(() => {
                if (this.editSetting?.Data360_DMO__c === dmoApiName) this.isLoadingDmoFields = false;
            });
    }

    _formulaNeedsFactor(mode) {
        return mode === 'Multiply' || mode === 'Divide';
    }

    _isNonZeroFactor(value) {
        return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) !== 0;
    }

    _scoreFormulaPreview(column, mode, factor) {
        if (!column) return 'Select a source column';
        const token = `{${column}}`;
        if (mode === 'Multiply' || mode === 'Divide') {
            const operator = mode === 'Multiply' ? '*' : '/';
            const shown = this._isNonZeroFactor(factor) ? String(factor) : '…';
            return `${token} ${operator} ${shown}`;
        }
        return token;
    }

    _formatSettingDate(value) {
        if (!value) return '';
        const parsed = new Date(`${value}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
