<script setup>
import { computed, ref } from 'vue'
import BannerActionTargetField from './BannerActionTargetField.vue'
import BannerImageSourcePanel from './BannerImageSourcePanel.vue'
import SldsHelptext from './SldsHelptext.vue'
import {
  PHOTO_BANNER_LAYOUT_OPTIONS,
  layoutShowsSecondary,
  layoutShowsTertiary,
  normalizePhotoBannerContent,
} from '../utils/photoBannerContent.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  blockId: {
    type: String,
    default: 'photo-banner-content',
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
])

const imageSourceTab = ref('upload')
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
    return normalizePhotoBannerContent(props.modelValue)
  },
  set(next) {
    emit('update:modelValue', normalizePhotoBannerContent(next))
    emit('change')
  },
})

const showTertiary = computed(() =>
  layoutShowsTertiary(content.value.buttonLayout),
)
const showSecondary = computed(() =>
  layoutShowsSecondary(content.value.buttonLayout),
)

const imageUrlModel = computed({
  get() {
    return content.value.imageUrl
  },
  set(next) {
    patch({ imageUrl: String(next ?? '').trim() })
  },
})

function patch(partial) {
  content.value = {
    ...content.value,
    ...partial,
  }
}

function setButtonLayout(buttonLayout) {
  patch({ buttonLayout })
}

function onTitleInput(event) {
  patch({ title: event.target.value })
}

function openPersonalization(field) {
  emit('open-personalization', field)
}

function trackPersonalization(field, event) {
  emit('track-personalization', field, event)
}
</script>

<template>
  <article class="block-card block-card_active photo-banner-block-card">
    <div class="block-card__chrome">
      <div class="block-card__header">
        <div class="block-card__title">
          <strong>Photo Banner Content</strong>
          <span>#1</span>
        </div>
      </div>
    </div>

    <div class="block-editor photo-banner-editor">
      <div class="photo-banner-editor__layout-row">
        <fieldset class="slds-form-element photo-banner-editor__layout">
          <legend class="slds-form-element__legend slds-form-element__label">
            Banner layout
          </legend>
          <div
            class="slds-form-element__control photo-banner-editor__layout-controls"
          >
            <div
              class="slds-button-group photo-banner-layout-group"
              role="group"
              aria-label="Banner layout"
            >
              <button
                v-for="option in PHOTO_BANNER_LAYOUT_OPTIONS"
                :id="`photo-banner-layout-${option.value}`"
                :key="option.value"
                class="slds-button"
                :class="
                  content.buttonLayout === option.value
                    ? 'slds-button_brand'
                    : 'slds-button_neutral'
                "
                type="button"
                :aria-pressed="
                  content.buttonLayout === option.value ? 'true' : 'false'
                "
                :title="option.description"
                @click="setButtonLayout(option.value)"
              >
                {{ option.label }}
              </button>
            </div>

            <label
              class="slds-checkbox_toggle slds-grid photo-banner-editor__close-toggle"
              for="photo-banner-show-close"
            >
              <span class="slds-form-element__label slds-m-bottom_none">
                Show close icon
              </span>
              <input
                id="photo-banner-show-close"
                type="checkbox"
                role="switch"
                :checked="content.showClose"
                aria-label="Show close icon"
                @change="patch({ showClose: $event.target.checked })"
              />
              <span class="slds-checkbox_faux_container" aria-live="polite">
                <span class="slds-checkbox_faux"></span>
                <span class="slds-checkbox_on slds-assistive-text">On</span>
                <span class="slds-checkbox_off slds-assistive-text">Off</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <div class="slds-form-element">
        <label
          class="slds-form-element__label canvas-label-row"
          for="photo-banner-title"
        >
          <span>Title</span>
          <button
            class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
            type="button"
            title="Add personalization to Title"
            @click.prevent="openPersonalization('bannerTitle')"
          >
            <span aria-hidden="true">{}</span>
            <span class="slds-assistive-text">Add personalization to Title</span>
          </button>
        </label>
        <div class="slds-form-element__control">
          <input
            id="photo-banner-title"
            class="slds-input"
            type="text"
            :value="content.title"
            placeholder="Title"
            @input="onTitleInput"
            @focus="trackPersonalization('bannerTitle', $event)"
            @click="trackPersonalization('bannerTitle', $event)"
            @keyup="trackPersonalization('bannerTitle', $event)"
            @select="trackPersonalization('bannerTitle', $event)"
          />
        </div>
      </div>

      <div class="slds-form-element">
        <label
          class="slds-form-element__label canvas-label-row"
          for="photo-banner-description"
        >
          <span>Description</span>
          <button
            class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
            type="button"
            title="Add personalization to Description"
            @click.prevent="openPersonalization('bannerDescription')"
          >
            <span aria-hidden="true">{}</span>
            <span class="slds-assistive-text"
              >Add personalization to Description</span
            >
          </button>
        </label>
        <div class="slds-form-element__control">
          <textarea
            id="photo-banner-description"
            class="slds-textarea"
            rows="3"
            :value="content.description"
            placeholder="Description"
            @input="patch({ description: $event.target.value })"
            @focus="trackPersonalization('bannerDescription', $event)"
            @click="trackPersonalization('bannerDescription', $event)"
            @keyup="trackPersonalization('bannerDescription', $event)"
            @select="trackPersonalization('bannerDescription', $event)"
          />
        </div>
      </div>

      <BannerImageSourcePanel
        v-model:image-url="imageUrlModel"
        v-model:source-tab="imageSourceTab"
        v-model:upload-folder-id="uploadFolderId"
        v-model:library-filters="libraryFilters"
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
        image-hint="Banner photo fills the full 315×248px area with 12px corner radius."
        @file-selected="emit('file-selected', $event)"
        @fetch-library="emit('fetch-library')"
        @select-library-asset="emit('select-library-asset', $event)"
        @synchronize-folders="emit('synchronize-folders')"
        @change="emit('change')"
      />

      <div
        class="photo-banner-actions settings-panel slds-form slds-form_stacked"
      >
        <h2 class="section-header">
          <span class="badge-step">2</span>
          Buttons &amp; legal note
        </h2>

        <div class="photo-banner-editor__action-groups">
          <div
            v-if="showTertiary"
            class="photo-banner-editor__action-group"
          >
            <p class="photo-banner-editor__action-group-title">Legal note</p>
            <div class="slds-form-element slds-m-bottom_small">
              <label
                class="slds-form-element__label canvas-label-row"
                for="photo-banner-legal-label"
              >
                <span>Label</span>
                <button
                  class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
                  type="button"
                  title="Add personalization to Legal note label"
                  @click.prevent="openPersonalization('bannerLegalLabel')"
                >
                  <span aria-hidden="true">{}</span>
                  <span class="slds-assistive-text"
                    >Add personalization to Legal note label</span
                  >
                </button>
              </label>
              <div class="slds-form-element__control">
                <input
                  id="photo-banner-legal-label"
                  class="slds-input"
                  type="text"
                  :value="content.legalLabel"
                  placeholder="Legal note"
                  @input="patch({ legalLabel: $event.target.value })"
                  @focus="trackPersonalization('bannerLegalLabel', $event)"
                  @click="trackPersonalization('bannerLegalLabel', $event)"
                  @keyup="trackPersonalization('bannerLegalLabel', $event)"
                  @select="trackPersonalization('bannerLegalLabel', $event)"
                />
              </div>
            </div>
            <div class="slds-form-element">
              <label
                class="slds-form-element__label canvas-label-row"
                for="photo-banner-legal-note"
              >
                <span>
                  Note
                  <SldsHelptext
                    content="Shown in a bottom drawer when the label is tapped."
                  />
                </span>
                <button
                  class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
                  type="button"
                  title="Add personalization to Legal note"
                  @click.prevent="openPersonalization('bannerLegalNote')"
                >
                  <span aria-hidden="true">{}</span>
                  <span class="slds-assistive-text"
                    >Add personalization to Legal note</span
                  >
                </button>
              </label>
              <div class="slds-form-element__control">
                <textarea
                  id="photo-banner-legal-note"
                  class="slds-textarea"
                  rows="4"
                  :value="content.legalNote"
                  placeholder="Legal note text…"
                  @input="patch({ legalNote: $event.target.value })"
                  @focus="trackPersonalization('bannerLegalNote', $event)"
                  @click="trackPersonalization('bannerLegalNote', $event)"
                  @keyup="trackPersonalization('bannerLegalNote', $event)"
                  @select="trackPersonalization('bannerLegalNote', $event)"
                />
              </div>
            </div>
          </div>

          <div
            v-if="showSecondary"
            class="photo-banner-editor__action-group"
          >
            <p class="photo-banner-editor__action-group-title">
              Secondary button
            </p>
            <div class="photo-banner-editor__field-grid">
              <div class="slds-form-element">
                <label
                  class="slds-form-element__label canvas-label-row"
                  for="photo-banner-secondary-label"
                >
                  <span>Label</span>
                  <button
                    class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
                    type="button"
                    title="Add personalization to Secondary button label"
                    @click.prevent="openPersonalization('bannerSecondaryLabel')"
                  >
                    <span aria-hidden="true">{}</span>
                    <span class="slds-assistive-text"
                      >Add personalization to Secondary button label</span
                    >
                  </button>
                </label>
                <div class="slds-form-element__control">
                  <input
                    id="photo-banner-secondary-label"
                    class="slds-input"
                    type="text"
                    :value="content.secondaryLabel"
                    placeholder="buttonLabel"
                    @input="patch({ secondaryLabel: $event.target.value })"
                    @focus="trackPersonalization('bannerSecondaryLabel', $event)"
                    @click="trackPersonalization('bannerSecondaryLabel', $event)"
                    @keyup="trackPersonalization('bannerSecondaryLabel', $event)"
                    @select="trackPersonalization('bannerSecondaryLabel', $event)"
                  />
                </div>
              </div>
              <BannerActionTargetField
                :key="`photo-secondary-${content.secondaryIntent}|${content.secondaryActionMode}|${content.secondaryUrl}`"
                :action-mode="content.secondaryActionMode"
                :intent="content.secondaryIntent"
                :url="content.secondaryUrl"
                field-id="photo-banner-secondary-target"
                label="Action target"
                personalization-field="bannerSecondaryUrl"
                @update:target="
                  patch({
                    secondaryActionMode: $event.actionMode,
                    secondaryIntent: $event.intent,
                    secondaryUrl: $event.url,
                  })
                "
                @change="emit('change')"
                @open-personalization="openPersonalization"
                @track-personalization="trackPersonalization"
              />
            </div>
          </div>

          <div class="photo-banner-editor__action-group">
            <p class="photo-banner-editor__action-group-title">Primary button</p>
            <div class="photo-banner-editor__field-grid">
              <div class="slds-form-element">
                <label
                  class="slds-form-element__label canvas-label-row"
                  for="photo-banner-primary-label"
                >
                  <span>Label</span>
                  <button
                    class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
                    type="button"
                    title="Add personalization to Primary button label"
                    @click.prevent="openPersonalization('bannerPrimaryLabel')"
                  >
                    <span aria-hidden="true">{}</span>
                    <span class="slds-assistive-text"
                      >Add personalization to Primary button label</span
                    >
                  </button>
                </label>
                <div class="slds-form-element__control">
                  <input
                    id="photo-banner-primary-label"
                    class="slds-input"
                    type="text"
                    :value="content.primaryLabel"
                    placeholder="buttonLabel"
                    @input="patch({ primaryLabel: $event.target.value })"
                    @focus="trackPersonalization('bannerPrimaryLabel', $event)"
                    @click="trackPersonalization('bannerPrimaryLabel', $event)"
                    @keyup="trackPersonalization('bannerPrimaryLabel', $event)"
                    @select="trackPersonalization('bannerPrimaryLabel', $event)"
                  />
                </div>
              </div>
              <BannerActionTargetField
                :key="`photo-primary-${content.primaryIntent}|${content.primaryActionMode}|${content.primaryUrl}`"
                :action-mode="content.primaryActionMode"
                :intent="content.primaryIntent"
                :url="content.primaryUrl"
                field-id="photo-banner-primary-target"
                label="Action target"
                personalization-field="bannerPrimaryUrl"
                @update:target="
                  patch({
                    primaryActionMode: $event.actionMode,
                    primaryIntent: $event.intent,
                    primaryUrl: $event.url,
                  })
                "
                @change="emit('change')"
                @open-personalization="openPersonalization"
                @track-personalization="trackPersonalization"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>
