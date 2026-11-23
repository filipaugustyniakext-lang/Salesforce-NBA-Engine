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
 * Edits the name, active flag and allocation of every Activation Path in one modal.
 * Active paths must add up to exactly 100%; an inactive path always carries 0%.
 * Emits save { records: [{ Id, Name, Is_Active__c, Distribution_Percent__c }] } (changed paths only) and close.
 */
export default class MarketingDictionaryPathEditor extends LightningElement {
    @api saving = false;
    @api errorMessage = '';
    @track rows = [];

    @api
    get paths() {
        return this.rows;
    }
    set paths(list) {
        this.rows = sortPaths(list).map(path => ({
            id: path.Id,
            name: path.Name || '',
            originalName: path.Name || '',
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

    get total() {
        return round2(this.rows.filter(row => row.active).reduce((sum, row) => sum + row.percent, 0));
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
            active: row.active,
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

    get balance() {
        return round2(TOTAL - this.total);
    }

    get totalText() {
        return `${this.total}%`;
    }

    get totalClass() {
        return `path-total ${this.balance === 0 && this.activeCount > 0 ? 'path-total_ok' : 'path-total_bad'}`;
    }

    get balanceText() {
        if (!this.activeCount) return 'Activate at least one path.';
        if (this.balance === 0) return 'Active paths add up to 100%.';
        return this.balance > 0
            ? `${this.balance}% still to allocate. Active paths must add up to 100%.`
            : `${round2(-this.balance)}% over. Active paths must add up to 100%.`;
    }

    get validationMessages() {
        const messages = [];
        if (!this.activeCount) messages.push('At least one path must be active.');
        else if (this.balance !== 0) messages.push(`Allocation must be 100%: ${this.balanceText}`);
        if (Object.keys(this.nameProblems).length) messages.push('Every path needs a unique name.');
        return messages.map((text, index) => ({ key: `m${index}`, text }));
    }

    get hasValidationMessages() {
        return this.validationMessages.length > 0;
    }

    get changedRows() {
        return this.rows.filter(row => this.isRenamed(row)
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

    handleAllocateEqually() {
        const active = this.rows.filter(row => row.active);
        if (!active.length) return;
        const base = Math.floor((TOTAL * 100) / active.length) / 100;
        let leftoverCents = Math.round((TOTAL - base * active.length) * 100);
        active.forEach(row => {
            row.percent = round2(base + (leftoverCents > 0 ? 0.01 : 0));
            if (leftoverCents > 0) leftoverCents -= 1;
        });
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
            Is_Active__c: row.active,
            Distribution_Percent__c: row.active ? row.percent : 0
        }));
        this.dispatchEvent(new CustomEvent('save', { detail: { records } }));
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
