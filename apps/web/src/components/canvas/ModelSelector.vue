<script setup lang="ts">
import { ref } from 'vue'
import { TEXT_MODELS, IMAGE_MODELS, VIDEO_MODELS, type GenerationType } from '@lnkpi/shared'

const props = defineProps<{
  modelValue: string
  type: GenerationType
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)

const models = {
  text: TEXT_MODELS,
  image: IMAGE_MODELS,
  video: VIDEO_MODELS,
}

const currentModels = models[props.type]
const current = currentModels.find((m) => m.id === props.modelValue) ?? currentModels[0]

function select(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="neo-ctl flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
      @click="open = !open"
    >
      <span class="opacity-60">{{ type === 'text' ? '文本' : type === 'image' ? '图像' : '视频' }}</span>
      <span class="font-medium">{{ current.name }}</span>
      <svg class="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 min-w-[180px] neo-popover rounded-xl py-1"
    >
      <button
        v-for="model in currentModels"
        :key="model.id"
        class="neo-popover-item flex w-full items-center justify-between px-3 py-2 text-xs"
        :class="model.id === modelValue ? 'text-brand-400' : 'text-white/70'"
        @click="select(model.id)"
      >
        <span>{{ model.name }}</span>
        <span class="opacity-45">{{ model.provider }}</span>
      </button>
    </div>
  </div>
</template>
