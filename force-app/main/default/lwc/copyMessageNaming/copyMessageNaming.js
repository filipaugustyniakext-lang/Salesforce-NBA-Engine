/**
 * Copy Center message naming helpers.
 * Full name: ChannelPrefix_Locale_MessageName_VariantNumber
 * Locale:     CountryCode-LanguageCode  (e.g. PL-EN)
 * Stem:       ChannelPrefix_Locale_MessageName
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

export function normalizeLanguage(raw) {
    return String(raw || '').trim().toUpperCase();
}

export function normalizeMessageNamePart(raw) {
    return String(raw || '').trim();
}

/** Locale token: CountryCode-LanguageCode */
export function composeLocale(countryCode, language) {
    const cc = normalizeCountryCode(countryCode);
    const lang = normalizeLanguage(language);
    if (!cc && !lang) return '';
    if (!cc) return lang;
    if (!lang) return cc;
    return `${cc}-${lang}`;
}

export function parseLocale(token) {
    const raw = String(token || '').trim();
    if (!raw) return { countryCode: '', language: '', locale: '' };
    const dash = raw.indexOf('-');
    if (dash < 0) {
        return { countryCode: raw.toUpperCase(), language: '', locale: raw.toUpperCase() };
    }
    const countryCode = raw.substring(0, dash).toUpperCase();
    const language = raw.substring(dash + 1).toUpperCase();
    return { countryCode, language, locale: composeLocale(countryCode, language) };
}

/** Stem without variant: PREFIX_CC-LANG_MessageName */
export function composeStem(prefix, countryCode, language, messageName) {
    const locale = composeLocale(countryCode, language);
    const mn = normalizeMessageNamePart(messageName);
    if (!prefix || !locale || locale.indexOf('-') < 0 || !mn) return '';
    return `${prefix}_${locale}_${mn}`;
}

/** Full persisted Name: PREFIX_CC-LANG_MessageName_Variant */
export function composeFullName(prefix, countryCode, language, messageName, variant) {
    const stem = composeStem(prefix, countryCode, language, messageName);
    const v = Number(variant);
    if (!stem || !v || v < 1) return '';
    return `${stem}_${v}`;
}

function emptyParsed() {
    return {
        prefix: '',
        locale: '',
        countryCode: '',
        language: '',
        messageName: '',
        variant: null,
        stem: '',
        isLegacy: true,
        isValid: false
    };
}

function fromParts(prefix, localeToken, messageName, variant, isLegacy) {
    const loc = parseLocale(localeToken);
    const stem = prefix && localeToken && messageName
        ? `${prefix}_${localeToken}_${messageName}`
        : [prefix, localeToken, messageName].filter(Boolean).join('_');
    return {
        prefix: prefix || '',
        locale: loc.locale || localeToken || '',
        countryCode: loc.countryCode,
        language: loc.language,
        messageName: messageName || '',
        variant,
        stem,
        isLegacy,
        isValid: !!(prefix && loc.countryCode && loc.language && messageName && (!isLegacy ? variant >= 1 : true))
    };
}

/**
 * Parse a stored Name into parts.
 * Current: PREFIX_CC-LANG_MessageName_Variant
 * Legacy:  PREFIX_CC_MessageName[_Variant] (no hyphen in locale)
 */
export function parseFullName(fullName) {
    const name = String(fullName || '').trim();
    if (!name) return emptyParsed();
    const parts = name.split('_');
    if (parts.length < 3) {
        return fromParts(parts[0] || '', parts[1] || '', parts.slice(2).join('_'), null, true);
    }
    const last = parts[parts.length - 1];
    const lastIsVariant = /^\d+$/.test(last);
    if (lastIsVariant && parts.length >= 4) {
        return fromParts(parts[0], parts[1], parts.slice(2, -1).join('_'), Number(last), false);
    }
    return fromParts(parts[0], parts[1], parts.slice(2).join('_'), null, true);
}

export function groupKeyFromName(fullName) {
    const parsed = parseFullName(fullName);
    return parsed.stem || fullName || '(unnamed)';
}

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
