import {
    aprioriChangeAlertMessage,
    aprioriSharedStateHint,
    aprioriOverwriteMessage,
    liveScoreOrigin
} from 'c/campaignAprioriCopy';

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

    it('names the campaign that set the live score and when', () => {
        const message = aprioriChangeAlertMessage(500, 300, 'CMP_OO_Test', '2026-11-26T12:07:15.000Z');
        expect(message).toContain('(set by campaign CMP_OO_Test on 2026-11-26)');
    });

    it('describes the origin with only what is known', () => {
        expect(liveScoreOrigin('CMP_OO_Test', null)).toBe(' (set by campaign CMP_OO_Test)');
        expect(liveScoreOrigin('', '2026-11-26T12:07:15.000Z')).toBe(' (set on 2026-11-26)');
        expect(liveScoreOrigin('', null)).toBe('');
        expect(liveScoreOrigin('', 'not a date')).toBe('');
    });

    it('describes the shared state', () => {
        expect(aprioriSharedStateHint({ hasMixedScores: true })).toContain('different shared apriori scores');
        expect(aprioriSharedStateHint({ hasSharedState: true, baselineScore: 300 })).toContain('(300)');
        expect(aprioriSharedStateHint({ hasSharedState: false, baselineScore: null })).toContain('goes live when this campaign is activated');
    });

    it('asks to confirm replacing the live score and says where the old one is kept', () => {
        const message = aprioriOverwriteMessage({
            liveScore: 500,
            newScore: 300,
            sourceCampaignName: 'CMP_OO_Test',
            liveSince: '2026-11-26T12:07:15.000Z'
        });
        expect(message).toContain('live apriori score for this Topic and Product Family is 500');
        expect(message).toContain('CMP_OO_Test');
        expect(message).toContain('replaces it with 300');
        expect(message).toContain('Campaign Scoring History');
    });

    it('explains the overwrite when the live scores differ between product families', () => {
        const message = aprioriOverwriteMessage({ hasMixedScores: true, newScore: 300 });
        expect(message).toContain('different live apriori scores');
        expect(message).toContain('sets all of them to 300');
    });
});
