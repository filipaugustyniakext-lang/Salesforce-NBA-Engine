import { api } from 'lwc';
import LightningModal from 'lightning/modal';
import schedulePublication from '@salesforce/apex/CcMessageLifecycleService.schedulePublication';
import cancelSchedule from '@salesforce/apex/CcMessageLifecycleService.cancelSchedule';

const ACTIONS = {
    Publish: 'Publish (set Live)',
    Unpublish: 'Unpublish (set Inactive)',
    'Publish Changes': 'Publish the draft version',
    Archive: 'Archive'
};

/** Schedules a status change of one message variant. Closes with 'scheduled' or 'cancelled'. */
export default class CcScheduleModal extends LightningModal {
    @api messageId;
    @api messageName;
    @api status;
    @api hasDraftVersion = false;
    @api hasPendingSchedule = false;
    action;
    runAt;
    note = '';
    saving = false;
    errorMessage;

    connectedCallback() {
        this.action = this.actionOptions[0]?.value;
    }

    get normalizedStatus() {
        return this.status === 'Published' ? 'Live' : (this.status || 'Draft');
    }

    get actionOptions() {
        const status = this.normalizedStatus;
        const values = [];
        if (status === 'Ready' || status === 'Inactive') values.push('Publish');
        if (status === 'Live') values.push('Unpublish');
        if (this.hasDraftVersion && status !== 'Archived' && status !== 'Draft') values.push('Publish Changes');
        if (status === 'Ready' || status === 'Inactive') values.push('Archive');
        return values.map(value => ({ label: ACTIONS[value], value }));
    }

    get canSchedule() {
        return this.actionOptions.length > 0;
    }

    get unavailableMessage() {
        if (this.normalizedStatus === 'Draft') return 'Draft messages cannot be scheduled. Validate the content and set the message to Ready first.';
        if (this.normalizedStatus === 'Archived') return 'Archived messages cannot be scheduled. Clone them as a new variant instead.';
        return 'No scheduled action is available for this message.';
    }

    get minDate() {
        return new Date().toISOString();
    }

    get saveDisabled() {
        return this.saving || !this.action || !this.runAt;
    }

    handleAction(event) {
        this.action = event.detail.value;
    }

    handleRunAt(event) {
        this.runAt = event.detail.value;
    }

    handleNote(event) {
        this.note = event.detail.value;
    }

    async handleSchedule() {
        this.saving = true;
        this.errorMessage = null;
        try {
            await schedulePublication({ messageId: this.messageId, action: this.action, runAt: this.runAt, note: this.note });
            this.close('scheduled');
        } catch (error) {
            this.errorMessage = error?.body?.message || 'The change could not be scheduled.';
        } finally {
            this.saving = false;
        }
    }

    async handleCancelSchedule() {
        this.saving = true;
        this.errorMessage = null;
        try {
            await cancelSchedule({ messageId: this.messageId });
            this.close('cancelled');
        } catch (error) {
            this.errorMessage = error?.body?.message || 'The scheduled change could not be cancelled.';
        } finally {
            this.saving = false;
        }
    }

    handleClose() {
        this.close();
    }
}
