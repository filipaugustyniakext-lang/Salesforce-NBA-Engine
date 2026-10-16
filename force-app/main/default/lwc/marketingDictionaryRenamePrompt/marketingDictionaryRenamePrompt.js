import getRenameImpact from '@salesforce/apex/MarketingDictionaryDeleteGuard.getRenameImpact';
import LightningConfirm from 'lightning/confirm';

/**
 * When a dictionary label is stored on NBA records (not Id), confirm before save.
 * @returns {Promise<boolean>} true if save should proceed
 */
export async function confirmDictionaryRenameIfNeeded(recordId, originalName, proposedName) {
    if (!recordId) {
        return true;
    }
    const next = (proposedName || '').trim();
    const prior = (originalName || '').trim();
    if (!next || next === prior) {
        return true;
    }
    try {
        const impact = await getRenameImpact({ recordId, proposedName: next });
        if (!impact?.requiresConfirmation) {
            return true;
        }
        return LightningConfirm.open({
            message: impact.message,
            label: 'Confirm dictionary rename',
            theme: 'warning'
        });
    } catch {
        return true;
    }
}
