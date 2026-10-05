<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MainBannerPreview from './MainBannerPreview.vue'
import PhotoBannerPreview from './PhotoBannerPreview.vue'
import SmallBannerPreview from './SmallBannerPreview.vue'
import {
  MAIN_BANNER_PHONE_WIDTH,
  MAIN_BANNER_WIDTH,
} from '../utils/mainBannerContent.js'
import { PHOTO_BANNER_WIDTH } from '../utils/photoBannerContent.js'

const props = defineProps({
  slides: {
    type: Array,
    default: () => [],
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  autoplay: {
    type: Boolean,
    default: false,
  },
  autoplayMs: {
    type: Number,
    default: 4000,
  },
  bannerType: {
    type: String,
    default: 'mainBanner',
  },
})

const slideWidthPx = computed(() => {
  if (props.bannerType === 'photoBanner') return PHOTO_BANNER_WIDTH
  if (props.bannerType === 'smallBanner') {
    return Math.max(1, viewportWidth.value || MAIN_BANNER_PHONE_WIDTH)
  }
  return MAIN_BANNER_WIDTH
})

const activeIndex = defineModel('activeIndex', {
  type: Number,
  default: 0,
})

const GAP_PX = 8
const SWIPE_THRESHOLD = 48
const ANIM_MS = 280

const viewportRef = ref(null)
const dragOffset = ref(0)
const isDragging = ref(false)
const suppressTransition = ref(false)
const viewportWidth = ref(MAIN_BANNER_PHONE_WIDTH)
const slideStep = ref(slideWidthPx.value + GAP_PX)
const isAnimating = ref(false)

const slideCount = computed(() => props.slides.length)
const canNavigate = computed(() => slideCount.value >= 2)

const slideWidth = computed(() => Math.max(0, slideStep.value - GAP_PX))

const sideInset = computed(() =>
  Math.max(0, (viewportWidth.value - slideWidth.value) / 2),
)

const safeIndex = computed(() => {
  if (!slideCount.value) return 0
  const raw = Number(activeIndex.value) || 0
  return ((raw % slideCount.value) + slideCount.value) % slideCount.value
})

/** Always render 3 slots (prev / current / next) so peeks stay visible. */
const visibleSlides = computed(() => {
  const list = props.slides
  const n = list.length
  if (!n) return []
  const current = safeIndex.value
  const prev = (current - 1 + n) % n
  const next = (current + 1) % n
  return [
    { ...list[prev], _slot: 'prev', _sourceIndex: prev },
    { ...list[current], _slot: 'current', _sourceIndex: current },
    { ...list[next], _slot: 'next', _sourceIndex: next },
  ]
})

const trackStyle = computed(() => {
  // Center the middle (current) slide; dragOffset shifts during swipe.
  const base = sideInset.value - slideStep.value
  return {
    transform: `translate3d(${base + dragOffset.value}px, 0, 0)`,
    gap: `${GAP_PX}px`,
    transition:
      suppressTransition.value || isDragging.value
        ? 'none'
        : `transform ${ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
  }
})

const slideBoxStyle = computed(() => ({
  width: `${slideWidthPx.value}px`,
  minWidth: `${slideWidthPx.value}px`,
  maxWidth: `${slideWidthPx.value}px`,
  flex: `0 0 ${slideWidthPx.value}px`,
}))

function measureViewport() {
  const viewport = viewportRef.value
  const width = viewport?.clientWidth
  if (Number.isFinite(width) && width > 0) {
    viewportWidth.value = width
  }
  const slideEl = viewport?.querySelector?.('.banner-carousel__slide')
  const measured = slideEl?.getBoundingClientRect?.().width
  if (Number.isFinite(measured) && measured > 0) {
    slideStep.value = measured + GAP_PX
  } else {
    slideStep.value = slideWidthPx.value + GAP_PX
  }
}

let resizeObserver = null
let autoplayTimer = null
let animTimer = null
let pointerId = null
let startX = 0
let startY = 0
let lastX = 0
let axisLocked = null

function clearAutoplay() {
  if (autoplayTimer) {
    window.clearInterval(autoplayTimer)
    autoplayTimer = null
  }
}

function clearAnimTimer() {
  if (animTimer) {
    window.clearTimeout(animTimer)
    animTimer = null
  }
}

function startAutoplay() {
  clearAutoplay()
  if (!props.autoplay || !canNavigate.value || isDragging.value || isAnimating.value) {
    return
  }
  autoplayTimer = window.setInterval(() => {
    stepBy(1)
  }, props.autoplayMs)
}

function wrapIndex(index) {
  if (!slideCount.value) return 0
  return ((Number(index) % slideCount.value) + slideCount.value) % slideCount.value
}

function reseatTo(index) {
  suppressTransition.value = true
  activeIndex.value = wrapIndex(index)
  dragOffset.value = 0
  // Force style flush so the next transition starts cleanly.
  void viewportRef.value?.offsetWidth
  suppressTransition.value = false
  isAnimating.value = false
  startAutoplay()
}

/**
 * Animate one step left (-1) or right (+1), then reseat the 3-slot window.
 */
function stepBy(delta) {
  if (!canNavigate.value || isAnimating.value || isDragging.value) return
  const direction = delta < 0 ? -1 : 1
  const nextIndex = wrapIndex(safeIndex.value + direction)

  clearAutoplay()
  clearAnimTimer()
  isAnimating.value = true
  // Move track toward the destination slide.
  dragOffset.value = direction < 0 ? slideStep.value : -slideStep.value

  animTimer = window.setTimeout(() => {
    animTimer = null
    reseatTo(nextIndex)
  }, ANIM_MS)
}

function goTo(index) {
  if (!slideCount.value || isAnimating.value) return
  clearAutoplay()
  clearAnimTimer()
  isAnimating.value = false
  reseatTo(index)
}

function goBy(delta) {
  stepBy(delta)
}

function onArrowActivate(delta, event) {
  event?.preventDefault?.()
  event?.stopPropagation?.()
  stepBy(delta)
}

function onPointerDown(event) {
  if (slideCount.value < 1 || isAnimating.value) return
  if (event.button != null && event.button !== 0) return
  clearAutoplay()
  isDragging.value = true
  axisLocked = null
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  lastX = event.clientX
  dragOffset.value = 0
  viewportRef.value?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event) {
  if (!isDragging.value || event.pointerId !== pointerId) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (!axisLocked) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    axisLocked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    if (axisLocked === 'y') {
      endDrag(false)
      return
    }
  }
  if (axisLocked !== 'x') return
  event.preventDefault()
  lastX = event.clientX
  if (!canNavigate.value) {
    dragOffset.value = dx * 0.35
    return
  }
  dragOffset.value = dx
}

function endDrag(commit = true) {
  if (!isDragging.value) return
  isDragging.value = false
  const dx = commit ? lastX - startX : 0
  pointerId = null
  axisLocked = null

  if (canNavigate.value && Math.abs(dx) >= SWIPE_THRESHOLD) {
    const direction = dx < 0 ? 1 : -1
    const nextIndex = wrapIndex(safeIndex.value + direction)
    clearAnimTimer()
    isAnimating.value = true
    dragOffset.value = direction < 0 ? slideStep.value : -slideStep.value
    animTimer = window.setTimeout(() => {
      animTimer = null
      reseatTo(nextIndex)
    }, ANIM_MS)
    return
  }

  dragOffset.value = 0
  startAutoplay()
}

function onPointerUp(event) {
  if (event.pointerId !== pointerId && pointerId != null) return
  endDrag(true)
}

function onPointerCancel(event) {
  if (event.pointerId !== pointerId && pointerId != null) return
  endDrag(false)
}

onMounted(async () => {
  await nextTick()
  measureViewport()
  if (typeof ResizeObserver !== 'undefined' && viewportRef.value) {
    resizeObserver = new ResizeObserver(() => measureViewport())
    resizeObserver.observe(viewportRef.value)
  }
  startAutoplay()
})

onBeforeUnmount(() => {
  clearAutoplay()
  clearAnimTimer()
  endDrag(false)
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(
  () => [props.autoplay, props.autoplayMs, slideCount.value],
  () => startAutoplay(),
)

watch(
  () => props.bannerType,
  async () => {
    await nextTick()
    measureViewport()
  },
)

watch(
  () => props.slides.length,
  async () => {
    if (safeIndex.value >= slideCount.value) {
      activeIndex.value = 0
    }
    await nextTick()
    measureViewport()
  },
)
</script>

<template>
  <div
    class="banner-carousel"
    :class="{ 'banner-carousel_dark': darkMode }"
    role="region"
    aria-roledescription="carousel"
    aria-label="Banner carousel preview"
  >
    <div
      ref="viewportRef"
      class="banner-carousel__viewport"
      :class="{ 'banner-carousel__viewport_dragging': isDragging }"
      tabindex="0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @keydown.left.prevent="goBy(-1)"
      @keydown.right.prevent="goBy(1)"
    >
      <div class="banner-carousel__track" :style="trackStyle">
        <div
          v-for="slide in visibleSlides"
          :key="`${slide._slot}-${slide.id || slide._sourceIndex}`"
          class="banner-carousel__slide"
          :class="{
            'banner-carousel__slide_active': slide._slot === 'current',
            'banner-carousel__slide_peek': slide._slot !== 'current',
          }"
          :style="slideBoxStyle"
          :aria-hidden="slide._slot === 'current' ? undefined : 'true'"
        >
          <PhotoBannerPreview
            v-if="bannerType === 'photoBanner'"
            :model-value="slide.content"
            :dark-mode="darkMode"
          />
          <SmallBannerPreview
            v-else-if="bannerType === 'smallBanner'"
            :model-value="slide.content"
            :dark-mode="darkMode"
          />
          <MainBannerPreview
            v-else
            :model-value="slide.content"
            :dark-mode="darkMode"
          />
        </div>
      </div>
    </div>

    <div
      v-if="slideCount > 0"
      class="banner-carousel__nav"
      :class="{ 'banner-carousel__nav_single': !canNavigate }"
    >
      <button
        class="banner-carousel__arrow banner-carousel__arrow_prev"
        type="button"
        title="Previous banner"
        :disabled="!canNavigate"
        :aria-disabled="!canNavigate ? 'true' : 'false'"
        @click.stop.prevent="onArrowActivate(-1, $event)"
      >
        <svg
          class="banner-carousel__arrow-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M15.5 4.5 8 12l7.5 7.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="slds-assistive-text">Previous banner</span>
      </button>

      <div
        class="banner-carousel__dots"
        role="tablist"
        aria-label="Carousel slides"
      >
        <button
          v-for="(slide, index) in slides"
          :key="`dot-${slide.id || index}`"
          class="banner-carousel__dot"
          :class="{ 'banner-carousel__dot_active': index === safeIndex }"
          type="button"
          role="tab"
          :aria-selected="index === safeIndex ? 'true' : 'false'"
          :title="slide.label || `Slide ${index + 1}`"
          @click.stop.prevent="goTo(index)"
        >
          <span class="slds-assistive-text">
            {{ slide.label || `Slide ${index + 1}` }}
          </span>
        </button>
      </div>

      <button
        class="banner-carousel__arrow banner-carousel__arrow_next"
        type="button"
        title="Next banner"
        :disabled="!canNavigate"
        :aria-disabled="!canNavigate ? 'true' : 'false'"
        @click.stop.prevent="onArrowActivate(1, $event)"
      >
        <svg
          class="banner-carousel__arrow-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M8.5 4.5 16 12l-7.5 7.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="slds-assistive-text">Next banner</span>
      </button>
    </div>
  </div>
</template>
