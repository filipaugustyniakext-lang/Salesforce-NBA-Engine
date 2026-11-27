import { aprioriChangeAlertMessage, aprioriSharedStateHint } from 'c/campaignAprioriCopy';

describe('campaignAprioriCopy', () => {
    it('says a new score goes live on activation', () => {
        expect(aprioriChangeAlertMessage(null, 500)).toContain('when this campaign is activated');
    });

    it('does not claim that saving updates the shared score', () => {
        const message = aprioriChangeAlertMessage(400, 600);
        expect(message).toContain('from 400 to 600');
        expect(message).toContain('only when this campaign is activated, not when it is saved');
        expect(message).not.toContain('Saving or activating');
    });

    it('describes the shared state', () => {
        expect(aprioriSharedStateHint({ hasMixedScores: true })).toContain('different shared apriori scores');
        expect(aprioriSharedStateHint({ hasSharedState: true, baselineScore: 300 })).toContain('(300)');
        expect(aprioriSharedStateHint({ hasSharedState: false, baselineScore: null })).toContain('goes live when this campaign is activated');
    });
});
