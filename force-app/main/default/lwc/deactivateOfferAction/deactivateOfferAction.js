import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CloseActionScreenEvent } from 'lightning/actions';
import deactivateOffer from '@salesforce/apex/OfferController.deactivateOffer';

export default class DeactivateOfferAction extends LightningElement {
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
            await deactivateOffer({ offerId: this.recordId });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Offer Deactivated',
                message: 'The offer is now Inactive. The current version has been moved to Ready.',
                variant: 'warning'
            }));
            this.dispatchEvent(new CloseActionScreenEvent());
        } catch (err) {
            this.isLoading = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: err?.body?.message || 'Failed to deactivate offer.',
                variant: 'error',
                mode: 'sticky'
            }));
        }
    }
}