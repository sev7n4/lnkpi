<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MiniMap } from '@vue-flow/minimap'
import { useVueFlow } from '@vue-flow/core'
import type { CanvasViewportSettings } from '@/composables/useCanvasViewportSettings'

const props = defineProps<{
  settings: CanvasViewportSettings
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>
}>()

const emit = defineEmits<{
  'update:settings': [patch: Partial<CanvasViewportSettings>]
  cycleMinimap: []
}>()

const { viewport, zoomTo, fitView } = useVueFlow()
const showGridPanel = ref(false)
const showListPanel = ref(false)
const showMinimapPopover = ref(false)

const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

const typeLabels: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  sceneComposer: '导演台',
  mediaInput: '媒体输入',
  videoComposition: '视频合成',
  worldModel: '3D World',
  shot: '分镜',
  group: '分组',
  prompt: '提示词',
}

const search = ref('')

const filteredNodes = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.nodes
  return props.nodes.filter((n) => {
    const data = n.data
    const label = String(data.title ?? data.prompt ?? data.content ?? n.id).toLowerCase()
    const type = String(n.type ?? '').toLowerCase()
    return label.includes(q) || type.includes(q)
  })
})

const groupedNodes = computed(() => {
  const map = new Map<string, typeof filteredNodes.value>()
  for (const node of filteredNodes.value) {
    const key = String(node.type ?? 'other')
    const bucket = map.get(key) ?? []
    bucket.push(node)
    map.set(key, bucket)
  }
  return [...map.entries()]
})

function patch(patch: Partial<CanvasViewportSettings>) {
  emit('update:settings', patch)
}

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

function focusNode(id: string) {
  void fitView({ nodes: [id], padding: 0.4, duration: 250, maxZoom: 1.1 })
  showListPanel.value = false
}

function nodeLabel(node: { id: string; type?: string; data: Record<string, unknown> }) {
  const data = node.data
  return String(data.title ?? data.prompt ?? data.content ?? node.id).slice(0, 36)
}

function miniMapNodeColor(node: { type?: string }) {
  const map: Record<string, string> = {
    text: 'rgba(125, 211, 252, 0.75)',
    image: 'rgba(110, 231, 183, 0.75)',
    video: 'rgba(167, 139, 250, 0.75)',
    audio: 'rgba(34, 211, 238, 0.75)',
    shot: 'rgba(129, 140, 248, 0.8)',
    group: 'rgba(192, 132, 252, 0.5)',
    prompt: 'rgba(129, 140, 248, 0.55)',
  }
  return map[String(node.type ?? '')] ?? 'rgba(255, 255, 255, 0.35)'
}

function onMapToggle() {
  emit('cycleMinimap')
}

const mapActive = computed(() => props.settings.minimapExpanded > 0)

watch(
  () => props.settings.minimapExpanded,
  (state) => {
    showListPanel.value = state === 2
    showMinimapPopover.value = state === 1
  },
  { immediate: true },
)
</script>

<template>
  <div class="canvas-bottom-toolbar relative w-max">
    <!-- 缩略图浮层 -->
    <div
      v-if="showMinimapPopover && settings.minimapExpanded === 1"
      class="minimap-popover pointer-events-auto absolute bottom-full left-0 mb-1.5 overflow-hidden rounded-xl border border-white/10 bg-[rgba(20,20,20,0.96)] shadow-xl backdrop-blur-md"
      @click.stop
    >
      <div class="minimap-popover-body">
        <MiniMap
          :pannable="true"
          :zoomable="true"
          :node-color="miniMapNodeColor"
          mask-color="rgba(99, 102, 241, 0.15)"
          mask-stroke-color="rgba(129, 140, 248, 0.7)"
          :mask-stroke-width="1.5"
          class="popover-minimap"
        />
      </div>
    </div>

    <!-- 列表浮层 -->
    <div
      v-if="showListPanel && settings.minimapExpanded === 2"
      class="list-popover pointer-events-auto absolute bottom-full left-0 mb-1.5 w-[200px] rounded-xl border border-white/10 bg-[rgba(20,20,20,0.96)] p-2 shadow-xl backdrop-blur-md"
      @click.stop
    >
      <input
        v-model="search"
        class="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[#6366f1]/40"
        placeholder="搜索节点..."
      >
      <div class="max-h-[220px] overflow-y-auto space-y-2">
        <div v-for="[type, items] in groupedNodes" :key="type">
          <p class="mb-0.5 text-[9px] uppercase tracking-wider text-white/30">
            {{ typeLabels[type] ?? type }} · {{ items.length }}
          </p>
          <button
            v-for="node in items"
            :key="node.id"
            type="button"
            class="mb-0.5 flex w-full rounded-lg px-2 py-1 text-left text-[11px] text-white/70 hover:bg-white/5"
            @click="focusNode(node.id)"
          >
            {{ nodeLabel(node) }}
          </button>
        </div>
      </div>
    </div>

    <!-- 单行底栏 -->
    <div class="toolbar-row pointer-events-auto flex flex-nowrap items-center gap-1 rounded-xl border border-white/10 bg-[rgba(20,20,20,0.94)] px-1.5 py-1 shadow-xl backdrop-blur-md">
      <!-- 小地图切换 -->
      <button
        type="button"
        class="bar-btn"
        :class="mapActive ? 'bg-[#6366f1]/15 text-[#818cf8]' : ''"
        title="小地图 / 列表"
        @click="onMapToggle"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A2 2 0 013 15.382V6.618a2 2 0 011.553-1.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A2 2 0 0021 18.382V9.618a2 2 0 00-1.553-1.894L15 5m0 14V5m0 0L9 2" />
        </svg>
      </button>

      <span class="toolbar-divider" />

      <!-- 缩放组：固定宽度，避免挤压重叠 -->
      <div class="zoom-group flex shrink-0 items-center gap-1">
        <button type="button" class="bar-btn" title="缩小" @click="zoomBy(-10)">−</button>
        <input
          type="range"
          class="zoom-slider"
          min="10"
          max="200"
          step="5"
          :value="zoomPercent"
          @input="onZoomInput"
        >
        <button type="button" class="bar-btn" title="放大" @click="zoomBy(10)">+</button>
        <span class="zoom-label">{{ zoomPercent }}%</span>
      </div>

      <span class="toolbar-divider" />

      <!-- 工具组 -->
      <div class="tool-group flex shrink-0 items-center gap-1">
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
            class="grid-settings-popover pointer-events-auto absolute bottom-full left-0 z-10 mb-1.5 w-[200px] rounded-xl border border-white/10 bg-[#242424] p-3 shadow-xl"
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
              间距 {{ settings.gridGap }}px
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
            <label class="mt-3 block text-[10px] text-white/40">
              Dock 缩放 {{ settings.bottomToolbarScale.toFixed(1) }}x
              <input
                type="range"
                min="0.8"
                max="2"
                step="0.1"
                class="mt-1 w-full accent-[#6366f1]"
                :value="settings.bottomToolbarScale"
                @input="patch({ bottomToolbarScale: Number(($event.target as HTMLInputElement).value) })"
              >
            </label>
          </div>
        </div>

        <button
          type="button"
          class="bar-btn"
          :class="settings.snapToGrid ? 'bg-[#6366f1]/20 text-[#818cf8]' : ''"
          title="节点吸附网格"
          @click="patch({ snapToGrid: !settings.snapToGrid })"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
          </svg>
        </button>

        <button
          type="button"
          class="bar-btn"
          :class="settings.edgeAnimated ? 'bg-[#6366f1]/20 text-[#818cf8]' : ''"
          title="连线动画"
          @click="patch({ edgeAnimated: !settings.edgeAnimated })"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        <button
          type="button"
          class="bar-btn"
          :class="settings.viewLocked ? 'bg-amber-500/20 text-amber-300' : ''"
          title="锁定视图"
          @click="patch({ viewLocked: !settings.viewLocked })"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path v-if="settings.viewLocked" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-row {
  height: 36px;
}

.toolbar-divider {
  @apply mx-0.5 h-4 w-px shrink-0 bg-white/10;
}

.bar-btn {
  @apply flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm leading-none text-white/55 transition hover:bg-white/10 hover:text-white;
}

.zoom-group {
  width: 148px;
}

.zoom-slider {
  width: 64px;
  flex-shrink: 0;
  accent-color: #6366f1;
  height: 4px;
  margin: 0;
}

.zoom-label {
  @apply w-8 shrink-0 text-center text-[10px] tabular-nums text-white/50;
}

.minimap-popover-body {
  width: 156px;
  height: 100px;
}

:deep(.popover-minimap) {
  width: 156px !important;
  height: 100px !important;
  margin: 0 !important;
  background: rgba(255, 255, 255, 0.03) !important;
  border: none !important;
  border-radius: 0 !important;
}

:deep(.popover-minimap .vue-flow__minimap-node) {
  fill-opacity: 1 !important;
}
</style>
