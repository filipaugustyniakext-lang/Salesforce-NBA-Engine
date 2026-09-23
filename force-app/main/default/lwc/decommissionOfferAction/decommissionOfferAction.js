import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CloseActionScreenEvent } from 'lightning/actions';
import decommissionOffer from '@salesforce/apex/OfferController.decommissionOffer';

export default class DecommissionOfferAction extends LightningElement {
    @api recordId;
    @track isLoading = false;

    // Platform calls invoke() when its own footer button is clicked — close immediately
    // since we own our own buttons inside the body.
    @api invoke() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }

    handleCancel() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }

    async handleConfirm() {
        this.isLoading = true;
        try {
            await decommissionOffer({ offerId: this.recordId });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Decommissioned',
                message: 'This offer has been permanently decommissioned.',
                variant: 'warning',
                mode: 'sticky'
            }));
            this.dispatchEvent(new CloseActionScreenEvent());
        } catch (err) {
            this.isLoading = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: err?.body?.message || 'Failed to decommission offer.',
                variant: 'error',
                mode: 'sticky'
            }));
        }
    }
}