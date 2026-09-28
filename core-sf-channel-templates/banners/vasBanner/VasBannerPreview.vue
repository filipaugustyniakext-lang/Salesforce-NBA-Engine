<script setup>
import { computed } from 'vue'
import {
  VAS_BANNER_FOCUS_RING,
  getVasBannerLayoutMeta,
  isVasBannerHalfLayout,
  normalizeVasBannerFocusBorderColor,
  normalizeVasBannerLayout,
  resolveVasBannerForLayout,
} from '../utils/vasBannerContent.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  /** When true, omit solo vertical margin (grid cell handles spacing). */
  inGrid: {
    type: Boolean,
    default: false,
  },
  /** Force a layout size (grid slot). Defaults to content.previewLayout. */
  layout: {
    type: String,
    default: '',
  },
  /** Muted context tile (no real creative). */
  placeholder: {
    type: Boolean,
    default: false,
  },
})

const resolved = computed(() =>
  resolveVasBannerForLayout(
    props.modelValue,
    props.layout || undefined,
  ),
)

const isHalf = computed(() => isVasBannerHalfLayout(resolved.value.layout))

const focusBorderColor = computed(() =>
  normalizeVasBannerFocusBorderColor(
    resolved.value.focusBorderColor,
    VAS_BANNER_FOCUS_RING,
  ),
)

const wrapStyle = computed(() => {
  if (props.inGrid) {
    return { width: '100%', maxWidth: '100%' }
  }
  if (isHalf.value) {
    return { width: '50%', maxWidth: '50%' }
  }
  return { width: '100%', maxWidth: '100%' }
})

const previewStyle = computed(() => {
  const height = getVasBannerLayoutMeta(resolved.value.layout).height
  return {
    width: '100%',
    height: `${height}px`,
    minHeight: `${height}px`,
    '--vas-focus-border': focusBorderColor.value,
  }
})

const mediaStyle = computed(() => {
  const imageUrl = String(resolved.value.imageUrl ?? '').trim()
  const position = resolved.value.backgroundPosition || '50% 50%'
  if (!imageUrl) {
    return {
      backgroundPosition: position,
    }
  }
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: position,
  }
})

const logoStyle = computed(() => {
  const logoUrl = String(resolved.value.logoUrl ?? '').trim()
  if (!logoUrl) return null
  return {
    backgroundImage: `url(${JSON.stringify(logoUrl)})`,
  }
})

const layoutClass = computed(() =>
  normalizeVasBannerLayout(resolved.value.layout),
)
</script>

<template>
  <div
    class="vas-banner-preview-wrap"
    :class="{
      'vas-banner-preview-wrap_solo': !inGrid,
      'vas-banner-preview-wrap_grid': inGrid,
      'vas-banner-preview-wrap_half': isHalf && !inGrid,
      [`vas-banner-preview-wrap_${layoutClass}`]: true,
    }"
    :style="wrapStyle"
  >
    <article
      class="vas-banner-preview"
      :class="{
        'vas-banner-preview_dark': darkMode,
        'vas-banner-preview_half': isHalf,
        'vas-banner-preview_placeholder': placeholder,
        [`vas-banner-preview_${layoutClass}`]: true,
      }"
      :style="previewStyle"
      aria-label="VAS banner preview"
      role="link"
      :tabindex="placeholder ? -1 : 0"
    >
      <div
        class="vas-banner-preview__media"
        :class="{
          'vas-banner-preview__media_placeholder': !resolved.imageUrl,
        }"
        :style="mediaStyle"
        aria-hidden="true"
      />

      <div
        class="vas-banner-preview__logo"
        :class="{
          'vas-banner-preview__logo_placeholder': !logoStyle,
        }"
        :style="logoStyle || undefined"
        aria-hidden="true"
      />

      <span
        v-if="resolved.showClose"
        class="vas-banner-preview__close"
        aria-hidden="true"
      >
        ×
      </span>

      <div class="vas-banner-preview__title-bar">
        <p class="vas-banner-preview__title">
          {{ resolved.title || '{Title}' }}
        </p>
      </div>
    </article>
  </div>
</template>
