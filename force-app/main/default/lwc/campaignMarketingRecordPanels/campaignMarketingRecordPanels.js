import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { refreshApex } from '@salesforce/apex';
import getCampaignCatalogAssignmentSummary from '@salesforce/apex/CampaignRuntimeCatalogService.getCampaignCatalogAssignmentSummary';

import EXCLUSIONS_JSON from '@salesforce/schema/Campaign.Campaign_Exclusions_JSON__c';
import EXCLUDE_OTHER from '@salesforce/schema/Campaign.Exclude_Other_Marketing_Activations__c';
import ASSIGNED_CHANNELS from '@salesforce/schema/Campaign.Assigned_Channels__c';

const DETAILS_FIELDS = [EXCLUSIONS_JSON, EXCLUDE_OTHER, ASSIGNED_CHANNELS];

export default class CampaignMarketingRecordPanels extends LightningElement {
    /** `details` = Details tab extras; `related` = catalogue related lists */
    @api panelMode = 'details';

    @api recordId;

    summary;
    summaryError;
    wiredSummaryResult;
    isLoadingSummary = true;

    @wire(getRecord, { recordId: '$recordId', fields: DETAILS_FIELDS })
    campaign;

    @wire(getCampaignCatalogAssignmentSummary, { campaignId: '$recordId' })
    wiredSummary(result) {
        this.wiredSummaryResult = result;
        this.isLoadingSummary = false;
        const { data, error } = result;
        if (data) {
            this.summary = this.decorateSummary(data);
            this.summaryError = undefined;
        } else if (error) {
            this.summary = undefined;
            this.summaryError = this.reduceError(error);
        }
    }

    get isDetailsMode() {
        return (this.panelMode || 'details').toLowerCase() === 'details';
    }

    get isRelatedMode() {
        return (this.panelMode || 'details').toLowerCase() === 'related';
    }

    get excludeOtherActivationsLabel() {
        return getFieldValue(this.campaign?.data, EXCLUDE_OTHER) === true ? 'Yes' : 'No';
    }

    get assignedChannelsDisplay() {
        const raw = getFieldValue(this.campaign?.data, ASSIGNED_CHANNELS);
        if (!raw) {
            return '—';
        }
        return raw.split(';').map((s) => s.trim()).filter(Boolean).join(', ');
    }

    get exclusionRows() {
        const raw = getFieldValue(this.campaign?.data, EXCLUSIONS_JSON);
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.map((row, index) => ({
                key: `ex-${index}`,
                source: row.source || row.type || '—',
                display: row.display || row.label || row.value || '—',
                mapping: row.mapping?.qualificationColumn
                    ? `${row.mapping.qualificationColumn} → ${row.mapping.foreignKeyColumn || '—'}`
                    : '—'
            }));
        } catch (e) {
            return [{ key: 'ex-parse', source: 'JSON', display: 'Unable to parse exclusions JSON', mapping: '—' }];
        }
    }

    get hasExclusions() {
        return this.exclusionRows.length > 0;
    }

    decorateSummary(data) {
        const mapRow = (row, objectApiName) => {
            const eligible = row.eligibleNow === true;
            const apiName = row.objectApiName || objectApiName;
            return {
                ...row,
                eligibleNow: eligible,
                recordUrl: row.id ? `/lightning/r/${apiName}/${row.id}/view` : '#',
                statusBadgeClass: eligible
                    ? 'slds-badge slds-theme_success'
                    : 'slds-badge slds-theme_warning',
                statusBadgeLabel: eligible ? 'Eligible now' : 'Not eligible now',
                rowClass: eligible ? '' : 'row-ineligible'
            };
        };
        return {
            ...data,
            offers: (data.offers || []).map((r) => mapRow(r, 'Offer__c')),
            copyVariants: (data.copyVariants || []).map((r) => mapRow(r, 'CC_Message_Metadata__c')),
            offerHeadline: `${data.eligibleOfferCount || 0} of ${data.assignedOfferCount || 0} offers eligible now`,
            copyHeadline: `${data.eligibleCopyCount || 0} of ${data.assignedCopyCount || 0} copy variants eligible now`,
            hasCatalogGap: data.hasCatalogGap === true
        };
    }

    reduceError(error) {
        if (Array.isArray(error?.body)) {
            return error.body.map((e) => e.message).join(', ');
        }
        return error?.body?.message || error?.message || 'Unable to load catalogue data.';
    }

    handleRefresh() {
        this.isLoadingSummary = true;
        refreshApex(this.wiredSummaryResult).finally(() => {
            this.isLoadingSummary = false;
        });
    }
}
