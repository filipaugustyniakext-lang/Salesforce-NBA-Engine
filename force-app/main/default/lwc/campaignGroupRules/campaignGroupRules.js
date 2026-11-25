/**
 * Campaign Groups belong to an Activation Type in the Marketing Dictionary. A campaign needs a campaign group
 * to be activated; without one it can only be saved as a draft.
 */
export const NO_CAMPAIGN_GROUPS_MESSAGE = 'This activation type doesn\'t have any campaign groups configured. '
    + 'Please ensure that your campaign dictionary setup is correct for this activation type.';
export const NO_CAMPAIGN_GROUPS_ISSUE = 'No campaign groups are configured for this activation type, '
    + 'so this campaign can be saved as a draft but not activated.';
export const SELECT_CAMPAIGN_GROUP_ISSUE = 'Select a campaign group.';

/** Campaign Groups configured for an Activation Type record (child relationship, array or { records }). */
export function campaignGroupsForType(typeRecord) {
    const groups = typeRecord?.Campaign_Groups_by_Type__r;
    return Array.isArray(groups) ? groups : (groups?.records || []);
}

export function campaignGroupOptionsForType(typeRecord) {
    return campaignGroupsForType(typeRecord)
        .filter(group => group?.Id)
        .map(group => ({
            label: group.Name,
            value: group.Id,
            timing: group.Timing_Evaluation_Type__c || ''
        }));
}

/**
 * What the wizard shows and enforces for the campaign group of the chosen activation type.
 * - the picklist is shown as soon as an activation type is chosen, even when it has no groups
 * - an activation type without groups shows an alert, and blocks activation (drafts can still be saved)
 * - otherwise a group of that activation type must be selected before activating
 */
export function campaignGroupGate(typeRecord, selectedGroupId) {
    const hasActivationType = !!typeRecord;
    const options = hasActivationType ? campaignGroupOptionsForType(typeRecord) : [];
    const hasGroups = options.length > 0;
    let issue = null;
    if (hasActivationType && !hasGroups) {
        issue = { id: 'campaign-group', message: NO_CAMPAIGN_GROUPS_ISSUE };
    } else if (hasActivationType && !options.some(option => option.value === selectedGroupId)) {
        issue = { id: 'campaign-group', message: SELECT_CAMPAIGN_GROUP_ISSUE };
    }
    return {
        options,
        hasActivationType,
        hasGroups,
        showPicklist: hasActivationType,
        showNoGroupsAlert: hasActivationType && !hasGroups,
        issue
    };
}
