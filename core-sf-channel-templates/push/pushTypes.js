/**
 * Mobile Push channel types (master push categories).
 * All versions of a message share one pushType; changing it requires a new message.
 */

export const PUSH_TYPE_OPTIONS = [
  {
    value: 'standard',
    label: 'Standard Push',
    description: 'Create a push notification with 1 media attachment.',
  },
  {
    value: 'carousel',
    label: 'Carousel Push',
    description:
      'Create a push notification with up to 5 images. Compatible with SDK versions 8.x and newer.',
  },
]

export const PUSH_TYPE_VALUES = PUSH_TYPE_OPTIONS.map((option) => option.value)

export const DEFAULT_PUSH_TYPE = 'standard'

export function isValidPushType(value = '') {
  return PUSH_TYPE_VALUES.includes(String(value ?? '').trim())
}

export function normalizePushType(value = '', fallback = '') {
  const normalized = String(value ?? '').trim()
  if (isValidPushType(normalized)) return normalized
  return isValidPushType(fallback) ? fallback : ''
}

export function formatPushTypeLabel(value = '') {
  const match = PUSH_TYPE_OPTIONS.find(
    (option) => option.value === String(value ?? '').trim(),
  )
  return match?.label ?? String(value ?? '').trim()
}
