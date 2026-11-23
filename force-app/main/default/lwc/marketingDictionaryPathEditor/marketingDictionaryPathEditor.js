import { LightningElement, api, track } from 'lwc';
import LightningAlert from 'lightning/alert';

const RENAME_WARNING = 'Changing a path name may result in unexpected processing results if any current NBA process '
    + 'refers to the path label rather than the path label ID. Make sure that your processes, for example in Data360, '
    + 'are not affected or are properly updated.';
const TOTAL = 100;

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

function sortPaths(list) {
    return [...(list || [])].sort((a, b) => {
        if (!!a.Is_Active__c !== !!b.Is_Active__c) return a.Is_Active__c ? -1 : 1;
        return String(a.Name || '').localeCompare(String(b.Name || ''));
    });
}

/**
 * Edits the name, audience type, active flag and allocation of every Activation Path in one modal.
 * Every path applies to one audience type (referenced by its dictionary record Id). For each audience type the
 * active paths must add up to exactly 100%; an inactive path always carries 0%.
 * Emits save { records: [{ Id, Name, Path_Description__c, Audience_Type_Dict__c, Is_Active__c, Distribution_Percent__c }] }
 * (changed paths only) and close.
 */
export default class MarketingDictionaryPathEditor extends LightningElement {
    @api saving = false;
    @api errorMessage = '';
    @track rows = [];
    _audienceTypes = [];

    /** Audience types from the Person section: [{ Id, Name }]. Labels are shown, the Id is what is stored. */
    @api
    get audienceTypes() {
        return this._audienceTypes;
    }
    set audienceTypes(list) {
        this._audienceTypes = [...(list || [])].sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || '')));
    }

    @api
    get paths() {
        return this.rows;
    }
    set paths(list) {
        this.rows = sortPaths(list).map(path => ({
            id: path.Id,
            name: path.Name || '',
            originalName: path.Name || '',
            description: path.Path_Description__c || '',
            originalDescription: path.Path_Description__c || '',
            audienceId: path.Audience_Type_Dict__c || null,
            originalAudienceId: path.Audience_Type_Dict__c || null,
            active: path.Is_Active__c === true,
            originalActive: path.Is_Active__c === true,
            percent: path.Is_Active__c === true ? round2(path.Distribution_Percent__c) : 0,
            originalPercent: path.Is_Active__c === true ? round2(path.Distribution_Percent__c) : 0,
            alerted: false
        }));
    }

    // ─── View model ──────────────────────────────────────────────────────────

    get renameWarning() {
        return RENAME_WARNING;
    }

    isRenamed(row) {
        return row.name.trim() !== row.originalName.trim();
    }

    get audienceOptions() {
        return this._audienceTypes.map(audience => ({ label: audience.Name, value: audience.Id }));
    }

    get hasNoAudienceTypes() {
        return this._audienceTypes.length === 0;
    }

    audienceName(id) {
        return this._audienceTypes.find(audience => audience.Id === id)?.Name || 'Unknown audience type';
    }

    get activeCount() {
        return this.rows.filter(row => row.active).length;
    }

    get nameProblems() {
        const seen = new Map();
        this.rows.forEach(row => {
            const key = row.name.trim().toLowerCase();
            seen.set(key, (seen.get(key) || 0) + 1);
        });
        const problems = {};
        this.rows.forEach(row => {
            const key = row.name.trim().toLowerCase();
            if (!key) problems[row.id] = 'Enter a name.';
            else if (seen.get(key) > 1) problems[row.id] = 'Another path already has this name.';
        });
        return problems;
    }

    get viewRows() {
        const problems = this.nameProblems;
        return this.rows.map(row => ({
            key: row.id,
            id: row.id,
            name: row.name,
            description: row.description,
            active: row.active,
            audienceId: row.audienceId,
            audienceMissing: !row.audienceId,
            radioName: `audience-${row.id}`,
            percentValue: String(row.percent),
            percentDisabled: !row.active,
            statusLabel: row.active ? 'Active' : 'Inactive',
            statusClass: row.active ? 'slds-badge path-badge_active' : 'slds-badge slds-badge_lightest',
            nameError: problems[row.id] || '',
            renamed: this.isRenamed(row),
            zeroWarning: row.active && row.percent === 0,
            rowClass: row.active ? '' : 'path-row_inactive'
        }));
    }

    get hasRenames() {
        return this.rows.some(row => this.isRenamed(row));
    }

    get renamedList() {
        return this.rows
            .filter(row => this.isRenamed(row))
            .map(row => ({ key: row.id, text: `"${row.originalName}" becomes "${row.name.trim()}"` }));
    }

    /** One group per audience type that has paths: the active paths of a group must add up to 100%. */
    get groups() {
        const known = this._audienceTypes.map(audience => audience.Id);
        const ids = [...known.filter(id => this.rows.some(row => row.audienceId === id))];
        this.rows.forEach(row => {
            if (row.audienceId && !ids.includes(row.audienceId)) ids.push(row.audienceId);
        });
        return ids.map(id => {
            const members = this.rows.filter(row => row.audienceId === id);
            const active = members.filter(row => row.active);
            const total = round2(active.reduce((sum, row) => sum + row.percent, 0));
            const balance = round2(TOTAL - total);
            const complete = active.length > 0 && balance === 0;
            let balanceText;
            if (!active.length) balanceText = 'Activate at least one path.';
            else if (balance === 0) balanceText = 'Active paths add up to 100%.';
            else if (balance > 0) balanceText = `${balance}% still to allocate. Active paths must add up to 100%.`;
            else balanceText = `${round2(-balance)}% over. Active paths must add up to 100%.`;
            return {
                key: id,
                audienceId: id,
                name: this.audienceName(id),
                total,
                totalText: `${total}%`,
                totalClass: `path-total ${complete ? 'path-total_ok' : 'path-total_bad'}`,
                balanceText,
                complete,
                activeCount: active.length,
                equalDisabled: !active.length || this.saving
            };
        });
    }

    get unassignedCount() {
        return this.rows.filter(row => !row.audienceId).length;
    }

    get hasUnassigned() {
        return this.unassignedCount > 0;
    }

    get validationMessages() {
        const messages = [];
        if (this.hasNoAudienceTypes) messages.push('Add audience types in the Person section first.');
        if (this.hasUnassigned) messages.push('Select an audience type for every path.');
        this.groups.forEach(group => {
            if (!group.complete) messages.push(`${group.name}: ${group.balanceText}`);
        });
        if (Object.keys(this.nameProblems).length) messages.push('Every path needs a unique name.');
        return messages.map((text, index) => ({ key: `m${index}`, text }));
    }

    get hasValidationMessages() {
        return this.validationMessages.length > 0;
    }

    get changedRows() {
        return this.rows.filter(row => this.isRenamed(row)
            || row.description.trim() !== row.originalDescription.trim()
            || row.audienceId !== row.originalAudienceId
            || row.active !== row.originalActive
            || row.percent !== row.originalPercent);
    }

    get hasChanges() {
        return this.changedRows.length > 0;
    }

    get saveDisabled() {
        return this.saving || !this.hasChanges || this.hasValidationMessages;
    }

    get hasServerError() {
        return !!this.errorMessage;
    }

    get allocateDisabled() {
        return !this.activeCount || this.saving;
    }

    get showGroups() {
        return this.groups.length > 0;
    }

    // ─── Editing ─────────────────────────────────────────────────────────────

    rowById(id) {
        return this.rows.find(row => row.id === id);
    }

    handleName(event) {
        const row = this.rowById(event.currentTarget.dataset.id);
        if (row) row.name = event.detail.value || '';
    }

    /** Fires when the field loses focus or Enter is pressed: the moment a rename is considered made. */
    async handleNameCommit(event) {
        const row = this.rowById(event.currentTarget.dataset.id);
        if (!row) return;
        await this.alertIfRenamed(row);
    }

    async alertIfRenamed(row) {
        if (!this.isRenamed(row) || !row.name.trim() || row.alerted) return;
        row.alerted = true;
        await LightningAlert.open({ message: RENAME_WARNING, theme: 'warning', label: 'Path name changed' });
    }

    handleAudience(event) {
        const row = this.rowById(event.currentTarget.dataset.id);
        if (row) row.audienceId = event.detail.value || null;
    }

    handleDescription(event) {
        const row = this.rowById(event.currentTarget.dataset.id);
        if (row) row.description = event.detail.value || '';
    }

    handleActive(event) {
        const row = this.rowById(event.currentTarget.dataset.id);
        if (!row) return;
        row.active = event.target.checked === true;
        row.percent = 0;
    }

    handlePercent(event) {
        const row = this.rowById(event.currentTarget.dataset.id);
        if (!row || !row.active) return;
        const parsed = Number(event.detail.value);
        row.percent = Number.isFinite(parsed) ? round2(Math.min(TOTAL, Math.max(0, parsed))) : 0;
    }

    splitEqually(rows) {
        if (!rows.length) return;
        const base = Math.floor((TOTAL * 100) / rows.length) / 100;
        let leftoverCents = Math.round((TOTAL - base * rows.length) * 100);
        rows.forEach(row => {
            row.percent = round2(base + (leftoverCents > 0 ? 0.01 : 0));
            if (leftoverCents > 0) leftoverCents -= 1;
        });
    }

    /** Splits 100% equally across the active paths of every audience type. */
    handleAllocateEqually() {
        this.groups.forEach(group => {
            this.splitEqually(this.rows.filter(row => row.audienceId === group.audienceId && row.active));
        });
    }

    handleGroupEqually(event) {
        const audienceId = event.currentTarget.dataset.audience;
        this.splitEqually(this.rows.filter(row => row.audienceId === audienceId && row.active));
    }

    async handleSave() {
        if (this.saveDisabled) return;
        for (const row of this.rows) {
            // Make sure a rename typed just before pressing Save was warned about.
            // eslint-disable-next-line no-await-in-loop
            await this.alertIfRenamed(row);
        }
        const records = this.changedRows.map(row => ({
            Id: row.id,
            Name: row.name.trim(),
            Path_Description__c: row.description.trim(),
            Audience_Type_Dict__c: row.audienceId,
            Is_Active__c: row.active,
            Distribution_Percent__c: row.active ? row.percent : 0
        }));
        this.dispatchEvent(new CustomEvent('save', { detail: { records } }));
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
