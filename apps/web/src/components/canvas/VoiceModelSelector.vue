<script setup lang="ts">
import { computed, ref } from 'vue'
import { AUDIO_VOICE_OPTIONS, DEFAULT_AUDIO_VOICE } from '@/constants/dockAudio'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)

const current = computed(
  () => AUDIO_VOICE_OPTIONS.find((v) => v.id === props.modelValue) ?? AUDIO_VOICE_OPTIONS[0],
)

function select(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs transition hover:bg-white/10"
      @click="open = !open"
    >
      <span class="text-white/50">音色</span>
      <span class="max-w-[88px] truncate font-medium">{{ current?.label ?? DEFAULT_AUDIO_VOICE }}</span>
    </button>
    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 min-w-[160px] rounded-xl border border-white/10 bg-[#242424] py-1 shadow-xl"
      @click.stop
    >
      <button
        v-for="voice in AUDIO_VOICE_OPTIONS"
        :key="voice.id"
        type="button"
        class="flex w-full px-3 py-2 text-xs transition hover:bg-white/5"
        :class="voice.id === modelValue ? 'text-[#818cf8]' : 'text-white/70'"
        @click="select(voice.id)"
      >
        {{ voice.label }}
      </button>
    </div>
  </div>
</template>
