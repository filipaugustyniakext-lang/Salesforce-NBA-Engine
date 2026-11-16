import { LightningElement, api, track } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import getCustomerTypeValues from '@salesforce/apex/ProductBulkUpdateController.getCustomerTypeValues';
import updateCustomerType from '@salesforce/apex/ProductBulkUpdateController.updateCustomerType';

export default class UpdateCustomerType extends LightningElement {
    @track selectedValues = [];
    @track options = [];
    @track isLoading = true;
    @track recordIds = [];

    @api
    set invoke(context) {
        if (context && context.recordIds) {
            this.recordIds = context.recordIds;
        }
    }
    get invoke() {
        return undefined;
    }

    connectedCallback() {
        this.loadPicklistValues();
    }

    async loadPicklistValues() {
        try {
            const values = await getCustomerTypeValues();
            this.options = values.map(val => ({ label: val, value: val }));
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Failed to load Customer Type values',
                variant: 'error'
            }));
        } finally {
            this.isLoading = false;
        }
    }

    handleChange(event) {
        this.selectedValues = event.detail.value;
    }

    async handleSave() {
        if (!this.recordIds.length) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Warning',
                message: 'No products selected. Please select products from the list view.',
                variant: 'warning'
            }));
            return;
        }

        if (!this.selectedValues.length) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Warning',
                message: 'Please select at least one Customer Type value.',
                variant: 'warning'
            }));
            return;
        }

        this.isLoading = true;
        try {
            const joinedValues = this.selectedValues.join(';');
            await updateCustomerType({ productIds: this.recordIds, customerTypeValue: joinedValues });

            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: `Customer Type updated for ${this.recordIds.length} product(s).`,
                variant: 'success'
            }));

            await notifyRecordUpdateAvailable(this.recordIds.map(id => ({ recordId: id })));
            this.handleCancel();
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: error.body?.message || 'Failed to update Customer Type',
                variant: 'error'
            }));
        } finally {
            this.isLoading = false;
        }
    }

    handleCancel() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }

    get hasRecords() {
        return this.recordIds.length > 0;
    }

    get noRecordsLoaded() {
        return !this.isLoading && this.recordIds.length === 0;
    }

    get recordCountLabel() {
        return `${this.recordIds.length} product(s) selected`;
    }
}