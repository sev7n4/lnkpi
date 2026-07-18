<script setup lang="ts">
import { ref } from 'vue'

export type ImageResolution = '1K' | '2K' | '4K'

defineProps<{
  modelValue: ImageResolution
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ImageResolution]
}>()

const open = ref(false)
const options: ImageResolution[] = ['1K', '2K', '4K']
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs transition hover:bg-white/10"
      title="分辨率"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-white/50">
        <path d="M4 8V4h4M16 4h4v4M4 16v4h4M16 20h4v-4" />
      </svg>
      <span class="font-medium">{{ modelValue }}</span>
    </button>
    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 flex gap-1 rounded-xl border border-white/10 bg-[#242424] p-1.5 shadow-xl"
      @click.stop
    >
      <button
        v-for="opt in options"
        :key="opt"
        type="button"
        class="rounded-md px-2 py-1 text-[10px] transition"
        :class="modelValue === opt ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/60'"
        @click="emit('update:modelValue', opt); open = false"
      >
        {{ opt }}
      </button>
    </div>
  </div>
</template>
