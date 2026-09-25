import { LightningElement, track } from 'lwc';

export default class MarketingDictionaryApp extends LightningElement {
    @track activeTab = 'person';
    _channelAvailability = {};

    handleTabChange(event) {
        this.activeTab = event.target.value;
    }

    handleChannelActiveChange(event) {
        this._channelAvailability = {
            ...this._channelAvailability,
            [event.detail.channelId]: event.detail.isActive
        };
        this._applyChannelAvailability();
    }

    renderedCallback() {
        this._applyChannelAvailability();
    }

    _applyChannelAvailability() {
        const blackoutTab = this.template.querySelector('c-marketing-dictionary-blackout-tab');
        if (blackoutTab) {
            Object.entries(this._channelAvailability).forEach(([channelId, isActive]) => {
                blackoutTab.handleChannelAvailabilityChange(channelId, isActive);
            });
        }
    }
}