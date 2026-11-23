import { LightningElement, api } from 'lwc';
import { isolateNativeEvents } from 'c/ccEventGuard';

const AREA_POSITIONS = [
    { label: 'Before this area', value: 'before' },
    { label: 'After this area', value: 'after' }
];
const ELEMENT_POSITIONS = [
    { label: 'Before this element', value: 'before' },
    { label: 'After this element', value: 'after' },
    { label: 'Inside, at the start', value: 'inside-start' },
    { label: 'Inside, at the end', value: 'inside-end' }
];

/**
 * Step 2 of the shell setup: place, move or remove the dropzone where marketers add content blocks.
 * Emits place { position }, removezone, pick { node }, next.
 */
export default class CcDropzonePanel extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api placement = null;
    @api info = null;
    @api errors = [];
    @api canContinue = false;
    position = 'after';
    confirmingRemove = false;

    get hasPlacement() {
        return !!this.placement;
    }

    get placementText() {
        return this.placement ? this.placement.text : '';
    }

    get showIdleHint() {
        return !this.placement && !this.info;
    }

    get isZoneElement() {
        return !!this.info && this.info.isZone;
    }

    get isInsideArea() {
        return !!this.info && this.info.insideRegion && !this.info.isArea && !this.info.isZone;
    }

    get canPlace() {
        return !!this.info && !this.isZoneElement && !this.isInsideArea;
    }

    get insideName() {
        return this.info?.areaName || 'another area';
    }

    get targetLabel() {
        if (!this.info) return '';
        return this.info.isArea && this.info.areaName ? `the area "${this.info.areaName}"` : `<${this.info.tag}>`;
    }

    get positionOptions() {
        return this.info && this.info.isArea ? AREA_POSITIONS : ELEMENT_POSITIONS;
    }

    get placeLabel() {
        return this.hasPlacement ? 'Move dropzone here' : 'Place dropzone here';
    }

    get errorItems() {
        return (this.errors || []).map((message, index) => ({ key: `e${index}`, message }));
    }

    get hasErrors() {
        return (this.errors || []).length > 0;
    }

    handlePosition(event) {
        this.position = event.detail.value;
    }

    handlePlace() {
        const allowed = this.positionOptions.map(option => option.value);
        this.dispatchEvent(new CustomEvent('place', { detail: { position: allowed.includes(this.position) ? this.position : 'after' } }));
    }

    handleRemoveAsk() {
        this.confirmingRemove = true;
    }

    handleRemoveCancel() {
        this.confirmingRemove = false;
    }

    handleRemoveConfirm() {
        this.confirmingRemove = false;
        this.dispatchEvent(new CustomEvent('removezone'));
    }

    handleUseEnclosing() {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: this.info.areaNode } }));
    }

    handleNext() {
        this.dispatchEvent(new CustomEvent('next'));
    }
}
