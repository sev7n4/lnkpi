<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import type { CropRect } from './refine/cropGeometry'
import { studioApi } from '@/services/studio-api'
import {
  coverDisplayMapper,
  elementEditShapeBBox,
  nextElementEditId,
  pointRectAt,
  type ElementEditItem,
  type ElementEditShape,
} from './elementEditModel'
import ElementChipRow from './refine/ElementChipRow.vue'
import { CANVAS_GENERATE_CREDITS } from '@lnkpi/shared'

/**
 * 节点直出元素编辑（2026-09-25 用户需求重做版）：
 * 单击图片节点 → 浮层「元素编辑」→
 *  - 上沿工具条：[✕ 元素编辑] [📍定位] [◎焦点] [⬚选区] [✏️画笔] [↺撤销]；
 *  - 焦点选择（核心）：点击图上元素 → 调 /studio/element-recognize（SAM 分割 + 识图命名）
 *    → 结果以小芯片条嵌入底部「编辑内容」卡（缩略图 + 可二次编辑对象名 + 【修改】输入）；
 *  - 矩形/画笔：直接成芯片（名默认「选区」），同样在芯片条内补修改内容；
 *  - 多轮点击多芯片累积，【⚡生成】一次完成多组修改 → image/edit mode:'inpaint' 下游新节点；
 *  - 撤销：移除最后一枚芯片（识别中芯片先中断请求）。
 */
const props = defineProps<{
  node: { id: string; type?: string | null; data?: Record<string, unknown> }
  url: string
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: { items: ElementEditItem[] }]
  cancel: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const TOOLBAR_GAP_PX = 8
const TOOLBAR_ESTIMATED_H = 40

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const natural = ref<{ w: number; h: number } | null>(null)
const loadToken = ref(0)

type Tool = 'locate' | 'point' | 'rect' | 'brush'
const tool = ref<Tool>('point')
const brushSize = ref(24)

/** 芯片（编辑项）；recognizing 的芯片由识别请求回填 */
const items = ref<ElementEditItem[]>([])
/** 当前高亮项 id（定位循环用） */
const highlightedId = ref<string | null>(null)
/** 定位循环游标 */
let locateCursor = -1
/** 焦点识别请求（撤销/退出时中断） */
let recognizeAbort: AbortController | null = null

/** 矩形拖拽中 */
const drawingRect = ref<CropRect | null>(null)
/** 笔画绘制中 */
const liveStroke = ref<{ points: { x: number; y: number }[]; size: number } | null>(null)
let dragStart: { x: number; y: number } | null = null

const toolbarAbove = ref(true)

const canGenerate = computed(
  () => !props.busy && items.value.length > 0 && items.value.every((it) => !it.recognizing) && items.value.some((it) => it.modify.trim().length > 0),
)
const undoDisabled = computed(() => props.busy || items.value.length === 0)

// —— 几何 ——
const stageStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  return { left: `${abs.value.x}px`, top: `${abs.value.y}px`, width: `${box.value.w}px`, height: `${box.value.h}px` }
})
const transformStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))
const toolbarStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const gap = TOOLBAR_GAP_PX / viewport.value.zoom
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top: toolbarAbove.value ? `${abs.value.y - gap}px` : `${abs.value.y + box.value.h + gap}px`,
    transform: toolbarAbove.value ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }
})

/** 底部「编辑内容」卡（芯片条）：下沿优先，空间不足翻上沿 */
const bottomCardStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const gap = TOOLBAR_GAP_PX / viewport.value.zoom
  const toolbarBelowOffset = toolbarAbove.value ? 0 : (TOOLBAR_ESTIMATED_H + TOOLBAR_GAP_PX) / viewport.value.zoom
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top: toolbarAbove.value
      ? `${abs.value.y + box.value.h + gap + toolbarBelowOffset}px`
      : `${abs.value.y - gap}px`,
    width: `${Math.max(box.value.w, 340)}px`,
    transform: toolbarAbove.value ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  }
})

const counterScaleStyle = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: toolbarAbove.value ? '50% 100%' : '50% 0%',
}))
const counterScaleStyleCard = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: toolbarAbove.value ? '50% 0%' : '50% 100%',
}))

async function loadNatural() {
  const token = ++loadToken.value
  const url = props.url
  natural.value = null
  if (!url) return
  try {
    const img = await loadCropSourceImage(url)
    if (token !== loadToken.value) return
    if (img.naturalWidth > 0 && img.naturalHeight > 0) natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  } catch {
    if (token === loadToken.value) natural.value = null
  }
}

function updateGeometry() {
  const flowNode = findNode(props.node.id) as FlowNode | undefined
  const sizeNode = flowNode ?? ({ ...props.node, type: String(props.node.type ?? '') } as FlowNode)
  const allNodes = flowNodes.value as unknown as FlowNode[]
  const position = getAbsolutePosition(sizeNode, allNodes)
  const { w, h } = getNodeSize(sizeNode)
  abs.value = position
  box.value = { w, h }
  const zoom = viewport.value.zoom
  const topScreen = viewport.value.y + position.y * zoom
  const bottomScreen = topScreen + h * zoom
  const CARD_H = 220
  toolbarAbove.value = topScreen - TOOLBAR_GAP_PX - TOOLBAR_ESTIMATED_H > 0
  const belowAvail = window.innerHeight - 260 - bottomScreen
  if (!toolbarAbove.value && belowAvail < CARD_H) {
    // 上沿放不下工具条、下沿也放不下卡（罕见）：工具条仍在下沿，卡翻上沿
    toolbarAbove.value = true
  }
}

// —— 绘制（焦点 / 矩形 / 笔画） ——

function stagePoint(event: PointerEvent): { x: number; y: number } | null {
  const el = stageEl()
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * box.value.w,
    y: ((event.clientY - rect.top) / rect.height) * box.value.h,
  }
}

const stageRef = ref<HTMLElement | null>(null)
function stageEl(): HTMLElement | null {
  return stageRef.value
}

function clampPoint(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, p.x), box.value.w),
    y: Math.min(Math.max(0, p.y), box.value.h),
  }
}

/** display→pixel 逆映射（bbox 回填 display 坐标用），与 coverDisplayMapper 同一套数学 */
function pixelToDisplayRect(bbox: { x: number; y: number; width: number; height: number }): CropRect {
  const n = natural.value
  if (!n) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.max(box.value.w / n.w, box.value.h / n.h)
  const offsetX = (box.value.w - n.w * scale) / 2
  const offsetY = (box.value.h - n.h * scale) / 2
  const x0 = bbox.x * scale + offsetX
  const y0 = bbox.y * scale + offsetY
  return {
    x: Math.max(0, x0),
    y: Math.max(0, y0),
    width: Math.min(box.value.w - Math.max(0, x0), bbox.width * scale),
    height: Math.min(box.value.h - Math.max(0, y0), bbox.height * scale),
  }
}

function onStagePointerDown(event: PointerEvent) {
  if (props.busy || !natural.value) return
  const pt = stagePoint(event)
  if (!pt) return
  event.stopPropagation()
  const p = clampPoint(pt)
  if (tool.value === 'point') {
    void recognizeAt(p)
    return
  }
  if (tool.value === 'brush') {
    liveStroke.value = { points: [p], size: brushSize.value }
  } else {
    dragStart = p
    drawingRect.value = { x: p.x, y: p.y, width: 0, height: 0 }
  }
  window.addEventListener('pointermove', onStagePointerMove)
  window.addEventListener('pointerup', onStagePointerUp)
}

function onStagePointerMove(event: PointerEvent) {
  const pt = stagePoint(event)
  if (!pt) return
  const p = clampPoint(pt)
  if (tool.value === 'brush' && liveStroke.value) {
    liveStroke.value.points.push(p)
    return
  }
  if (dragStart && drawingRect.value) {
    drawingRect.value = {
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      width: Math.abs(p.x - dragStart.x),
      height: Math.abs(p.y - dragStart.y),
    }
  }
}

function onStagePointerUp() {
  window.removeEventListener('pointermove', onStagePointerMove)
  window.removeEventListener('pointerup', onStagePointerUp)
  if (tool.value === 'brush' && liveStroke.value) {
    if (liveStroke.value.points.length > 0) {
      pushChip({ kind: 'strokes', strokes: [liveStroke.value] }, '选区')
    }
    liveStroke.value = null
    return
  }
  if (drawingRect.value && dragStart) {
    const r = drawingRect.value
    if (r.width >= 8 && r.height >= 8) {
      pushChip({ kind: 'rect', rect: r }, '选区')
    }
  }
  drawingRect.value = null
  dragStart = null
}

/** 矩形/画笔完成 → 直接成芯片（名默认「选区」，芯片条内补修改内容） */
function pushChip(shape: ElementEditShape, name: string) {
  const item: ElementEditItem = { id: nextElementEditId(), name, modify: '', shape }
  items.value.push(item)
  highlightedId.value = item.id
  refreshThumb(item)
}

/** 焦点识别：成芯片（转圈）→ element-recognize（SAM 分割 + 识图命名）→ 回填名与精确框 */
async function recognizeAt(p: { x: number; y: number }) {
  const n = natural.value
  if (!n) return
  const mapper = coverDisplayMapper(n.w, n.h, box.value.w, box.value.h)
  const item: ElementEditItem = {
    id: nextElementEditId(),
    name: '',
    modify: '',
    shape: { kind: 'rect', rect: pointRectAt(p, box.value.w, box.value.h) },
    recognizing: true,
  }
  items.value.push(item)
  highlightedId.value = item.id
  refreshThumb(item)
  recognizeAbort?.abort()
  recognizeAbort = new AbortController()
  const signal = recognizeAbort.signal
  try {
    const { data } = await studioApi.recognizeElement(
      {
        imageUrl: props.url,
        x: Math.round(mapper.toPixelX(p.x)),
        y: Math.round(mapper.toPixelY(p.y)),
      },
      signal,
    )
    const target = items.value.find((it) => it.id === item.id)
    if (!target) return
    target.recognizing = false
    target.name = data.data.name || '未识别对象'
    const b = data.data.bbox
    if (b && b.width > 0 && b.height > 0) {
      target.shape = { kind: 'rect', rect: pixelToDisplayRect(b) }
      refreshThumb(target)
    }
  } catch (err) {
    if (signal.aborted) return
    const target = items.value.find((it) => it.id === item.id)
    if (target) {
      target.recognizing = false
      target.name = '未识别对象'
    }
    const message = err instanceof Error && err.message ? err.message : '对象识别失败，请重试或改用框选'
    console.warn('[element-recognize]', message)
  } finally {
    if (recognizeAbort?.signal === signal) recognizeAbort = null
  }
}

/** 撤销：移除最后一枚芯片（识别中先中断请求） */
function undoLast() {
  const last = items.value[items.value.length - 1]
  if (!last) return
  if (last.recognizing) {
    recognizeAbort?.abort()
    recognizeAbort = null
  }
  items.value.pop()
  if (highlightedId.value === last.id) highlightedId.value = null
}

/** 定位：循环高亮芯片，便于确认每个选区位置 */
function locateNext() {
  if (!items.value.length) return
  locateCursor = (locateCursor + 1) % items.value.length
  highlightedId.value = items.value[locateCursor]!.id
}

/** 选区快照缩略图：从原图 bbox 裁剪出 dataURL，直接写入芯片（ElementChipRow 展示/hover 预览） */
async function refreshThumb(item: ElementEditItem) {
  const n = natural.value
  if (!n) return
  try {
    const img = await loadCropSourceImage(props.url)
    const bbox = elementEditShapeBBox(item.shape)
    const sx = n.w / Math.max(1, box.value.w)
    const sy = n.h / Math.max(1, box.value.h)
    const c = document.createElement('canvas')
    const w = Math.max(8, Math.round(bbox.width * sx))
    const h = Math.max(8, Math.round(bbox.height * sy))
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, bbox.x * sx, bbox.y * sy, w, h, 0, 0, w, h)
    item.thumb = c.toDataURL('image/png')
  } catch {
    /* 快照失败留空 */
  }
}

/** 删除指定芯片（× 按钮） */
function removeChip(id: string) {
  const idx = items.value.findIndex((it) => it.id === id)
  if (idx === -1) return
  const [removed] = items.value.splice(idx, 1)
  if (removed?.recognizing) {
    recognizeAbort?.abort()
    recognizeAbort = null
  }
  if (highlightedId.value === id) highlightedId.value = null
}

function onCancel() {
  emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') onCancel()
}

watch(
  () => props.node.id,
  () => {
    updateGeometry()
    tool.value = 'point'
    items.value = []
    highlightedId.value = null
    void loadNatural()
  },
  { immediate: true },
)

watch(() => props.url, () => void loadNatural())
watch(viewport, updateGeometry, { deep: true })
watch(flowNodes, updateGeometry, { deep: true })

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  recognizeAbort?.abort()
  onStagePointerUp()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[46] overflow-visible" data-testid="node-element-overlay">
    <div class="origin-top-left" :style="transformStyle">
      <!-- 选区层：节点卡上点选 / 框选 / 涂抹 -->
      <div
        v-if="abs && natural"
        ref="stageRef"
        class="pointer-events-auto absolute overflow-hidden rounded-lg"
        :class="tool === 'point' ? 'is-point' : ''"
        :style="stageStyle"
        data-testid="node-element-stage"
        @pointerdown="onStagePointerDown"
        @mousedown.stop
        @click.stop
      >
        <template v-for="item in items" :key="item.id">
          <div
            v-if="item.shape.kind === 'rect'"
            class="node-element-shape"
            :class="{ 'is-hl': highlightedId === item.id, 'is-busy': item.recognizing }"
            :style="{
              left: `${item.shape.rect.x}px`,
              top: `${item.shape.rect.y}px`,
              width: `${item.shape.rect.width}px`,
              height: `${item.shape.rect.height}px`,
            }"
          />
          <svg v-else class="node-element-svg" :style="{ left: 0, top: 0, width: `${box.w}px`, height: `${box.h}px` }" :viewBox="`0 0 ${box.w} ${box.h}`">
            <polyline
              v-for="(st, i) in item.shape.strokes"
              :key="i"
              :points="st.points.map((p) => `${p.x},${p.y}`).join(' ')"
              fill="none"
              :stroke="highlightedId === item.id ? '#a89dff' : '#ffffff'"
              :stroke-width="st.size"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="opacity: 0.75"
            />
          </svg>
        </template>
        <!-- 拖拽中矩形 / 笔画 -->
        <div
          v-if="drawingRect"
          class="node-element-shape is-pending"
          :style="{
            left: `${drawingRect.x}px`,
            top: `${drawingRect.y}px`,
            width: `${drawingRect.width}px`,
            height: `${drawingRect.height}px`,
          }"
        />
        <svg
          v-if="liveStroke"
          class="node-element-svg"
          :style="{ left: 0, top: 0, width: `${box.w}px`, height: `${box.h}px` }"
          :viewBox="`0 0 ${box.w} ${box.h}`"
        >
          <polyline
            :points="liveStroke.points.map((p) => `${p.x},${p.y}`).join(' ')"
            fill="none"
            stroke="#a89dff"
            :stroke-width="liveStroke.size"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="opacity: 0.75"
          />
        </svg>
      </div>

      <!-- 上沿工具条：[✕ 元素编辑] [定位] [焦点] [选区] [画笔] [撤销] -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="toolbarStyle">
        <div
          class="neo-chrome flex items-center gap-0.5 rounded-xl px-1 py-1"
          :style="counterScaleStyle"
          data-testid="node-element-toolbar"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="node-element-btn node-element-btn--label"
            data-testid="node-element-cancel"
            title="退出元素编辑"
            aria-label="退出元素编辑"
            @click="onCancel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            <span>元素编辑</span>
          </button>
          <span class="node-element-divider" aria-hidden="true" />
          <button
            type="button"
            class="node-element-btn"
            data-testid="node-element-locate"
            title="定位（循环查看各选区）"
            aria-label="定位选区"
            :disabled="!items.length"
            @click="locateNext"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" opacity="0.4" />
            </svg>
          </button>
          <button
            type="button"
            class="node-element-btn"
            :class="{ 'is-on': tool === 'point' }"
            data-testid="node-element-point"
            title="焦点选择：点击元素，自动识别对象"
            aria-label="焦点选择"
            @click="tool = 'point'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
          <button
            type="button"
            class="node-element-btn"
            :class="{ 'is-on': tool === 'rect' }"
            data-testid="node-element-rect"
            title="矩形选区（拖框圈出元素）"
            aria-label="矩形选区"
            @click="tool = 'rect'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
            </svg>
          </button>
          <button
            type="button"
            class="node-element-btn"
            :class="{ 'is-on': tool === 'brush' }"
            data-testid="node-element-brush"
            title="画笔（涂抹元素区域）"
            aria-label="画笔"
            @click="tool = 'brush'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" /><path d="M14.8 6.6l2.6 2.6" />
            </svg>
          </button>
          <input
            v-if="tool === 'brush'"
            v-model.number="brushSize"
            type="range"
            min="4"
            max="80"
            step="1"
            class="node-element-slider"
            data-testid="node-element-size"
            title="笔刷大小"
            aria-label="笔刷大小"
          >
          <button
            type="button"
            class="node-element-btn"
            data-testid="node-element-undo"
            title="撤销（移除最后一枚芯片）"
            aria-label="撤销"
            :disabled="undoDisabled"
            @click="undoLast"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 底部「编辑内容」卡：芯片条（缩略图 + 可编辑对象名 + 修改）+ 取消/生成 -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="bottomCardStyle">
        <div
          class="neo-chrome flex flex-col gap-1.5 rounded-xl px-2 py-2"
          :style="counterScaleStyleCard"
          data-testid="node-element-card"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <div class="flex items-center justify-between px-0.5">
            <span class="flex items-center gap-1 text-[12px] font-semibold" style="color: var(--neo-text)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              编辑内容
            </span>
            <span class="text-[11px]" style="color: var(--neo-text-muted)" data-testid="node-element-count">{{ items.length }}处</span>
          </div>
          <div v-if="items.length" class="node-element-list">
            <ElementChipRow
              v-for="item in items"
              :key="item.id"
              :item="item"
              :highlighted="highlightedId === item.id"
              @update:name="item.name = $event"
              @update:modify="item.modify = $event"
              @update:ref-url="item.refUrl = $event"
              @remove="removeChip(item.id)"
              @highlight="highlightedId = $event ? item.id : null"
            />
          </div>
          <div v-else class="px-1 py-1 text-[11px]" style="color: var(--neo-text-muted)">
            {{ tool === 'point' ? '点击图中的元素（如眼睛、项链），自动识别对象' : '拖框或涂抹圈出元素；多轮点选可累积多处' }}
          </div>
          <div class="flex items-center justify-end gap-1.5">
            <button
              type="button"
              class="node-element-cancelbtn"
              data-testid="node-element-cancelbtn"
              @click="onCancel"
            >取消</button>
            <button
              type="button"
              class="node-element-generate"
              data-testid="node-element-generate"
              :disabled="!canGenerate"
              :title="canGenerate ? '按编辑内容一次性生成（下游新节点）' : '为至少一处元素填写修改内容'"
              @click="emit('confirm', { items: [...items] })"
            >{{ busy ? '生成中…' : `⚡ 生成${items.length ? `（${items.length}处）` : ''} · ${CANVAS_GENERATE_CREDITS}积分` }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-element-shape {
  position: absolute;
  border: 1.5px solid rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  border-radius: 2px;
}
.node-element-shape.is-hl {
  border-color: #a89dff;
  background: rgba(168, 157, 255, 0.18);
}
.node-element-shape.is-busy {
  border-style: dashed;
  border-color: #a89dff;
}
.node-element-shape.is-pending {
  border-style: dashed;
  border-color: #a89dff;
}
.node-element-svg {
  position: absolute;
  pointer-events: none;
  overflow: visible;
}
.node-element-stage.is-point,
div.is-point {
  cursor: crosshair;
}

.node-element-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 0.45rem;
  border-radius: 0.5rem;
  color: var(--neo-text);
  transition: background 0.15s ease;
}
.node-element-btn:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-element-btn.is-on {
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
  color: var(--neo-text-primary, var(--neo-text));
}
.node-element-btn--label {
  gap: 0.3rem;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.node-element-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.node-element-divider {
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
}
.node-element-slider {
  width: 76px;
  accent-color: #fff;
  margin: 0 0.35rem;
  cursor: pointer;
}

.node-element-thumb {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--neo-text) 8%, transparent);
  background-size: cover;
  background-position: center;
}
.node-element-thumb--empty {
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--neo-text) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--neo-text) 6%, transparent) 75%);
  background-size: 8px 8px;
}

.node-element-list {
  display: flex;
  max-height: 168px;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.node-element-chip {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.25rem 0.4rem;
  border-radius: 0.55rem;
  color: var(--neo-text);
}
.node-element-chip.is-hl {
  background: color-mix(in srgb, var(--neo-accent-text, #a89dff) 12%, transparent);
}
.node-element-chip__name {
  min-width: 0;
  flex: 1;
  padding: 0.22rem 0.4rem;
  border: none;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--neo-text);
  font-size: 12px;
  font-weight: 600;
}
.node-element-chip__name:hover {
  background: color-mix(in srgb, var(--neo-text) 7%, transparent);
}
.node-element-chip__name:focus {
  outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent);
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
}
.node-element-chip__name:disabled {
  color: var(--neo-text-muted);
}
.node-element-chip__modify-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.2rem;
  padding: 0.24rem 0.45rem;
  border-radius: 0.45rem;
  color: var(--neo-text-muted);
  font-size: 11.5px;
  cursor: pointer;
}
.node-element-chip__modify-btn:hover,
.node-element-chip__modify-btn.is-on {
  background: color-mix(in srgb, var(--neo-text) 10%, transparent);
  color: var(--neo-text);
}
.node-element-chip__modify {
  width: 100%;
  margin-left: 38px;
  width: calc(100% - 40px);
  padding: 0.32rem 0.45rem;
  border: none;
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  color: var(--neo-text);
  font-size: 12px;
}
.node-element-chip__modify:focus {
  outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent);
}
.node-element-chip__modify::placeholder {
  color: color-mix(in srgb, var(--neo-text) 45%, transparent);
}
.node-element-chip__spin {
  flex: 0 0 12px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--neo-text) 25%, transparent);
  border-top-color: var(--neo-accent-text, #a89dff);
  animation: node-element-spin 0.8s linear infinite;
}
@keyframes node-element-spin {
  to { transform: rotate(360deg); }
}

.node-element-cancelbtn {
  padding: 0.45rem 0.9rem;
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--neo-text) 10%, transparent);
  color: var(--neo-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.node-element-cancelbtn:hover {
  background: color-mix(in srgb, var(--neo-text) 16%, transparent);
}
.node-element-generate {
  padding: 0.45rem 1.1rem;
  border-radius: 0.55rem;
  background: #fff;
  color: #111;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.node-element-generate:hover:not(:disabled) {
  opacity: 0.88;
}
.node-element-generate:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
