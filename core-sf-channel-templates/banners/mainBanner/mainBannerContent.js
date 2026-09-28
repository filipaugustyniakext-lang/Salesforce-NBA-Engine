/**
 * mainBanner content model — layout variants, limits, and normalization.
 */

import { normalizeBannerActionTarget } from './bannerIntents.js'

export const MAIN_BANNER_WIDTH = 315
export const MAIN_BANNER_HEIGHT = 191
export const MAIN_BANNER_IMAGE_SIZE = 100
export const MAIN_BANNER_PHONE_WIDTH = 375
export const MAIN_BANNER_SCREEN_INSET = 20
/** Phone mock screen height (portrait mobile). */
export const MAIN_BANNER_PHONE_HEIGHT = 720

export const MAIN_BANNER_COLORS = {
  background: '#002D36',
  backgroundDark: '#210004',
  buttonPrimary: '#E7F8FB',
  buttonPrimaryDark: '#7A1A12',
  buttonSecondaryBorder: '#E7F8FB',
  text: '#FFFFFF',
  buttonPrimaryText: '#002D36',
  buttonPrimaryTextDark: '#FFFFFF',
}

export const MAIN_BANNER_LAYOUT_OPTIONS = [
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

export const MAIN_BANNER_TITLE_MAX = 17
export const MAIN_BANNER_DESCRIPTION_MAX_WITH_TERTIARY = 40
export const MAIN_BANNER_DESCRIPTION_MAX_WITHOUT_TERTIARY = 60
export const MAIN_BANNER_LEGAL_NOTE_MAX = 2000

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

function resolveMainBannerImageFields(source = {}) {
  const legacy = String(source.imageUrl ?? '').trim()
  const imageUrlLight = String(source.imageUrlLight ?? '').trim() || legacy
  const imageUrlDark = String(source.imageUrlDark ?? '').trim()
  return {
    imageUrlLight,
    imageUrlDark,
    imageUrl: imageUrlLight,
  }
}

export function resolveMainBannerImageUrl(content = {}, darkMode = false) {
  const { imageUrlLight, imageUrlDark } = resolveMainBannerImageFields(content)
  if (darkMode) {
    return imageUrlDark || imageUrlLight
  }
  return imageUrlLight
}

export function validateMainBannerContentForSave(content = {}) {
  const normalized = normalizeMainBannerContent(content)
  if (!normalized.imageUrlLight) {
    return {
      ok: false,
      reason: 'Add a light mode banner image before saving or publishing.',
    }
  }
  return { ok: true, reason: '' }
}

export function createDefaultMainBannerContent(overrides = {}) {
  return normalizeMainBannerContent({
    type: 'BannerContent',
    bannerType: 'mainBanner',
    darkMode: false,
    buttonLayout: 'threeButtons',
    title: '',
    description: '',
    imageUrl: '',
    imageUrlLight: '',
    imageUrlDark: '',
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

export function getMainBannerDescriptionMax(buttonLayout = '') {
  return layoutShowsTertiary(buttonLayout)
    ? MAIN_BANNER_DESCRIPTION_MAX_WITH_TERTIARY
    : MAIN_BANNER_DESCRIPTION_MAX_WITHOUT_TERTIARY
}

function resolveLegalNote(source = {}) {
  if (source.legalNote != null && String(source.legalNote).trim()) {
    return String(source.legalNote)
  }
  // Legacy: some drafts may have stored note text in tertiaryUrl.
  const legacy = String(source.tertiaryUrl ?? '').trim()
  if (legacy && !/^https?:\/\//i.test(legacy)) {
    return legacy
  }
  return ''
}

export function normalizeMainBannerContent(content = {}) {
  const source = content && typeof content === 'object' ? content : {}
  const buttonLayout = MAIN_BANNER_LAYOUT_OPTIONS.some(
    (option) => option.value === source.buttonLayout,
  )
    ? source.buttonLayout
    : 'threeButtons'
  const imageFields = resolveMainBannerImageFields(source)

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
    bannerType: 'mainBanner',
    darkMode: source.darkMode === true,
    buttonLayout,
    title: String(source.title ?? ''),
    description: String(source.description ?? ''),
    imageUrl: imageFields.imageUrl,
    imageUrlLight: imageFields.imageUrlLight,
    imageUrlDark: imageFields.imageUrlDark,
    legalLabel: String(source.legalLabel ?? source.tertiaryLabel ?? ''),
    legalNote: String(resolveLegalNote(source) ?? ''),
    secondaryLabel: String(source.secondaryLabel ?? ''),
    ...secondaryTarget,
    primaryLabel: String(source.primaryLabel ?? ''),
    ...primaryTarget,
    showClose: source.showClose !== false,
  }
}
