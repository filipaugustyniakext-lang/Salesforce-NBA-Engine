/**
 * smallBanner content model — compact list strip with illustration + text + chevron.
 */

import { normalizeBannerActionTarget } from './bannerIntents.js'

/** Design reference width at 375px phone with 20px insets; layout uses 100%. */
export const SMALL_BANNER_WIDTH = 335
export const SMALL_BANNER_MIN_HEIGHT = 48
export const SMALL_BANNER_RADIUS = 12
export const SMALL_BANNER_IMAGE_SIZE = 40
export const SMALL_BANNER_IMAGE_RADIUS = 8

export const SMALL_BANNER_PHONE_WIDTH = 375
export const SMALL_BANNER_SCREEN_INSET = 20
export const SMALL_BANNER_PHONE_HEIGHT = 720

export const SMALL_BANNER_COLORS = {
  background: '#002D36',
  backgroundDark: '#210004',
  text: '#FFFFFF',
  focusRing: '#FF6A00',
}

export const SMALL_BANNER_TEXT_MAX = 48

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

function resolveSmallBannerImageFields(source = {}) {
  const legacy = String(source.imageUrl ?? '').trim()
  const imageUrlLight = String(source.imageUrlLight ?? '').trim() || legacy
  const imageUrlDark = String(source.imageUrlDark ?? '').trim()
  return {
    imageUrlLight,
    imageUrlDark,
    imageUrl: imageUrlLight,
  }
}

export function resolveSmallBannerImageUrl(content = {}, darkMode = false) {
  const { imageUrlLight, imageUrlDark } = resolveSmallBannerImageFields(content)
  if (darkMode) {
    return imageUrlDark || imageUrlLight
  }
  return imageUrlLight
}

export function validateSmallBannerContentForSave(content = {}) {
  const normalized = normalizeSmallBannerContent(content)
  if (!normalized.imageUrlLight) {
    return {
      ok: false,
      reason: 'Add a light mode banner image before saving or publishing.',
    }
  }
  return { ok: true, reason: '' }
}

export function createDefaultSmallBannerContent(overrides = {}) {
  return normalizeSmallBannerContent({
    type: 'BannerContent',
    bannerType: 'smallBanner',
    darkMode: false,
    text: '',
    imageUrl: '',
    imageUrlLight: '',
    imageUrlDark: '',
    actionMode: '',
    intent: '',
    url: '',
    ...overrides,
  })
}

export function normalizeSmallBannerContent(content = {}) {
  const source = content && typeof content === 'object' ? content : {}
  const imageFields = resolveSmallBannerImageFields(source)
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
    bannerType: 'smallBanner',
    darkMode: source.darkMode === true,
    text: String(source.text ?? ''),
    imageUrl: imageFields.imageUrl,
    imageUrlLight: imageFields.imageUrlLight,
    imageUrlDark: imageFields.imageUrlDark,
    ...actionTarget,
  }
}
