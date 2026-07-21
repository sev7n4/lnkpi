<script setup lang="ts">
import { computed, ref } from 'vue'
import { AUDIO_VOICE_OPTIONS, DEFAULT_AUDIO_VOICE } from '@/constants/dockAudio'
import type { StudioVoiceOption } from '@/constants/studioModels'
import { useClickOutside } from '@/composables/useClickOutside'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    voices?: StudioVoiceOption[]
  }>(),
  {
    voices: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => {
  open.value = false
})

const voiceOptions = computed(() =>
  props.voices?.length ? props.voices : AUDIO_VOICE_OPTIONS,
)

const current = computed(
  () => voiceOptions.value.find((v) => v.id === props.modelValue) ?? voiceOptions.value[0],
)

function select(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="neo-ctl flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
      title="音色"
      @click="open = !open"
    >
      <DockTypeIcon icon="audio" :size="12" class="opacity-60" />
      <span class="max-w-[88px] truncate font-medium">{{ current?.label ?? DEFAULT_AUDIO_VOICE }}</span>
    </button>
    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 min-w-[160px] neo-popover rounded-xl py-1"
      @click.stop
    >
      <button
        v-for="voice in voiceOptions"
        :key="voice.id"
        type="button"
        class="neo-popover-item flex w-full px-3 py-2 text-xs"
        :class="voice.id === modelValue ? '!text-[var(--neo-accent-text)]' : ''"
        @click="select(voice.id)"
      >
        {{ voice.label }}
      </button>
    </div>
  </div>
</template>
