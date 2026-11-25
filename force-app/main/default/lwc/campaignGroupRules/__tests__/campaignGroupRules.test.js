import {
    campaignGroupsForType,
    campaignGroupOptionsForType,
    campaignGroupGate,
    NO_CAMPAIGN_GROUPS_MESSAGE,
    NO_CAMPAIGN_GROUPS_ISSUE,
    SELECT_CAMPAIGN_GROUP_ISSUE
} from 'c/campaignGroupRules';

const WITH_GROUPS = {
    Id: 't1',
    Name: 'Always-on',
    Campaign_Groups_by_Type__r: [
        { Id: 'g1', Name: 'WorldOfNeeds', Timing_Evaluation_Type__c: 'Duration' },
        { Id: 'g2', Name: 'Onboarding' },
        { Name: 'No id, ignored' }
    ]
};
const WITHOUT_GROUPS = { Id: 't2', Name: 'One-off' };

describe('campaignGroupRules', () => {
    it('reads the groups of an activation type from an array, a records wrapper, or nothing', () => {
        expect(campaignGroupsForType(WITH_GROUPS)).toHaveLength(3);
        expect(campaignGroupsForType({ Campaign_Groups_by_Type__r: { records: [{ Id: 'g1' }] } })).toEqual([{ Id: 'g1' }]);
        expect(campaignGroupsForType(WITHOUT_GROUPS)).toEqual([]);
        expect(campaignGroupsForType(null)).toEqual([]);
    });

    it('offers the groups of the activation type as options, keyed by id', () => {
        expect(campaignGroupOptionsForType(WITH_GROUPS)).toEqual([
            { label: 'WorldOfNeeds', value: 'g1', timing: 'Duration' },
            { label: 'Onboarding', value: 'g2', timing: '' }
        ]);
    });

    it('does not show the picklist before an activation type is chosen', () => {
        expect(campaignGroupGate(null, '')).toEqual({
            options: [], hasActivationType: false, hasGroups: false, showPicklist: false, showNoGroupsAlert: false, issue: null
        });
    });

    it('shows the picklist and asks for a group when the activation type has groups', () => {
        const gate = campaignGroupGate(WITH_GROUPS, '');
        expect(gate.showPicklist).toBe(true);
        expect(gate.showNoGroupsAlert).toBe(false);
        expect(gate.options).toHaveLength(2);
        expect(gate.issue).toEqual({ id: 'campaign-group', message: SELECT_CAMPAIGN_GROUP_ISSUE });
    });

    it('is satisfied once a group of that activation type is selected', () => {
        expect(campaignGroupGate(WITH_GROUPS, 'g2').issue).toBeNull();
    });

    it('does not accept a group that does not belong to the activation type', () => {
        expect(campaignGroupGate(WITH_GROUPS, 'g-other').issue.message).toBe(SELECT_CAMPAIGN_GROUP_ISSUE);
    });

    it('still shows the picklist, with an alert, and blocks activation when the activation type has no groups', () => {
        const gate = campaignGroupGate(WITHOUT_GROUPS, '');
        expect(gate.showPicklist).toBe(true);
        expect(gate.hasGroups).toBe(false);
        expect(gate.showNoGroupsAlert).toBe(true);
        expect(gate.options).toEqual([]);
        expect(gate.issue).toEqual({ id: 'campaign-group', message: NO_CAMPAIGN_GROUPS_ISSUE });
        // A stale selection cannot make it activable either.
        expect(campaignGroupGate(WITHOUT_GROUPS, 'g1').issue.message).toBe(NO_CAMPAIGN_GROUPS_ISSUE);
    });

    it('words the alert as the dictionary setup problem it is', () => {
        expect(NO_CAMPAIGN_GROUPS_MESSAGE).toBe(
            'This activation type doesn\'t have any campaign groups configured. '
            + 'Please ensure that your campaign dictionary setup is correct for this activation type.'
        );
        expect(NO_CAMPAIGN_GROUPS_ISSUE).toContain('saved as a draft but not activated');
    });
});
