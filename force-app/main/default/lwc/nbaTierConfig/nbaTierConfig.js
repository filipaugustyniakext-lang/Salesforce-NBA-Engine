/**
 * Shared Campaign Tier field definitions used by Marketing Dictionary
 * and Agentforce Campaign Wizard so summary badges stay consistent.
 */

export const TIER_ATTR_FIELDS = [
    {
        field: 'Override_Random_Activation_Path__c',
        label: 'Override Random Activation Path',
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' }
        ]
    },
    {
        field: 'Honor_Marketing_Consents__c',
        label: 'Honor Marketing Consents',
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
            { label: 'Defined per Campaign', value: 'Defined per Campaign' }
        ]
    },
    {
        field: 'Includes_Control_Group__c',
        label: 'Includes Control Group',
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
            { label: 'Defined per Campaign', value: 'Defined per Campaign' }
        ]
    },
    {
        field: 'Honors_Channel_Cooldowns__c',
        label: 'Honors Channel Cooldowns',
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
            { label: 'Defined per Campaign', value: 'Defined per Campaign' }
        ]
    },
    {
        field: 'Allows_Random_Copy_Assignment__c',
        label: 'Allows Random Copy Assignment',
        options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' }
        ]
    }
];

/** Only Manual Suppressions remains as a tier exclusion setting. */
export const TIER_EXCL_FIELDS = [
    { field: 'Excl_Manual_Suppressions__c', label: 'Manual Suppressions' }
];

export const TIER_ATTR_BADGE_CLASS = {
    Yes: 'slds-badge cd-badge-yes',
    No: 'slds-badge cd-badge-no',
    'Defined per Campaign': 'slds-badge cd-badge-dpc'
};

export function parseSupportedCampaignTypes(raw) {
    return (raw || '')
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean);
}

export function buildTierAttrRows(tier) {
    if (!tier) return [];
    return TIER_ATTR_FIELDS.map(af => {
        const value = tier[af.field] || '—';
        return {
            label: af.label,
            value,
            key: af.field,
            badgeClass: TIER_ATTR_BADGE_CLASS[tier[af.field]] || 'slds-badge slds-badge_lightest'
        };
    });
}

export function buildTierExclusionChips(tier) {
    if (!tier) return [];
    return TIER_EXCL_FIELDS
        .filter(ef => !!tier[ef.field])
        .map(ef => ef.label.replace(/^Exclude\s+/i, ''));
}

export function buildTierTypeChips(tier) {
    return parseSupportedCampaignTypes(tier && tier.Supported_Campaign_Types__c);
}
