import { LightningElement, track } from 'lwc';

export default class MarketingDictionaryScoringTab extends LightningElement {
    @track activeSubTab = 'definitions';

    get isDefinitions() {
        return this.activeSubTab === 'definitions';
    }

    get isSettings() {
        return this.activeSubTab === 'settings';
    }

    get definitionsClass() {
        return this._tabClass(this.isDefinitions);
    }

    get settingsClass() {
        return this._tabClass(this.isSettings);
    }

    handleSubTabClick(event) {
        this.activeSubTab = event.currentTarget.dataset.tab;
    }

    _tabClass(isActive) {
        return 'vtab-item' + (isActive ? ' vtab-item_active' : '');
    }
}
