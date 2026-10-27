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

/** Tier-level allowed exclusion types (Campaign Dictionary → Tiers). */
export const TIER_EXCL_FIELDS = [
    { field: 'Excl_Other_Marketing_Activations__c', label: 'Other Marketing' },
    { field: 'Excl_Campaign_Groups__c', label: 'Campaign Groups' },
    { field: 'Excl_Manual_Suppressions__c', label: 'Manual Exclusions' }
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

/** Checkbox tier flags may arrive as boolean or string from Apex / wire cache. */
export function isTierExclusionEnabled(tier, fieldName) {
    if (!tier || !fieldName) return false;
    const value = tier[fieldName];
    return value === true || value === 'true';
}

export function buildTierExclusionChips(tier) {
    if (!tier) return [];
    return TIER_EXCL_FIELDS
        .filter(ef => isTierExclusionEnabled(tier, ef.field))
        .map(ef => ef.label);
}

export function buildTierTypeChips(tier) {
    return parseSupportedCampaignTypes(tier && tier.Supported_Campaign_Types__c);
}