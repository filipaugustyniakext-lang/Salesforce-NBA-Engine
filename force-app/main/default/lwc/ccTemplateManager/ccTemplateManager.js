import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getTemplates from '@salesforce/apex/CcTemplateDefinitionController.getTemplates';
import archiveTemplate from '@salesforce/apex/CcTemplateDefinitionController.archiveTemplate';
import deleteTemplate from '@salesforce/apex/CcTemplateDefinitionController.deleteTemplate';
import { isolateNativeEvents } from 'c/ccEventGuard';

/** Marketing Dictionary > Channels > Templates: list of channel templates and the schema v1 wizard. */
export default class CcTemplateManager extends LightningElement {
    connectedCallback() {
        isolateNativeEvents(this);
    }

    @api channelName;
    templates = [];
    loading = false;
    errorMessage;
    wizardOpen = false;
    wizardTemplateId;
    _channelId;

    @api
    get channelId() {
        return this._channelId;
    }
    set channelId(next) {
        const changed = next !== this._channelId;
        this._channelId = next;
        if (changed) {
            this.wizardOpen = false;
            this.load();
        }
    }

    async load() {
        if (!this._channelId) return;
        this.loading = true;
        this.errorMessage = null;
        try {
            this.templates = await getTemplates({ channelId: this._channelId });
        } catch (error) {
            this.errorMessage = error?.body?.message || 'Templates could not be loaded.';
        } finally {
            this.loading = false;
        }
    }

    get rows() {
        return (this.templates || []).map(template => {
            const activeBlocks = (template.blocks || []).filter(block => block.status === 'Active').length;
            return {
                ...template,
                modeLabel: template.templateMode === 'single' ? 'Single-block' : 'Multi-block',
                blocksLabel: template.templateMode === 'single' ? '—' : `${activeBlocks} active / ${(template.blocks || []).length}`,
                statusClass: `slds-badge${template.status === 'Active' ? ' slds-theme_success' : ''}`,
                validationClass: template.validationStatus === 'Valid' ? 'slds-text-color_success' : 'slds-text-color_weak',
                formatLabel: template.isV1 ? 'v1' : 'Legacy',
                openLabel: template.isV1 ? 'Open' : 'Upgrade to v1',
                canArchive: template.status === 'Active',
                deleteDisabled: !!template.deleteBlockedReason,
                deleteTitle: template.deleteBlockedReason || 'Delete template',
                deleteIcon: 'utility:delete'
            };
        });
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    handleNew() {
        this.wizardTemplateId = null;
        this.wizardOpen = true;
    }

    handleOpen(event) {
        this.wizardTemplateId = event.currentTarget.dataset.id;
        this.wizardOpen = true;
    }

    handleWizardClose() {
        this.wizardOpen = false;
        this.load();
    }

    handleWizardSaved() {
        this.load();
    }

    async handleArchive(event) {
        const id = event.currentTarget.dataset.id;
        const confirmed = await LightningConfirm.open({
            message: 'Archive this template? Marketers can no longer select it for new messages.',
            label: 'Archive template',
            theme: 'warning'
        });
        if (!confirmed) return;
        try {
            await archiveTemplate({ templateId: id });
            this.toast('Template archived', '', 'success');
            this.load();
        } catch (error) {
            this.toast('Template could not be archived', error?.body?.message, 'error');
        }
    }

    async handleDelete(event) {
        const id = event.currentTarget.dataset.id;
        const confirmed = await LightningConfirm.open({ message: 'Delete this template and its content blocks?', label: 'Delete template', theme: 'error' });
        if (!confirmed) return;
        try {
            await deleteTemplate({ templateId: id });
            this.toast('Template deleted', '', 'success');
            this.load();
        } catch (error) {
            this.toast('Template could not be deleted', error?.body?.message, 'error');
        }
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
