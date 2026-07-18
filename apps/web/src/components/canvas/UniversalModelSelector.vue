<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GenerationType } from '@lnkpi/shared'
import { useCapabilities } from '@/composables/useCapabilities'
import { useClickOutside } from '@/composables/useClickOutside'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import type { DockNodeIconKind } from '@/components/canvas/dock-studio/shared/dockIcons'

const props = defineProps<{
  modelValue: string
  type: GenerationType
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { modelsFor, loading } = useCapabilities()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => {
  open.value = false
})

const models = computed(() => modelsFor(props.type))
const current = computed(() => {
  const found = models.value.find((m) => m.id === props.modelValue)
  if (found) return found
  if (props.modelValue) {
    return { id: props.modelValue, name: props.modelValue, provider: '自定义' }
  }
  return models.value[0]
})

const typeIcon = computed((): DockNodeIconKind => {
  if (props.type === 'image') return 'image'
  if (props.type === 'video') return 'video'
  return 'text'
})

const typeTitle = computed(() => {
  if (props.type === 'text') return '文本模型'
  if (props.type === 'image') return '图像模型'
  return '视频模型'
})

function select(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs transition hover:bg-white/10"
      :title="typeTitle"
      @click="open = !open"
    >
      <DockTypeIcon :icon="typeIcon" :size="13" class="text-white/55" />
      <span class="max-w-[110px] truncate font-medium">{{ current?.name ?? '...' }}</span>
      <span v-if="loading" class="text-[9px] text-white/30">…</span>
      <svg class="h-3 w-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] rounded-xl border border-white/10 bg-[#242424] py-1 shadow-xl"
      @click.stop
    >
      <button
        v-for="model in models"
        :key="model.id"
        type="button"
        class="flex w-full items-center justify-between px-3 py-2 text-xs transition hover:bg-white/5"
        :class="model.id === modelValue ? 'text-[#818cf8]' : 'text-white/70'"
        @click="select(model.id)"
      >
        <span>{{ model.name }}</span>
        <span class="text-white/30">{{ model.provider }}</span>
      </button>
    </div>
  </div>
</template>
