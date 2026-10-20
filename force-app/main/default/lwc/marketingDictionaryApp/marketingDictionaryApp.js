import { LightningElement, track } from 'lwc';
import {
    MAIN_TAB_VALUES,
    persistMainTab,
    resolveMainTab
} from 'c/marketingDictionaryState';

export default class MarketingDictionaryApp extends LightningElement {
    @track activeTab = 'person';
    _channelAvailability = {};
    _readyForUserTabChanges = false;
    _restoredTab = 'person';

    connectedCallback() {
        this._restoredTab = resolveMainTab();
        this.activeTab = this._restoredTab;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            this._readyForUserTabChanges = true;
        });
    }

    handleMainTabActive(event) {
        const nextTab = event?.target?.value;
        if (!nextTab || !MAIN_TAB_VALUES.includes(nextTab)) {
            return;
        }

        if (!this._readyForUserTabChanges) {
            if (nextTab === this._restoredTab) {
                this.activeTab = nextTab;
            }
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