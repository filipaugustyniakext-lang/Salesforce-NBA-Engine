import { LightningElement, api } from 'lwc';

/**
 * Node selector: the path of the picked element (parents) and its children, so the right container can be
 * chosen without hunting for it in the preview. `info` comes from inspectNode() in c/ccElementMarking.
 * Emits pick { node } and, when `allowGroup` is set, groupchildren.
 */
export default class CcElementPath extends LightningElement {
    @api info;
    @api allowGroup = false;

    get hasInfo() {
        return !!this.info;
    }

    get path() {
        const items = this.info?.path || [];
        return items.map((item, index) => {
            const current = index === items.length - 1;
            return {
                ...item,
                key: `${item.node}`,
                current,
                className: `cc-path__crumb${item.marked ? ' cc-path__crumb_marked' : ''}${current ? ' cc-path__crumb_current' : ''}`
            };
        });
    }

    get children() {
        return (this.info?.children || []).map(item => ({
            ...item,
            key: `${item.node}`,
            className: `cc-path__crumb${item.marked ? ' cc-path__crumb_marked' : ''}`
        }));
    }

    get hasChildren() {
        return this.children.length > 0;
    }

    get hiddenChildren() {
        return Math.max(0, (this.info?.childCount || 0) - this.children.length);
    }

    get canGroupChildren() {
        return !!this.allowGroup && (this.info?.childCount || 0) > 1;
    }

    handlePick(event) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { node: Number(event.currentTarget.dataset.node) } }));
    }

    handleGroupChildren() {
        this.dispatchEvent(new CustomEvent('groupchildren'));
    }
}
