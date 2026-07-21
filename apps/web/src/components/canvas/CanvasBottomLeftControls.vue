<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MiniMap } from '@vue-flow/minimap'
import { useVueFlow } from '@vue-flow/core'
import { useClickOutside } from '@/composables/useClickOutside'
import type { CanvasViewportSettings } from '@/composables/useCanvasViewportSettings'

const props = defineProps<{
  settings: CanvasViewportSettings
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>
}>()

const emit = defineEmits<{
  'update:settings': [patch: Partial<CanvasViewportSettings>]
  cycleMinimap: []
}>()

const { viewport, zoomTo, fitView, nodes: flowNodes, setCenter } = useVueFlow()
const showGridPanel = ref(false)
const showListPanel = ref(false)
const showMinimapPopover = ref(false)
const minimapBodyRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)

useClickOutside(rootRef, () => {
  showGridPanel.value = false
  if (props.settings.minimapExpanded !== 0) {
    emit('update:settings', { minimapExpanded: 0 })
  }
})

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

function onMinimapClick(event: MouseEvent) {
  const el = minimapBodyRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const mapNodes = flowNodes.value.filter((n) => !n.hidden)
  if (!mapNodes.length) return

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of mapNodes) {
    const w = node.dimensions?.width || 280
    const h = node.dimensions?.height || 160
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + w)
    maxY = Math.max(maxY, node.position.y + h)
  }

  const pad = 40
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  const worldW = Math.max(1, maxX - minX)
  const worldH = Math.max(1, maxY - minY)

  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const flowX = minX + (localX / rect.width) * worldW
  const flowY = minY + (localY / rect.height) * worldH

  let bestId: string | null = null
  let bestDist = Infinity
  for (const node of mapNodes) {
    const w = node.dimensions?.width || 280
    const h = node.dimensions?.height || 160
    const cx = node.position.x + w / 2
    const cy = node.position.y + h / 2
    const inside =
      flowX >= node.position.x &&
      flowX <= node.position.x + w &&
      flowY >= node.position.y &&
      flowY <= node.position.y + h
    const dist = Math.hypot(flowX - cx, flowY - cy)
    if (inside || dist < Math.min(w, h) * 0.6) {
      if (dist < bestDist) {
        bestDist = dist
        bestId = node.id
      }
    }
  }

  if (bestId) {
    focusNode(bestId)
    return
  }

  void setCenter(flowX, flowY, { zoom: viewport.value.zoom, duration: 250 })
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
  <div ref="rootRef" class="canvas-bottom-toolbar relative w-max">
    <!-- 缩略图浮层 -->
    <div
      v-if="showMinimapPopover && settings.minimapExpanded === 1"
      class="minimap-popover neo-popover pointer-events-auto absolute bottom-full left-0 mb-1.5 overflow-hidden rounded-xl"
      @click.stop
    >
      <div
        ref="minimapBodyRef"
        class="minimap-popover-body"
        @click.stop="onMinimapClick"
      >
        <MiniMap
          :pannable="true"
          :zoomable="true"
          :node-color="miniMapNodeColor"
          mask-color="rgba(109, 93, 252, 0.14)"
          mask-stroke-color="rgba(138, 125, 255, 0.7)"
          :mask-stroke-width="1.5"
          class="popover-minimap"
        />
      </div>
    </div>

    <!-- 列表浮层 -->
    <div
      v-if="showListPanel && settings.minimapExpanded === 2"
      class="list-popover neo-popover pointer-events-auto absolute bottom-full left-0 mb-1.5 w-[200px] rounded-xl p-2"
      @click.stop
    >
      <input
        v-model="search"
        class="list-search mb-2 w-full rounded-lg px-2 py-1.5 text-xs outline-none"
        placeholder="搜索节点..."
      >
      <div class="max-h-[220px] overflow-y-auto space-y-2">
        <div v-for="[type, items] in groupedNodes" :key="type">
          <p class="list-caption mb-0.5 text-[9px] uppercase tracking-wider">
            {{ typeLabels[type] ?? type }} · {{ items.length }}
          </p>
          <button
            v-for="node in items"
            :key="node.id"
            type="button"
            class="neo-popover-item mb-0.5 flex w-full rounded-lg px-2 py-1 text-left text-[11px]"
            @click="focusNode(node.id)"
          >
            {{ nodeLabel(node) }}
          </button>
        </div>
      </div>
    </div>

    <!-- 单行底栏 -->
    <div class="toolbar-row neo-glass-lite pointer-events-auto flex flex-nowrap items-center gap-1 rounded-xl px-1.5 py-1">
      <!-- 小地图切换 -->
      <button
        type="button"
        class="bar-btn"
        :class="mapActive ? 'is-accent' : ''"
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
            :class="showGridPanel ? 'is-accent' : ''"
            title="网格设置"
            @click="showGridPanel = !showGridPanel"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16M8 4v16M16 4v16" />
            </svg>
          </button>
          <div
            v-if="showGridPanel"
            class="grid-settings-popover neo-popover pointer-events-auto absolute bottom-full left-0 z-10 mb-1.5 w-[200px] rounded-xl p-3"
            @click.stop
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="panel-label text-xs">网格底纹</span>
              <button
                type="button"
                class="seg-btn rounded-md px-2 py-0.5 text-[10px]"
                :class="settings.gridVisible ? 'is-on' : ''"
                @click="patch({ gridVisible: !settings.gridVisible })"
              >
                {{ settings.gridVisible ? '显示' : '隐藏' }}
              </button>
            </div>
            <div class="mb-3 flex gap-1">
              <button
                type="button"
                class="seg-btn flex-1 rounded-lg py-1 text-[10px]"
                :class="settings.gridVariant === 'dots' ? 'is-on' : ''"
                @click="patch({ gridVariant: 'dots' })"
              >
                点阵
              </button>
              <button
                type="button"
                class="seg-btn flex-1 rounded-lg py-1 text-[10px]"
                :class="settings.gridVariant === 'lines' ? 'is-on' : ''"
                @click="patch({ gridVariant: 'lines' })"
              >
                线格
              </button>
            </div>
            <label class="panel-caption mb-2 block text-[10px]">
              间距 {{ settings.gridGap }}px
              <input
                type="range"
                min="8"
                max="48"
                step="2"
                class="mt-1 w-full accent-[var(--neo-slider-accent)]"
                :value="settings.gridGap"
                @input="patch({ gridGap: Number(($event.target as HTMLInputElement).value) })"
              >
            </label>
            <label class="panel-caption block text-[10px]">
              点大小 {{ settings.gridDotSize.toFixed(1) }}
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.1"
                class="mt-1 w-full accent-[var(--neo-slider-accent)]"
                :value="settings.gridDotSize"
                @input="patch({ gridDotSize: Number(($event.target as HTMLInputElement).value) })"
              >
            </label>
            <label class="panel-caption mt-3 block text-[10px]">
              Dock 缩放 {{ settings.bottomToolbarScale.toFixed(1) }}x
              <input
                type="range"
                min="0.8"
                max="2"
                step="0.1"
                class="mt-1 w-full accent-[var(--neo-slider-accent)]"
                :value="settings.bottomToolbarScale"
                @input="patch({ bottomToolbarScale: Number(($event.target as HTMLInputElement).value) })"
              >
            </label>
          </div>
        </div>

        <button
          type="button"
          class="bar-btn"
          :class="settings.snapToGrid ? 'is-accent' : ''"
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
          :class="settings.edgeAnimated ? 'is-accent' : ''"
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
  @apply mx-0.5 h-4 w-px shrink-0;
  background: var(--neo-border);
}

.bar-btn {
  @apply flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm leading-none transition;
  color: var(--neo-text-muted);
}

.bar-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.bar-btn.is-accent {
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

.list-search {
  border: 1px solid var(--neo-border);
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.list-search:focus {
  border-color: var(--neo-accent-border);
}

.list-search::placeholder {
  color: var(--neo-text-muted);
}

.list-caption,
.panel-caption {
  color: var(--neo-text-muted);
}

.panel-label {
  color: var(--neo-text-secondary);
}

.seg-btn {
  background: var(--neo-hover-bg);
  color: var(--neo-text-muted);
  transition: background 0.15s ease, color 0.15s ease;
}

.seg-btn:hover {
  background: var(--neo-active-bg);
}

.seg-btn.is-on {
  background: var(--neo-accent-soft);
  color: var(--neo-accent-text);
}

.zoom-group {
  width: 148px;
}

.zoom-slider {
  width: 64px;
  flex-shrink: 0;
  accent-color: var(--neo-slider-accent);
  height: 4px;
  margin: 0;
}

.zoom-label {
  @apply w-8 shrink-0 text-center text-[10px] tabular-nums;
  color: var(--neo-text-muted);
}

.minimap-popover-body {
  width: 156px;
  height: 100px;
}

:deep(.popover-minimap) {
  width: 156px !important;
  height: 100px !important;
  margin: 0 !important;
  background: var(--neo-hover-bg) !important;
  border: none !important;
  border-radius: 0 !important;
}

:deep(.popover-minimap .vue-flow__minimap-node) {
  fill-opacity: 1 !important;
}
</style>
