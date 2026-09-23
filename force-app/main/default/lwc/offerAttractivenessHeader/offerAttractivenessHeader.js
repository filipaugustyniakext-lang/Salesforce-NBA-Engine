import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import ATTRACTIVENESS_FIELD from '@salesforce/schema/Offer__c.Attractiveness_Score__c';

export default class OfferAttractivenessHeader extends LightningElement {
    @api recordId;

    @wire(getRecord, { recordId: '$recordId', fields: [ATTRACTIVENESS_FIELD] })
    offer;

    get score() {
        return getFieldValue(this.offer?.data, ATTRACTIVENESS_FIELD);
    }
}