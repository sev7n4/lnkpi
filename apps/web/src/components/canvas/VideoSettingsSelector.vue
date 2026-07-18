<script setup lang="ts">
import { ref } from 'vue'
import { useClickOutside } from '@/composables/useClickOutside'
import {
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_CROP_OPTIONS,
  VIDEO_DURATION_OPTIONS,
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
  emit('update:modelValue', { ...DEFAULT_VIDEO_SETTINGS, ...props.modelValue, ...partial })
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs transition hover:bg-white/10"
      title="视频参数"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-white/50">
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <path d="m16 10 6-3v10l-6-3z" />
      </svg>
      <span class="font-medium">
        {{ modelValue.aspectRatio }} · {{ modelValue.resolution }} · {{ modelValue.duration }}s
      </span>
      <svg class="h-3 w-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full right-0 z-50 mb-1 w-[240px] rounded-xl border border-white/10 bg-[#242424] p-3 shadow-xl"
      @click.stop
    >
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">画面比例</p>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in VIDEO_ASPECT_RATIO_OPTIONS"
            :key="opt.value"
            type="button"
            class="rounded-md px-2 py-1 text-[10px] transition"
            :class="modelValue.aspectRatio === opt.value
              ? 'bg-[#6366f1]/30 text-[#818cf8]'
              : 'bg-white/5 text-white/60 hover:bg-white/10'"
            @click="patch({ aspectRatio: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">分辨率</p>
        <div class="flex gap-1">
          <button
            v-for="opt in VIDEO_RESOLUTION_OPTIONS"
            :key="opt.value"
            type="button"
            class="flex-1 rounded-md px-2 py-1 text-[10px] transition"
            :class="modelValue.resolution === opt.value
              ? 'bg-[#6366f1]/30 text-[#818cf8]'
              : 'bg-white/5 text-white/60 hover:bg-white/10'"
            @click="patch({ resolution: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">时长</p>
        <div class="flex gap-1">
          <button
            v-for="opt in VIDEO_DURATION_OPTIONS"
            :key="opt.value"
            type="button"
            class="flex-1 rounded-md px-2 py-1 text-[10px] transition"
            :class="modelValue.duration === opt.value
              ? 'bg-[#6366f1]/30 text-[#818cf8]'
              : 'bg-white/5 text-white/60 hover:bg-white/10'"
            @click="patch({ duration: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-[10px] text-white/40">裁剪</p>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in VIDEO_CROP_OPTIONS"
            :key="opt.value"
            type="button"
            class="rounded-md px-2 py-1 text-[10px] transition"
            :class="modelValue.crop === opt.value
              ? 'bg-[#6366f1]/30 text-[#818cf8]'
              : 'bg-white/5 text-white/60 hover:bg-white/10'"
            @click="patch({ crop: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="mt-3 w-full rounded-lg py-1 text-[10px] text-white/40 hover:text-white/70"
        @click="patch(DEFAULT_VIDEO_SETTINGS)"
      >
        重置默认
      </button>
    </div>
  </div>
</template>
