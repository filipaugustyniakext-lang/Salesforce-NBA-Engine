/**
 * Helpers for Salesforce locale codes (language_COUNTRY, e.g. pl_PL) stored on Locale dictionary records.
 */
const LOCALE_CODE_PATTERN = /^([a-z]{2,3})_([A-Za-z0-9]+)(?:_[A-Za-z0-9]+)*$/;

export function isSalesforceLocaleCode(code) {
    return LOCALE_CODE_PATTERN.test(String(code || '').trim());
}

/** Map of code -> "Language - Country" from getSalesforceLocales rows. */
export function buildLocaleLabelMap(rows) {
    const map = new Map();
    (rows || []).forEach(row => {
        if (row && row.value) {
            map.set(row.value, row.label || row.value);
        }
    });
    return map;
}

export function localeLabelFor(code, labelMap) {
    if (!code) return '';
    return (labelMap && labelMap.get(code)) || '';
}

/** "pl_PL · Polish - Poland", or just the code when no label is known. */
export function localeDisplay(code, labelMap) {
    const label = localeLabelFor(code, labelMap);
    return label ? `${code} · ${label}` : (code || '');
}

/**
 * Copy Center message names keep the countryCode-LANGUAGE token (pl-PL, pl-EN) because the
 * name parser splits on hyphens. pl_PL -> pl-PL, en_PL -> pl-EN. Legacy tokens pass through.
 */
export function copyLocaleToken(code) {
    const raw = String(code || '').trim();
    const match = raw.match(LOCALE_CODE_PATTERN);
    if (!match) return raw;
    return `${match[2].toLowerCase()}-${match[1].toUpperCase()}`;
}

/** Locale segments older campaign names may start with (CMP_pl-PL_..., CMP_pl-EN_...). */
export function legacyCampaignLocaleTokens(code) {
    const raw = String(code || '').trim();
    if (!raw) return [];
    const tokens = new Set([raw]);
    if (isSalesforceLocaleCode(raw)) {
        tokens.add(raw.replace(/_/g, '-'));
        tokens.add(copyLocaleToken(raw));
    }
    return [...tokens];
}
