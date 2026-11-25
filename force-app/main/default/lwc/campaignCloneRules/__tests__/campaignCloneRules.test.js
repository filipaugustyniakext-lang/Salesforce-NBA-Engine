import { cloneResetState, cloneBannerMessage, isActivationBlockedByClone, CLONE_ACTIVATION_NOTE } from 'c/campaignCloneRules';

describe('campaignCloneRules', () => {
    it('clears only the name and the active window of a clone', () => {
        expect(cloneResetState()).toEqual({ campaignName: '', activeFrom: '', activeTo: '' });
        expect(cloneResetState()).not.toBe(cloneResetState());
    });

    it('tells the operator what was copied and that the clone is a draft', () => {
        const message = cloneBannerMessage('CMP_pl_PL_AO_CashLoan');
        expect(message).toContain('Cloning CMP_pl_PL_AO_CashLoan.');
        expect(message).toContain('except the campaign name and the Active From / Active To dates');
        expect(message).toContain('saved as a draft (inactive)');
        expect(cloneBannerMessage('')).not.toContain('Cloning');
        expect(cloneBannerMessage(null)).toContain('saved as a draft');
    });

    it('blocks activation of a clone until it has been saved once', () => {
        expect(isActivationBlockedByClone(true)).toBe(true);
        expect(isActivationBlockedByClone(false)).toBe(false);
        expect(isActivationBlockedByClone(undefined)).toBe(false);
        expect(CLONE_ACTIVATION_NOTE).toContain('Save it once as a draft');
    });
});
