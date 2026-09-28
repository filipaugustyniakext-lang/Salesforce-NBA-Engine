<script setup>
import { computed } from 'vue'
import VasBannerPreview from './VasBannerPreview.vue'
import {
  VAS_BANNER_GAP,
  buildVasBannerGridSlides,
  buildVasBannerMasonrySegments,
  isVasBannerHalfLayout,
  normalizeVasBannerGridCount,
  normalizeVasBannerLayout,
} from '../utils/vasBannerContent.js'

const props = defineProps({
  /** Live banner content being edited. */
  currentContent: {
    type: Object,
    default: () => ({}),
  },
  /** Total tiles in the context grid (2–5), including the live banner. */
  itemCount: {
    type: Number,
    default: 4,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  /**
   * Optional catalog/bulk slides. When provided with length >= 2, used as-is
   * (bulk "Preview as Grid"); otherwise build placeholders around currentContent.
   */
  slides: {
    type: Array,
    default: () => [],
  },
})

const items = computed(() => {
  const provided = props.slides ?? []
  const source =
    provided.length >= 2
      ? provided.map((slide, index) => ({
          ...slide,
          layout:
            slide.layout ||
            slide.content?.previewLayout ||
            slide.content?.layout ||
            'expanded',
          isPlaceholder: slide.isPlaceholder === true,
          isCurrent: slide.isCurrent === true || index === 0,
        }))
      : buildVasBannerGridSlides(props.currentContent, props.itemCount)

  return source.map((slide, index) => {
    const layout = normalizeVasBannerLayout(
      slide.layout || slide.content?.previewLayout,
    )
    return {
      id: slide?.id || `vas-${index}`,
      label: slide?.label || '',
      content: slide?.content ?? {},
      layout,
      isHalf: isVasBannerHalfLayout(layout),
      isCurrent: slide?.isCurrent === true,
      isPlaceholder: slide?.isPlaceholder === true,
    }
  })
})

const segments = computed(() => buildVasBannerMasonrySegments(items.value))

const resolvedCount = computed(() =>
  normalizeVasBannerGridCount(items.value.length),
)

const gridStyle = computed(() => ({
  gap: `${VAS_BANNER_GAP}px`,
}))

const halvesStyle = computed(() => ({
  gap: `${VAS_BANNER_GAP}px`,
}))

const columnStyle = computed(() => ({
  gap: `${VAS_BANNER_GAP}px`,
}))
</script>

<template>
  <div
    class="vas-banner-grid"
    :class="{
      [`vas-banner-grid_count-${resolvedCount}`]: true,
      'vas-banner-grid_dark': darkMode,
    }"
    :style="gridStyle"
    role="list"
    aria-label="VAS banner grid preview"
  >
    <template v-for="(segment, segmentIndex) in segments" :key="`seg-${segmentIndex}`">
      <div
        v-if="segment.type === 'full'"
        class="vas-banner-grid__cell vas-banner-grid__cell_full"
        :class="{
          'vas-banner-grid__cell_current': segment.item.isCurrent,
          'vas-banner-grid__cell_placeholder': segment.item.isPlaceholder,
        }"
        role="listitem"
        :title="segment.item.label"
      >
        <VasBannerPreview
          :model-value="segment.item.content"
          :layout="segment.item.layout"
          :dark-mode="darkMode"
          :in-grid="true"
          :placeholder="segment.item.isPlaceholder"
        />
      </div>
      <div
        v-else
        class="vas-banner-grid__halves"
        :style="halvesStyle"
      >
        <div class="vas-banner-grid__col" :style="columnStyle">
          <div
            v-for="item in segment.left"
            :key="item.id"
            class="vas-banner-grid__cell vas-banner-grid__cell_half"
            :class="{
              'vas-banner-grid__cell_current': item.isCurrent,
              'vas-banner-grid__cell_placeholder': item.isPlaceholder,
            }"
            role="listitem"
            :title="item.label"
          >
            <VasBannerPreview
              :model-value="item.content"
              :layout="item.layout"
              :dark-mode="darkMode"
              :in-grid="true"
              :placeholder="item.isPlaceholder"
            />
          </div>
        </div>
        <div class="vas-banner-grid__col" :style="columnStyle">
          <div
            v-for="item in segment.right"
            :key="item.id"
            class="vas-banner-grid__cell vas-banner-grid__cell_half"
            :class="{
              'vas-banner-grid__cell_current': item.isCurrent,
              'vas-banner-grid__cell_placeholder': item.isPlaceholder,
            }"
            role="listitem"
            :title="item.label"
          >
            <VasBannerPreview
              :model-value="item.content"
              :layout="item.layout"
              :dark-mode="darkMode"
              :in-grid="true"
              :placeholder="item.isPlaceholder"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
