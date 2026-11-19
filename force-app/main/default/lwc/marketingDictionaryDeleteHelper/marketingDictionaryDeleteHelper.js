import getDictionaryDeleteDependencies from '@salesforce/apex/MarketingDictionaryDeleteGuard.getDictionaryDeleteDependencies';
import getCampaignTierDeleteDependencies from '@salesforce/apex/MarketingDictionaryDeleteGuard.getCampaignTierDeleteDependencies';
import getOfferReferenceValueDeleteDependencies from '@salesforce/apex/MarketingDictionaryDeleteGuard.getOfferReferenceValueDeleteDependencies';

/** Matches server-side blocked-delete summary text. */
export const DEPENDENCY_BLOCK_PHRASE = 'must be removed before it can be deleted';

export function reportHasDependencies(report) {
    return Array.isArray(report?.groups) && report.groups.length > 0;
}

export function formatDependencyReportForClipboard(report) {
    if (!report) {
        return '';
    }
    if (Array.isArray(report.reports) && report.reports.length) {
        return report.reports.map(formatDependencyReportForClipboard).join('\n\n');
    }
    const lines = [];
    lines.push(`Dictionary value: ${report.recordName || '(unknown)'}`);
    lines.push('Dependencies (by category):');
    lines.push('');
    for (const group of report.groups || []) {
        lines.push(group.category || 'Related records');
        const refs = group.references || [];
        if (refs.length) {
            for (const ref of refs) {
                const idSuffix = ref.recordId ? ` (${ref.recordId})` : '';
                lines.push(`  • ${ref.label || 'Related record'}${idSuffix}`);
            }
        } else {
            for (const name of group.recordNames || []) {
                lines.push(`  • ${name}`);
            }
        }
        lines.push('');
    }
    if (report.truncated) {
        lines.push('Note: only the first references are listed in the app.');
        lines.push('');
    }
    lines.push('Remove or reassign these references before deleting this dictionary value.');
    return lines.join('\n');
}

export function isDependencyBlockedMessage(message) {
    return typeof message === 'string' && message.includes(DEPENDENCY_BLOCK_PHRASE);
}

export async function fetchDictionaryDeleteReport(recordId) {
    if (!recordId) {
        return { groups: [] };
    }
    return getDictionaryDeleteDependencies({ recordId });
}

export async function fetchCampaignTierDeleteReport(recordId) {
    if (!recordId) {
        return { groups: [] };
    }
    return getCampaignTierDeleteDependencies({ recordId });
}

export async function fetchOfferReferenceValueDeleteReport(recordId) {
    if (!recordId) {
        return { groups: [] };
    }
    return getOfferReferenceValueDeleteDependencies({ recordId });
}

/**
 * Preflight dependency check, then run delete. Returns true when delete ran.
 */
export async function runDictionaryDeleteWithDependencyCheck({ recordId, deleteFn, onBlocked }) {
    const report = await fetchDictionaryDeleteReport(recordId);
    if (reportHasDependencies(report)) {
        onBlocked(report);
        return false;
    }
    await deleteFn();
    return true;
}

/**
 * Bulk variant: checks every record, deletes only the ones without dependencies and
 * returns the blocked reports so the dependency dialog can list them per value.
 */
export async function runBulkDictionaryDeleteWithDependencyCheck({ recordIds, deleteFn }) {
    const deletedIds = [];
    const blockedReports = [];
    const failures = [];
    for (const recordId of recordIds || []) {
        // eslint-disable-next-line no-await-in-loop
        const report = await fetchDictionaryDeleteReport(recordId);
        if (reportHasDependencies(report)) {
            blockedReports.push(report);
            continue;
        }
        try {
            // eslint-disable-next-line no-await-in-loop
            await deleteFn(recordId);
            deletedIds.push(recordId);
        } catch (e) {
            const message = e?.body?.message || e?.message || 'Delete failed.';
            if (isDependencyBlockedMessage(message)) {
                // eslint-disable-next-line no-await-in-loop
                const fresh = await fetchDictionaryDeleteReport(recordId);
                if (reportHasDependencies(fresh)) {
                    blockedReports.push(fresh);
                    continue;
                }
            }
            failures.push({ recordId, message });
        }
    }
    return { deletedIds, blockedReports, failures };
}

/** Wraps blocked reports from a bulk delete into the shape the dependency dialog expects. */
export function combineBlockedReports(blockedReports) {
    const reports = (blockedReports || []).filter(reportHasDependencies);
    if (!reports.length) {
        return null;
    }
    if (reports.length === 1) {
        return reports[0];
    }
    return {
        recordName: `${reports.length} values`,
        groups: reports.flatMap(r => r.groups),
        reports,
        truncated: reports.some(r => r.truncated === true)
    };
}

export async function runCampaignTierDeleteWithDependencyCheck({ recordId, deleteFn, onBlocked }) {
    const report = await fetchCampaignTierDeleteReport(recordId);
    if (reportHasDependencies(report)) {
        onBlocked(report);
        return false;
    }
    await deleteFn();
    return true;
}

export async function runOfferReferenceDeleteWithDependencyCheck({ recordId, deleteFn, onBlocked }) {
    const report = await fetchOfferReferenceValueDeleteReport(recordId);
    if (reportHasDependencies(report)) {
        onBlocked(report);
        return false;
    }
    await deleteFn();
    return true;
}