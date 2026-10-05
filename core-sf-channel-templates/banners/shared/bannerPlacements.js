/**
 * Web Banner placement locations (master-message level).
 * All variants of a message share the same placement set (one or more).
 */

export const BANNER_PLACEMENT_OPTIONS = [
  {
    value: 'mainPage',
    label: 'Main Page',
    description: 'Homepage / main feed placement.',
  },
  {
    value: 'productPageLoans',
    label: 'Product Page: Loans',
    description: 'Loans product page.',
  },
  {
    value: 'productPageInvestments',
    label: 'Product Page: Investments',
    description: 'Investments product page.',
  },
  {
    value: 'productPageAccounts',
    label: 'Product Page: Accounts',
    description: 'Accounts product page.',
  },
  {
    value: 'productPageCards',
    label: 'Product Page: Cards',
    description: 'Cards product page.',
  },
]

export const BANNER_PLACEMENT_VALUES = BANNER_PLACEMENT_OPTIONS.map(
  (option) => option.value,
)

export const DEFAULT_BANNER_PLACEMENT = 'mainPage'

export function isValidBannerPlacement(value = '') {
  return BANNER_PLACEMENT_VALUES.includes(String(value ?? '').trim())
}

export function normalizeBannerPlacement(value = '', fallback = '') {
  const normalized = String(value ?? '').trim()
  if (isValidBannerPlacement(normalized)) return normalized
  return isValidBannerPlacement(fallback) ? fallback : ''
}

export function formatBannerPlacementLabel(value = '') {
  const match = BANNER_PLACEMENT_OPTIONS.find(
    (option) => option.value === String(value ?? '').trim(),
  )
  return match?.label ?? String(value ?? '').trim()
}

/** Split a stored placement value into raw tokens (array, CSV, or single). */
export function splitBannerPlacementValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }
  const raw = String(value ?? '').trim()
  if (!raw) return []
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
      }
    } catch {
      /* fall through to CSV / single */
    }
  }
  return raw
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Normalize one or more placement values to a de-duplicated ordered list.
 * Accepts placementIds array, placementId string, CSV, or mixed metadata.
 */
export function normalizeBannerPlacementIds(
  value,
  fallback = DEFAULT_BANNER_PLACEMENT,
) {
  const seen = new Set()
  const result = []
  for (const token of splitBannerPlacementValues(value)) {
    const normalized = normalizeBannerPlacement(token)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  if (result.length) return result
  const fallbackNormalized = normalizeBannerPlacement(fallback)
  return fallbackNormalized ? [fallbackNormalized] : []
}

export function parseBannerPlacementIdsFromMeta(meta = {}) {
  if (Array.isArray(meta?.placementIds) && meta.placementIds.length) {
    return normalizeBannerPlacementIds(meta.placementIds, '')
  }
  return normalizeBannerPlacementIds(meta?.placementId, '')
}

export function primaryBannerPlacementId(
  value,
  fallback = DEFAULT_BANNER_PLACEMENT,
) {
  return normalizeBannerPlacementIds(value, fallback)[0] ?? ''
}

export function isValidBannerPlacementSelection(value) {
  return normalizeBannerPlacementIds(value, '').length > 0
}

export function formatBannerPlacementLabels(value = []) {
  return normalizeBannerPlacementIds(value, '')
    .map((id) => formatBannerPlacementLabel(id))
    .filter(Boolean)
    .join(', ')
}

/** Persist shape: array + primary for older readers. */
export function toBannerPlacementPersistFields(value) {
  const placementIds = normalizeBannerPlacementIds(value, '')
  return {
    placementIds,
    placementId: placementIds[0] ?? '',
  }
}
