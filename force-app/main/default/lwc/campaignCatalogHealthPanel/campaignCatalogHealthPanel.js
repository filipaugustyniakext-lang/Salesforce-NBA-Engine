import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getCampaignCatalogAssignmentSummary from '@salesforce/apex/CampaignRuntimeCatalogService.getCampaignCatalogAssignmentSummary';

export default class CampaignCatalogHealthPanel extends LightningElement {
    @api recordId;

    summary;
    errorMessage;
    isLoading = true;
    wiredSummaryResult;

    @wire(getCampaignCatalogAssignmentSummary, { campaignId: '$recordId' })
    wiredSummary(result) {
        this.wiredSummaryResult = result;
        const { data, error } = result;
        this.isLoading = false;
        if (data) {
            this.summary = this.decorateSummary(data);
            this.errorMessage = undefined;
        } else if (error) {
            this.summary = undefined;
            this.errorMessage = this.reduceError(error);
        }
    }

    decorateSummary(data) {
        const offers = (data.offers || []).map((row) => this.decorateRow(row));
        const copyVariants = (data.copyVariants || []).map((row) => this.decorateRow(row));
        return {
            ...data,
            offers,
            copyVariants,
            offerHeadline: `${data.eligibleOfferCount || 0} of ${data.assignedOfferCount || 0} offers eligible now`,
            copyHeadline: `${data.eligibleCopyCount || 0} of ${data.assignedCopyCount || 0} copy variants eligible now`,
            hasAssignments: (data.assignedOfferCount || 0) + (data.assignedCopyCount || 0) > 0
        };
    }

    decorateRow(row) {
        const eligible = row.eligibleNow === true;
        const objectApiName = row.objectApiName || 'Offer__c';
        const recordUrl = row.id
            ? `/lightning/r/${objectApiName}/${row.id}/view`
            : '#';
        return {
            ...row,
            eligibleNow: eligible,
            recordUrl,
            statusBadgeClass: eligible
                ? 'slds-badge slds-theme_success'
                : 'slds-badge slds-theme_warning',
            statusBadgeLabel: eligible ? 'Eligible now' : 'Not eligible now',
            rowClass: eligible ? '' : 'slds-hint-parent row-ineligible'
        };
    }

    reduceError(error) {
        if (Array.isArray(error?.body)) {
            return error.body.map((e) => e.message).join(', ');
        }
        return error?.body?.message || error?.message || 'Unable to load catalogue health.';
    }

    handleRefresh() {
        this.isLoading = true;
        refreshApex(this.wiredSummaryResult).finally(() => {
            this.isLoading = false;
        });
    }

    get showGapAlert() {
        return this.summary?.hasCatalogGap === true;
    }

    get showEmptyState() {
        return this.summary && !this.summary.hasAssignments;
    }
}
