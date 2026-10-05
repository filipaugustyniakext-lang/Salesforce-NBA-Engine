/**
 * Web Banner channel types (master banner categories).
 * All versions of a message share one bannerType; changing it requires a new message.
 */

export const BANNER_TYPE_OPTIONS = [
  {
    value: 'mainBanner',
    label: 'Main Banner',
    description: 'Primary homepage / hero placement.',
  },
  {
    value: 'photoBanner',
    label: 'Photo Banner',
    description: 'Image-led banner with supporting copy.',
  },
  {
    value: 'vasBanner',
    label: 'VAS Banner',
    description: 'Value-added services promotional banner.',
  },
  {
    value: 'smallBanner',
    label: 'Small Banner',
    description: 'Compact strip / secondary placement.',
  },
]

export const BANNER_TYPE_VALUES = BANNER_TYPE_OPTIONS.map(
  (option) => option.value,
)

export const DEFAULT_BANNER_TYPE = 'mainBanner'

export function isValidBannerType(value = '') {
  return BANNER_TYPE_VALUES.includes(String(value ?? '').trim())
}

export function normalizeBannerType(value = '', fallback = '') {
  const normalized = String(value ?? '').trim()
  if (isValidBannerType(normalized)) return normalized
  return isValidBannerType(fallback) ? fallback : ''
}

export function formatBannerTypeLabel(value = '') {
  const match = BANNER_TYPE_OPTIONS.find(
    (option) => option.value === String(value ?? '').trim(),
  )
  return match?.label ?? String(value ?? '').trim()
}
