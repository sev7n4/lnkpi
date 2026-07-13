<script setup lang="ts">
import { ref } from 'vue'
import {
  AUDIO_EMOTION_OPTIONS,
  AUDIO_LANGUAGE_OPTIONS,
  DEFAULT_AUDIO_EMOTION,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_AUDIO_SPEED,
  type AudioEmotion,
  type AudioLanguage,
} from '@/constants/dockAudio'

export interface AudioVoiceSettings {
  emotion: AudioEmotion
  language: AudioLanguage
  speed: number
}

const props = withDefaults(
  defineProps<{
    modelValue: AudioVoiceSettings
  }>(),
  {
    modelValue: () => ({
      emotion: DEFAULT_AUDIO_EMOTION,
      language: DEFAULT_AUDIO_LANGUAGE,
      speed: DEFAULT_AUDIO_SPEED,
    }),
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: AudioVoiceSettings]
}>()

const open = ref(false)

function patch(partial: Partial<AudioVoiceSettings>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs transition hover:bg-white/10"
      @click="open = !open"
    >
      <span class="text-white/50">语音</span>
      <span class="font-medium">
        {{ modelValue.speed }}x · {{ AUDIO_LANGUAGE_OPTIONS.find(l => l.value === modelValue.language)?.label }}
      </span>
    </button>
    <div
      v-if="open"
      class="absolute bottom-full right-0 z-50 mb-1 w-[200px] rounded-xl border border-white/10 bg-[#242424] p-3 shadow-xl"
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
      <div>
        <p class="mb-1.5 text-[10px] text-white/40">语速 {{ modelValue.speed.toFixed(1) }}x</p>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          :value="modelValue.speed"
          class="w-full accent-[#6366f1]"
          @input="patch({ speed: Number(($event.target as HTMLInputElement).value) })"
        >
      </div>
    </div>
  </div>
</template>
