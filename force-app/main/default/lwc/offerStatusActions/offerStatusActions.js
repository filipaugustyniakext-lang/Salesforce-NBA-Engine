import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, getFieldValue, notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import deactivateOffer from '@salesforce/apex/OfferController.deactivateOffer';
import decommissionOffer from '@salesforce/apex/OfferController.decommissionOffer';

import OFFER_STATUS_FIELD from '@salesforce/schema/Offer__c.Offer_Status__c';

export default class OfferStatusActions extends LightningElement {
    @api recordId;

    @track isLoading = false;
    @track showDeactivateModal = false;
    @track showDecommissionModal = false;

    @wire(getRecord, { recordId: '$recordId', fields: [OFFER_STATUS_FIELD] })
    offer;

    get offerStatus() {
        return getFieldValue(this.offer.data, OFFER_STATUS_FIELD);
    }

    get showDeactivate() {
        return this.offerStatus === 'Active';
    }

    get showDecommission() {
        const s = this.offerStatus;
        return s && s !== 'Decommissioned';
    }

    // ─── Deactivate ──────────────────────────────────────────────────────────

    handleDeactivateClick() { this.showDeactivateModal = true; }
    handleDeactivateCancel() { this.showDeactivateModal = false; }

    async handleDeactivateConfirm() {
        this.showDeactivateModal = false;
        this.isLoading = true;
        try {
            await deactivateOffer({ offerId: this.recordId });
            notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Deactivated',
                message: 'This offer is now Inactive. The current version has been moved to Ready.',
                variant: 'warning'
            }));
        } catch (err) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: err?.body?.message || 'Failed to deactivate offer.',
                variant: 'error',
                mode: 'sticky'
            }));
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Decommission ─────────────────────────────────────────────────────────

    handleDecommissionClick() { this.showDecommissionModal = true; }
    handleDecommissionCancel() { this.showDecommissionModal = false; }

    async handleDecommissionConfirm() {
        this.showDecommissionModal = false;
        this.isLoading = true;
        try {
            await decommissionOffer({ offerId: this.recordId });
            notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Decommissioned',
                message: 'This offer has been permanently decommissioned. No versions can be reactivated.',
                variant: 'warning',
                mode: 'sticky'
            }));
        } catch (err) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: err?.body?.message || 'Failed to decommission offer.',
                variant: 'error',
                mode: 'sticky'
            }));
        } finally {
            this.isLoading = false;
        }
    }
}