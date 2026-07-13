<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { CanvasViewportSettings } from '@/composables/useCanvasViewportSettings'

const props = withDefaults(
  defineProps<{
    settings: CanvasViewportSettings
    compact?: boolean
  }>(),
  { compact: false },
)

const emit = defineEmits<{
  'update:settings': [patch: Partial<CanvasViewportSettings>]
  cycleMinimap: []
}>()

const { viewport, zoomTo, fitView } = useVueFlow()
const showGridPanel = ref(false)

const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

function onZoomInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  void zoomTo(value / 100, { duration: 120 })
}

function zoomBy(delta: number) {
  const next = Math.min(200, Math.max(10, zoomPercent.value + delta))
  void zoomTo(next / 100, { duration: 120 })
}

function resetView() {
  void fitView({ padding: 0.2, duration: 200 })
}

function patch(patch: Partial<CanvasViewportSettings>) {
  emit('update:settings', patch)
}
</script>

<template>
  <div
    class="canvas-zoom-bar flex items-center gap-0.5 rounded-xl border border-white/10 bg-[rgba(20,20,20,0.92)] shadow-xl backdrop-blur-md"
    :class="props.compact ? 'w-full flex-wrap p-0.5' : 'gap-1 p-1'"
  >
    <button type="button" class="bar-btn" title="缩小" @click="zoomBy(-10)">−</button>

    <div class="flex min-w-0 flex-1 items-center gap-1 px-0.5" :class="props.compact ? 'min-w-[72px]' : 'min-w-[120px] px-1'">
      <input
        type="range"
        class="zoom-slider flex-1"
        min="10"
        max="200"
        step="5"
        :value="zoomPercent"
        @input="onZoomInput"
      >
      <span class="w-8 shrink-0 text-center text-[9px] tabular-nums text-white/55">{{ zoomPercent }}%</span>
    </div>

    <button type="button" class="bar-btn" title="放大" @click="zoomBy(10)">+</button>

    <span class="mx-0.5 hidden h-4 w-px bg-white/10 sm:block" />

    <button type="button" class="bar-btn" title="适应画布" @click="resetView">
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
      </svg>
    </button>

    <div class="relative">
      <button
        type="button"
        class="bar-btn"
        :class="showGridPanel ? 'bg-white/10 text-white' : ''"
        title="网格设置"
        @click="showGridPanel = !showGridPanel"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16M8 4v16M16 4v16" />
        </svg>
      </button>

      <div
        v-if="showGridPanel"
        class="grid-settings-popover absolute bottom-full left-0 mb-2 w-[200px] rounded-xl border border-white/10 bg-[#242424] p-3 shadow-xl"
        @click.stop
      >
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs text-white/80">网格底纹</span>
          <button
            type="button"
            class="rounded-md px-2 py-0.5 text-[10px]"
            :class="settings.gridVisible ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/40'"
            @click="patch({ gridVisible: !settings.gridVisible })"
          >
            {{ settings.gridVisible ? '显示' : '隐藏' }}
          </button>
        </div>

        <div class="mb-3 flex gap-1">
          <button
            type="button"
            class="flex-1 rounded-lg py-1 text-[10px]"
            :class="settings.gridVariant === 'dots' ? 'bg-[#6366f1]/25 text-[#818cf8]' : 'bg-white/5 text-white/50'"
            @click="patch({ gridVariant: 'dots' })"
          >
            点阵
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg py-1 text-[10px]"
            :class="settings.gridVariant === 'lines' ? 'bg-[#6366f1]/25 text-[#818cf8]' : 'bg-white/5 text-white/50'"
            @click="patch({ gridVariant: 'lines' })"
          >
            线格
          </button>
        </div>

        <label class="mb-2 block text-[10px] text-white/40">
          网格间距 {{ settings.gridGap }}px
          <input
            type="range"
            min="8"
            max="48"
            step="2"
            class="mt-1 w-full"
            :value="settings.gridGap"
            @input="patch({ gridGap: Number(($event.target as HTMLInputElement).value) })"
          >
        </label>

        <label class="block text-[10px] text-white/40">
          点大小 {{ settings.gridDotSize.toFixed(1) }}
          <input
            type="range"
            min="0.5"
            max="4"
            step="0.1"
            class="mt-1 w-full"
            :value="settings.gridDotSize"
            @input="patch({ gridDotSize: Number(($event.target as HTMLInputElement).value) })"
          >
        </label>
      </div>
    </div>

    <span class="mx-0.5 h-4 w-px bg-white/10" />

    <button
      type="button"
      class="bar-btn flex gap-0.5 px-1"
      :class="settings.minimapExpanded === 0 ? 'text-white/30' : 'text-[#818cf8]'"
      :title="`小地图：${settings.minimapExpanded === 0 ? '隐藏' : settings.minimapExpanded === 1 ? '缩略图' : '列表'}`"
      @click="emit('cycleMinimap')"
    >
      <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A2 2 0 013 15.382V6.618a2 2 0 011.553-1.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A2 2 0 0021 18.382V9.618a2 2 0 00-1.553-1.894L15 5m0 14V5m0 0L9 2" />
      </svg>
      <span v-if="!props.compact" class="text-[9px]">{{ settings.minimapExpanded === 0 ? '地图' : settings.minimapExpanded === 1 ? '图' : '列表' }}</span>
    </button>
  </div>
</template>

<style scoped>
.bar-btn {
  @apply flex h-6 w-6 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white;
}

.zoom-slider {
  accent-color: #6366f1;
  height: 4px;
}
</style>
