<script setup>
import { computed, ref, watch } from 'vue'
import ContentBuilderFolderSelect from './ContentBuilderFolderSelect.vue'
import ImageLibraryPanel from './ImageLibraryPanel.vue'
import SldsHelptext from './SldsHelptext.vue'
import SldsIcon from './SldsIcon.vue'
import SldsInlineSpinner from './SldsInlineSpinner.vue'

const sourceTab = defineModel('sourceTab', {
  type: String,
  default: 'upload',
})

const appearanceTab = defineModel('appearanceTab', {
  type: String,
  default: 'light',
})

const uploadFolderId = defineModel('uploadFolderId', {
  type: [String, Number],
  default: '',
})

const libraryFilters = defineModel('libraryFilters', {
  type: Object,
  required: true,
})

const imageUrl = defineModel('imageUrl', {
  type: String,
  default: '',
})

const imageUrlLight = defineModel('imageUrlLight', {
  type: String,
  default: '',
})

const imageUrlDark = defineModel('imageUrlDark', {
  type: String,
  default: '',
})

const props = defineProps({
  blockId: {
    type: String,
    default: 'banner-image',
  },
  showAppearanceTabs: {
    type: Boolean,
    default: false,
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
  imageHint: {
    type: String,
    default: 'Banner image is shown at 100×100px with 4px corner radius.',
  },
  stepNumber: {
    type: [String, Number],
    default: '1',
  },
  panelTitle: {
    type: String,
    default: 'Choose Image Source',
  },
})

const emit = defineEmits([
  'file-selected',
  'fetch-library',
  'select-library-asset',
  'synchronize-folders',
  'change',
  'appearance-change',
])

const activeAppearanceTab = computed({
  get() {
    return appearanceTab.value === 'dark' ? 'dark' : 'light'
  },
  set(next) {
    appearanceTab.value = next === 'dark' ? 'dark' : 'light'
  },
})

const activeImageUrl = computed({
  get() {
    if (!props.showAppearanceTabs) {
      return String(imageUrl.value ?? '')
    }
    return activeAppearanceTab.value === 'dark'
      ? String(imageUrlDark.value ?? '')
      : String(imageUrlLight.value ?? '')
  },
  set(next) {
    const value = String(next ?? '').trim()
    if (!props.showAppearanceTabs) {
      imageUrl.value = value
      return
    }
    if (activeAppearanceTab.value === 'dark') {
      imageUrlDark.value = value
    } else {
      imageUrlLight.value = value
    }
  },
})

const localUrl = ref(String(activeImageUrl.value ?? ''))

watch(
  () => activeImageUrl.value,
  (next) => {
    if (String(next ?? '') !== localUrl.value) {
      localUrl.value = String(next ?? '')
    }
  },
)

watch(activeAppearanceTab, (next) => {
  emit('appearance-change', next)
})

function setAppearanceTab(tab) {
  activeAppearanceTab.value = tab === 'dark' ? 'dark' : 'light'
  emit('appearance-change', activeAppearanceTab.value)
}

function setSourceTab(tab) {
  sourceTab.value = tab
  if (tab === 'library') {
    emit('fetch-library')
  }
}

function applyUrl() {
  activeImageUrl.value = String(localUrl.value ?? '').trim()
  emit('change')
}

function onSelectLibraryAsset(asset) {
  emit('select-library-asset', asset)
}
</script>

<template>
  <div class="banner-image-source settings-panel slds-form slds-form_stacked">
    <h2 class="section-header">
      <span class="badge-step">{{ stepNumber }}</span>
      {{ panelTitle }}
      <SldsHelptext :content="imageHint" />
    </h2>

    <div class="image-wizard-source-panel">
      <div
        v-if="showAppearanceTabs"
        class="slds-tabs_default image-wizard-appearance-tabs slds-m-bottom_small"
      >
        <ul
          class="slds-tabs_default__nav image-wizard-appearance-tabs__nav"
          role="tablist"
          aria-label="Banner appearance"
        >
          <li
            :class="[
              'slds-tabs_default__item',
              { 'slds-is-active': activeAppearanceTab === 'light' },
            ]"
          >
            <button
              class="slds-tabs_default__link block-editor-tab-button"
              type="button"
              role="tab"
              :aria-selected="activeAppearanceTab === 'light' ? 'true' : 'false'"
              @click="setAppearanceTab('light')"
            >
              Light mode
            </button>
          </li>
          <li
            :class="[
              'slds-tabs_default__item',
              { 'slds-is-active': activeAppearanceTab === 'dark' },
            ]"
          >
            <button
              class="slds-tabs_default__link block-editor-tab-button"
              type="button"
              role="tab"
              :aria-selected="activeAppearanceTab === 'dark' ? 'true' : 'false'"
              @click="setAppearanceTab('dark')"
            >
              Dark mode
            </button>
          </li>
        </ul>
        <p
          v-if="activeAppearanceTab === 'dark' && !imageUrlDark && imageUrlLight"
          class="slds-text-body_small slds-text-color_weak slds-p-horizontal_small slds-p-top_x-small"
        >
          No dark mode image yet — preview uses the light mode image as fallback.
        </p>
      </div>

      <div class="slds-tabs_default image-wizard-source-tabs">
        <ul class="slds-tabs_default__nav image-wizard-subtabs" role="tablist">
          <li
            :class="[
              'slds-tabs_default__item',
              { 'slds-is-active': sourceTab === 'upload' },
            ]"
          >
            <button
              class="slds-tabs_default__link block-editor-tab-button"
              type="button"
              role="tab"
              :aria-selected="sourceTab === 'upload' ? 'true' : 'false'"
              @click="setSourceTab('upload')"
            >
              Upload File
            </button>
          </li>
          <li
            :class="[
              'slds-tabs_default__item',
              { 'slds-is-active': sourceTab === 'url' },
            ]"
          >
            <button
              class="slds-tabs_default__link block-editor-tab-button"
              type="button"
              role="tab"
              :aria-selected="sourceTab === 'url' ? 'true' : 'false'"
              @click="setSourceTab('url')"
            >
              Image URL
            </button>
          </li>
          <li
            :class="[
              'slds-tabs_default__item',
              { 'slds-is-active': sourceTab === 'library' },
            ]"
          >
            <button
              class="slds-tabs_default__link block-editor-tab-button"
              type="button"
              role="tab"
              :aria-selected="sourceTab === 'library' ? 'true' : 'false'"
              @click="setSourceTab('library')"
            >
              Library
            </button>
          </li>
        </ul>

        <div
          v-if="sourceTab === 'upload'"
          class="slds-tabs_default__content slds-show slds-p-around_medium"
          role="tabpanel"
        >
          <ContentBuilderFolderSelect
            v-model:selected-folder-id="uploadFolderId"
            class="slds-m-bottom_medium"
            :categories="categories"
            :loading="foldersLoading"
            :syncing="foldersSyncing"
            :error="foldersError"
            :disabled="uploadInProgress"
            @synchronize="emit('synchronize-folders')"
          />
          <div class="slds-form-element">
            <span class="slds-form-element__label">Upload Asset</span>
            <div class="slds-form-element__control">
              <div class="slds-file-selector slds-file-selector_files">
                <div class="slds-file-selector__dropzone">
                  <input
                    :id="`banner-img-file-${blockId}-${activeAppearanceTab}`"
                    class="slds-file-selector__input slds-assistive-text"
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    :disabled="uploadInProgress"
                    @change="emit('file-selected', $event)"
                  />
                  <label
                    class="slds-file-selector__body"
                    :for="`banner-img-file-${blockId}-${activeAppearanceTab}`"
                  >
                    <span
                      class="slds-file-selector__button slds-button slds-button_neutral"
                    >
                      <SldsInlineSpinner
                        v-if="uploadInProgress"
                        assistive-text="Uploading image"
                      />
                      <span>{{
                        uploadInProgress ? 'Uploading…' : 'Upload Files'
                      }}</span>
                    </span>
                    <span class="slds-file-selector__text slds-medium-show">
                      or Drop Files
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="sourceTab === 'url'"
          class="slds-tabs_default__content slds-show slds-p-around_medium"
          role="tabpanel"
        >
          <div class="slds-form-element">
            <label
              class="slds-form-element__label"
              :for="`banner-img-url-${blockId}-${activeAppearanceTab}`"
            >
              Image URL
            </label>
            <div class="slds-form-element__control slds-grid slds-gutters_xx-small">
              <div class="slds-col slds-grow">
                <input
                  :id="`banner-img-url-${blockId}-${activeAppearanceTab}`"
                  v-model="localUrl"
                  class="slds-input"
                  type="url"
                  placeholder="https://…"
                  @keydown.enter.prevent="applyUrl"
                />
              </div>
              <div class="slds-col slds-grow-none">
                <button
                  class="slds-button slds-button_neutral"
                  type="button"
                  @click="applyUrl"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else
          class="slds-tabs_default__content slds-show slds-p-around_medium"
          role="tabpanel"
        >
          <ImageLibraryPanel
            v-model:filters="libraryFilters"
            :loading="libraryLoading"
            :assets="libraryAssets"
            :error="libraryError"
            :selected-folder-id="uploadFolderId"
            :result-count="libraryResultCount"
            @fetch-library="emit('fetch-library')"
            @select-library-asset="onSelectLibraryAsset"
          />
        </div>
      </div>
    </div>

    <div
      v-if="showAppearanceTabs"
      class="banner-image-source__current slds-m-top_small"
    >
      <div v-if="imageUrlLight" class="banner-image-source__current-row">
        <SldsIcon name="image" size="x-small" assistive-text="" />
        <span class="slds-text-body_small slds-text-color_weak">Light:</span>
        <span class="slds-truncate" :title="imageUrlLight">{{ imageUrlLight }}</span>
      </div>
      <div v-if="imageUrlDark" class="banner-image-source__current-row">
        <SldsIcon name="image" size="x-small" assistive-text="" />
        <span class="slds-text-body_small slds-text-color_weak">Dark:</span>
        <span class="slds-truncate" :title="imageUrlDark">{{ imageUrlDark }}</span>
      </div>
    </div>
    <div v-else-if="activeImageUrl" class="banner-image-source__current slds-m-top_small">
      <SldsIcon name="image" size="x-small" assistive-text="" />
      <span class="slds-truncate" :title="activeImageUrl">{{ activeImageUrl }}</span>
    </div>
  </div>
</template>

<style scoped>
.banner-image-source__current-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.banner-image-source__current-row + .banner-image-source__current-row {
  margin-top: 0.25rem;
}

.image-wizard-appearance-tabs__nav {
  border-bottom: 1px solid #c9c9c9;
}
</style>
