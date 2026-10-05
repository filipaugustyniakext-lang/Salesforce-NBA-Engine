<script setup>
import { computed, ref } from 'vue'
import BannerActionTargetField from './BannerActionTargetField.vue'
import BannerImageSourcePanel from './BannerImageSourcePanel.vue'
import SldsHelptext from './SldsHelptext.vue'
import {
  VAS_BANNER_FOCUS_RING,
  VAS_BANNER_LAYOUT_OPTIONS,
  normalizeVasBannerBgPosition,
  normalizeVasBannerContent,
  normalizeVasBannerFocusBorderColor,
  normalizeVasBannerLayout,
  patchVasBannerVariant,
} from '../utils/vasBannerContent.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  blockId: {
    type: String,
    default: 'vas-banner-content',
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
])

const backgroundSourceTab = ref('upload')
const logoSourceTab = ref('upload')
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
    return normalizeVasBannerContent(props.modelValue)
  },
  set(next) {
    emit('update:modelValue', normalizeVasBannerContent(next))
    emit('change')
  },
})

const imageUrlModel = computed({
  get() {
    return content.value.imageUrl
  },
  set(next) {
    patch({ imageUrl: String(next ?? '').trim() })
  },
})

const logoUrlModel = computed({
  get() {
    return content.value.logoUrl
  },
  set(next) {
    patch({ logoUrl: String(next ?? '').trim() })
  },
})

function patch(partial) {
  content.value = {
    ...content.value,
    ...partial,
  }
}

function setPreviewLayout(layout) {
  patch({ previewLayout: normalizeVasBannerLayout(layout) })
}

function patchVariant(layout, partial) {
  content.value = patchVasBannerVariant(content.value, layout, partial)
}

function targetImageField(field) {
  emit('image-field-target', field)
}

function onBackgroundFileSelected(event) {
  targetImageField('imageUrl')
  emit('file-selected', event)
}

function onLogoFileSelected(event) {
  targetImageField('logoUrl')
  emit('file-selected', event)
}

function onBackgroundLibraryAsset(asset) {
  targetImageField('imageUrl')
  emit('select-library-asset', asset)
}

function onLogoLibraryAsset(asset) {
  targetImageField('logoUrl')
  emit('select-library-asset', asset)
}

function openPersonalization(field) {
  emit('open-personalization', field)
}

function trackPersonalization(field, event) {
  emit('track-personalization', field, event)
}
</script>

<template>
  <article class="block-card block-card_active vas-banner-block-card">
    <div class="block-card__chrome">
      <div class="block-card__header">
        <div class="block-card__title">
          <strong>VAS Banner Content</strong>
          <span>#1</span>
        </div>
      </div>
    </div>

    <div class="block-editor vas-banner-editor">
      <div class="vas-banner-editor__layout-row">
        <fieldset class="slds-form-element vas-banner-editor__layout">
          <legend class="slds-form-element__legend slds-form-element__label">
            Preview layout
            <SldsHelptext
              content="Production may use any size. Configure title and background position for all three layouts below. This control only changes which size the preview shows."
            />
          </legend>
          <div
            class="slds-form-element__control vas-banner-editor__layout-controls"
          >
            <div
              class="slds-button-group vas-banner-layout-group"
              role="group"
              aria-label="Preview layout"
            >
              <button
                v-for="option in VAS_BANNER_LAYOUT_OPTIONS"
                :id="`vas-banner-preview-layout-${option.value}`"
                :key="option.value"
                class="slds-button"
                :class="
                  content.previewLayout === option.value
                    ? 'slds-button_brand'
                    : 'slds-button_neutral'
                "
                type="button"
                :aria-pressed="
                  content.previewLayout === option.value ? 'true' : 'false'
                "
                :title="option.description"
                @click="setPreviewLayout(option.value)"
              >
                {{ option.label }}
              </button>
            </div>

            <label
              class="slds-checkbox_toggle slds-grid vas-banner-editor__close-toggle"
              for="vas-banner-show-close"
            >
              <span class="slds-form-element__label slds-m-bottom_none">
                Show close icon
              </span>
              <input
                id="vas-banner-show-close"
                type="checkbox"
                :checked="content.showClose"
                @change="patch({ showClose: $event.target.checked })"
              />
              <span class="slds-checkbox_faux_container" aria-live="polite">
                <span class="slds-checkbox_faux"></span>
                <span class="slds-checkbox_on">On</span>
                <span class="slds-checkbox_off">Off</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <div class="slds-form-element">
        <label
          class="slds-form-element__label"
          for="vas-banner-focus-border-color"
        >
          Focus border color
          <SldsHelptext
            content="2px focus ring around the banner. Usually matches the partner logo color; customize if needed."
          />
        </label>
        <div class="slds-form-element__control vas-banner-editor__color-row">
          <input
            id="vas-banner-focus-border-color"
            class="vas-banner-editor__color-swatch"
            type="color"
            :value="content.focusBorderColor || VAS_BANNER_FOCUS_RING"
            @input="
              patch({
                focusBorderColor: normalizeVasBannerFocusBorderColor(
                  $event.target.value,
                ),
              })
            "
          />
          <input
            class="slds-input vas-banner-editor__color-hex"
            type="text"
            maxlength="7"
            :value="content.focusBorderColor"
            placeholder="#FF6A00"
            @change="
              patch({
                focusBorderColor: normalizeVasBannerFocusBorderColor(
                  $event.target.value,
                ),
              })
            "
          />
        </div>
      </div>

      <BannerImageSourcePanel
        v-model:image-url="imageUrlModel"
        v-model:source-tab="backgroundSourceTab"
        v-model:upload-folder-id="uploadFolderId"
        v-model:library-filters="libraryFilters"
        :block-id="`${blockId}-background`"
        :upload-in-progress="uploadInProgress"
        :library-loading="libraryLoading"
        :library-assets="libraryAssets"
        :library-error="libraryError"
        :library-result-count="libraryResultCount"
        :categories="categories"
        :folders-loading="foldersLoading"
        :folders-syncing="foldersSyncing"
        :folders-error="foldersError"
        image-hint="Shared background for all sizes. Use each layout’s X/Y position to frame the crop."
        step-number="1"
        panel-title="Background image"
        @file-selected="onBackgroundFileSelected"
        @fetch-library="emit('fetch-library')"
        @select-library-asset="onBackgroundLibraryAsset"
        @synchronize-folders="emit('synchronize-folders')"
        @change="emit('change')"
      />

      <BannerImageSourcePanel
        v-model:image-url="logoUrlModel"
        v-model:source-tab="logoSourceTab"
        v-model:upload-folder-id="uploadFolderId"
        v-model:library-filters="libraryFilters"
        :block-id="`${blockId}-logo`"
        :upload-in-progress="uploadInProgress"
        :library-loading="libraryLoading"
        :library-assets="libraryAssets"
        :library-error="libraryError"
        :library-result-count="libraryResultCount"
        :categories="categories"
        :folders-loading="foldersLoading"
        :folders-syncing="foldersSyncing"
        :folders-error="foldersError"
        image-hint="Logo is shown as a 32×32px circle in the top-left corner."
        step-number="2"
        panel-title="Logo image"
        @file-selected="onLogoFileSelected"
        @fetch-library="emit('fetch-library')"
        @select-library-asset="onLogoLibraryAsset"
        @synchronize-folders="emit('synchronize-folders')"
        @change="emit('change')"
      />

      <div
        class="vas-banner-variants settings-panel slds-form slds-form_stacked"
      >
        <h2 class="section-header">
          <span class="badge-step">3</span>
          Layout variants
          <SldsHelptext
            content="All three sizes are saved to the Data Extension. Production picks which size to render."
          />
        </h2>

        <section
          v-for="option in VAS_BANNER_LAYOUT_OPTIONS"
          :key="option.value"
          class="vas-banner-variant-card"
          :class="{
            'vas-banner-variant-card_active':
              content.previewLayout === option.value,
          }"
        >
          <header class="vas-banner-variant-card__header">
            <div>
              <strong>{{ option.label }}</strong>
              <p class="slds-text-body_small slds-text-color_weak">
                {{ option.description }}
              </p>
            </div>
            <button
              class="slds-button slds-button_neutral slds-button_small"
              type="button"
              @click="setPreviewLayout(option.value)"
            >
              Preview
            </button>
          </header>

          <div class="slds-form-element">
            <label
              class="slds-form-element__label canvas-label-row"
              :for="option.titleInputId"
            >
              <span>Title</span>
              <button
                class="slds-button slds-button_icon slds-button_icon-brand context-var-button"
                type="button"
                :title="`Add personalization to ${option.label} title`"
                @click.prevent="openPersonalization(option.personalizationField)"
              >
                <span aria-hidden="true">{}</span>
                <span class="slds-assistive-text">
                  Add personalization to {{ option.label }} title
                </span>
              </button>
            </label>
            <div class="slds-form-element__control">
              <textarea
                :id="option.titleInputId"
                class="slds-textarea"
                rows="2"
                :value="content.variants[option.value].title"
                placeholder="Banner title"
                @input="
                  patchVariant(option.value, {
                    title: $event.target.value,
                  })
                "
                @focus="
                  trackPersonalization(option.personalizationField, $event)
                "
                @click="
                  trackPersonalization(option.personalizationField, $event)
                "
                @keyup="
                  trackPersonalization(option.personalizationField, $event)
                "
                @select="
                  trackPersonalization(option.personalizationField, $event)
                "
              />
            </div>
          </div>

          <div class="vas-banner-variant-card__positions">
            <div class="slds-form-element">
              <label
                class="slds-form-element__label"
                :for="`vas-banner-${option.value}-pos-x`"
              >
                Background position X
                <span class="slds-text-color_weak">
                  ({{ content.variants[option.value].backgroundPositionX }}%)
                </span>
              </label>
              <div class="slds-form-element__control">
                <input
                  :id="`vas-banner-${option.value}-pos-x`"
                  class="vas-banner-editor__range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  :value="content.variants[option.value].backgroundPositionX"
                  @input="
                    patchVariant(option.value, {
                      backgroundPositionX: normalizeVasBannerBgPosition(
                        $event.target.value,
                      ),
                    })
                  "
                />
              </div>
            </div>
            <div class="slds-form-element">
              <label
                class="slds-form-element__label"
                :for="`vas-banner-${option.value}-pos-y`"
              >
                Background position Y
                <span class="slds-text-color_weak">
                  ({{ content.variants[option.value].backgroundPositionY }}%)
                </span>
              </label>
              <div class="slds-form-element__control">
                <input
                  :id="`vas-banner-${option.value}-pos-y`"
                  class="vas-banner-editor__range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  :value="content.variants[option.value].backgroundPositionY"
                  @input="
                    patchVariant(option.value, {
                      backgroundPositionY: normalizeVasBannerBgPosition(
                        $event.target.value,
                      ),
                    })
                  "
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="vas-banner-actions settings-panel slds-form slds-form_stacked">
        <h2 class="section-header">
          <span class="badge-step">4</span>
          Link
          <SldsHelptext
            content="The entire VAS banner is clickable (except the close icon) and opens the selected intent or URL."
          />
        </h2>
        <BannerActionTargetField
          :key="`vas-link-${content.intent}|${content.actionMode}|${content.url}`"
          :action-mode="content.actionMode"
          :intent="content.intent"
          :url="content.url"
          field-id="vas-banner-link-target"
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
