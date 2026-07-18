<script setup lang="ts">
import { ref } from 'vue'

export type ImageAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'

defineProps<{
  modelValue: ImageAspectRatio
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ImageAspectRatio]
}>()

const open = ref(false)

const options: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '21:9', label: '21:9' },
]
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs transition hover:bg-white/10"
      title="画面比例"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-white/50">
        <rect x="3" y="5" width="18" height="14" rx="2" />
      </svg>
      <span class="font-medium">{{ modelValue }}</span>
    </button>
    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 flex max-w-[220px] flex-wrap gap-1 rounded-xl border border-white/10 bg-[#242424] p-1.5 shadow-xl"
      @click.stop
    >
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="rounded-md px-2 py-1 text-[10px] transition"
        :class="modelValue === opt.value ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/60'"
        @click="emit('update:modelValue', opt.value); open = false"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>
