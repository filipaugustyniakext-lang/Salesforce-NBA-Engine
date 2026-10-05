<script setup>
import { computed, onMounted, ref } from 'vue'
import BannerActionTargetField from './BannerActionTargetField.vue'
import BannerImageSourcePanel from './BannerImageSourcePanel.vue'
import SldsHelptext from './SldsHelptext.vue'
import { normalizeSmallBannerContent } from '../utils/smallBannerContent.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  blockId: {
    type: String,
    default: 'small-banner-content',
  },
  uploadInProgress: {
    type: Boolean,
    default: false,
  },
  libraryLoading: {
    type: Boolean,
    default: false,
  },
  libraryAssets: {
    type: Array,
    default: () => [],
  },
  libraryError: {
    type: String,
    default: '',
  },
  libraryResultCount: {
    type: Number,
    default: 0,
  },
  categories: {
    type: Array,
    default: () => [],
  },
  foldersLoading: {
    type: Boolean,
    default: false,
  },
  foldersSyncing: {
    type: Boolean,
    default: false,
  },
  foldersError: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'update:modelValue',
  'file-selected',
  'fetch-library',
  'select-library-asset',
  'synchronize-folders',
  'change',
  'open-personalization',
  'track-personalization',
  'image-field-target',
  'appearance-change',
])

const imageSourceTab = ref('upload')
const appearanceTab = ref('light')
const uploadFolderId = defineModel('uploadFolderId', {
  type: [String, Number],
  default: '',
})
const libraryFilters = defineModel('libraryFilters', {
  type: Object,
  required: true,
})

const content = computed({
  get() {
    return normalizeSmallBannerContent(props.modelValue)
  },
  set(next) {
    emit('update:modelValue', normalizeSmallBannerContent(next))
    emit('change')
  },
})

const imageUrlLightModel = computed({
  get() {
    return content.value.imageUrlLight
  },
  set(next) {
    patch({ imageUrlLight: String(next ?? '').trim() })
  },
})

const imageUrlDarkModel = computed({
  get() {
    return content.value.imageUrlDark
  },
  set(next) {
    patch({ imageUrlDark: String(next ?? '').trim() })
  },
})

function onAppearanceChange(tab = 'light') {
  emit(
    'image-field-target',
    tab === 'dark' ? 'imageUrlDark' : 'imageUrlLight',
  )
  emit('appearance-change', tab)
}

onMounted(() => {
  onAppearanceChange(appearanceTab.value)
})

function patch(partial) {
  content.value = {
    ...content.value,
    ...partial,
  }
}

function openPersonalization(field) {
  emit('open-personalization', field)
}

function trackPersonalization(field, event) {
  emit('track-personalization', field, event)
}
</script>

<template>
  <article class="block-card block-card_active small-banner-block-card">
    <div class="block-card__chrome">
      <div class="block-card__header">
        <div class="block-card__title">
          <strong>Small Banner Content</strong>
          <span>#1</span>
        </div>
      </div>
    </div>

    <div class="block-editor small-banner-editor">
      <div class="slds-form-element">
        <label
          class="slds-form-element__label canvas-label-row"
          for="small-banner-text"
        >
          <span>Text</span>
          <button
            class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
            type="button"
            title="Add personalization to Text"
            @click.prevent="openPersonalization('bannerText')"
          >
            <span aria-hidden="true">{}</span>
            <span class="slds-assistive-text">Add personalization to Text</span>
          </button>
        </label>
        <div class="slds-form-element__control">
          <textarea
            id="small-banner-text"
            class="slds-textarea"
            rows="3"
            :value="content.text"
            placeholder="Banner text"
            @input="patch({ text: $event.target.value })"
            @focus="trackPersonalization('bannerText', $event)"
            @click="trackPersonalization('bannerText', $event)"
            @keyup="trackPersonalization('bannerText', $event)"
            @select="trackPersonalization('bannerText', $event)"
          />
        </div>
      </div>

      <BannerImageSourcePanel
        v-model:image-url-light="imageUrlLightModel"
        v-model:image-url-dark="imageUrlDarkModel"
        v-model:appearance-tab="appearanceTab"
        v-model:source-tab="imageSourceTab"
        v-model:upload-folder-id="uploadFolderId"
        v-model:library-filters="libraryFilters"
        show-appearance-tabs
        :block-id="blockId"
        :upload-in-progress="uploadInProgress"
        :library-loading="libraryLoading"
        :library-assets="libraryAssets"
        :library-error="libraryError"
        :library-result-count="libraryResultCount"
        :categories="categories"
        :folders-loading="foldersLoading"
        :folders-syncing="foldersSyncing"
        :folders-error="foldersError"
        image-hint="Illustration is shown at 40×40px with 8px corner radius on the left of the strip."
        @file-selected="emit('file-selected', $event)"
        @fetch-library="emit('fetch-library')"
        @select-library-asset="emit('select-library-asset', $event)"
        @synchronize-folders="emit('synchronize-folders')"
        @appearance-change="onAppearanceChange"
        @change="emit('change')"
      />

      <div
        class="small-banner-actions settings-panel slds-form slds-form_stacked"
      >
        <h2 class="section-header">
          <span class="badge-step">2</span>
          Link
          <SldsHelptext
            content="The entire small banner is clickable and opens the selected intent or URL."
          />
        </h2>
        <BannerActionTargetField
          :key="`small-link-${content.intent}|${content.actionMode}|${content.url}`"
          :action-mode="content.actionMode"
          :intent="content.intent"
          :url="content.url"
          field-id="small-banner-link-target"
          label="Link target"
          personalization-field="bannerUrl"
          @update:target="
            patch({
              actionMode: $event.actionMode,
              intent: $event.intent,
              url: $event.url,
            })
          "
          @change="emit('change')"
          @open-personalization="openPersonalization"
          @track-personalization="trackPersonalization"
        />
      </div>
    </div>
  </article>
</template>
