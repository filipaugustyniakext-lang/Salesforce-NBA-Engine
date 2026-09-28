<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import {
  BANNER_ACTION_MODE_INTENT,
  BANNER_ACTION_MODE_URL,
  BANNER_INTENT_LIST_MAX_HEIGHT_ITEMS,
  BANNER_INTENT_OPTIONS,
  filterBannerIntentOptions,
} from '../utils/bannerIntents.js'

const props = defineProps({
  actionMode: {
    type: String,
    default: BANNER_ACTION_MODE_INTENT,
  },
  intent: {
    type: String,
    default: '',
  },
  url: {
    type: String,
    default: '',
  },
  fieldId: {
    type: String,
    default: 'banner-action-target',
  },
  label: {
    type: String,
    default: 'Action target',
  },
  urlPlaceholder: {
    type: String,
    default: 'https://…',
  },
  showPersonalization: {
    type: Boolean,
    default: true,
  },
  personalizationField: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'update:target',
  'change',
  'open-personalization',
  'track-personalization',
])

const rootEl = ref(null)
const triggerEl = ref(null)
const listboxEl = ref(null)
const isOpen = ref(false)
const searchQuery = ref('')
const customIntent = ref('')
const activeIndex = ref(-1)
const dropdownStyle = ref({})

const isIntentMode = computed(
  () => props.actionMode !== BANNER_ACTION_MODE_URL,
)
const filteredOptions = computed(() =>
  filterBannerIntentOptions(searchQuery.value),
)
const listboxId = computed(() => `${props.fieldId}-listbox`)
const intentInputId = computed(() => `${props.fieldId}-intent`)
const urlInputId = computed(() => `${props.fieldId}-url`)
const customIntentInputId = computed(() => `${props.fieldId}-custom`)
// Closed: always show the persisted intent. Open: show the active search query.
// (Previously `searchQuery` could mask a loaded intent while the list was closed.)
const intentInputValue = computed(() =>
  isOpen.value ? searchQuery.value : String(props.intent ?? ''),
)
const activeOptionId = computed(() =>
  activeIndex.value >= 0
    ? `${props.fieldId}-option-${activeIndex.value}`
    : undefined,
)
const showUrlPersonalization = computed(
  () =>
    props.showPersonalization &&
    Boolean(props.personalizationField) &&
    !isIntentMode.value,
)
const listMaxHeightPx = computed(
  () => BANNER_INTENT_LIST_MAX_HEIGHT_ITEMS * 36,
)

watch(
  () => props.intent,
  (nextIntent) => {
    if (isOpen.value) return
    searchQuery.value = ''
    const value = String(nextIntent ?? '').trim()
    customIntent.value = BANNER_INTENT_OPTIONS.includes(value) ? '' : value
  },
  { immediate: true },
)

// When switching banners / reloading content, drop transient combobox state so
// the closed input shows the loaded intent/url instead of a stale search string.
watch(
  () => [props.actionMode, props.intent, props.url],
  () => {
    isOpen.value = false
    searchQuery.value = ''
    activeIndex.value = -1
    dropdownStyle.value = {}
    const value = String(props.intent ?? '').trim()
    customIntent.value = BANNER_INTENT_OPTIONS.includes(value) ? '' : value
  },
)

/** Single atomic update — parents must patch all three fields together. */
function emitTarget({
  actionMode = props.actionMode,
  intent = props.intent,
  url = props.url,
} = {}) {
  const mode =
    actionMode === BANNER_ACTION_MODE_URL
      ? BANNER_ACTION_MODE_URL
      : BANNER_ACTION_MODE_INTENT
  emit('update:target', {
    actionMode: mode,
    intent: mode === BANNER_ACTION_MODE_INTENT ? String(intent ?? '') : '',
    url: mode === BANNER_ACTION_MODE_URL ? String(url ?? '') : '',
  })
  emit('change')
}

function setActionMode(nextMode) {
  const mode =
    nextMode === BANNER_ACTION_MODE_URL
      ? BANNER_ACTION_MODE_URL
      : BANNER_ACTION_MODE_INTENT
  if (mode === BANNER_ACTION_MODE_URL) {
    customIntent.value = ''
    searchQuery.value = ''
    closeList()
    emitTarget({ actionMode: mode, intent: '', url: props.url })
    return
  }
  emitTarget({ actionMode: mode, intent: props.intent, url: '' })
}

function positionDropdown() {
  const trigger = triggerEl.value
  if (!trigger) {
    dropdownStyle.value = {}
    return
  }

  const rect = trigger.getBoundingClientRect()
  const gap = 4
  const viewportPadding = 8
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight
  const spaceBelow = viewportHeight - rect.bottom - gap - viewportPadding
  const spaceAbove = rect.top - gap - viewportPadding
  const preferredMax = listMaxHeightPx.value + 56
  const openBelow = spaceBelow >= Math.min(preferredMax, spaceAbove)
  const available = openBelow ? spaceBelow : spaceAbove
  const maxHeight = Math.max(160, Math.min(preferredMax, available))
  const top = openBelow
    ? rect.bottom + gap
    : Math.max(viewportPadding, rect.top - gap - maxHeight)

  dropdownStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${rect.left}px`,
    width: `${Math.max(rect.width, 240)}px`,
    maxHeight: `${maxHeight}px`,
    zIndex: 9200,
  }
}

function positionDropdownIfOpen() {
  if (!isOpen.value) return
  positionDropdown()
}

function openList() {
  if (!isIntentMode.value) return
  // Keep search empty so the full list is browsable; selection stays in props.intent.
  searchQuery.value = ''
  isOpen.value = true
  activeIndex.value = Math.max(
    0,
    filteredOptions.value.findIndex((option) => option === props.intent),
  )
  nextTick(() => {
    positionDropdown()
    nextTick(positionDropdown)
  })
}

function closeList() {
  isOpen.value = false
  searchQuery.value = ''
  activeIndex.value = -1
  dropdownStyle.value = {}
}

function chooseIntent(nextIntent) {
  const value = String(nextIntent ?? '').trim()
  customIntent.value = BANNER_INTENT_OPTIONS.includes(value) ? '' : value
  searchQuery.value = ''
  closeList()
  emitTarget({
    actionMode: BANNER_ACTION_MODE_INTENT,
    intent: value,
    url: '',
  })
}

function applyCustomIntent() {
  const value = String(customIntent.value ?? '').trim()
  if (!value) return
  chooseIntent(value)
}

function onIntentSearchInput(event) {
  searchQuery.value = event.target.value
  openList()
  activeIndex.value = filteredOptions.value.length ? 0 : -1
}

function onUrlInput(event) {
  emitTarget({
    actionMode: BANNER_ACTION_MODE_URL,
    intent: '',
    url: event.target.value,
  })
}

function moveActiveIndex(delta) {
  const count = filteredOptions.value.length
  if (!count) {
    activeIndex.value = -1
    return
  }
  const current = activeIndex.value < 0 ? 0 : activeIndex.value
  activeIndex.value = (current + delta + count) % count
  nextTick(() => {
    listboxEl.value
      ?.querySelector(`[data-intent-index="${activeIndex.value}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  })
}

function onIntentKeydown(event) {
  if (!isIntentMode.value) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!isOpen.value) openList()
    else moveActiveIndex(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!isOpen.value) openList()
    else moveActiveIndex(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    if (
      isOpen.value &&
      activeIndex.value >= 0 &&
      filteredOptions.value[activeIndex.value]
    ) {
      chooseIntent(filteredOptions.value[activeIndex.value])
    } else if (String(searchQuery.value ?? '').trim()) {
      chooseIntent(searchQuery.value)
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeList()
  }
}

function onDocumentPointerDown(event) {
  if (!isOpen.value) return
  const target = event.target
  if (rootEl.value?.contains(target) || listboxEl.value?.contains(target)) {
    return
  }
  closeList()
}

function openPersonalization() {
  if (!props.personalizationField) return
  emit('open-personalization', props.personalizationField)
}

function trackPersonalization(event) {
  if (!props.personalizationField) return
  emit('track-personalization', props.personalizationField, event)
}

function toggleList() {
  if (isOpen.value) closeList()
  else openList()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  window.addEventListener('resize', positionDropdownIfOpen)
  window.addEventListener('scroll', positionDropdownIfOpen, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('resize', positionDropdownIfOpen)
  window.removeEventListener('scroll', positionDropdownIfOpen, true)
})
</script>

<template>
  <div ref="rootEl" class="banner-action-target slds-form-element">
    <div class="slds-form-element__label canvas-label-row">
      <span>{{ label }}</span>
      <button
        v-if="showUrlPersonalization"
        class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
        type="button"
        :title="`Add personalization to ${label}`"
        @click.prevent="openPersonalization"
      >
        <span aria-hidden="true">{}</span>
        <span class="slds-assistive-text"
          >Add personalization to {{ label }}</span
        >
      </button>
    </div>

    <div class="slds-button-group banner-action-target__mode" role="group">
      <button
        class="slds-button"
        :class="isIntentMode ? 'slds-button_brand' : 'slds-button_neutral'"
        type="button"
        :aria-pressed="isIntentMode ? 'true' : 'false'"
        @click.prevent.stop="setActionMode(BANNER_ACTION_MODE_INTENT)"
      >
        Intent
      </button>
      <button
        class="slds-button"
        :class="!isIntentMode ? 'slds-button_brand' : 'slds-button_neutral'"
        type="button"
        :aria-pressed="!isIntentMode ? 'true' : 'false'"
        @click.prevent.stop="setActionMode(BANNER_ACTION_MODE_URL)"
      >
        URL
      </button>
    </div>

    <div
      v-if="isIntentMode"
      class="slds-form-element__control slds-m-top_x-small"
    >
      <div
        class="slds-combobox_container"
        :class="{ 'slds-has-selection': Boolean(intent) && !isOpen }"
      >
        <div
          class="slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click"
          :class="{ 'slds-is-open': isOpen }"
        >
          <div
            ref="triggerEl"
            class="slds-combobox__form-element slds-input-has-icon slds-input-has-icon_right"
            role="none"
          >
            <input
              :id="intentInputId"
              :key="`intent-value-${intent || ''}`"
              class="slds-input slds-combobox__input"
              :class="{ 'slds-combobox__input-value': Boolean(intent) && !isOpen }"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              :aria-controls="listboxId"
              :aria-expanded="isOpen ? 'true' : 'false'"
              :aria-activedescendant="activeOptionId"
              autocomplete="off"
              placeholder="Search intent…"
              :value="intentInputValue"
              @focus="openList"
              @input="onIntentSearchInput"
              @keydown="onIntentKeydown"
            />
            <button
              class="slds-button slds-button_icon slds-input__icon slds-input__icon_right"
              type="button"
              tabindex="-1"
              title="Open intent list"
              @click.prevent="toggleList"
            >
              <svg
                class="slds-button__icon slds-icon-text-default"
                aria-hidden="true"
                viewBox="0 0 52 52"
                width="16"
                height="16"
              >
                <path
                  d="M8.3 18.7c.6-.7 1.5-.8 2.2-.3l14.1 10.8c.5.4 1.3.4 1.8 0L40.5 18.4c.7-.5 1.6-.4 2.2.3.6.7.5 1.6-.2 2.1L27 35.7c-1.3 1-3.1 1-4.4 0L8.5 20.8c-.7-.5-.8-1.4-.2-2.1z"
                />
              </svg>
              <span class="slds-assistive-text">Open intent list</span>
            </button>
          </div>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-show="isOpen"
          :id="listboxId"
          ref="listboxEl"
          class="slds-dropdown slds-dropdown_fluid banner-action-target__dropdown"
          role="listbox"
          :style="dropdownStyle"
        >
          <ul
            class="slds-listbox slds-listbox_vertical banner-action-target__options"
            role="presentation"
          >
            <li
              v-for="(option, index) in filteredOptions"
              :id="`${fieldId}-option-${index}`"
              :key="option"
              class="slds-listbox__item"
              role="presentation"
              :data-intent-index="index"
            >
              <div
                class="slds-media slds-listbox__option slds-listbox__option_plain slds-media_small"
                :class="{
                  'slds-has-focus': index === activeIndex,
                  'slds-is-selected': option === intent,
                }"
                role="option"
                :aria-selected="option === intent ? 'true' : 'false'"
                @mousedown.prevent="chooseIntent(option)"
                @mouseenter="activeIndex = index"
              >
                <span class="slds-media__body">
                  <span class="slds-truncate" :title="option">{{
                    option
                  }}</span>
                </span>
              </div>
            </li>
            <li
              v-if="!filteredOptions.length"
              class="slds-listbox__item"
              role="presentation"
            >
              <div
                class="slds-media slds-listbox__option slds-listbox__option_plain slds-media_small"
                role="option"
                aria-selected="false"
              >
                <span class="slds-media__body">
                  <span class="slds-truncate">No matching intents</span>
                </span>
              </div>
            </li>
          </ul>
          <div class="banner-action-target__custom">
            <label class="slds-assistive-text" :for="customIntentInputId">
              Provide your own intent value
            </label>
            <div
              class="slds-grid slds-gutters_xx-small slds-grid_vertical-align-center"
            >
              <div class="slds-col slds-grow">
                <input
                  :id="customIntentInputId"
                  v-model="customIntent"
                  class="slds-input"
                  type="text"
                  placeholder="provide your own intent value"
                  @keydown.enter.prevent="applyCustomIntent"
                />
              </div>
              <div class="slds-col slds-grow-none">
                <button
                  class="slds-button slds-button_neutral"
                  type="button"
                  :disabled="!String(customIntent || '').trim()"
                  @click="applyCustomIntent"
                >
                  Use
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>

    <div v-else class="slds-form-element__control slds-m-top_x-small">
      <input
        :id="urlInputId"
        class="slds-input"
        type="text"
        :value="url"
        :placeholder="urlPlaceholder"
        @input="onUrlInput"
        @focus="trackPersonalization"
        @click="trackPersonalization"
        @keyup="trackPersonalization"
        @select="trackPersonalization"
      />
    </div>
  </div>
</template>

<style scoped>
.banner-action-target__mode {
  display: inline-flex;
  position: relative;
  z-index: 1;
}

.banner-action-target__dropdown {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0;
  padding: 0;
  float: none;
  transform: none;
  box-sizing: border-box;
  background: #ffffff;
  border: 1px solid #dddbda;
  border-radius: 0.25rem;
  box-shadow: 0 2px 3px 0 rgba(0, 0, 0, 0.16);
}

.banner-action-target__options {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 0.25rem 0;
}

.banner-action-target__custom {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid #dddbda;
  background: #ffffff;
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.06);
}
</style>
<style>
/* Unscoped: dropdown is Teleported to body */
.banner-action-target__dropdown {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0;
  padding: 0;
  float: none;
  transform: none;
  box-sizing: border-box;
  background: #ffffff;
  border: 1px solid #dddbda;
  border-radius: 0.25rem;
  box-shadow: 0 2px 3px 0 rgba(0, 0, 0, 0.16);
}

.banner-action-target__options {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 0.25rem 0;
}

.banner-action-target__custom {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid #dddbda;
  background: #ffffff;
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.06);
}
</style>
