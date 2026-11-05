import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getJourneyHistory from '@salesforce/apex/JourneyMembershipController.getJourneyHistory';
import ejectFromJourney from '@salesforce/apex/JourneyMembershipController.ejectFromJourney';

export default class PersonAccountJourneys extends LightningElement {
    @api recordId;
    journeys = [];
    message = '';
    contactKeyLabel = '';
    isLoading = true;
    error;
    stoppingKey;
    expandedKeys = [];

    connectedCallback() {
        this.loadJourneys();
    }

    async loadJourneys() {
        this.isLoading = true;
        this.error = undefined;
        try {
            const result = await getJourneyHistory({ recordId: this.recordId });
            this.message = result?.message || '';
            this.contactKeyLabel = (result?.contactKeys || []).join(', ');
            const expanded = new Set(this.expandedKeys);
            this.journeys = (result?.journeys || []).map(row => this._decorate(row, expanded.has(row.rowKey)));
        } catch (error) {
            this.journeys = [];
            this.message = '';
            this.error = error?.body?.message || error?.message || 'Could not load journeys.';
        } finally {
            this.isLoading = false;
        }
    }

    handleRefresh() {
        this.loadJourneys();
    }

    handleToggle(event) {
        const rowKey = event.currentTarget.dataset.rowKey;
        const expanded = new Set(this.expandedKeys);
        if (expanded.has(rowKey)) {
            expanded.delete(rowKey);
        } else {
            expanded.add(rowKey);
        }
        this.expandedKeys = [...expanded];
        this.journeys = this.journeys.map(row => this._decorate(row, expanded.has(row.rowKey)));
    }

    _decorate(row, expanded) {
        const name = row.journeyName || '';
        return {
            ...row,
            expanded,
            shortName: name.length > 20 ? name.slice(0, 20) : name,
            chevronIcon: expanded ? 'utility:chevrondown' : 'utility:chevronright',
            expandLabel: expanded ? 'Hide journey details' : 'Show journey details',
            statusClass: statusClass(row.status),
            versionLabel: displayValue(row.versionLabel),
            latestActivityName: displayValue(row.latestActivityName),
            latestActivityType: displayValue(row.latestActivityType),
            latestActivityStatus: displayValue(row.latestActivityStatus),
            latestActivityId: displayValue(row.latestActivityId),
            activityDateLabel: displayValue(formatDate(row.latestActivityDate)),
            activityTypeClass: activityTypeBadgeClass(row.latestActivityType)
        };
    }

    async handleStop(event) {
        const rowKey = event.currentTarget.dataset.rowKey;
        const row = this.journeys.find(item => item.rowKey === rowKey);
        if (!row || !row.canStop || this.stoppingKey) {
            return;
        }
        const confirmed = await LightningConfirm.open({
            message: `Stop ${row.journeyName}? The contact will be ejected from this journey version.`,
            label: 'Stop journey',
            theme: 'warning'
        });
        if (!confirmed) {
            return;
        }
        this.stoppingKey = rowKey;
        try {
            await ejectFromJourney({
                recordId: this.recordId,
                contactKey: row.contactKey,
                definitionKey: row.definitionKey
            });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Journey stopped',
                message: `${row.journeyName} no longer includes this contact.`,
                variant: 'success'
            }));
            await this.loadJourneys();
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not stop the journey',
                message: error?.body?.message || error?.message || 'Marketing Cloud rejected the request.',
                variant: 'error'
            }));
        } finally {
            this.stoppingKey = '';
        }
    }
}

function activityTypeBadgeClass(type) {
    const value = String(type || '').trim().toLowerCase();
    if (!value || value === '—') {
        return 'slds-badge_lightest';
    }
    if (value.startsWith('wait')
        || value === 'path optimizer'
        || value.includes('decis')
        || value.includes('split')) {
        return 'journey-badge_path';
    }
    if (value.includes('activity') || value.includes('update')) {
        return 'journey-badge_action';
    }
    return 'slds-badge_lightest';
}

function displayValue(value) {
    return value ? value : '—';
}

function statusClass(status) {
    if (status === 'In-flight') {
        return 'slds-badge slds-theme_success';
    }
    if (status === 'Exit') {
        return 'slds-badge slds-theme_warning';
    }
    return 'slds-badge';
}

function formatDate(value) {
    if (!value) {
        return '';
    }
    return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
