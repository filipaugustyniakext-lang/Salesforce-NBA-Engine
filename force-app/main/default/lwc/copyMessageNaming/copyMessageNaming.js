/**
 * Copy Center message naming helpers.
 * Full name: ChannelPrefix_CountryCode_MessageName_VariantNumber
 * Stem (master key): ChannelPrefix_CountryCode_MessageName
 */
export const CHANNEL_PREFIX_MAP = {
    Email: 'EMA',
    SMS: 'SMS',
    Push: 'PUSH',
    Banner: 'BAN',
    'In-App': 'INAPP',
    'AI Agent Inbound': 'AII',
    'AI Agent Outbound': 'AIO',
    'Branch Agent': 'BRA',
    WhatsApp: 'WHP'
};

export function channelPrefixForType(channelType) {
    if (!channelType) return '';
    return CHANNEL_PREFIX_MAP[channelType] || channelType;
}

export function normalizeCountryCode(raw) {
    return String(raw || '').trim().toUpperCase();
}

export function normalizeMessageNamePart(raw) {
    return String(raw || '').trim();
}

/** Stem without variant: PREFIX_CC_MessageName */
export function composeStem(prefix, countryCode, messageName) {
    const cc = normalizeCountryCode(countryCode);
    const mn = normalizeMessageNamePart(messageName);
    if (!prefix || !cc || !mn) return '';
    return `${prefix}_${cc}_${mn}`;
}

/** Full persisted Name: PREFIX_CC_MessageName_Variant */
export function composeFullName(prefix, countryCode, messageName, variant) {
    const stem = composeStem(prefix, countryCode, messageName);
    const v = Number(variant);
    if (!stem || !v || v < 1) return '';
    return `${stem}_${v}`;
}

/**
 * Parse a stored Name into parts.
 * Supports:
 *  - new: PREFIX_CC_MessageName_Variant (MessageName may contain underscores)
 *  - legacy: PREFIX_CC_MessageName (no trailing variant) — treated as stem-only
 */
export function parseFullName(fullName) {
    const name = String(fullName || '').trim();
    if (!name) {
        return {
            prefix: '',
            countryCode: '',
            messageName: '',
            variant: null,
            stem: '',
            isLegacy: true,
            isValid: false
        };
    }
    const parts = name.split('_');
    if (parts.length < 3) {
        return {
            prefix: parts[0] || '',
            countryCode: parts[1] || '',
            messageName: parts.slice(2).join('_'),
            variant: null,
            stem: name,
            isLegacy: true,
            isValid: false
        };
    }
    const last = parts[parts.length - 1];
    const lastIsVariant = /^\d+$/.test(last);
    if (lastIsVariant && parts.length >= 4) {
        const prefix = parts[0];
        const countryCode = parts[1];
        const messageName = parts.slice(2, -1).join('_');
        const variant = Number(last);
        const stem = `${prefix}_${countryCode}_${messageName}`;
        return {
            prefix,
            countryCode,
            messageName,
            variant,
            stem,
            isLegacy: false,
            isValid: !!(prefix && countryCode && messageName && variant >= 1)
        };
    }
    // Legacy (no numeric variant suffix)
    const prefix = parts[0];
    const countryCode = parts[1];
    const messageName = parts.slice(2).join('_');
    const stem = `${prefix}_${countryCode}_${messageName}`;
    return {
        prefix,
        countryCode,
        messageName,
        variant: null,
        stem,
        isLegacy: true,
        isValid: !!(prefix && countryCode && messageName)
    };
}

/** Master-row group key for a record Name. */
export function groupKeyFromName(fullName) {
    const parsed = parseFullName(fullName);
    return parsed.stem || fullName || '(unnamed)';
}

/** True if record Name belongs to stem (exact legacy stem or stem_N). */
export function nameBelongsToStem(fullName, stem) {
    if (!stem) return false;
    const name = String(fullName || '');
    if (name === stem) return true;
    if (!name.startsWith(`${stem}_`)) return false;
    const suffix = name.substring(stem.length + 1);
    return /^\d+$/.test(suffix);
}

export function nextAvailableVariant(takenVariants) {
    const taken = new Set((takenVariants || []).map(Number));
    let v = 1;
    while (taken.has(v)) v += 1;
    return v;
}
