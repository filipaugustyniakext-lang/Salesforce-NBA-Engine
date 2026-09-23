import { LightningElement, track } from 'lwc';

export default class MarketingDictionaryApp extends LightningElement {
    @track activeTab = 'person';

    handleTabChange(event) {
        this.activeTab = event.target.value;
    }
}