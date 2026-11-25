/**
 * Cloning a campaign in the Campaign Creation Wizard: everything is copied from the source campaign except what
 * identifies the new campaign (its name and its active window). A clone is always created as a draft.
 */
export const CLONE_ACTIVATION_NOTE = 'This campaign is a clone. Save it once as a draft before activating it.';

/** Wizard state that must be entered again for a clone. */
export function cloneResetState() {
    return { campaignName: '', activeFrom: '', activeTo: '' };
}

export function cloneBannerMessage(sourceName) {
    const source = String(sourceName || '').trim();
    return `${source ? `Cloning ${source}. ` : ''}All settings are copied except the campaign name and the Active From / Active To dates: enter them below. `
        + 'The clone is saved as a draft (inactive).';
}

/** A clone cannot be activated until it has been saved once, so it is always created as a draft. */
export function isActivationBlockedByClone(isCloneMode) {
    return isCloneMode === true;
}
