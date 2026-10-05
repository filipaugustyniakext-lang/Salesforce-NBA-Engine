<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  MAIN_BANNER_COLORS,
  MAIN_BANNER_HEIGHT,
  MAIN_BANNER_WIDTH,
  layoutShowsSecondary,
  layoutShowsTertiary,
  layoutUsesFullWidthPrimary,
  normalizeMainBannerContent,
  resolveMainBannerImageUrl,
} from '../utils/mainBannerContent.js'

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

const content = computed(() => normalizeMainBannerContent(props.modelValue))
const resolvedImageUrl = computed(() =>
  resolveMainBannerImageUrl(content.value, props.darkMode),
)
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
  width: `${MAIN_BANNER_WIDTH}px`,
  height: `${MAIN_BANNER_HEIGHT}px`,
  minHeight: `${MAIN_BANNER_HEIGHT}px`,
  background: props.darkMode
    ? MAIN_BANNER_COLORS.backgroundDark
    : MAIN_BANNER_COLORS.background,
}))

const primaryButtonStyle = computed(() => ({
  background: props.darkMode
    ? MAIN_BANNER_COLORS.buttonPrimaryDark
    : MAIN_BANNER_COLORS.buttonPrimary,
  color: props.darkMode
    ? MAIN_BANNER_COLORS.buttonPrimaryTextDark
    : MAIN_BANNER_COLORS.buttonPrimaryText,
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
  <div ref="wrapRef" class="main-banner-preview-wrap">
    <article
      class="main-banner-preview"
      :class="{ 'main-banner-preview_dark': darkMode }"
      :style="previewStyle"
      aria-label="Main banner preview"
    >
      <button
        v-if="content.showClose"
        class="main-banner-preview__close"
        type="button"
        tabindex="-1"
        aria-hidden="true"
      >
        ×
      </button>

      <div class="main-banner-preview__body">
        <div class="main-banner-preview__copy">
          <h3 class="main-banner-preview__title">
            {{ content.title || '{Title}' }}
          </h3>
          <p class="main-banner-preview__description">
            {{ content.description || '{Description}' }}
          </p>
          <button
            v-if="showTertiary"
            class="main-banner-preview__tertiary"
            type="button"
            @pointerdown.stop
            @click.stop="openLegalNote"
          >
            {{ content.legalLabel || '{Legal note}' }}
          </button>
        </div>
        <div class="main-banner-preview__image-wrap">
          <img
            v-if="resolvedImageUrl"
            class="main-banner-preview__image"
            :src="resolvedImageUrl"
            alt=""
          />
          <div v-else class="main-banner-preview__image-placeholder" />
        </div>
      </div>

      <div
        class="main-banner-preview__actions"
        :class="{
          'main-banner-preview__actions_single': fullWidthPrimary,
        }"
      >
        <button
          v-if="showSecondary"
          class="main-banner-preview__btn main-banner-preview__btn_secondary"
          type="button"
          tabindex="-1"
        >
          {{ content.secondaryLabel || '{buttonLabel}' }}
        </button>
        <button
          class="main-banner-preview__btn main-banner-preview__btn_primary"
          :class="{
            'main-banner-preview__btn_full': fullWidthPrimary,
          }"
          type="button"
          tabindex="-1"
          :style="primaryButtonStyle"
        >
          {{ content.primaryLabel || '{buttonLabel}' }}
        </button>
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
