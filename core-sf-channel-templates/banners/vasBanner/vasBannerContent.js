import { normalizeBannerActionTarget } from './bannerIntents.js'

/**
 * vasBanner content model — image tile with logo, close, and per-layout variants.
 *
 * Production may render any of the three sizes, so DE JSON always stores all
 * three variants (title + background-position) alongside shared assets.
 *
 *   expanded:           100% × 164, title max 54
 *   halfExpandedLong:   50% × 240, title max 33
 *   halfExpandedShort:  50% × 164, title max 22
 *
 * Multiple VAS banners render in a grid (gap 8px), not a carousel.
 */

export const VAS_BANNER_GAP = 8
export const VAS_BANNER_SOLO_MARGIN_Y = 16
export const VAS_BANNER_RADIUS = 12
export const VAS_BANNER_LOGO_SIZE = 32
export const VAS_BANNER_FOCUS_RING = '#FF6A00'
export const VAS_BANNER_CLOSE_HOVER = '#BFEBF3'
export const VAS_BANNER_CLOSE_PRESSED = '#9FD8E2'
export const VAS_BANNER_DEFAULT_BG_POSITION = 50

export const VAS_BANNER_PHONE_WIDTH = 375
export const VAS_BANNER_SCREEN_INSET = 20

/** Design reference widths at 375px phone with 20px insets. */
export const VAS_BANNER_EXPANDED_REF_WIDTH = 335
export const VAS_BANNER_HALF_REF_WIDTH = 164

export const VAS_BANNER_LAYOUT_OPTIONS = [
  {
    value: 'expanded',
    label: 'Expanded',
    description: 'Full-width tile (100% × 164).',
    width: '100%',
    height: 164,
    titleMax: 54,
    personalizationField: 'bannerExpandedTitle',
    titleInputId: 'vas-banner-expanded-title',
  },
  {
    value: 'halfExpandedLong',
    label: 'Half expanded long',
    description: 'Tall half-width tile (50% × 240).',
    width: '50%',
    height: 240,
    titleMax: 33,
    personalizationField: 'bannerHalfExpandedLongTitle',
    titleInputId: 'vas-banner-half-long-title',
  },
  {
    value: 'halfExpandedShort',
    label: 'Half expanded short',
    description: 'Short half-width tile (50% × 164).',
    width: '50%',
    height: 164,
    titleMax: 22,
    personalizationField: 'bannerHalfExpandedShortTitle',
    titleInputId: 'vas-banner-half-short-title',
  },
]

export const VAS_BANNER_LAYOUT_VALUES = VAS_BANNER_LAYOUT_OPTIONS.map(
  (option) => option.value,
)

export const DEFAULT_VAS_BANNER_LAYOUT = 'expanded'

/** Allowed grid preview sizes (current banner + placeholders). */
export const VAS_BANNER_GRID_COUNT_OPTIONS = [2, 3, 4, 5]
export const DEFAULT_VAS_BANNER_GRID_COUNT = 4

/**
 * Layout sequences matching Figma promotions grids (expanded + staggered halves).
 */
export const VAS_BANNER_GRID_TEMPLATES = {
  2: ['halfExpandedShort', 'halfExpandedLong'],
  3: ['expanded', 'halfExpandedShort', 'halfExpandedLong'],
  4: [
    'expanded',
    'halfExpandedShort',
    'halfExpandedLong',
    'halfExpandedLong',
  ],
  5: [
    'expanded',
    'halfExpandedShort',
    'halfExpandedLong',
    'halfExpandedLong',
    'halfExpandedShort',
  ],
}

export function normalizeVasBannerGridCount(
  value = DEFAULT_VAS_BANNER_GRID_COUNT,
) {
  const n = Number(value)
  if (VAS_BANNER_GRID_COUNT_OPTIONS.includes(n)) return n
  return DEFAULT_VAS_BANNER_GRID_COUNT
}

export function isValidVasBannerLayout(value = '') {
  return VAS_BANNER_LAYOUT_VALUES.includes(String(value ?? '').trim())
}

export function normalizeVasBannerLayout(
  value = '',
  fallback = DEFAULT_VAS_BANNER_LAYOUT,
) {
  const normalized = String(value ?? '').trim()
  if (isValidVasBannerLayout(normalized)) return normalized
  return isValidVasBannerLayout(fallback)
    ? fallback
    : DEFAULT_VAS_BANNER_LAYOUT
}

export function getVasBannerLayoutMeta(layout = DEFAULT_VAS_BANNER_LAYOUT) {
  const resolved = normalizeVasBannerLayout(layout)
  return (
    VAS_BANNER_LAYOUT_OPTIONS.find((option) => option.value === resolved) ??
    VAS_BANNER_LAYOUT_OPTIONS[0]
  )
}

export function getVasBannerTitleMax(layout = DEFAULT_VAS_BANNER_LAYOUT) {
  return getVasBannerLayoutMeta(layout).titleMax
}

export function isVasBannerHalfLayout(layout = DEFAULT_VAS_BANNER_LAYOUT) {
  const resolved = normalizeVasBannerLayout(layout)
  return (
    resolved === 'halfExpandedLong' || resolved === 'halfExpandedShort'
  )
}

/** Clamp background-position axis to 0–100 (percent). */
export function normalizeVasBannerBgPosition(
  value = VAS_BANNER_DEFAULT_BG_POSITION,
) {
  const n = Number(value)
  if (!Number.isFinite(n)) return VAS_BANNER_DEFAULT_BG_POSITION
  return Math.min(100, Math.max(0, Math.round(n)))
}

export function formatVasBannerBgPositionCss(x = 50, y = 50) {
  return `${normalizeVasBannerBgPosition(x)}% ${normalizeVasBannerBgPosition(y)}%`
}

/** Normalize operator-provided focus border color (#RGB / #RRGGBB). */
export function normalizeVasBannerFocusBorderColor(
  value = '',
  fallback = VAS_BANNER_FOCUS_RING,
) {
  const raw = String(value ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  const fallbackRaw = String(fallback ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(fallbackRaw)) return fallbackRaw.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(fallbackRaw)) {
    const [, r, g, b] = fallbackRaw
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return VAS_BANNER_FOCUS_RING
}

/** Personalization / AMPscript may exceed display character budgets. */
export function containsPersonalizationMarkup(value = '') {
  return /%%|AttributeValue\s*\(|IIF\s*\(/i.test(String(value ?? ''))
}

export function limitBannerPlainText(value = '', max = 0) {
  const text = String(value ?? '')
  if (!Number.isFinite(max) || max <= 0) return text
  if (containsPersonalizationMarkup(text)) return text
  return text.slice(0, max)
}

export function createDefaultVasBannerVariant(layout = DEFAULT_VAS_BANNER_LAYOUT) {
  return {
    title: '',
    backgroundPositionX: VAS_BANNER_DEFAULT_BG_POSITION,
    backgroundPositionY: VAS_BANNER_DEFAULT_BG_POSITION,
  }
}

export function normalizeVasBannerVariant(layout, source = {}, legacyTitle = '') {
  const raw = source && typeof source === 'object' ? source : {}
  return {
    title: String(raw.title ?? legacyTitle ?? ''),
    backgroundPositionX: normalizeVasBannerBgPosition(
      raw.backgroundPositionX ?? raw.bgPositionX ?? raw.positionX,
    ),
    backgroundPositionY: normalizeVasBannerBgPosition(
      raw.backgroundPositionY ?? raw.bgPositionY ?? raw.positionY,
    ),
  }
}

export function normalizeVasBannerVariants(source = {}) {
  const root = source && typeof source === 'object' ? source : {}
  const variantsRaw =
    root.variants && typeof root.variants === 'object' ? root.variants : {}
  // Migrate legacy single-title / single-layout payloads into all variants.
  const legacyTitle = root.title ?? root.text ?? ''
  const legacyLayout = normalizeVasBannerLayout(
    root.layout || root.size || root.variant,
    '',
  )

  const variants = {}
  for (const option of VAS_BANNER_LAYOUT_OPTIONS) {
    const key = option.value
    const seedTitle =
      legacyLayout === key || (!legacyLayout && key === DEFAULT_VAS_BANNER_LAYOUT)
        ? legacyTitle
        : ''
    variants[key] = normalizeVasBannerVariant(
      key,
      variantsRaw[key],
      seedTitle,
    )
  }
  return variants
}

export function createDefaultVasBannerContent(overrides = {}) {
  return normalizeVasBannerContent({
    type: 'BannerContent',
    bannerType: 'vasBanner',
    darkMode: false,
    previewLayout: DEFAULT_VAS_BANNER_LAYOUT,
    imageUrl: '',
    logoUrl: '',
    actionMode: '',
    intent: '',
    url: '',
    showClose: true,
    focusBorderColor: VAS_BANNER_FOCUS_RING,
    variants: {
      expanded: createDefaultVasBannerVariant('expanded'),
      halfExpandedLong: createDefaultVasBannerVariant('halfExpandedLong'),
      halfExpandedShort: createDefaultVasBannerVariant('halfExpandedShort'),
    },
    ...overrides,
  })
}

/**
 * Canonical DE / editor payload. Always includes all three layout variants.
 */
export function normalizeVasBannerContent(content = {}) {
  const source = content && typeof content === 'object' ? content : {}
  const previewLayout = normalizeVasBannerLayout(
    source.previewLayout || source.layout || source.size || source.variant,
  )
  const actionTarget = normalizeBannerActionTarget(
    {
      ...source,
      url: String(
        source.url ?? source.targetUrl ?? source.primaryUrl ?? '',
      ).trim(),
    },
    { legacyUrlKeys: ['targetUrl', 'primaryUrl'] },
  )

  return {
    type: 'BannerContent',
    bannerType: 'vasBanner',
    darkMode: source.darkMode === true,
    /** Editor/preview only: which size to show in Single mode. */
    previewLayout,
    imageUrl: String(source.imageUrl ?? source.backgroundUrl ?? '').trim(),
    logoUrl: String(
      source.logoUrl ?? source.iconUrl ?? source.cornerIconUrl ?? '',
    ).trim(),
    ...actionTarget,
    showClose: source.showClose !== false,
    focusBorderColor: normalizeVasBannerFocusBorderColor(
      source.focusBorderColor ?? source.accentColor ?? source.borderColor,
    ),
    variants: normalizeVasBannerVariants(source),
  }
}

/**
 * Flatten shared + one variant for rendering a specific layout size.
 */
export function resolveVasBannerForLayout(
  content = {},
  layout = '',
) {
  const normalized = normalizeVasBannerContent(content)
  const resolvedLayout = normalizeVasBannerLayout(
    layout || normalized.previewLayout,
    normalized.previewLayout,
  )
  const variant =
    normalized.variants[resolvedLayout] ??
    createDefaultVasBannerVariant(resolvedLayout)
  return {
    ...normalized,
    layout: resolvedLayout,
    title: variant.title,
    backgroundPositionX: variant.backgroundPositionX,
    backgroundPositionY: variant.backgroundPositionY,
    backgroundPosition: formatVasBannerBgPositionCss(
      variant.backgroundPositionX,
      variant.backgroundPositionY,
    ),
  }
}

export function getVasBannerVariantTitle(content = {}, layout = DEFAULT_VAS_BANNER_LAYOUT) {
  return resolveVasBannerForLayout(content, layout).title
}

export function patchVasBannerVariant(content = {}, layout, partial = {}) {
  const normalized = normalizeVasBannerContent(content)
  const resolved = normalizeVasBannerLayout(layout)
  return normalizeVasBannerContent({
    ...normalized,
    variants: {
      ...normalized.variants,
      [resolved]: normalizeVasBannerVariant(resolved, {
        ...normalized.variants[resolved],
        ...partial,
      }),
    },
  })
}

export function createVasBannerPlaceholderContent(layout = 'halfExpandedShort') {
  return normalizeVasBannerContent({
    previewLayout: layout,
    variants: {
      [layout]: {
        title: '{Title}',
        backgroundPositionX: VAS_BANNER_DEFAULT_BG_POSITION,
        backgroundPositionY: VAS_BANNER_DEFAULT_BG_POSITION,
      },
    },
    imageUrl: '',
    logoUrl: '',
    url: '',
    showClose: true,
    focusBorderColor: VAS_BANNER_FOCUS_RING,
  })
}

/**
 * Build grid slides: live banner in a matching layout slot, rest are placeholders.
 * The live tile renders with the layout of that slot (using that variant's title/position).
 */
export function buildVasBannerGridSlides(
  currentContent = {},
  itemCount = DEFAULT_VAS_BANNER_GRID_COUNT,
) {
  const count = normalizeVasBannerGridCount(itemCount)
  const current = normalizeVasBannerContent(currentContent)
  const template = [
    ...(VAS_BANNER_GRID_TEMPLATES[count] ?? VAS_BANNER_GRID_TEMPLATES[4]),
  ]

  let currentIndex = template.findIndex(
    (layout) => layout === current.previewLayout,
  )
  if (currentIndex < 0) {
    currentIndex = 0
    template[0] = current.previewLayout
  }

  return template.map((layout, index) => {
    if (index === currentIndex) {
      return {
        id: 'vas-current',
        label: 'Current banner',
        isCurrent: true,
        isPlaceholder: false,
        layout,
        content: current,
      }
    }
    return {
      id: `vas-placeholder-${index}-${layout}`,
      label: `Placeholder · ${getVasBannerLayoutMeta(layout).label}`,
      isCurrent: false,
      isPlaceholder: true,
      layout,
      content: createVasBannerPlaceholderContent(layout),
    }
  })
}

/**
 * Pack slides into full-width rows + 2-column masonry for half tiles.
 * Avoids CSS Grid row-track gaps when a short tile sits beside a tall one.
 */
export function buildVasBannerMasonrySegments(slides = []) {
  const segments = []
  let left = []
  let right = []
  let leftHeight = 0
  let rightHeight = 0

  const flushHalves = () => {
    if (!left.length && !right.length) return
    segments.push({
      type: 'halves',
      left,
      right,
    })
    left = []
    right = []
    leftHeight = 0
    rightHeight = 0
  }

  for (const slide of slides) {
    const layout = normalizeVasBannerLayout(
      slide?.layout || slide?.content?.previewLayout,
    )
    const item = {
      ...slide,
      layout,
      isHalf: isVasBannerHalfLayout(layout),
    }

    if (!item.isHalf) {
      flushHalves()
      segments.push({ type: 'full', item })
      continue
    }

    const tileHeight = getVasBannerLayoutMeta(layout).height + VAS_BANNER_GAP
    if (leftHeight <= rightHeight) {
      left.push(item)
      leftHeight += tileHeight
    } else {
      right.push(item)
      rightHeight += tileHeight
    }
  }

  flushHalves()
  return segments
}

/** Map personalization field → layout key (or '' for shared fields). */
export function getVasBannerPersonalizationLayout(field = '') {
  const match = VAS_BANNER_LAYOUT_OPTIONS.find(
    (option) => option.personalizationField === field,
  )
  return match?.value ?? ''
}
