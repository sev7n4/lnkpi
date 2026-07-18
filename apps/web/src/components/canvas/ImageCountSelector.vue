<script setup lang="ts">
export type ImageCount = 1 | 2 | 4

defineProps<{
  modelValue: ImageCount
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ImageCount]
}>()

const options: ImageCount[] = [1, 2, 4]
</script>

<template>
  <div class="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5" title="生成张数">
    <button
      v-for="opt in options"
      :key="opt"
      type="button"
      class="min-w-[26px] rounded-md px-1.5 py-1 text-[10px] transition"
      :class="modelValue === opt ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/50 hover:text-white/80'"
      @click="emit('update:modelValue', opt)"
    >
      ×{{ opt }}
    </button>
  </div>
</template>
