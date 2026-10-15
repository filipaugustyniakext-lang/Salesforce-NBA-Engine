export const COUNTRY_OPTIONS = [
    { label: 'Poland (PL)', value: 'PL' },
    { label: 'Romania (RO)', value: 'RO' },
    { label: 'Czechia (CZ)', value: 'CZ' },
    { label: 'Hungary (HU)', value: 'HU' },
    { label: 'Bulgaria (BG)', value: 'BG' },
    { label: 'Croatia (HR)', value: 'HR' },
    { label: 'Germany (DE)', value: 'DE' },
    { label: 'Italy (IT)', value: 'IT' }
];

export const CLASSIFICATION_OPTIONS = [
    { label: 'Commercial', value: 'Commercial' },
    { label: 'Transactional', value: 'Transactional' }
];

export const WIZARD_STEPS = [
    { value: 'basic', label: 'Basic Properties', number: 'I' },
    { value: 'shell', label: 'Template Shell', number: 'II' },
    { value: 'blocks', label: 'Content Blocks', number: 'III' },
    { value: 'summary', label: 'Validate & Preview', number: 'IV' }
];

const CC_PREVIEW_PATTERN = /<cc-preview\b[^>]*\btype\s*=\s*(['"])(fixed-read|fixed-edit|blocks)\1/gi;

export function normalizeSlug(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '')
        .substring(0, 80);
}

export function composeRecordName(countryCode, slug, classification) {
    const clean = normalizeSlug(slug);
    if (!clean) return '';
    const country = (countryCode || 'PL').trim() || 'PL';
    const kind = classification || 'Commercial';
    return `TEMP_${country}_${clean}_${kind}`;
}

export function scanCcPreviewRegions(html) {
    const found = new Set();
    const source = String(html || '');
    let match = CC_PREVIEW_PATTERN.exec(source);
    while (match) {
        found.add(String(match[2]).toLowerCase());
        match = CC_PREVIEW_PATTERN.exec(source);
    }
    CC_PREVIEW_PATTERN.lastIndex = 0;
    return ['fixed-read', 'fixed-edit', 'blocks'].filter(type => found.has(type));
}

export function regionLabel(type) {
    if (type === 'fixed-read') return 'fixed-read (pre-rendered)';
    if (type === 'fixed-edit') return 'fixed-edit (editable defaults)';
    if (type === 'blocks') return 'blocks (drop zone)';
    return type;
}
