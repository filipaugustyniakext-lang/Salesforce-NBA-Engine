<script setup>
import { computed } from 'vue'
import {
  PUSH_PREVIEW_DEVICE_OPTIONS,
  getPushPreviewViewsForDevice,
  normalizePushPreviewDevice,
  normalizePushPreviewView,
} from '../config/pushBehaviours.js'

const props = defineProps({
  appName: { type: String, default: 'APP NAME' },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  body: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  buttons: { type: Array, default: () => [] },
  device: { type: String, default: 'iphone' },
  view: { type: String, default: 'lockScreen' },
  showToolbar: { type: Boolean, default: true },
})

const emit = defineEmits(['update:device', 'update:view'])

const resolvedDevice = computed(() => normalizePushPreviewDevice(props.device))
const resolvedView = computed(() =>
  normalizePushPreviewView(resolvedDevice.value, props.view),
)
const viewOptions = computed(() =>
  getPushPreviewViewsForDevice(resolvedDevice.value),
)

const displayAppName = computed(() => {
  const name = String(props.appName ?? '').trim()
  return name || 'APP NAME'
})

const displayTitle = computed(() => {
  const value = String(props.title ?? '').trim()
  return value || 'Title'
})

const displaySubtitle = computed(() => String(props.subtitle ?? '').trim())

const displayBody = computed(() => {
  const value = String(props.body ?? '').trim()
  return value || 'Message'
})

const displayImageUrl = computed(() => String(props.imageUrl ?? '').trim())

const androidButtons = computed(() =>
  (Array.isArray(props.buttons) ? props.buttons : [])
    .slice(0, 3)
    .map((button, index) => {
      const label = String(button?.label ?? '').trim()
      return {
        key: `btn-${index}`,
        label: label || `button ${index + 1}`,
        iconFileName: String(button?.iconFileName ?? '').trim(),
      }
    }),
)

const previewDateLabel = computed(() => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date())
  } catch {
    return 'Friday, July 24'
  }
})

const previewTimeLabel = computed(() => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())
  } catch {
    return '5:00'
  }
})

const screenClass = computed(() => {
  if (resolvedDevice.value === 'smartWatch') return 'push-device__screen_watch'
  if (resolvedDevice.value === 'android' && resolvedView.value === 'shade') {
    return 'push-device__screen_shade'
  }
  if (resolvedDevice.value === 'iphone' && resolvedView.value === 'longPress') {
    return 'push-device__screen_blur-green'
  }
  if (
    resolvedDevice.value === 'iphone' &&
    (resolvedView.value === 'alert' || resolvedView.value === 'banner')
  ) {
    return 'push-device__screen_home'
  }
  return 'push-device__screen_lock-ocean'
})

function onDeviceChange(event) {
  const nextDevice = normalizePushPreviewDevice(event.target.value)
  emit('update:device', nextDevice)
  emit('update:view', getPushPreviewViewsForDevice(nextDevice)[0]?.value)
}

function onViewChange(event) {
  emit(
    'update:view',
    normalizePushPreviewView(resolvedDevice.value, event.target.value),
  )
}
</script>

<template>
  <div class="push-device-preview push-device-preview_embedded">
    <div v-if="showToolbar" class="push-device-preview__toolbar">
      <div class="slds-form-element">
        <label class="slds-assistive-text" for="push-preview-device"
          >Device</label
        >
        <div class="slds-form-element__control">
          <div class="slds-select_container">
            <select
              id="push-preview-device"
              class="slds-select"
              :value="resolvedDevice"
              @change="onDeviceChange"
            >
              <option
                v-for="option in PUSH_PREVIEW_DEVICE_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
        </div>
      </div>
      <div class="slds-form-element">
        <label class="slds-assistive-text" for="push-preview-view"
          >Display type</label
        >
        <div class="slds-form-element__control">
          <div class="slds-select_container">
            <select
              id="push-preview-view"
              class="slds-select"
              :value="resolvedView"
              @change="onViewChange"
            >
              <option
                v-for="option in viewOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div :class="['push-device__screen', screenClass]">
      <!-- iPhone Lock Screen -->
      <template
        v-if="resolvedDevice === 'iphone' && resolvedView === 'lockScreen'"
      >
        <div class="push-device__lock-clock">
          <div class="push-device__lock-time">{{ previewTimeLabel }}</div>
          <div class="push-device__lock-date">{{ previewDateLabel }}</div>
        </div>
        <div class="push-device__card push-device__card_ios">
          <div class="push-device__card-header">
            <span class="push-device__app-icon" aria-hidden="true"></span>
            <span class="push-device__app-name">{{ displayAppName }}</span>
            <span class="push-device__timestamp">Now</span>
          </div>
          <img
            v-if="displayImageUrl"
            class="push-device__media"
            :src="displayImageUrl"
            alt=""
          />
          <div class="push-device__title">{{ displayTitle }}</div>
          <div v-if="displaySubtitle" class="push-device__subtitle">
            {{ displaySubtitle }}
          </div>
          <div class="push-device__body">{{ displayBody }}</div>
        </div>
      </template>

      <!-- iPhone Long Press -->
      <template
        v-else-if="resolvedDevice === 'iphone' && resolvedView === 'longPress'"
      >
        <div class="push-device__card push-device__card_ios push-device__card_expanded">
          <div class="push-device__card-header">
            <span class="push-device__app-icon" aria-hidden="true"></span>
            <span class="push-device__app-name">{{ displayAppName }}</span>
            <span class="push-device__dismiss" aria-hidden="true">×</span>
          </div>
          <div class="push-device__title">{{ displayTitle }}</div>
          <div v-if="displaySubtitle" class="push-device__subtitle">
            {{ displaySubtitle }}
          </div>
          <div class="push-device__body">{{ displayBody }}</div>
          <img
            v-if="displayImageUrl"
            class="push-device__media"
            :src="displayImageUrl"
            alt=""
          />
        </div>
      </template>

      <!-- iPhone Alert -->
      <template
        v-else-if="resolvedDevice === 'iphone' && resolvedView === 'alert'"
      >
        <div class="push-device__home-grid" aria-hidden="true">
          <span v-for="n in 8" :key="n" class="push-device__home-icon"></span>
        </div>
        <div class="push-device__alert">
          <div class="push-device__alert-app">{{ displayAppName }}</div>
          <div class="push-device__alert-message">{{ displayBody }}</div>
          <div class="push-device__alert-actions">
            <span>Cancel</span>
            <span>Launch</span>
          </div>
        </div>
      </template>

      <!-- iPhone Banner -->
      <template
        v-else-if="resolvedDevice === 'iphone' && resolvedView === 'banner'"
      >
        <div class="push-device__card push-device__card_ios push-device__card_banner">
          <div class="push-device__card-header">
            <span class="push-device__app-icon" aria-hidden="true"></span>
            <span class="push-device__app-name">{{ displayAppName }}</span>
            <span class="push-device__timestamp">Now</span>
          </div>
          <div class="push-device__title">{{ displayTitle }}</div>
          <div v-if="displaySubtitle" class="push-device__subtitle">
            {{ displaySubtitle }}
          </div>
          <div class="push-device__body">{{ displayBody }}</div>
        </div>
        <div
          class="push-device__home-grid push-device__home-grid_banner"
          aria-hidden="true"
        >
          <span v-for="n in 8" :key="n" class="push-device__home-icon"></span>
        </div>
      </template>

      <!-- Android Lock Screen -->
      <template
        v-else-if="
          resolvedDevice === 'android' && resolvedView === 'lockScreen'
        "
      >
        <div class="push-device__lock-clock push-device__lock-clock_android">
          <div class="push-device__lock-time">{{ previewTimeLabel }}</div>
          <div class="push-device__lock-date push-device__lock-date_upper">
            {{ previewDateLabel }}
          </div>
        </div>
        <div class="push-device__card push-device__card_android">
          <div class="push-device__card-header">
            <span class="push-device__app-icon" aria-hidden="true"></span>
            <span class="push-device__app-name">{{ displayAppName }}</span>
            <span class="push-device__timestamp"
              >1d <span class="push-device__chevron">▾</span></span
            >
          </div>
          <div class="push-device__title">{{ displayTitle }}</div>
          <div v-if="displaySubtitle" class="push-device__subtitle">
            {{ displaySubtitle }}
          </div>
          <div class="push-device__body push-device__body_android">
            {{ displayBody }}
          </div>
          <div class="push-device__android-actions">
            <button
              v-for="button in androidButtons"
              :key="button.key"
              class="push-device__android-action"
              type="button"
              tabindex="-1"
            >
              <span class="push-device__android-action-icon" aria-hidden="true"
                >◌</span
              >
              <span>{{ button.label }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- Android Shade -->
      <template
        v-else-if="resolvedDevice === 'android' && resolvedView === 'shade'"
      >
        <div class="push-device__shade-status">
          <span>{{ previewTimeLabel }} {{ previewDateLabel }}</span>
        </div>
        <div class="push-device__card push-device__card_android">
          <div class="push-device__card-header">
            <span class="push-device__app-icon" aria-hidden="true"></span>
            <span class="push-device__app-name"
              >{{ displayAppName }} · 1d
              <span class="push-device__chevron">▾</span></span
            >
          </div>
          <div class="push-device__title">{{ displayTitle }}</div>
          <div v-if="displaySubtitle" class="push-device__subtitle">
            {{ displaySubtitle }}
          </div>
          <div class="push-device__body push-device__body_android">
            {{ displayBody }}
          </div>
          <div class="push-device__android-actions">
            <button
              v-for="button in androidButtons"
              :key="button.key"
              class="push-device__android-action"
              type="button"
              tabindex="-1"
            >
              <span class="push-device__android-action-icon" aria-hidden="true"
                >◌</span
              >
              <span>{{ button.label }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- Apple Watch Short Look -->
      <template
        v-else-if="
          resolvedDevice === 'smartWatch' && resolvedView === 'shortLook'
        "
      >
        <div class="push-device__watch-short">
          <span class="push-device__watch-icon" aria-hidden="true"></span>
          <div class="push-device__watch-title">{{ displayTitle }}</div>
          <div class="push-device__watch-app">{{ displayAppName }}</div>
        </div>
      </template>

      <!-- Apple Watch Long Look -->
      <template v-else>
        <div class="push-device__watch-long">
          <div class="push-device__watch-long-time">{{ previewTimeLabel }}</div>
          <div class="push-device__watch-long-header">
            <span class="push-device__app-icon" aria-hidden="true"></span>
            <span class="push-device__watch-app">{{ displayAppName }}</span>
          </div>
          <div class="push-device__watch-message">{{ displayBody }}</div>
          <div class="push-device__watch-dismiss">Dismiss</div>
        </div>
      </template>
    </div>
  </div>
</template>
