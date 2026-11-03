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
    { value: 'summary', label: 'Validate and Activate', number: 'IV' }
];

const CC_PREVIEW_REGION_PATTERN = /<cc-preview\b[^>]*\bregion\s*=\s*(['"])([^'"]+)\1/gi;
const CC_PREVIEW_TYPE_PATTERN = /<cc-preview\b[^>]*\btype\s*=\s*(['"])([^'"]+)\1/gi;

const CANONICAL_REGION_ORDER = ['fixed-read', 'fixed-edit', 'blocks'];

export function normalizePreviewType(rawType) {
    const value = String(rawType || '').trim().toLowerCase();
    if (value === 'fixed' || value === 'fixed-read' || value === 'preview-fixed') return 'fixed-read';
    if (value === 'fixed-edit' || value === 'preview-edit') return 'fixed-edit';
    if (value === 'blocks') return 'blocks';
    return '';
}

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
    const collect = (pattern) => {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);
        while (match) {
            const canonical = normalizePreviewType(match[2]);
            if (canonical) found.add(canonical);
            match = pattern.exec(source);
        }
    };
    collect(CC_PREVIEW_REGION_PATTERN);
    collect(CC_PREVIEW_TYPE_PATTERN);
    return CANONICAL_REGION_ORDER.filter(type => found.has(type));
}

export function regionLabel(type) {
    if (type === 'fixed-read') return 'fixed-read (read-only shell)';
    if (type === 'fixed-edit') return 'fixed-edit (editable regions)';
    if (type === 'blocks') return 'blocks (content canvas)';
    return type;
}

/** Editor field targets for {{placeholder}} content bindings (Copy Center message editor). */
export const CONTENT_BINDING_SOURCE_OPTIONS = [
    { label: 'Copy text', value: 'copy' },
    { label: 'Image URL', value: 'imageUrl' },
    { label: 'Alt text', value: 'altText' },
    { label: 'Legal / disclaimer text', value: 'legal' }
];

/** Legacy block settings when HTML does not use binding-container layout markers. */
export const LEGACY_BLOCK_SETTING_OPTIONS = [
    { label: 'Desktop visibility', value: 'viewDesktop' },
    { label: 'Mobile visibility', value: 'viewMobile' },
    { label: 'Padding', value: 'padding' },
    { label: 'Background', value: 'background' },
    { label: 'Column layout', value: 'columnLayout' },
    { label: 'Desktop height', value: 'heightDesktop' },
    { label: 'Mobile height', value: 'heightMobile' }
];

const CONTENT_SOURCE_VALUES = new Set(CONTENT_BINDING_SOURCE_OPTIONS.map(item => item.value));

export function isContentPlaceholder(name, structuralTokens) {
    const token = String(name || '').trim();
    if (!token) return false;
    return !(structuralTokens || []).includes(token);
}

export function suggestContentBindingSource(placeholder) {
    const key = String(placeholder || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) return '';
    if (key.includes('imageurl') || key === 'image' || key.includes('imgurl')) return 'imageUrl';
    if (key.includes('alt')) return 'altText';
    if (key.includes('legal') || key.includes('disclaimer')) return 'legal';
    if (key.includes('copy') || key.includes('text') || key.includes('body') || key.includes('richtext')) {
        return 'copy';
    }
    return '';
}

export function mergeBindingRows(primary, secondary) {
    const byPlaceholder = new Map();
    (secondary || []).forEach(row => {
        if (row?.placeholder) byPlaceholder.set(row.placeholder, row);
    });
    (primary || []).forEach(row => {
        if (row?.placeholder && row.source) byPlaceholder.set(row.placeholder, row);
    });
    return [...byPlaceholder.values()];
}

export function bindingSourceLabel(source) {
    const match = CONTENT_BINDING_SOURCE_OPTIONS.find(item => item.value === source);
    if (match) return match.label;
    return source || '—';
}

export function isContentBindingSource(source) {
    return CONTENT_SOURCE_VALUES.has(source);
}