/**
 * Mobile Push open / button behaviours and device preview modes.
 */

export const PUSH_OPEN_BEHAVIOUR_OPTIONS = [
  { value: 'app', label: 'Open the App', needsTarget: false },
  { value: 'appUrl', label: 'Go to App URL', needsTarget: true },
  { value: 'webUrl', label: 'Go to Web URL', needsTarget: true },
  { value: 'cloudPage', label: 'Go to CloudPage', needsTarget: true },
]

export const PUSH_OPEN_BEHAVIOUR_VALUES = PUSH_OPEN_BEHAVIOUR_OPTIONS.map(
  (option) => option.value,
)

export const DEFAULT_PUSH_OPEN_BEHAVIOUR = 'app'

/** Legacy openAction values from earlier drafts. */
const LEGACY_OPEN_BEHAVIOUR_MAP = {
  deeplink: 'appUrl',
  url: 'webUrl',
  deepLink: 'appUrl',
}

export function isValidPushOpenBehaviour(value = '') {
  return PUSH_OPEN_BEHAVIOUR_VALUES.includes(String(value ?? '').trim())
}

export function normalizePushOpenBehaviour(value = '', fallback = DEFAULT_PUSH_OPEN_BEHAVIOUR) {
  const raw = String(value ?? '').trim()
  const mapped = LEGACY_OPEN_BEHAVIOUR_MAP[raw] || raw
  if (isValidPushOpenBehaviour(mapped)) return mapped
  return isValidPushOpenBehaviour(fallback) ? fallback : DEFAULT_PUSH_OPEN_BEHAVIOUR
}

export function formatPushOpenBehaviourLabel(value = '') {
  const normalized = normalizePushOpenBehaviour(value, '')
  return (
    PUSH_OPEN_BEHAVIOUR_OPTIONS.find((option) => option.value === normalized)
      ?.label ?? 'Open the App'
  )
}

export function pushOpenBehaviourNeedsTarget(value = '') {
  const normalized = normalizePushOpenBehaviour(value)
  return Boolean(
    PUSH_OPEN_BEHAVIOUR_OPTIONS.find((option) => option.value === normalized)
      ?.needsTarget,
  )
}

export function pushOpenBehaviourTargetLabel(value = '') {
  const normalized = normalizePushOpenBehaviour(value)
  if (normalized === 'appUrl') return 'App URL'
  if (normalized === 'webUrl') return 'Web URL'
  if (normalized === 'cloudPage') return 'CloudPage URL'
  return 'Target URL'
}

export function pushOpenBehaviourTargetPlaceholder(value = '') {
  const normalized = normalizePushOpenBehaviour(value)
  if (normalized === 'appUrl') return 'app://offer/123'
  if (normalized === 'webUrl') return 'https://example.com'
  if (normalized === 'cloudPage') return 'https://cloud.page/... or CloudPage ID'
  return ''
}

export const PUSH_PREVIEW_DEVICE_OPTIONS = [
  {
    value: 'iphone',
    label: 'iPhone',
    views: [
      { value: 'lockScreen', label: 'Lock Screen' },
      { value: 'longPress', label: 'Long Press' },
      { value: 'alert', label: 'Alert' },
      { value: 'banner', label: 'Banner' },
    ],
  },
  {
    value: 'android',
    label: 'Android',
    views: [
      { value: 'lockScreen', label: 'Lock Screen' },
      { value: 'shade', label: 'Shade' },
    ],
  },
  {
    value: 'smartWatch',
    label: 'Apple Watch',
    views: [
      { value: 'shortLook', label: 'Short Look' },
      { value: 'longLook', label: 'Long Look' },
    ],
  },
]

export const DEFAULT_PUSH_PREVIEW_DEVICE = 'iphone'
export const DEFAULT_PUSH_PREVIEW_VIEW = 'lockScreen'

export function getPushPreviewViewsForDevice(device = DEFAULT_PUSH_PREVIEW_DEVICE) {
  return (
    PUSH_PREVIEW_DEVICE_OPTIONS.find(
      (option) => option.value === String(device ?? '').trim(),
    )?.views ?? PUSH_PREVIEW_DEVICE_OPTIONS[0].views
  )
}

export function normalizePushPreviewDevice(value = '') {
  const normalized = String(value ?? '').trim()
  return PUSH_PREVIEW_DEVICE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_PUSH_PREVIEW_DEVICE
}

export function normalizePushPreviewView(device = '', view = '') {
  const resolvedDevice = normalizePushPreviewDevice(device)
  const views = getPushPreviewViewsForDevice(resolvedDevice)
  const normalized = String(view ?? '').trim()
  return views.some((option) => option.value === normalized)
    ? normalized
    : views[0]?.value || DEFAULT_PUSH_PREVIEW_VIEW
}

export const PUSH_ANDROID_BUTTON_COUNT = 3

export function createEmptyPushButton(overrides = {}) {
  return {
    label: String(overrides.label ?? ''),
    identifier: String(overrides.identifier ?? ''),
    iconFileName: String(overrides.iconFileName ?? overrides.icon ?? ''),
    behaviour: normalizePushOpenBehaviour(
      overrides.behaviour ?? overrides.openAction,
      DEFAULT_PUSH_OPEN_BEHAVIOUR,
    ),
    targetUrl: String(overrides.targetUrl ?? overrides.url ?? ''),
  }
}

export function normalizePushButtons(rawButtons) {
  const source = Array.isArray(rawButtons) ? rawButtons : []
  return Array.from({ length: PUSH_ANDROID_BUTTON_COUNT }, (_, index) =>
    createEmptyPushButton(source[index] || {}),
  )
}
