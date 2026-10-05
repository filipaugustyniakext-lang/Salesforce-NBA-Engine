<script setup>
import { computed } from 'vue'
import {
  SMALL_BANNER_MIN_HEIGHT,
  normalizeSmallBannerContent,
  resolveSmallBannerImageUrl,
} from '../utils/smallBannerContent.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
})

const content = computed(() => normalizeSmallBannerContent(props.modelValue))

const previewStyle = computed(() => ({
  width: '100%',
  minHeight: `${SMALL_BANNER_MIN_HEIGHT}px`,
}))

const mediaStyle = computed(() => {
  const imageUrl = resolveSmallBannerImageUrl(content.value, props.darkMode)
  if (!imageUrl) return null
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
  }
})
</script>

<template>
  <div class="small-banner-preview-wrap">
    <article
      class="small-banner-preview"
      :class="{ 'small-banner-preview_dark': darkMode }"
      :style="previewStyle"
      aria-label="Small banner preview"
      role="link"
      tabindex="-1"
    >
      <div
        class="small-banner-preview__media"
        :class="{
          'small-banner-preview__media_placeholder': !mediaStyle,
        }"
        :style="mediaStyle || undefined"
        aria-hidden="true"
      />
      <p class="small-banner-preview__text">
        {{ content.text || '{text}' }}
      </p>
      <span class="small-banner-preview__chevron" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          focusable="false"
        >
          <path
            d="M9 5.5 15.5 12 9 18.5"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </article>
  </div>
</template>
