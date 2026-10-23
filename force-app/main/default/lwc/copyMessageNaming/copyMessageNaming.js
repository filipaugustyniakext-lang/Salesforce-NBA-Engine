/**
 * Copy Center message naming helpers.
 * Current full name: ChannelPrefix-Locale-MessageName-VariantNumber
 * Locale:            countryCode-LanguageCode (e.g. pl-PL from Marketing Dictionary)
 * Legacy underscore names are still parsed for existing rows.
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

/** Locale token: CountryCode-LanguageCode (normalized casing). */
export function composeLocale(countryCode, language) {
    const cc = normalizeCountryCode(countryCode);
    const lang = normalizeLanguage(language);
    if (!cc && !lang) return '';
    if (!cc) return lang;
    if (!lang) return cc;
    return `${cc}-${lang}`;
}

/** Build locale token for dictionary / display (e.g. pl-PL). */
export function formatLocaleToken(countryCode, language) {
    const cc = String(countryCode || '').trim().toLowerCase();
    const lang = String(language || '').trim();
    if (!cc && !lang) return '';
    if (!cc) return lang;
    if (!lang) return cc;
    const langPart = lang.length <= 3 ? lang.toUpperCase() : lang;
    return `${cc}-${langPart}`;
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

export function variantSeparatorForStem(stem) {
    const s = String(stem || '');
    if (!s) return '-';
    return s.includes('-') && !s.includes('_') ? '-' : '_';
}

/** Stem without variant (hyphen convention). */
export function composeStemFromLocale(prefix, localeToken, messageName) {
    const pre = String(prefix || '').trim();
    const loc = String(localeToken || '').trim();
    const mn = normalizeMessageNamePart(messageName);
    if (!pre || !loc || loc.indexOf('-') < 0 || !mn) return '';
    return `${pre}-${loc}-${mn}`;
}

/** Full persisted Name (hyphen convention). */
export function composeFullNameFromLocale(prefix, localeToken, messageName, variant) {
    const stem = composeStemFromLocale(prefix, localeToken, messageName);
    const v = Number(variant);
    if (!stem || !v || v < 1) return '';
    return `${stem}-${v}`;
}

/** Stem without variant (legacy underscore or hyphen via locale token). */
export function composeStem(prefix, countryCode, language, messageName) {
    const locale = composeLocale(countryCode, language);
    return composeStemFromLocale(prefix, locale, messageName)
        || composeStemLegacy(prefix, locale, messageName);
}

function composeStemLegacy(prefix, locale, messageName) {
    const mn = normalizeMessageNamePart(messageName);
    if (!prefix || !locale || locale.indexOf('-') < 0 || !mn) return '';
    return `${prefix}_${locale}_${mn}`;
}

/** Full persisted Name (prefers hyphen; falls back to legacy underscore). */
export function composeFullName(prefix, countryCode, language, messageName, variant) {
    const locale = composeLocale(countryCode, language);
    const hyphen = composeFullNameFromLocale(prefix, locale, messageName, variant);
    if (hyphen) return hyphen;
    const stem = composeStemLegacy(prefix, locale, messageName);
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

function fromParts(prefix, localeToken, messageName, variant, isLegacy, useHyphenStem) {
    const loc = parseLocale(localeToken);
    const stem = prefix && localeToken && messageName
        ? (useHyphenStem
            ? composeStemFromLocale(prefix, localeToken, messageName)
            : `${prefix}_${localeToken}_${messageName}`)
        : [prefix, localeToken, messageName].filter(Boolean).join(useHyphenStem ? '-' : '_');
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

function parseHyphenFullName(name) {
    const parts = name.split('-');
    if (parts.length < 4) return null;
    const last = parts[parts.length - 1];
    if (!/^\d+$/.test(last)) return null;
    const variant = Number(last);
    const prefix = parts[0];
    const localeToken = `${parts[1]}-${parts[2]}`;
    const messageName = parts.slice(3, -1).join('-');
    if (!messageName) return null;
    return fromParts(prefix, localeToken, messageName, variant, false, true);
}

/**
 * Parse a stored Name into parts.
 * Current: PREFIX-Locale-MessageName-Variant (Locale = cc-LL)
 * Legacy:  PREFIX_CC-LANG_MessageName_Variant or older PREFIX_CC_MessageName
 */
export function parseFullName(fullName) {
    const name = String(fullName || '').trim();
    if (!name) return emptyParsed();

    if (name.includes('-') && !name.includes('_')) {
        const hyphen = parseHyphenFullName(name);
        if (hyphen) return hyphen;
    }

    const parts = name.split('_');
    if (parts.length < 3) {
        return fromParts(parts[0] || '', parts[1] || '', parts.slice(2).join('_'), null, true, false);
    }
    const last = parts[parts.length - 1];
    const lastIsVariant = /^\d+$/.test(last);
    if (lastIsVariant && parts.length >= 4) {
        return fromParts(parts[0], parts[1], parts.slice(2, -1).join('_'), Number(last), false, false);
    }
    return fromParts(parts[0], parts[1], parts.slice(2).join('_'), null, true, false);
}

export function groupKeyFromName(fullName) {
    const parsed = parseFullName(fullName);
    return parsed.stem || fullName || '(unnamed)';
}

/**
 * Master row key for Copy Center grouping.
 * MCE rows: MessageName__c — not parsed Name suffix.
 */
export function masterGroupKey(record) {
    if (record && record.MessageName__c && String(record.MessageName__c).trim()) {
        return String(record.MessageName__c).trim();
    }
    return groupKeyFromName(record?.Name);
}

function parseVariantToken(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const direct = Number(text);
    if (!Number.isNaN(direct)) return direct;
    const match = text.match(/\d+/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isNaN(parsed) ? null : parsed;
}

export function variantNumberFromRecord(record) {
    if (!record) return 0;
    if (record.MessageVariant__c != null && record.MessageVariant__c !== '') {
        const fromMce = parseVariantToken(record.MessageVariant__c);
        if (fromMce != null) return fromMce;
    }
    if (record.Message_Variant__c != null && record.Message_Variant__c !== '') {
        const fromLabel = parseVariantToken(record.Message_Variant__c);
        if (fromLabel != null) return fromLabel;
    }
    if (record.Version__c != null && record.Version__c !== '') {
        const fromVersion = parseVariantToken(record.Version__c);
        if (fromVersion != null) return fromVersion;
    }
    const parsed = parseFullName(record.Name);
    return parsed.variant != null ? parsed.variant : 0;
}

export function recordBelongsToMasterGroup(record, stem) {
    if (!stem || !record) return false;
    if (record.MessageName__c && String(record.MessageName__c).trim() === stem) {
        return true;
    }
    return nameBelongsToStem(record.Name, stem) || groupKeyFromName(record.Name) === stem;
}

export function nameBelongsToStem(fullName, stem) {
    if (!stem) return false;
    const name = String(fullName || '');
    if (name === stem) return true;
    const sep = variantSeparatorForStem(stem);
    if (!name.startsWith(`${stem}${sep}`)) return false;
    const suffix = name.substring(stem.length + 1);
    return /^\d+$/.test(suffix);
}

export function nextAvailableVariant(takenVariants) {
    const taken = new Set((takenVariants || []).map(Number));
    let v = 1;
    while (taken.has(v)) v += 1;
    return v;
}
