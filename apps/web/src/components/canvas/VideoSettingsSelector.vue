<script setup lang="ts">
import { ref, watch } from 'vue'
import { useClickOutside } from '@/composables/useClickOutside'
import {
  clampVideoDuration,
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_CROP_OPTIONS,
  VIDEO_DURATION_MARKS,
  VIDEO_RESOLUTION_OPTIONS,
  type VideoSettings,
} from '@lnkpi/shared'

const props = defineProps<{
  modelValue: VideoSettings
}>()

const emit = defineEmits<{
  'update:modelValue': [value: VideoSettings]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => {
  open.value = false
})

function patch(partial: Partial<VideoSettings>) {
  const next = { ...DEFAULT_VIDEO_SETTINGS, ...props.modelValue, ...partial }
  if ('duration' in partial) {
    next.duration = clampVideoDuration(next.duration)
  }
  emit('update:modelValue', next)
}

watch(open, (isOpen) => {
  if (!isOpen) return
  const clamped = clampVideoDuration(props.modelValue.duration)
  if (clamped !== props.modelValue.duration) {
    patch({ duration: clamped })
  }
})
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="neo-ctl flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
      title="视频参数"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="opacity-60">
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <path d="m16 10 6-3v10l-6-3z" />
      </svg>
      <span class="font-medium">
        {{ modelValue.aspectRatio }} · {{ modelValue.resolution }} · {{ modelValue.duration }}s
      </span>
      <svg class="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full right-0 z-50 mb-1 w-[240px] neo-popover rounded-xl p-3"
      @click.stop
    >
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-[var(--neo-text-muted)]">画面比例</p>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in VIDEO_ASPECT_RATIO_OPTIONS"
            :key="opt.value"
            type="button"
            class="neo-chip rounded-md px-2 py-1 text-[10px]"
            :class="modelValue.aspectRatio === opt.value
              ? 'is-on'
              : ''"
            @click="patch({ aspectRatio: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-[var(--neo-text-muted)]">分辨率</p>
        <div class="flex gap-1">
          <button
            v-for="opt in VIDEO_RESOLUTION_OPTIONS"
            :key="opt.value"
            type="button"
            class="neo-chip flex-1 rounded-md px-2 py-1 text-[10px]"
            :class="modelValue.resolution === opt.value
              ? 'is-on'
              : ''"
            @click="patch({ resolution: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="mb-3">
        <p class="mb-1.5 flex items-center justify-between text-[10px] text-[var(--neo-text-muted)]">
          <span>时长</span>
          <span class="tabular-nums text-[var(--neo-text-secondary)]">{{ modelValue.duration }}s</span>
        </p>
        <input
          type="range"
          min="5"
          max="15"
          step="1"
          class="w-full accent-[var(--neo-accent)]"
          :value="modelValue.duration"
          @input="patch({ duration: clampVideoDuration(($event.target as HTMLInputElement).value) })"
        />
        <div class="mt-1 flex justify-between text-[10px]">
          <button
            v-for="mark in VIDEO_DURATION_MARKS"
            :key="mark"
            type="button"
            class="text-[var(--neo-text-muted)]"
            :class="mark === 10 || mark === 15 ? 'font-semibold text-[var(--neo-accent-text)]' : ''"
            @click="patch({ duration: mark })"
          >
            {{ mark }}
          </button>
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-[10px] text-[var(--neo-text-muted)]">裁剪</p>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in VIDEO_CROP_OPTIONS"
            :key="opt.value"
            type="button"
            class="neo-chip rounded-md px-2 py-1 text-[10px]"
            :class="modelValue.crop === opt.value
              ? 'is-on'
              : ''"
            @click="patch({ crop: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="mt-3 w-full rounded-lg py-1 text-[10px] text-[var(--neo-text-muted)] hover:text-white/70"
        @click="patch(DEFAULT_VIDEO_SETTINGS)"
      >
        重置默认
      </button>
    </div>
  </div>
</template>
