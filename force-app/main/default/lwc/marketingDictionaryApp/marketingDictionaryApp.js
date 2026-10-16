import { LightningElement, track } from 'lwc';
import {
    mainTabFromActiveEvent,
    persistMainTab,
    resolveMainTab
} from 'c/marketingDictionaryState';

export default class MarketingDictionaryApp extends LightningElement {
    @track activeTab = 'person';
    _channelAvailability = {};
    _acceptTabActiveEvents = false;

    connectedCallback() {
        this.activeTab = resolveMainTab();
        // Ignore the tabset's initial onactive (it can reset to the first tab).
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            this._acceptTabActiveEvents = true;
        });
    }

    handleTabChange(event) {
        if (!this._acceptTabActiveEvents) {
            return;
        }
        const nextTab = mainTabFromActiveEvent(event);
        if (!nextTab || nextTab === this.activeTab) {
            return;
        }
        this.activeTab = persistMainTab(nextTab);
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