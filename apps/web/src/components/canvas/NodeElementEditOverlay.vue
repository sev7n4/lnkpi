<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import type { CropRect } from './refine/cropGeometry'
import {
  ELEMENT_EDIT_NAME_OPTIONS,
  elementEditShapeBBox,
  nextElementEditId,
  type ElementEditItem,
  type ElementEditShape,
} from './elementEditModel'

/**
 * 节点直出元素编辑（多选区局部编辑，复刻竞品 2026-09-25 用户需求）：
 * 单击图片节点 → 浮层「元素编辑」→
 *  - 上沿工具条：[✕ 元素编辑] [📍定位] [⬚选区] [✏️画笔] [↺撤销]
 *  - 图上多选区：矩形拖框 / 画笔涂抹，每次绘制产生一个「草稿项」；
 *  - 右侧编辑卡（贴选区）：选区快照 + 元素名下拉 + 改动描述 +【添加】；
 *  - 底部「编辑内容 N处」卡：列表 + [取消] [⚡生成]。
 * 确认时上抛 { items }（display 坐标形状），宿主 paintElementEditMask 合成整图蒙版
 * → exportMaskPng → persist → image/edit mode:'inpaint' 单次生成 → 下游新节点。
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
const SIDE_CARD_W = 260

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const natural = ref<{ w: number; h: number } | null>(null)
const loadToken = ref(0)

type Tool = 'locate' | 'rect' | 'brush'
const tool = ref<Tool>('rect')
const brushSize = ref(24)

/** 已确认的编辑项 */
const items = ref<ElementEditItem[]>([])
/** 草稿项（画完未【添加】；右侧卡在编辑它） */
const pending = ref<ElementEditItem | null>(null)
const pendingName = ref(ELEMENT_EDIT_NAME_OPTIONS[0] as string)
const pendingDesc = ref('')
/** 当前高亮项 id（定位循环用） */
const highlightedId = ref<string | null>(null)
/** 定位循环游标 */
let locateCursor = -1

/** 矩形拖拽中 */
const drawingRect = ref<CropRect | null>(null)
/** 笔画绘制中 */
const liveStroke = ref<{ points: { x: number; y: number }[]; size: number } | null>(null)
let dragStart: { x: number; y: number } | null = null

const nameMenuOpen = ref(false)
const toolbarAbove = ref(true)
const sideCardAbove = ref(false)

const canAddPending = computed(() => !!pending.value && (pendingDesc.value.trim().length > 0 || pendingName.value.trim().length > 0))
const canGenerate = computed(() => !props.busy && items.value.length > 0)

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

/** 右侧编辑卡：贴当前草稿选区右侧（空间不足翻左侧），无草稿时贴节点右侧居中 */
const sideCardStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const zoom = viewport.value.zoom
  const gap = 10 / zoom
  const bbox = pending.value ? elementEditShapeBBox(pending.value.shape) : null
  const anchorRight = bbox ? bbox.x + bbox.width : box.value.w
  const anchorCY = bbox ? bbox.y + bbox.height / 2 : box.value.h / 2
  const cardW = SIDE_CARD_W / zoom
  const rightSpace = box.value.w - anchorRight
  const flip = rightSpace < cardW + gap
  const left = flip ? anchorRight - bboxWidth(bbox) - gap - cardW : anchorRight + gap
  return {
    left: `${abs.value.x + left}px`,
    top: `${abs.value.y + Math.min(Math.max(0, anchorCY - 70 / zoom), Math.max(0, box.value.h - 150 / zoom))}px`,
    width: `${cardW}px`,
  }
})

function bboxWidth(bbox: CropRect | null): number {
  return bbox?.width ?? 0
}

/** 底部「编辑内容」卡：与 prompt 卡同位规则（下沿优先，空间不足翻上沿） */
const bottomCardStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const gap = TOOLBAR_GAP_PX / viewport.value.zoom
  const toolbarBelowOffset = toolbarAbove.value ? 0 : (TOOLBAR_ESTIMATED_H + TOOLBAR_GAP_PX) / viewport.value.zoom
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top: sideCardAbove.value
      ? `${abs.value.y - gap}px`
      : `${abs.value.y + box.value.h + gap + toolbarBelowOffset}px`,
    width: `${Math.max(box.value.w, 320)}px`,
    transform: sideCardAbove.value ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }
})

const counterScaleStyle = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: toolbarAbove.value ? '50% 100%' : '50% 0%',
}))
const counterScaleStyleBelow = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: sideCardAbove.value ? '50% 100%' : '50% 0%',
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
  const CARD_H = 210
  const belowAvail = window.innerHeight - 260 - bottomScreen
  sideCardAbove.value = belowAvail < CARD_H && topScreen - TOOLBAR_GAP_PX > CARD_H * 0.6
  toolbarAbove.value = !sideCardAbove.value && topScreen - TOOLBAR_GAP_PX - TOOLBAR_ESTIMATED_H > 0
}

// —— 绘制（矩形 / 笔画） ——

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

function onStagePointerDown(event: PointerEvent) {
  if (props.busy || !natural.value) return
  const pt = stagePoint(event)
  if (!pt) return
  event.stopPropagation()
  const p = clampPoint(pt)
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
      startPending({ kind: 'strokes', strokes: [liveStroke.value] })
    }
    liveStroke.value = null
    return
  }
  if (drawingRect.value && dragStart) {
    const r = drawingRect.value
    if (r.width >= 8 && r.height >= 8) {
      startPending({ kind: 'rect', rect: r })
    }
  }
  drawingRect.value = null
  dragStart = null
}

/** 画完 → 草稿项 + 右侧卡聚焦编辑 */
function startPending(shape: ElementEditShape) {
  pending.value = { id: nextElementEditId(), name: '', desc: '', shape }
  pendingName.value = ELEMENT_EDIT_NAME_OPTIONS[0] as string
  pendingDesc.value = ''
}

function addPending() {
  if (!pending.value || !canAddPending.value) return
  const item: ElementEditItem = {
    ...pending.value,
    name: pendingName.value.trim() || (ELEMENT_EDIT_NAME_OPTIONS[0] as string),
    desc: pendingDesc.value.trim(),
  }
  items.value.push(item)
  pending.value = null
  pendingDesc.value = ''
  highlightedId.value = item.id
}

function removePending() {
  pending.value = null
}

/** 撤销：优先丢弃草稿，否则移除最后一项 */
function undoLast() {
  if (pending.value) {
    pending.value = null
    return
  }
  items.value.pop()
}

/** 定位：循环高亮列表项（含草稿），便于确认每个选区位置 */
function locateNext() {
  const all = [...items.value.map((it) => it.id), ...(pending.value ? [pending.value.id] : [])]
  if (!all.length) return
  locateCursor = (locateCursor + 1) % all.length
  highlightedId.value = all[locateCursor]!
}

function editItem(item: ElementEditItem) {
  // 点列表项 → 转为草稿重新编辑（从列表移除，确认后回填）
  items.value = items.value.filter((it) => it.id !== item.id)
  pending.value = item
  pendingName.value = item.name || (ELEMENT_EDIT_NAME_OPTIONS[0] as string)
  pendingDesc.value = item.desc
}

/** 选区快照缩略图（草稿 / 列表项通用）：从原图 bbox 裁剪出 dataURL */
const thumbCache = ref<Record<string, string>>({})
async function refreshThumb(item: ElementEditItem) {
  const n = natural.value
  if (!n) return
  try {
    const img = await loadCropSourceImage(props.url)
    const bbox = elementEditShapeBBox(item.shape)
    const mapper = {
      sx: n.w / Math.max(1, box.value.w),
      sy: n.h / Math.max(1, box.value.h),
    }
    const c = document.createElement('canvas')
    const w = Math.max(8, Math.round(bbox.width * mapper.sx))
    const h = Math.max(8, Math.round(bbox.height * mapper.sy))
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, bbox.x * mapper.sx, bbox.y * mapper.sy, w, h, 0, 0, w, h)
    thumbCache.value = { ...thumbCache.value, [item.id]: c.toDataURL('image/png') }
  } catch {
    /* 快照失败留空 */
  }
}

watch(pending, (p) => {
  if (p) void refreshThumb(p)
})
watch(items, (list) => {
  for (const it of list) {
    if (!thumbCache.value[it.id]) void refreshThumb(it)
  }
}, { deep: true })

function onCancel() {
  if (nameMenuOpen.value) {
    nameMenuOpen.value = false
    return
  }
  emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') onCancel()
}

watch(
  () => props.node.id,
  () => {
    updateGeometry()
    tool.value = 'rect'
    items.value = []
    pending.value = null
    highlightedId.value = null
    thumbCache.value = {}
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
  onStagePointerUp()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[46] overflow-visible" data-testid="node-element-overlay">
    <div class="origin-top-left" :style="transformStyle">
      <!-- 选区层：节点卡上直接框选 / 涂抹 -->
      <div
        v-if="abs && natural"
        ref="stageRef"
        class="pointer-events-auto absolute overflow-hidden rounded-lg"
        :style="stageStyle"
        data-testid="node-element-stage"
        @pointerdown="onStagePointerDown"
        @mousedown.stop
        @click.stop
      >
        <!-- 已确认项形状 -->
        <template v-for="item in items" :key="item.id">
          <div
            v-if="item.shape.kind === 'rect'"
            class="node-element-shape"
            :class="{ 'is-hl': highlightedId === item.id }"
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
        <!-- 草稿形状 -->
        <template v-if="pending">
          <div
            v-if="pending.shape.kind === 'rect'"
            class="node-element-shape is-pending"
            :style="{
              left: `${pending.shape.rect.x}px`,
              top: `${pending.shape.rect.y}px`,
              width: `${pending.shape.rect.width}px`,
              height: `${pending.shape.rect.height}px`,
            }"
          />
          <svg v-else class="node-element-svg" :style="{ left: 0, top: 0, width: `${box.w}px`, height: `${box.h}px` }" :viewBox="`0 0 ${box.w} ${box.h}`">
            <polyline
              v-for="(st, i) in pending.shape.strokes"
              :key="i"
              :points="st.points.map((p) => `${p.x},${p.y}`).join(' ')"
              fill="none"
              stroke="#a89dff"
              :stroke-width="st.size"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="opacity: 0.75"
            />
          </svg>
        </template>
        <!-- 拖拽中矩形 -->
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
      </div>

      <!-- 上沿工具条：[✕ 元素编辑] [定位] [选区] [画笔] [撤销] -->
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
            :class="{ 'is-on': tool === 'locate' }"
            data-testid="node-element-locate"
            title="定位（循环查看各选区）"
            aria-label="定位选区"
            @click="locateNext"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" opacity="0.4" />
            </svg>
          </button>
          <button
            type="button"
            class="node-element-btn"
            :class="{ 'is-on': tool === 'rect' }"
            data-testid="node-element-rect"
            title="选区（拖框圈出元素）"
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
            title="撤销（丢弃草稿 / 移除最后一项）"
            aria-label="撤销"
            :disabled="!pending && !items.length"
            @click="undoLast"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 右侧编辑卡：选区快照 + 元素名下拉 + 描述 + 添加 -->
      <div v-if="abs && natural && pending" class="pointer-events-auto absolute" :style="sideCardStyle">
        <div
          class="neo-chrome flex flex-col gap-1.5 rounded-xl px-2 py-2"
          :style="counterScaleStyleBelow"
          data-testid="node-element-side-card"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <div class="flex items-center gap-1.5">
            <span
              v-if="thumbCache[pending.id]"
              class="node-element-thumb"
              :style="{ backgroundImage: `url(${thumbCache[pending.id]})` }"
              data-testid="node-element-thumb"
            />
            <span v-else class="node-element-thumb node-element-thumb--empty" />
            <div class="relative min-w-0 flex-1">
              <button
                type="button"
                class="node-element-name"
                data-testid="node-element-name"
                :aria-expanded="nameMenuOpen"
                @click="nameMenuOpen = !nameMenuOpen"
              >
                <span class="truncate">{{ pendingName || '元素' }}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div
                v-if="nameMenuOpen"
                class="neo-chrome node-element-name-menu absolute left-0 top-full z-[3] mt-1 rounded-xl p-1"
                role="menu"
                data-testid="node-element-name-menu"
                @click.stop
              >
                <button
                  v-for="opt in ELEMENT_EDIT_NAME_OPTIONS"
                  :key="opt"
                  type="button"
                  role="menuitem"
                  class="node-element-name-item"
                  :class="{ 'is-on': pendingName === opt }"
                  @click="pendingName = opt; nameMenuOpen = false"
                >{{ opt }}</button>
              </div>
            </div>
          </div>
          <input
            v-model="pendingDesc"
            class="node-element-desc"
            placeholder="描述改动，如：增加耳钉"
            data-testid="node-element-desc"
            @keydown.enter.prevent="addPending"
          >
          <div class="flex items-center justify-end gap-1.5">
            <button
              type="button"
              class="node-element-ghost"
              data-testid="node-element-discard"
              title="丢弃该选区"
              @click="removePending"
            >✕</button>
            <button
              type="button"
              class="node-element-add"
              data-testid="node-element-add"
              :disabled="!canAddPending"
              title="加入编辑内容"
              @click="addPending"
            >添加</button>
          </div>
        </div>
      </div>

      <!-- 底部「编辑内容」卡：列表 + 取消/生成 -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="bottomCardStyle">
        <div
          class="neo-chrome flex flex-col gap-1.5 rounded-xl px-2 py-2"
          :style="counterScaleStyleBelow"
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
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="node-element-row"
              :data-testid="`node-element-row-${item.id}`"
              :title="`${item.name} ${item.desc}（点击重新编辑）`"
              @click="editItem(item)"
            >
              <span
                v-if="thumbCache[item.id]"
                class="node-element-thumb node-element-thumb--sm"
                :style="{ backgroundImage: `url(${thumbCache[item.id]})` }"
              />
              <span v-else class="node-element-thumb node-element-thumb--sm node-element-thumb--empty" />
              <b class="node-element-row__name">{{ item.name }}</b>
              <span class="node-element-row__desc">{{ item.desc || '—' }}</span>
            </button>
          </div>
          <div v-else class="px-1 py-1 text-[11px]" style="color: var(--neo-text-muted)">
            用「选区」拖框或「画笔」涂抹，为每个元素添加改动描述
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
              :title="items.length ? '按编辑内容一次性生成（下游新节点）' : '先添加至少一处编辑'"
              @click="emit('confirm', { items: [...items] })"
            >{{ busy ? '生成中…' : '⚡ 生成' }}</button>
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
.node-element-shape.is-pending {
  border-style: dashed;
  border-color: #a89dff;
}
.node-element-svg {
  position: absolute;
  pointer-events: none;
  overflow: visible;
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
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--neo-text) 8%, transparent);
  background-size: cover;
  background-position: center;
}
.node-element-thumb--sm {
  width: 26px;
  height: 26px;
  flex-basis: 26px;
}
.node-element-thumb--empty {
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--neo-text) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--neo-text) 6%, transparent) 75%);
  background-size: 8px 8px;
}

.node-element-name {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
  color: var(--neo-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.node-element-name-menu {
  min-width: 96px;
  background: var(--neo-chrome-bg);
  box-shadow: var(--neo-chrome-shadow);
  max-height: 220px;
  overflow-y: auto;
}
.node-element-name-item {
  display: block;
  width: 100%;
  padding: 0.32rem 0.6rem;
  text-align: left;
  font-size: 11.5px;
  color: var(--neo-text);
  white-space: nowrap;
  border-radius: 0.4rem;
}
.node-element-name-item:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-element-name-item.is-on {
  color: var(--neo-accent-text, #a89dff);
}

.node-element-desc {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  color: var(--neo-text);
  font-size: 12.5px;
  line-height: 1.4;
}
.node-element-desc:focus {
  outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent);
}
.node-element-desc::placeholder {
  color: color-mix(in srgb, var(--neo-text) 45%, transparent);
}

.node-element-ghost {
  padding: 0.4rem 0.55rem;
  border-radius: 0.5rem;
  color: var(--neo-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.node-element-ghost:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-element-add {
  padding: 0.42rem 0.95rem;
  border-radius: 0.55rem;
  background: #fff;
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.node-element-add:hover:not(:disabled) {
  opacity: 0.88;
}
.node-element-add:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.node-element-list {
  display: flex;
  max-height: 132px;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.node-element-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.5rem;
  text-align: left;
  cursor: pointer;
  color: var(--neo-text);
}
.node-element-row:hover {
  background: color-mix(in srgb, var(--neo-text) 7%, transparent);
}
.node-element-row__name {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
}
.node-element-row__desc {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  color: var(--neo-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
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
