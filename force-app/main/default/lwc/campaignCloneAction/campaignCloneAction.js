import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

/**
 * Headless record action "Clone" for a Campaign: opens the Campaign Creation Wizard (Aura wrapper
 * c:campaignCloneApp, URL /lightning/cmp/c__campaignCloneApp) with this campaign as the source.
 * The standard Clone action cannot be overridden with a Lightning component, so the record page uses this action.
 */
export default class CampaignCloneAction extends NavigationMixin(LightningElement) {
    @api recordId;

    @api invoke() {
        if (!this.recordId) {
            return;
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__component',
            attributes: { componentName: 'c__campaignCloneApp' },
            state: { c__sourceId: this.recordId }
        });
    }
}
