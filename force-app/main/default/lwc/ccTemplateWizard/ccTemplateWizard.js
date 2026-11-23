import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getTemplateDetail from '@salesforce/apex/CcTemplateDefinitionController.getTemplateDetail';
import saveTemplate from '@salesforce/apex/CcTemplateDefinitionController.saveTemplate';
import saveBlock from '@salesforce/apex/CcTemplateDefinitionController.saveBlock';
import setBlockStatus from '@salesforce/apex/CcTemplateDefinitionController.setBlockStatus';
import deleteBlock from '@salesforce/apex/CcTemplateDefinitionController.deleteBlock';
import deleteTemplate from '@salesforce/apex/CcTemplateDefinitionController.deleteTemplate';
import validateTemplate from '@salesforce/apex/CcTemplateDefinitionController.validateTemplate';
import activateTemplate from '@salesforce/apex/CcTemplateDefinitionController.activateTemplate';
import getLocales from '@salesforce/apex/MarketingDictionaryManagerController.getLocales';
import { parseJson, buildBlockConfig, newMessageBlock, CONTENT_TYPE_LABELS } from 'c/ccTemplateSchema';
import { renderMessage } from 'c/ccTemplateRenderer';
import { parseTemplate } from 'c/ccTemplateParser';
import { annotateNodes, isUnmarked } from 'c/ccElementMarking';

const STEPS = [
    { value: 'basic', label: 'Basics' },
    { value: 'shell', label: 'Template shell' },
    { value: 'blocks', label: 'Content blocks' },
    { value: 'summary', label: 'Summary' }
];
const CLASSIFICATIONS = [
    { label: 'Commercial', value: 'Commercial' },
    { label: 'Transactional', value: 'Transactional' }
];
const MODES = [
    { label: 'Multi-block (marketers add content blocks)', value: 'multi' },
    { label: 'Single-block (the template is the block)', value: 'single' }
];

function errorMessage(error) {
    return error?.body?.message || error?.message || 'Something went wrong.';
}

export default class CcTemplateWizard extends LightningElement {
    @api channelId;
    @api channelName;
    @api templateId;
    classificationOptions = CLASSIFICATIONS;
    modeOptions = MODES;
    step = 'basic';
    loading = false;
    saving = false;
    status = 'Draft';
    localeOptions = [];
    basics = { slug: '', localeId: null, classification: 'Commercial', templateMode: 'multi', description: '' };
    shell = { html: '', definition: null, errors: [], warnings: [] };
    blocks = [];
    blockDraft = null;
    validation = null;
    previewChoice = 'all';
    inspectKey = null;
    pickedNodes = [];
    markOn = false;
    _annotated = { html: null, out: null };
    isLegacy = false;
    messageCount = 0;

    connectedCallback() {
        this.load();
    }

    async load() {
        this.loading = true;
        try {
            const locales = await getLocales();
            this.localeOptions = (locales || [])
                .filter(row => row.Is_Active__c)
                .map(row => ({ label: row.Topic_Description__c ? `${row.Name} · ${row.Topic_Description__c}` : row.Name, value: row.Id }));
            if (this.templateId) {
                await this.loadTemplate(this.templateId);
            } else {
                const fallback = (locales || []).find(row => row.Is_Default__c && row.Is_Active__c);
                this.basics = { ...this.basics, localeId: fallback?.Id || null };
            }
        } catch (error) {
            this.toast('Template could not be loaded', errorMessage(error), 'error');
        } finally {
            this.loading = false;
        }
    }

    async loadTemplate(templateId) {
        const detail = await getTemplateDetail({ templateId });
        this.templateId = detail.id;
        this.status = detail.status;
        this.isLegacy = !detail.isV1;
        this.messageCount = detail.messageCount || 0;
        this.basics = {
            slug: detail.slug || '',
            localeId: detail.localeId,
            classification: detail.classification || 'Commercial',
            templateMode: detail.templateMode || 'multi',
            description: detail.description || '',
            mceAssetId: detail.mceAssetId,
            mceAssetPath: detail.mceAssetPath,
            mcnAssetId: detail.mcnAssetId,
            mcnAssetPath: detail.mcnAssetPath
        };
        let shellHtml = detail.shellHtml || '';
        if (!detail.isV1 && shellHtml) {
            shellHtml = parseTemplate(shellHtml, { kind: 'shell', templateMode: detail.templateMode || 'multi' }).html;
        }
        this.shell = {
            html: shellHtml,
            definition: detail.isV1 ? parseJson(detail.definitionJson, null) : null,
            errors: [],
            warnings: []
        };
        this.blocks = (detail.blocks || []).map(block => ({ ...block, definition: parseJson(block.definitionJson, null) }));
    }

    // ─── Steps ───────────────────────────────────────────────────────────────

    get steps() {
        return STEPS.filter(item => item.value !== 'blocks' || this.isMulti).map((item, index) => ({
            ...item,
            number: index + 1,
            className: `cc-wizard__step${item.value === this.step ? ' cc-wizard__step_active' : ''}`
        }));
    }

    get isMulti() {
        return this.basics.templateMode === 'multi';
    }

    get isBasicStep() {
        return this.step === 'basic';
    }

    get isShellStep() {
        return this.step === 'shell';
    }

    get isBlocksStep() {
        return this.step === 'blocks';
    }

    get isSummaryStep() {
        return this.step === 'summary';
    }

    get showBack() {
        return this.step !== 'basic';
    }

    get isLastStep() {
        return this.step === 'summary';
    }

    get isActive() {
        return this.status === 'Active';
    }

    get title() {
        return this.templateId ? `Edit template ${this.basics.slug || ''}` : `New template for ${this.channelName || 'channel'}`;
    }

    get statusBadgeClass() {
        return `slds-badge${this.isActive ? ' slds-theme_success' : ''}`;
    }

    stepOrder() {
        return this.steps.map(item => item.value);
    }

    basicErrors() {
        const errors = [];
        if (!String(this.basics.slug || '').trim()) errors.push('Template name is required.');
        if (!this.basics.localeId) errors.push('Select a template locale.');
        if (!this.basics.classification) errors.push('Select a send classification.');
        return errors;
    }

    async handleNext() {
        if (this.step === 'basic') {
            const errors = this.basicErrors();
            if (errors.length) {
                this.toast('Complete the basics', errors.join(' '), 'warning');
                return;
            }
        }
        if (this.step === 'shell') {
            if (!this.shell.html) {
                this.toast('Upload the template shell', 'The template needs a shell HTML file.', 'warning');
                return;
            }
            const saved = await this.saveTemplateRecord(false);
            if (!saved) return;
            if (this.shell.errors.length) {
                this.toast('Shell saved with errors', 'Fix the listed errors before activating the template.', 'warning');
            }
        }
        const order = this.stepOrder();
        this.resetInspect();
        this.step = order[Math.min(order.indexOf(this.step) + 1, order.length - 1)];
        if (this.step === 'summary') this.runValidation();
    }

    handleBack() {
        const order = this.stepOrder();
        this.resetInspect();
        this.step = order[Math.max(order.indexOf(this.step) - 1, 0)];
    }

    handleStepClick(event) {
        const target = event.currentTarget.dataset.step;
        if (target !== 'basic' && !this.templateId && target !== 'shell') {
            this.toast('Save the shell first', 'Upload and save the template shell before configuring blocks.', 'info');
            return;
        }
        this.resetInspect();
        this.step = target;
        if (target === 'summary') this.runValidation();
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close', { detail: { templateId: this.templateId } }));
    }

    // ─── Step 1 & 2 ──────────────────────────────────────────────────────────

    handleBasic(event) {
        const field = event.target.dataset.field;
        this.basics = { ...this.basics, [field]: event.detail.value };
    }

    get modeLocked() {
        return this.isActive || this.blocks.length > 0;
    }

    get shellSource() {
        return { html: this.shell.html, definition: this.shell.definition };
    }

    handleShellChange(event) {
        this.noteUpload(event.detail);
        this.shell = { ...event.detail };
    }

    async saveTemplateRecord(showToast = true) {
        if (this.isActive && this.messageCount > 0) {
            const confirmed = await LightningConfirm.open({
                message: `This Active template is used by ${this.messageCount} message variant(s). Saving changes may affect how those messages render. Continue?`,
                label: 'Update Active template',
                theme: 'warning'
            });
            if (!confirmed) return false;
        }
        this.saving = true;
        try {
            const result = await saveTemplate({
                payloadJson: JSON.stringify({
                    id: this.templateId,
                    channelId: this.channelId,
                    ...this.basics,
                    shellHtml: this.shell.html,
                    definitionJson: this.shell.definition ? JSON.stringify(this.shell.definition) : null
                })
            });
            this.templateId = result.id;
            this.isLegacy = false;
            if (showToast) {
                this.toast('Template saved', result.validation?.valid ? 'The template is valid.' : 'Saved as draft with validation issues.', result.validation?.valid ? 'success' : 'warning');
            }
            this.dispatchEvent(new CustomEvent('saved', { detail: { templateId: result.id } }));
            return true;
        } catch (error) {
            this.toast('Template could not be saved', errorMessage(error), 'error');
            return false;
        } finally {
            this.saving = false;
        }
    }

    handleSaveTemplate() {
        this.saveTemplateRecord(true);
    }

    // ─── Step 3: blocks ──────────────────────────────────────────────────────

    get blockRows() {
        return this.blocks.map(block => ({
            ...block,
            typesLabel: (block.contentTypes || []).map(type => CONTENT_TYPE_LABELS[type] || type).join(', ') || 'No content',
            statusClass: `slds-badge${block.status === 'Active' ? ' slds-theme_success' : block.status === 'Ready' ? ' slds-badge_lightest' : ''}`,
            validClass: block.validationStatus === 'Valid' ? 'slds-text-color_success' : 'slds-text-color_error',
            canActivate: block.status !== 'Active' && block.validationStatus === 'Valid',
            canDeactivate: block.status === 'Active',
            canDelete: block.status !== 'Active' && !block.usageCount,
            rowClass: `cc-wizard__block-row${this.blockDraft?.id === block.id ? ' cc-wizard__block-row_selected' : ''}`
        }));
    }

    get hasBlocks() {
        return this.blocks.length > 0;
    }

    get blockSource() {
        return { html: this.blockDraft?.html || '', definition: this.blockDraft?.definition || null };
    }

    get blockDraftTitle() {
        return this.blockDraft?.id ? `Edit block ${this.blockDraft.name}` : 'New content block';
    }

    handleNewBlock() {
        this.resetInspect();
        this.blockDraft = { id: null, name: '', description: '', html: '', definition: null, errors: [], status: 'Draft' };
    }

    handleEditBlock(event) {
        this.resetInspect();
        const block = this.blocks.find(item => item.id === event.currentTarget.dataset.id);
        if (!block) return;
        this.blockDraft = {
            id: block.id,
            name: block.name,
            description: block.description || '',
            html: block.sourceHtml || '',
            definition: block.definition,
            errors: [],
            status: block.status,
            usageCount: block.usageCount,
            order: block.order
        };
    }

    handleBlockField(event) {
        this.blockDraft = { ...this.blockDraft, [event.target.dataset.field]: event.target.value };
    }

    handleBlockSource(event) {
        this.noteUpload(event.detail);
        this.blockDraft = { ...this.blockDraft, ...event.detail };
    }

    handleCancelBlock() {
        this.resetInspect();
        this.blockDraft = null;
    }

    async handleSaveBlock() {
        const draft = this.blockDraft;
        if (!draft?.name?.trim()) {
            this.toast('Block name is required', 'Give the content block a name.', 'warning');
            return;
        }
        if (draft.status === 'Active') {
            const confirmed = await LightningConfirm.open({
                message: `This block is Active${draft.usageCount ? ` and used by ${draft.usageCount} message block(s)` : ''}. Changes may affect how existing messages render. Continue?`,
                label: 'Update Active block',
                theme: 'warning'
            });
            if (!confirmed) return;
        }
        this.saving = true;
        try {
            const result = await saveBlock({
                payloadJson: JSON.stringify({
                    id: draft.id,
                    templateId: this.templateId,
                    name: draft.name,
                    description: draft.description,
                    order: draft.order || this.blocks.length + 1,
                    sourceHtml: draft.html,
                    definitionJson: draft.definition ? JSON.stringify(draft.definition) : null
                })
            });
            this.toast('Block saved', result.validation?.valid ? 'The block is valid.' : 'Saved as draft with validation issues.', result.validation?.valid ? 'success' : 'warning');
            await this.reloadBlocks();
            this.blockDraft = null;
        } catch (error) {
            this.toast('Block could not be saved', errorMessage(error), 'error');
        } finally {
            this.saving = false;
        }
    }

    async handleBlockStatus(event) {
        const { id, status } = event.currentTarget.dataset;
        try {
            await setBlockStatus({ blockId: id, status });
            await this.reloadBlocks();
        } catch (error) {
            this.toast('Block status not changed', errorMessage(error), 'error');
        }
    }

    async handleDeleteBlock(event) {
        const id = event.currentTarget.dataset.id;
        const confirmed = await LightningConfirm.open({ message: 'Delete this content block?', label: 'Delete block', theme: 'error' });
        if (!confirmed) return;
        try {
            await deleteBlock({ blockId: id });
            if (this.blockDraft?.id === id) this.blockDraft = null;
            await this.reloadBlocks();
        } catch (error) {
            this.toast('Block could not be deleted', errorMessage(error), 'error');
        }
    }

    async reloadBlocks() {
        const detail = await getTemplateDetail({ templateId: this.templateId });
        this.blocks = (detail.blocks || []).map(block => ({ ...block, definition: parseJson(block.definitionJson, null) }));
        this.status = detail.status;
    }

    // ─── Step 4: summary ─────────────────────────────────────────────────────

    async runValidation() {
        if (!this.templateId) return;
        try {
            this.validation = await validateTemplate({ templateId: this.templateId });
        } catch (error) {
            this.validation = { valid: false, errors: [errorMessage(error)], warnings: [] };
        }
    }

    get validationErrors() {
        return (this.validation?.errors || []).map((message, index) => ({ key: `e${index}`, message }));
    }

    get validationWarnings() {
        return (this.validation?.warnings || []).map((message, index) => ({ key: `w${index}`, message }));
    }

    get isValid() {
        return !!this.validation?.valid;
    }

    get activateDisabled() {
        return this.saving || !this.isValid || this.isActive || !this.templateId;
    }

    get hasValidationErrors() {
        return (this.validation?.errors || []).length > 0;
    }

    get hasValidationWarnings() {
        return (this.validation?.warnings || []).length > 0;
    }

    get localeLabel() {
        return this.localeOptions.find(option => option.value === this.basics.localeId)?.label || '';
    }

    get modeLabel() {
        return this.isMulti ? 'Multi-block' : 'Single-block';
    }

    get shellStats() {
        const definition = this.shell.definition;
        if (!definition) return 'No shell parsed.';
        return `${definition.regions.length} region(s), ${definition.sections.length} section(s), ${definition.contentSlots.length} content binding(s)`;
    }

    get previewOptions() {
        const options = [{ label: 'Shell with all blocks', value: 'all' }, { label: 'Shell only', value: 'shell' }];
        this.blocks.forEach(block => options.push({ label: `Shell with ${block.name}`, value: block.id }));
        return options;
    }

    get showPreviewChoice() {
        return this.isMulti && this.isSummaryStep;
    }

    handlePreviewChoice(event) {
        this.previewChoice = event.detail.value;
    }

    get hasShell() {
        return !!this.shell.html && !!this.shell.definition;
    }

    get showSidePreview() {
        return this.hasShell;
    }

    get layoutClass() {
        return `cc-wizard__layout${this.showSidePreview ? ' cc-wizard__layout_split' : ''}`;
    }

    /** Hover/click inspection works while editing bindings: the shell step, or a block opened for editing. */
    get inspectable() {
        return this.hasShell && (this.isShellStep || (this.isBlocksStep && !!this.blockDraft?.html && !!this.blockDraft?.definition));
    }

    get inspectScope() {
        return this.isBlocksStep ? 'blocks' : 'all';
    }

    handleInspectSelect(event) {
        this.pickedNodes = [];
        this.inspectKey = event.detail.key;
    }

    resetInspect() {
        this.inspectKey = null;
        this.pickedNodes = [];
    }

    /** A click in the preview (Shift extends the selection to neighbouring elements via the workspace). */
    handlePreviewPick(event) {
        this.inspectKey = null;
        const { node, extend } = event.detail;
        const workspace = this.template.querySelector('c-cc-binding-workspace');
        if (extend && this.pickedNodes.length && workspace) {
            workspace.extendSelection(node);
            return;
        }
        this.pickedNodes = [node];
    }

    /** The workspace changed the selection (group, children, wrap result, close). */
    handleWorkspacePick(event) {
        this.pickedNodes = event.detail.nodes || [];
        if (this.pickedNodes.length) this.inspectKey = null;
    }

    handleModeChange(event) {
        this.markOn = !!event.detail.mark;
        this.pickedNodes = [];
    }

    /** A raw upload (no markings yet) switches the preview into guided mark mode. */
    noteUpload(detail) {
        if (detail.html && isUnmarked(detail.definition)) this.markOn = true;
    }

    annotated(html) {
        if (this._annotated.html !== html) this._annotated = { html, out: annotateNodes(html) };
        return this._annotated.out;
    }

    get previewHeading() {
        if (this.isBlocksStep && this.blockDraft?.html) return 'Block inside the template shell';
        return this.isMulti ? 'Template preview' : 'Template preview';
    }

    /** Preview follows the step: shell while uploading, the block being edited, or the chosen summary view. */
    get previewRender() {
        if (!this.hasShell) return null;
        const marking = this.inspectable && this.markOn;
        const shell = {
            html: marking && this.isShellStep ? this.annotated(this.shell.html) : this.shell.html,
            definition: this.shell.definition
        };
        const isMulti = this.isMulti;
        const draft = this.blockDraft;
        let blocks = [];
        if (isMulti) {
            if (this.isBlocksStep && draft?.html && draft.definition) {
                blocks = [{ html: marking ? this.annotated(draft.html) : draft.html, definition: draft.definition, record: {} }];
            } else if (this.isSummaryStep || this.isBlocksStep) {
                const choice = this.isSummaryStep ? this.previewChoice : 'all';
                blocks = this.blocks
                    .filter(block => block.definition && block.sourceHtml && (
                        choice === 'all' ? (this.isSummaryStep ? block.status === 'Active' : true) : choice === block.id
                    ))
                    .map(block => ({ html: block.sourceHtml, definition: block.definition, record: block }));
            }
        }
        return (device, theme) => renderMessage({
            shell,
            shellContent: !isMulti ? { blockConfig: buildBlockConfig(shell.definition) } : null,
            blocks: blocks.map((entry, index) => ({
                html: entry.html,
                definition: entry.definition,
                block: newMessageBlock(entry.record, entry.definition, index + 1)
            })),
            device,
            theme
        });
    }

    // ─── Delete ──────────────────────────────────────────────────────────────

    get canDelete() {
        return !!this.templateId;
    }

    async handleDeleteTemplate() {
        const confirmed = await LightningConfirm.open({
            message: `Delete this template${this.isActive ? ' (it is Active)' : ''} and its content blocks? This cannot be undone.`,
            label: 'Delete template',
            theme: 'error'
        });
        if (!confirmed) return;
        this.saving = true;
        try {
            await deleteTemplate({ templateId: this.templateId });
            this.toast('Template deleted', '', 'success');
            this.templateId = null;
            this.dispatchEvent(new CustomEvent('saved', { detail: { templateId: null } }));
            this.handleClose();
        } catch (error) {
            this.toast('Template could not be deleted', errorMessage(error), 'error');
        } finally {
            this.saving = false;
        }
    }

    async handleActivate() {
        this.saving = true;
        try {
            await activateTemplate({ templateId: this.templateId });
            this.status = 'Active';
            this.toast('Template activated', 'Marketers can now use this template in Copy Center.', 'success');
            this.dispatchEvent(new CustomEvent('saved', { detail: { templateId: this.templateId } }));
        } catch (error) {
            this.toast('Template could not be activated', errorMessage(error), 'error');
        } finally {
            this.saving = false;
        }
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
