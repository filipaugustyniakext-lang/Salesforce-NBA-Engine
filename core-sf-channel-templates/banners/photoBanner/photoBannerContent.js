/**
 * photoBanner content model — image-led banner with left glass content card.
 * Specs: banner 315×248 (radius 12, padding 4, gap 10);
 * content card 144×240 (radius 12, padding 12, gap 16).
 */

import { normalizeBannerActionTarget } from './bannerIntents.js'

export const PHOTO_BANNER_WIDTH = 315
export const PHOTO_BANNER_HEIGHT = 248
export const PHOTO_BANNER_RADIUS = 12
export const PHOTO_BANNER_PADDING = 4
export const PHOTO_BANNER_GAP = 10

export const PHOTO_BANNER_CARD_WIDTH = 144
export const PHOTO_BANNER_CARD_HEIGHT = 240
export const PHOTO_BANNER_CARD_RADIUS = 12
export const PHOTO_BANNER_CARD_PADDING = 12
export const PHOTO_BANNER_CARD_GAP = 16

export const PHOTO_BANNER_PHONE_WIDTH = 375
export const PHOTO_BANNER_SCREEN_INSET = 20
export const PHOTO_BANNER_PHONE_HEIGHT = 720

export const PHOTO_BANNER_COLORS = {
  cardBackground: 'rgba(255, 255, 255, 0.08)',
  cardBorder: 'rgba(255, 255, 255, 0.2)',
  text: '#FFFFFF',
  textSubtle: 'rgba(255, 255, 255, 0.7)',
  buttonPrimary: '#E7F8FB',
  buttonPrimaryDark: '#7A1A12',
  buttonPrimaryText: '#002D36',
  buttonPrimaryTextDark: '#FFFFFF',
  buttonSecondaryBorder: '#E7F8FB',
}

export const PHOTO_BANNER_LAYOUT_OPTIONS = [
  {
    value: 'threeButtons',
    label: 'Three buttons',
    description: 'Legal note + secondary + primary.',
  },
  {
    value: 'twoButtonsA',
    label: 'Two buttons (A)',
    description: 'Legal note + full-width primary.',
  },
  {
    value: 'twoButtonsB',
    label: 'Two buttons (B)',
    description: 'Secondary + primary (no legal note).',
  },
  {
    value: 'oneButton',
    label: 'One button',
    description: 'Full-width primary only.',
  },
]

export const PHOTO_BANNER_TITLE_SINGLE_LINE_MAX = 14
export const PHOTO_BANNER_TITLE_MAX = 28
export const PHOTO_BANNER_LEGAL_NOTE_MAX = 2000

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

export function layoutShowsTertiary(buttonLayout = '') {
  return buttonLayout === 'threeButtons' || buttonLayout === 'twoButtonsA'
}

export function layoutShowsSecondary(buttonLayout = '') {
  return buttonLayout === 'threeButtons' || buttonLayout === 'twoButtonsB'
}

export function layoutShowsPrimary(buttonLayout = '') {
  return true
}

export function layoutUsesFullWidthPrimary(buttonLayout = '') {
  return buttonLayout === 'twoButtonsA' || buttonLayout === 'oneButton'
}

export function isPhotoBannerLongTitle(title = '') {
  return String(title ?? '').length > PHOTO_BANNER_TITLE_SINGLE_LINE_MAX
}

/**
 * Description limits from Figma anatomy:
 * - 3 buttons + short title → 51; long title → 34
 * - fewer buttons + short title → 68; long title → 51
 */
export function getPhotoBannerDescriptionMax(buttonLayout = '', title = '') {
  const longTitle = isPhotoBannerLongTitle(title)
  const threeButtons = buttonLayout === 'threeButtons'
  if (threeButtons) {
    return longTitle ? 34 : 51
  }
  return longTitle ? 51 : 68
}

function resolveLegalNote(source = {}) {
  if (source.legalNote != null && String(source.legalNote).trim()) {
    return String(source.legalNote)
  }
  const legacy = String(source.tertiaryUrl ?? '').trim()
  if (legacy && !/^https?:\/\//i.test(legacy)) {
    return legacy
  }
  return ''
}

export function createDefaultPhotoBannerContent(overrides = {}) {
  return normalizePhotoBannerContent({
    type: 'BannerContent',
    bannerType: 'photoBanner',
    darkMode: false,
    buttonLayout: 'threeButtons',
    title: '',
    description: '',
    imageUrl: '',
    legalLabel: '',
    legalNote: '',
    secondaryLabel: '',
    secondaryActionMode: '',
    secondaryIntent: '',
    secondaryUrl: '',
    primaryLabel: '',
    primaryActionMode: '',
    primaryIntent: '',
    primaryUrl: '',
    showClose: true,
    ...overrides,
  })
}

export function normalizePhotoBannerContent(content = {}) {
  const source = content && typeof content === 'object' ? content : {}
  const buttonLayout = PHOTO_BANNER_LAYOUT_OPTIONS.some(
    (option) => option.value === source.buttonLayout,
  )
    ? source.buttonLayout
    : 'threeButtons'
  const title = String(source.title ?? '')
  const primaryTarget = normalizeBannerActionTarget(source, {
    modeKey: 'primaryActionMode',
    intentKey: 'primaryIntent',
    urlKey: 'primaryUrl',
  })
  const secondaryTarget = normalizeBannerActionTarget(source, {
    modeKey: 'secondaryActionMode',
    intentKey: 'secondaryIntent',
    urlKey: 'secondaryUrl',
  })

  return {
    type: 'BannerContent',
    bannerType: 'photoBanner',
    darkMode: source.darkMode === true,
    buttonLayout,
    title,
    description: String(source.description ?? ''),
    imageUrl: String(source.imageUrl ?? '').trim(),
    legalLabel: String(source.legalLabel ?? source.tertiaryLabel ?? ''),
    legalNote: String(resolveLegalNote(source) ?? ''),
    secondaryLabel: String(source.secondaryLabel ?? ''),
    ...secondaryTarget,
    primaryLabel: String(source.primaryLabel ?? ''),
    ...primaryTarget,
    showClose: source.showClose !== false,
  }
}
