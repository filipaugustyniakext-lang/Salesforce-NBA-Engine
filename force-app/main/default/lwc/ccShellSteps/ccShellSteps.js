import { LightningElement, api } from 'lwc';

/**
 * The three setup steps of a template: for a multi-block shell fixed areas, dropzone and editable content
 * (`variant="shell"`, `progress` from shellProgress()); for a content block or single-block template layout
 * sections, content and settings (`variant="block"`, `progress` from blockProgress()).
 * Steps unlock in order; a done step can always be reopened. Emits stepselect { step }.
 */
export default class CcShellSteps extends LightningElement {
    @api progress;
    @api activeStep = 1;
    @api variant = 'shell';

    get definitions() {
        const progress = this.progress || { steps: [] };
        const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
        if (this.variant === 'block') {
            return [
                {
                    step: 1,
                    title: 'Layout sections',
                    summary: progress.sectionCount
                        ? plural(progress.sectionCount, 'section')
                        : progress.noSections ? 'No layout settings' : 'Mark container, rows and columns',
                    locked: 'Available'
                },
                {
                    step: 2,
                    title: 'Content',
                    summary: progress.slotCount ? plural(progress.slotCount, 'binding') : 'Mark text, images, lists and buttons',
                    locked: 'Finish step 1 first'
                },
                {
                    step: 3,
                    title: 'Settings and presets',
                    optional: true,
                    summary: 'Defaults, color presets, editor levels',
                    locked: 'Finish steps 1 and 2 first'
                }
            ];
        }
        return [
            {
                step: 1,
                title: 'Fixed areas',
                summary: progress.areaCount
                    ? plural(progress.areaCount, 'area')
                    : progress.noFixedAreas ? 'No fixed areas' : 'Mark header, footer and similar areas',
                locked: 'Available'
            },
            {
                step: 2,
                title: 'Dropzone',
                summary: progress.hasZone ? 'Placed' : 'Choose where content blocks go',
                locked: 'Finish step 1 first'
            },
            {
                step: 3,
                title: 'Editable content',
                optional: true,
                summary: progress.slotCount
                    ? plural(progress.slotCount, 'binding')
                    : progress.editableCount ? 'Mark what marketers can edit' : 'Nothing to edit',
                locked: 'Finish steps 1 and 2 first'
            }
        ];
    }

    get cards() {
        const progress = this.progress || { steps: [] };
        const state = step => progress.steps.find(item => item.step === step) || { done: false, unlocked: step === 1 };
        return this.definitions.map(card => {
            const { done, unlocked } = state(card.step);
            const active = Number(this.activeStep) === card.step;
            return {
                ...card,
                done,
                unlocked,
                active,
                icon: done ? 'utility:success' : unlocked ? 'utility:record' : 'utility:lock',
                heading: `${card.step}. ${card.title}${card.optional ? ' (optional)' : ''}`,
                text: unlocked ? card.summary : card.locked,
                ariaCurrent: active ? 'step' : null,
                disabled: !unlocked,
                className: `cc-steps__card${active ? ' cc-steps__card_active' : ''}${done ? ' cc-steps__card_done' : ''}${unlocked ? '' : ' cc-steps__card_locked'}`
            };
        });
    }

    handleSelect(event) {
        const step = Number(event.currentTarget.dataset.step);
        const card = this.cards.find(item => item.step === step);
        if (!card || !card.unlocked) return;
        this.dispatchEvent(new CustomEvent('stepselect', { detail: { step } }));
    }
}
