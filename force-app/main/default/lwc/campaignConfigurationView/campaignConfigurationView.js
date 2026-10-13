import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getCampaignConfigurationView from '@salesforce/apex/MarketingDictionaryController.getCampaignConfigurationView';
import { parseFullName } from 'c/copyMessageNaming';

function formatDateTime(value) {
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

function yesNo(value) {
    return value === true ? 'Yes' : 'No';
}

export default class CampaignConfigurationView extends NavigationMixin(LightningElement) {
    @api recordId;

    campaign;
    offers = [];
    copyVariants = [];
    loadError;

    @wire(getCampaignConfigurationView, { campaignId: '$recordId' })
    wiredView({ data, error }) {
        if (data) {
            this.loadError = undefined;
            this.campaign = data.campaign;
            this.offers = data.offers || [];
            this.copyVariants = (data.copyVariants || []).map(row => {
                const parsed = parseFullName(row.name);
                return {
                    ...row,
                    messageName: parsed.messageName || row.name,
                    variantNumber: row.version != null ? String(row.version) : (parsed.variant != null ? String(parsed.variant) : '—'),
                    eligibleLabel: row.eligible ? 'Eligible' : 'Ineligible',
                    eligibleClass: row.eligible ? 'slds-badge slds-theme_success' : 'slds-badge slds-theme_shade',
                    statusClass: this.statusBadgeClass(row.status)
                };
            });
        } else if (error) {
            this.loadError = error?.body?.message || error?.message || 'Could not load campaign configuration.';
            this.campaign = undefined;
            this.offers = [];
            this.copyVariants = [];
        }
    }

    statusBadgeClass(status) {
        const key = (status || '').toLowerCase();
        const map = {
            draft: 'slds-badge slds-theme_lightest',
            ready: 'slds-badge slds-theme_info',
            published: 'slds-badge slds-theme_success',
            archived: 'slds-badge slds-theme_shade'
        };
        return map[key] || 'slds-badge slds-theme_lightest';
    }

    get hasData() {
        return !!this.campaign;
    }

    get campaignGroupName() {
        return this.campaign?.Campaign_Group_Dict__r?.Name || '—';
    }

    get topicName() {
        return this.campaign?.Topic_Dict__r?.Name || this.campaign?.Topic_Name__c || '—';
    }

    get scoringModelName() {
        return this.campaign?.Scoring_Model_Dict__r?.Name || '—';
    }

    get activeFromLabel() {
        return formatDateTime(this.campaign?.Active_From__c);
    }

    get activeToLabel() {
        return formatDateTime(this.campaign?.Active_To__c);
    }

    get durationDaysLabel() {
        const val = this.campaign?.Duration_Days__c;
        return val != null ? String(val) : '—';
    }

    get fallbackScoreLabel() {
        const val = this.campaign?.Fallback_Score__c;
        return val != null ? String(val) : '—';
    }

    get excludeOnboardingLabel() {
        return yesNo(this.campaign?.Exclude_Onboarding__c);
    }

    get isActiveLabel() {
        return yesNo(this.campaign?.IsActive);
    }

    get offeringItemsLabel() {
        if (!this.campaign) {
            return '—';
        }
        const type = (this.campaign.Offering_Type__c || '').toLowerCase();
        if (type.includes('family of needs')) {
            return this.campaign.Family_of_Needs__c || '—';
        }
        return this.campaign.Product_Family__c || '—';
    }

    get hasOffers() {
        return this.offers.length > 0;
    }

    get hasCopyVariants() {
        return this.copyVariants.length > 0;
    }

    handleOpenCopyVariant(event) {
        const variantId = event.currentTarget.dataset.id;
        if (!variantId) {
            return;
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Copy_Center' },
            state: { c__editId: variantId }
        });
    }

    handleOpenOffer(event) {
        const offerId = event.currentTarget.dataset.id;
        if (!offerId) {
            return;
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: offerId,
                objectApiName: 'Offer__c',
                actionName: 'view'
            }
        });
    }
}
