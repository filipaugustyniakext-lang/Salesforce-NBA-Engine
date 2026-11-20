import { LightningElement, api } from 'lwc';
import { normalizeSpacing, defaultSpacing } from 'c/ccTemplateSchema';

const SIDES = [
    { key: 'top', label: 'Top' },
    { key: 'right', label: 'Right' },
    { key: 'bottom', label: 'Bottom' },
    { key: 'left', label: 'Left' }
];

export default class CcSpacingInput extends LightningElement {
    @api label = 'Padding';
    @api disabled = false;
    _value = defaultSpacing(0);

    @api
    get value() {
        return this._value;
    }
    set value(next) {
        this._value = normalizeSpacing(next || defaultSpacing(0));
    }

    get desktop() {
        return this.deviceModel('desktop');
    }

    get mobile() {
        return this.deviceModel('mobile');
    }

    get mobileInherits() {
        return this._value.mobile.inheritFromDesktop !== false;
    }

    get showMobile() {
        return !this.mobileInherits;
    }

    deviceModel(device) {
        const sides = this._value[device];
        const chained = !!sides.chained;
        return {
            device,
            chained,
            chainIcon: chained ? 'utility:link' : 'utility:unlinked',
            chainTitle: chained ? 'All sides use one value. Click to set sides separately.' : 'Click to use one value for all sides.',
            fields: chained
                ? [{ key: 'top', label: 'All sides', value: sides.top, id: `${device}-all` }]
                : SIDES.map(side => ({ ...side, value: sides[side.key], id: `${device}-${side.key}` }))
        };
    }

    handleSide(event) {
        const { device, side } = event.target.dataset;
        const amount = Math.max(0, parseInt(event.target.value, 10) || 0);
        const next = JSON.parse(JSON.stringify(this._value));
        next[device][side] = amount;
        this.emit(next);
    }

    handleChain(event) {
        const { device } = event.currentTarget.dataset;
        const next = JSON.parse(JSON.stringify(this._value));
        next[device].chained = !next[device].chained;
        this.emit(next);
    }

    handleInherit(event) {
        const next = JSON.parse(JSON.stringify(this._value));
        next.mobile.inheritFromDesktop = event.target.checked;
        this.emit(next);
    }

    emit(next) {
        this._value = normalizeSpacing(next);
        this.dispatchEvent(new CustomEvent('change', { detail: { value: this._value } }));
    }
}
