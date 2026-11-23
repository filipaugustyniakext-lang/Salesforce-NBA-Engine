import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { exampleFor } from 'c/ccBindingExamples';

const SECTION_ROWS = [
    { attribute: 'data-cc-section', values: 'container | row | column', meaning: 'Marks a section. A container holds rows, a row holds columns, a column holds content. A row without columns counts as one column.' },
    { attribute: 'data-cc-id', values: 'unique slug', meaning: 'Optional stable id. Generated when missing (block, row-1, row-1-col-2). Set it if you rename or reorder sections later.' },
    { attribute: 'data-cc-bind', values: 'padding margin background hide column-direction', meaning: 'Settings marketers may change on that element. Space separated. column-direction works on rows only. Add color and gradient presets for background in the editor after upload.' }
];
const REGION_ROWS = [
    { attribute: 'data-cc-region="fixed-read"', values: '', meaning: 'Read-only part (header, legal text). Rendered exactly as uploaded.' },
    { attribute: 'data-cc-region="fixed-edit"', values: '', meaning: 'Always shown, section settings are fixed, content bindings inside stay editable.' },
    { attribute: 'data-cc-region="blocks"', values: '', meaning: 'Drop zone for content blocks. Multi-block shells need exactly one; single-block templates must not have it.' }
];
const CONTENT_ROWS = [
    { attribute: 'data-cc-content="richText"', values: 'data-cc-key, data-cc-complexity', meaning: 'Any element. Its inner HTML is replaced by the rich text. You can use several, each with its own key.' },
    { attribute: 'data-cc-content="image"', values: 'data-cc-key', meaning: 'Must be an <img>. src, alt, width and height are set; mobile and dark images fall back to desktop and light.' },
    { attribute: 'data-cc-content="bulletList"', values: 'data-cc-key', meaning: 'Container with one child data-cc-loop="item" holding data-cc-slot="text" and optional data-cc-slot="icon". Wrap the icon in data-cc-slot="icon-cell" to remove its whole cell.' },
    { attribute: 'data-cc-content="divider"', values: 'data-cc-key', meaning: 'Padding is applied to the element; a child data-cc-slot="line" is the optional horizontal line.' },
    { attribute: 'data-cc-content="button"', values: 'data-cc-key', meaning: 'Must be an <a>. Label, link, target and alias are set; removed when hidden.' },
    { attribute: 'data-cc-key', values: 'letters, digits, _ -', meaning: 'Required on every content element, unique within the file. data-cc-label sets the name marketers see.' }
];

/** Collapsible instructions on how to prepare template HTML for data binding, with a downloadable example. */
export default class CcBindingGuide extends LightningElement {
    @api kind = 'block';
    @api templateMode = 'multi';
    @api open = false;
    sectionRows = SECTION_ROWS;
    regionRows = REGION_ROWS;
    contentRows = CONTENT_ROWS;

    get isShell() {
        return this.kind === 'shell';
    }

    get isMultiShell() {
        return this.kind === 'shell' && this.templateMode !== 'single';
    }

    get title() {
        return this.isMultiShell ? 'How to prepare the template shell' : 'How to prepare the HTML for binding';
    }

    get example() {
        return exampleFor(this.kind, this.templateMode);
    }

    get exampleFileName() {
        return this.isMultiShell ? 'template-shell-example.html' : 'content-block-example.html';
    }

    get downloadHref() {
        return `data:text/html;charset=utf-8,${encodeURIComponent(this.example)}`;
    }

    async handleCopy() {
        try {
            await navigator.clipboard.writeText(this.example);
            this.dispatchEvent(new ShowToastEvent({ title: 'Example copied', variant: 'success' }));
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Copy failed', message: 'Select the example and copy it manually.', variant: 'warning' }));
        }
    }
}
