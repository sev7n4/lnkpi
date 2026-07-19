<script setup lang="ts">
import { ref } from 'vue'
import { useClickOutside } from '@/composables/useClickOutside'
import {
  AUDIO_EMOTION_OPTIONS,
  AUDIO_LANGUAGE_OPTIONS,
  DEFAULT_AUDIO_EMOTION,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_AUDIO_PITCH,
  DEFAULT_AUDIO_SPEED,
  DEFAULT_AUDIO_VOLUME,
  type AudioVoiceSettings,
} from '@/constants/dockAudio'

const props = withDefaults(
  defineProps<{
    modelValue: AudioVoiceSettings
  }>(),
  {
    modelValue: () => ({
      emotion: DEFAULT_AUDIO_EMOTION,
      language: DEFAULT_AUDIO_LANGUAGE,
      speed: DEFAULT_AUDIO_SPEED,
      volume: DEFAULT_AUDIO_VOLUME,
      pitch: DEFAULT_AUDIO_PITCH,
    }),
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: AudioVoiceSettings]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => {
  open.value = false
})

function patch(partial: Partial<AudioVoiceSettings>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function bumpSpeed(delta: number) {
  const next = Math.min(2, Math.max(0.5, Number((props.modelValue.speed + delta).toFixed(1))))
  patch({ speed: next })
}

function bumpVolume(delta: number) {
  const next = Math.min(2, Math.max(0.1, Number((props.modelValue.volume + delta).toFixed(1))))
  patch({ volume: next })
}

function bumpPitch(delta: number) {
  const next = Math.min(12, Math.max(-12, props.modelValue.pitch + delta))
  patch({ pitch: next })
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs transition hover:bg-white/10"
      title="语音参数"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-white/50">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
      <span class="font-medium">
        {{ AUDIO_EMOTION_OPTIONS.find(e => e.value === modelValue.emotion)?.label }}
        ·
        {{ AUDIO_LANGUAGE_OPTIONS.find(l => l.value === modelValue.language)?.label }}
        ·
        {{ modelValue.speed.toFixed(1) }}x
      </span>
    </button>
    <div
      v-if="open"
      class="absolute bottom-full right-0 z-50 mb-1 w-[220px] rounded-xl border border-white/10 bg-[#242424] p-3 shadow-xl"
      @click.stop
    >
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">情感</p>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in AUDIO_EMOTION_OPTIONS"
            :key="opt.value"
            type="button"
            class="rounded-md px-2 py-1 text-[10px] transition"
            :class="modelValue.emotion === opt.value ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/60'"
            @click="patch({ emotion: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">语言</p>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in AUDIO_LANGUAGE_OPTIONS"
            :key="opt.value"
            type="button"
            class="rounded-md px-2 py-1 text-[10px] transition"
            :class="modelValue.language === opt.value ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/60'"
            @click="patch({ language: opt.value })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">语速 {{ modelValue.speed.toFixed(1) }}x</p>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"
            @click="bumpSpeed(-0.1)"
          >
            −
          </button>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            :value="modelValue.speed"
            class="min-w-0 flex-1 accent-[#6366f1]"
            @input="patch({ speed: Number(($event.target as HTMLInputElement).value) })"
          >
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"
            @click="bumpSpeed(0.1)"
          >
            +
          </button>
        </div>
      </div>
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-white/40">音量 {{ modelValue.volume.toFixed(1) }}</p>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"
            @click="bumpVolume(-0.1)"
          >
            −
          </button>
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.1"
            :value="modelValue.volume"
            class="min-w-0 flex-1 accent-[#6366f1]"
            @input="patch({ volume: Number(($event.target as HTMLInputElement).value) })"
          >
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"
            @click="bumpVolume(0.1)"
          >
            +
          </button>
        </div>
      </div>
      <div>
        <p class="mb-1.5 text-[10px] text-white/40">音调 {{ modelValue.pitch > 0 ? '+' : '' }}{{ modelValue.pitch }}</p>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"
            @click="bumpPitch(-1)"
          >
            −
          </button>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            :value="modelValue.pitch"
            class="min-w-0 flex-1 accent-[#6366f1]"
            @input="patch({ pitch: Number(($event.target as HTMLInputElement).value) })"
          >
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white/80"
            @click="bumpPitch(1)"
          >
            +
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
