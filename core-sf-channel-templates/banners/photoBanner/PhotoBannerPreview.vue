<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  PHOTO_BANNER_COLORS,
  PHOTO_BANNER_HEIGHT,
  PHOTO_BANNER_WIDTH,
  layoutShowsSecondary,
  layoutShowsTertiary,
  layoutUsesFullWidthPrimary,
  normalizePhotoBannerContent,
} from '../utils/photoBannerContent.js'

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

const content = computed(() => normalizePhotoBannerContent(props.modelValue))
const wrapRef = ref(null)
const drawerTarget = ref(null)
const legalNoteOpen = ref(false)
const legalNoteMounted = ref(false)

const showTertiary = computed(() =>
  layoutShowsTertiary(content.value.buttonLayout),
)
const showSecondary = computed(() =>
  layoutShowsSecondary(content.value.buttonLayout),
)
const fullWidthPrimary = computed(() =>
  layoutUsesFullWidthPrimary(content.value.buttonLayout),
)

const previewStyle = computed(() => ({
  width: `${PHOTO_BANNER_WIDTH}px`,
  height: `${PHOTO_BANNER_HEIGHT}px`,
  minHeight: `${PHOTO_BANNER_HEIGHT}px`,
}))

const mediaStyle = computed(() => {
  const imageUrl = String(content.value.imageUrl ?? '').trim()
  if (!imageUrl) return null
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
  }
})

const primaryButtonStyle = computed(() => ({
  background: props.darkMode
    ? PHOTO_BANNER_COLORS.buttonPrimaryDark
    : PHOTO_BANNER_COLORS.buttonPrimary,
  color: props.darkMode
    ? PHOTO_BANNER_COLORS.buttonPrimaryTextDark
    : PHOTO_BANNER_COLORS.buttonPrimaryText,
}))

function resolveDrawerTarget() {
  return (
    wrapRef.value?.closest?.('.banner-preview-phone__screen') ??
    wrapRef.value?.closest?.('.banner-preview-phone') ??
    null
  )
}

async function openLegalNote() {
  if (!showTertiary.value) return
  drawerTarget.value = resolveDrawerTarget()
  legalNoteMounted.value = true
  await nextTick()
  requestAnimationFrame(() => {
    legalNoteOpen.value = true
  })
}

function closeLegalNote() {
  legalNoteOpen.value = false
}

function onDrawerTransitionEnd(event) {
  if (event.propertyName !== 'transform') return
  if (!legalNoteOpen.value) {
    legalNoteMounted.value = false
  }
}

onMounted(() => {
  drawerTarget.value = resolveDrawerTarget()
})

onBeforeUnmount(() => {
  legalNoteOpen.value = false
  legalNoteMounted.value = false
})

watch(
  () => [content.value.legalLabel, content.value.legalNote, showTertiary.value],
  () => {
    if (!showTertiary.value) closeLegalNote()
  },
)
</script>

<template>
  <div ref="wrapRef" class="photo-banner-preview-wrap">
    <article
      class="photo-banner-preview"
      :class="{ 'photo-banner-preview_dark': darkMode }"
      :style="previewStyle"
      aria-label="Photo banner preview"
    >
      <div
        class="photo-banner-preview__media"
        :class="{
          'photo-banner-preview__media_placeholder': !mediaStyle,
        }"
        :style="mediaStyle || undefined"
        aria-hidden="true"
      />

      <button
        v-if="content.showClose"
        class="photo-banner-preview__close"
        type="button"
        tabindex="-1"
        aria-hidden="true"
      >
        ×
      </button>

      <div class="photo-banner-preview__card">
        <div class="photo-banner-preview__copy">
          <h3 class="photo-banner-preview__title">
            {{ content.title || '{Title}' }}
          </h3>
          <p class="photo-banner-preview__description">
            {{ content.description || '{Description}' }}
          </p>
          <button
            v-if="showTertiary"
            class="photo-banner-preview__tertiary"
            type="button"
            @pointerdown.stop
            @click.stop="openLegalNote"
          >
            {{ content.legalLabel || '{button label}' }}
          </button>
        </div>

        <div
          class="photo-banner-preview__actions"
          :class="{
            'photo-banner-preview__actions_single': fullWidthPrimary,
          }"
        >
          <button
            class="photo-banner-preview__btn photo-banner-preview__btn_primary"
            :class="{
              'photo-banner-preview__btn_full': fullWidthPrimary,
            }"
            type="button"
            tabindex="-1"
            :style="primaryButtonStyle"
          >
            {{ content.primaryLabel || '{buttonLabel}' }}
          </button>
          <button
            v-if="showSecondary"
            class="photo-banner-preview__btn photo-banner-preview__btn_secondary"
            type="button"
            tabindex="-1"
          >
            {{ content.secondaryLabel || '{buttonLabel}' }}
          </button>
        </div>
      </div>
    </article>

    <Teleport v-if="drawerTarget && legalNoteMounted" :to="drawerTarget">
      <div
        class="main-banner-legal-drawer-layer"
        :class="{ 'main-banner-legal-drawer-layer_open': legalNoteOpen }"
      >
        <div
          class="main-banner-legal-drawer-backdrop"
          @click="closeLegalNote"
        />
        <aside
          class="main-banner-legal-drawer"
          :class="{ 'main-banner-legal-drawer_open': legalNoteOpen }"
          role="dialog"
          aria-modal="true"
          aria-label="Legal note"
          @transitionend="onDrawerTransitionEnd"
        >
          <header class="main-banner-legal-drawer__header">
            <h4 class="main-banner-legal-drawer__title">
              {{ content.legalLabel || 'Legal note' }}
            </h4>
            <button
              class="main-banner-legal-drawer__close"
              type="button"
              title="Close"
              @click="closeLegalNote"
            >
              ×
            </button>
          </header>
          <div class="main-banner-legal-drawer__body">
            <p class="main-banner-legal-drawer__text">
              {{ content.legalNote || '{Legal note text}' }}
            </p>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>
