/**
 * Copy for the wizard's apriori score step. A new apriori score does not go live when the campaign is saved:
 * it is published to Campaign Scoring State when the campaign is activated, and activating a campaign whose score
 * differs from the live one asks for an explicit confirmation first.
 */

function formatDay(value) {
    if (value === null || value === undefined || value === '') return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** " (set by campaign X on 2026-11-26)" when the live score has a known source, otherwise an empty string. */
export function liveScoreOrigin(sourceCampaignName, liveSince) {
    const campaign = sourceCampaignName ? `by campaign ${sourceCampaignName}` : '';
    const day = formatDay(liveSince);
    const when = day ? `on ${day}` : '';
    const parts = [campaign, when].filter(Boolean);
    return parts.length ? ` (set ${parts.join(' ')})` : '';
}

export function aprioriChangeAlertMessage(baselineScore, currentScore, sourceCampaignName, liveSince) {
    if (baselineScore === null || baselineScore === undefined) {
        return 'This apriori score will be stored for all campaigns sharing the same Topic and Product Family combination when this campaign is activated.';
    }
    return `Apriori score changed from ${baselineScore} to ${currentScore}. The live score${liveScoreOrigin(sourceCampaignName, liveSince)} is replaced only when this campaign is activated, not when it is saved.`;
}

export function aprioriSharedStateHint({ hasMixedScores, hasSharedState, baselineScore }) {
    if (hasMixedScores) {
        return 'Selected product families have different shared apriori scores for this topic. Resolve in Marketing Dictionary or adjust selections.';
    }
    if (hasSharedState && baselineScore !== null && baselineScore !== undefined) {
        return `A shared apriori score (${baselineScore}) already exists for this topic and product family selection. Changing it updates all campaigns using the same combination once this campaign is activated.`;
    }
    return 'No shared apriori score exists yet for this topic and product family selection. You can set a value from 0 to 1000; it goes live when this campaign is activated.';
}

/** Body of the confirmation shown right before activating over a different live score. */
export function aprioriOverwriteMessage({ hasMixedScores, liveScore, newScore, sourceCampaignName, liveSince }) {
    if (hasMixedScores) {
        return `The selected product families currently have different live apriori scores. Activating this campaign sets all of them to ${newScore}. The previous scores stay in Campaign Scoring History.`;
    }
    return `The live apriori score for this Topic and Product Family is ${liveScore}${liveScoreOrigin(sourceCampaignName, liveSince)}. Activating this campaign replaces it with ${newScore}. The previous score stays in Campaign Scoring History.`;
}
