<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GenerationType } from '@lnkpi/shared'
import { decodeChannelModel, modelOptionName } from '@lnkpi/shared'
import { type StudioModality } from '@/constants/studioModels'
import { useClickOutside } from '@/composables/useClickOutside'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import type { DockNodeIconKind } from '@/components/canvas/dock-studio/shared/dockIcons'

export type SelectorModelOption = {
  id: string
  name: string
  channelName: string
  disabled?: boolean
}

const props = defineProps<{
  modelValue: string
  type: GenerationType
  /** Override catalog modality (e.g. audio when type is not in GenerationType) */
  modality?: StudioModality
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => {
  open.value = false
})

const { preferences, allChannels } = useProviderBootstrap()

const catalogModality = computed((): StudioModality => props.modality ?? props.type)

function selectableForModality(modality: StudioModality): string[] {
  const prefs = preferences.value
  if (!prefs) return []
  if (modality === 'image') return prefs.selectableImageModels
  if (modality === 'video') return prefs.selectableVideoModels
  if (modality === 'audio') return prefs.selectableAudioModels
  return prefs.selectableTextModels
}

function channelNameForValue(value: string): string {
  const decoded = decodeChannelModel(value)
  if (!decoded) return '未知渠道'
  const ch = allChannels.value.find((c) => c.id === decoded.channelId)
  return ch?.name || decoded.channelId
}

function labelForValue(value: string): string {
  return `${modelOptionName(value)}（${channelNameForValue(value)}）`
}

const selectableOptions = computed((): SelectorModelOption[] => {
  return selectableForModality(catalogModality.value).map((id) => ({
    id,
    name: modelOptionName(id),
    channelName: channelNameForValue(id),
  }))
})

const current = computed((): SelectorModelOption | undefined => {
  const found = selectableOptions.value.find((m) => m.id === props.modelValue)
  if (found) return found
  if (props.modelValue) {
    return {
      id: props.modelValue,
      name: modelOptionName(props.modelValue),
      channelName: channelNameForValue(props.modelValue),
      disabled: true,
    }
  }
  return selectableOptions.value[0]
})

const currentLabel = computed(() => {
  if (!current.value) return '...'
  const base = `${current.value.name}（${current.value.channelName}）`
  return current.value.disabled ? `${base} · 已停用` : base
})

const typeIcon = computed((): DockNodeIconKind => {
  const m = catalogModality.value
  if (m === 'image') return 'image'
  if (m === 'video') return 'video'
  if (m === 'audio') return 'audio'
  return 'text'
})

const typeTitle = computed(() => {
  const m = catalogModality.value
  if (m === 'text') return '文本模型'
  if (m === 'image') return '图像模型'
  if (m === 'video') return '视频模型'
  if (m === 'audio') return '音频模型'
  return '模型'
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
      <span class="max-w-[140px] truncate font-medium" :class="current?.disabled ? 'text-amber-300/90' : ''">
        {{ currentLabel }}
      </span>
      <svg class="h-3 w-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-1 min-w-[220px] rounded-xl border border-white/10 bg-[#242424] py-1 shadow-xl"
      @click.stop
    >
      <button
        v-if="current?.disabled"
        type="button"
        class="flex w-full items-center justify-between px-3 py-2 text-xs text-amber-300/90"
        disabled
      >
        <span class="truncate">{{ labelForValue(current.id) }}</span>
        <span class="ml-2 shrink-0 text-amber-300/60">已停用</span>
      </button>
      <button
        v-for="model in selectableOptions"
        :key="model.id"
        type="button"
        class="flex w-full items-center justify-between px-3 py-2 text-xs transition hover:bg-white/5"
        :class="model.id === modelValue ? 'text-[#818cf8]' : 'text-white/70'"
        @click="select(model.id)"
      >
        <span class="truncate">{{ model.name }}</span>
        <span class="ml-2 shrink-0 text-white/30">{{ model.channelName }}</span>
      </button>
      <p v-if="!selectableOptions.length" class="px-3 py-2 text-[11px] text-white/40">
        暂无可选模型，请先在配置中设置
      </p>
    </div>
  </div>
</template>
