<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import {
  combineInpaintPrompt,
  elementEditShapeBBox,
  nextElementEditId,
  paintElementEditMask,
  type ElementEditItem,
  type ElementEditShape,
} from './elementEditModel'
import type { CropRect } from './refine/cropGeometry'
import ElementChipRow from './refine/ElementChipRow.vue'
import RectHandleFrame from './RectHandleFrame.vue'
import { CANVAS_TOOL_CREDITS } from '@lnkpi/shared'

/**
 * 节点直出局部重绘（2026-09-25 芯片化重做，与精修 inpaint 同构）：
 * 单击图片节点 → 浮层「重绘」→ 画笔涂抹/矩形框选**松手即成芯片**；
 * 芯片条：缩略图 hover 放大、对象名、【修改】、+ 替换图（本地/资产库，生成时对象替换）、× 删除；
 * 矩形芯片支持 8 手柄（边+顶点）调整与整体拖动（统一能力）。
 * 确认时芯片合并为整图蒙版（paintElementEditMask，原图分辨率）+ 全局 prompt →
 * image/edit mode:'inpaint'（size 'auto'，单次一张，⚡10积分）→ 下游新节点。
 */
const props = defineProps<{
  node: { id: string; type?: string | null; data?: Record<string, unknown> }
  /** 节点原图 url（蒙版按其自然尺寸建立） */
  url: string
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: { prompt: string; maskCanvas: HTMLCanvasElement; refUrls: string[] }]
  cancel: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const TOOLBAR_GAP_PX = 8
const TOOLBAR_ESTIMATED_H = 40
const PROMPT_GAP_PX = 8
/** prompt 卡估高（屏幕 px）与底部生成 dock 预留高度：用于「下沿放不下 → 整卡翻上沿」判定。 */
const CARD_ESTIMATED_H = 260
const DOCK_RESERVE_PX = 330

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const natural = ref<{ w: number; h: number } | null>(null)
type Tool = 'brush' | 'rect'
const tool = ref<Tool>('brush')
const brushSize = ref(24)
const prompt = ref('')
const loadToken = ref(0)

/** 芯片（编辑项）；矩形/笔画松手即成 */
const items = ref<ElementEditItem[]>([])
const highlightedId = ref<string | null>(null)

/** 矩形拖拽中 */
const drawingRect = ref<CropRect | null>(null)
/** 笔画绘制中 */
const liveStroke = ref<{ points: { x: number; y: number }[]; size: number } | null>(null)
let dragStart: { x: number; y: number } | null = null

const toolbarAbove = ref(true)
const cardAbove = ref(false)

const canConfirm = computed(() => {
  if (props.busy || !natural.value || items.value.length === 0) return false
  return prompt.value.trim().length > 0 || items.value.some((it) => it.modify.trim().length > 0)
})

const confirmLabel = computed(() =>
  props.busy ? '重绘中…' : `确认 · ⚡${CANVAS_TOOL_CREDITS.inpaint}积分`,
)

const stageStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  return { left: `${abs.value.x}px`, top: `${abs.value.y}px`, width: `${box.value.w}px`, height: `${box.value.h}px` }
})

const transformStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))

/** 工具卡贴节点上沿（prompt 卡翻上沿时让位翻下沿；节点贴顶时翻下沿）；prompt 卡位置见下 */
const toolbarStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const gap = TOOLBAR_GAP_PX / viewport.value.zoom
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top: toolbarAbove.value ? `${abs.value.y - gap}px` : `${abs.value.y + box.value.h + gap}px`,
    transform: toolbarAbove.value ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }
})

/** prompt 卡默认下沿（工具条翻下时顺延错开）；下沿空间不足（含底部 dock 预留）翻上沿。 */
const promptCardStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const gap = PROMPT_GAP_PX / viewport.value.zoom
  const toolbarBelowOffset = toolbarAbove.value
    ? 0
    : (TOOLBAR_ESTIMATED_H + PROMPT_GAP_PX) / viewport.value.zoom
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top: cardAbove.value
      ? `${abs.value.y - gap}px`
      : `${abs.value.y + box.value.h + gap + toolbarBelowOffset}px`,
    width: `${Math.max(box.value.w, 320)}px`,
    transform: cardAbove.value ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }
})

const counterScaleStyle = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: toolbarAbove.value ? '50% 100%' : '50% 0%',
}))
const counterScaleStyleCard = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: cardAbove.value ? '50% 100%' : '50% 0%',
}))

async function loadNatural() {
  const token = ++loadToken.value
  const url = props.url
  natural.value = null
  items.value = []
  highlightedId.value = null
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
  const belowAvail = window.innerHeight - DOCK_RESERVE_PX - bottomScreen
  cardAbove.value =
    belowAvail < CARD_ESTIMATED_H && topScreen - PROMPT_GAP_PX > CARD_ESTIMATED_H * 0.6
  toolbarAbove.value =
    !cardAbove.value && topScreen - TOOLBAR_GAP_PX - TOOLBAR_ESTIMATED_H > 0
}

// —— 绘制（矩形 / 笔画，松手成芯片） ——

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

/** 命中检测：点落在某个矩形芯片内 → 返回该项（后画的在上，倒序优先） */
function hitRectItem(p: { x: number; y: number }): ElementEditItem | null {
  for (let i = items.value.length - 1; i >= 0; i -= 1) {
    const it = items.value[i]!
    if (it.shape.kind !== 'rect') continue
    const r = it.shape.rect
    if (r.width > 2 && r.height > 2 && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
      return it
    }
  }
  return null
}

/** 选中（高亮）中的矩形芯片：8 手柄调整 / 拖动 */
const selectedRectItem = computed(() => {
  const it = items.value.find((i) => i.id === highlightedId.value)
  if (!it || it.shape.kind !== 'rect') return null
  return it
})

function onSelectedRectUpdate(rect: CropRect) {
  const it = selectedRectItem.value
  if (!it || it.shape.kind !== 'rect') return
  it.shape.rect = rect
}

function onSelectedRectDragEnd() {
  const it = selectedRectItem.value
  if (it) refreshThumb(it)
}

function onStagePointerDown(event: PointerEvent) {
  if (props.busy || !natural.value) return
  const pt = stagePoint(event)
  if (!pt) return
  event.stopPropagation()
  const p = clampPoint(pt)
  // 命中已有矩形芯片：选中它（8 手柄调整 / 拖动），不落新选区
  const hit = hitRectItem(p)
  if (hit) {
    highlightedId.value = hit.id
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
      pushChip({ kind: 'strokes', strokes: [liveStroke.value] }, '区域')
    }
    liveStroke.value = null
    return
  }
  if (drawingRect.value && dragStart) {
    const r = drawingRect.value
    if (r.width >= 8 && r.height >= 8) {
      pushChip({ kind: 'rect', rect: r }, '区域')
    }
  }
  drawingRect.value = null
  dragStart = null
}

/** 矩形/画笔完成 → 直接成芯片（松手自动成芯片，2026-09-25 拍板） */
function pushChip(shape: ElementEditShape, name: string) {
  const item: ElementEditItem = { id: nextElementEditId(), name, modify: '', shape }
  items.value.push(item)
  highlightedId.value = item.id
  refreshThumb(item)
}

/** 撤销：移除最后一枚芯片 */
function undoLast() {
  const last = items.value[items.value.length - 1]
  if (!last) return
  items.value.pop()
  if (highlightedId.value === last.id) highlightedId.value = null
}

/** 删除指定芯片（× 按钮） */
function removeChip(id: string) {
  const idx = items.value.findIndex((it) => it.id === id)
  if (idx === -1) return
  const [removed] = items.value.splice(idx, 1)
  if (removed && highlightedId.value === removed.id) highlightedId.value = null
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

function onConfirm() {
  const n = natural.value
  if (!canConfirm.value || !n) return
  const maskCanvas = paintElementEditMask(items.value, n.w, n.h, box.value.w, box.value.h)
  const refUrls = items.value
    .map((it) => it.refUrl?.trim())
    .filter((u): u is string => !!u)
  emit('confirm', { prompt: combineInpaintPrompt(prompt.value, items.value), maskCanvas, refUrls })
}

function onCancel() {
  emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  onCancel()
}

watch(
  () => props.node.id,
  () => {
    updateGeometry()
    tool.value = 'brush'
    prompt.value = ''
    void loadNatural()
  },
  { immediate: true },
)

watch(() => props.url, () => void loadNatural())
watch(viewport, updateGeometry, { deep: true })
watch(flowNodes, updateGeometry, { deep: true })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  onStagePointerUp()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[46] overflow-visible" data-testid="node-inpaint-overlay">
    <div class="origin-top-left" :style="transformStyle">
      <!-- 芯片选区层：节点卡上直接看芯片 / 框选 / 涂抹 -->
      <div
        v-if="abs && natural"
        ref="stageRef"
        class="pointer-events-auto absolute overflow-hidden rounded-lg"
        :style="stageStyle"
        data-testid="node-inpaint-stage"
        @pointerdown="onStagePointerDown"
        @mousedown.stop
        @click.stop
      >
        <template v-for="item in items" :key="item.id">
          <div
            v-if="item.shape.kind === 'rect'"
            class="node-inpaint-shape"
            :class="{ 'is-hl': highlightedId === item.id }"
            :style="{
              left: `${item.shape.rect.x}px`,
              top: `${item.shape.rect.y}px`,
              width: `${item.shape.rect.width}px`,
              height: `${item.shape.rect.height}px`,
            }"
          />
          <svg
            v-else-if="item.shape.kind === 'strokes'"
            class="node-inpaint-svg"
            :style="{ left: 0, top: 0, width: `${box.w}px`, height: `${box.h}px` }"
            :viewBox="`0 0 ${box.w} ${box.h}`"
          >
            <polyline
              v-for="(st, i) in item.shape.strokes"
              :key="i"
              :points="st.points.map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(' ')"
              fill="none"
              :stroke="highlightedId === item.id ? '#a89dff' : '#ffffff'"
              :stroke-width="st.size"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="opacity: 0.75"
            />
          </svg>
        </template>

        <!-- 选中矩形芯片：8 手柄（边+顶点）调整 + 拖动（2026-09-25 统一能力） -->
        <RectHandleFrame
          v-if="selectedRectItem && selectedRectItem.shape.kind === 'rect'"
          :rect="selectedRectItem.shape.rect"
          :bounds="{ w: box.w, h: box.h }"
          :scale="viewport.zoom"
          @update:rect="onSelectedRectUpdate"
          @drag-end="onSelectedRectDragEnd"
        />

        <!-- 拖拽中矩形 / 笔画 -->
        <div
          v-if="drawingRect"
          class="node-inpaint-shape is-pending"
          :style="{
            left: `${drawingRect.x}px`,
            top: `${drawingRect.y}px`,
            width: `${drawingRect.width}px`,
            height: `${drawingRect.height}px`,
          }"
        />
        <svg
          v-if="liveStroke"
          class="node-inpaint-svg"
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

      <!-- 上沿工具卡：[✕ 重绘] [画笔|矩形] [大小] [撤销] -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="toolbarStyle">
        <div
          class="neo-chrome flex items-center gap-0.5 rounded-xl px-1 py-1"
          :style="counterScaleStyle"
          data-testid="node-inpaint-toolbar"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="node-inpaint-btn node-inpaint-btn--label"
            data-testid="node-inpaint-cancel"
            title="退出局部重绘"
            aria-label="退出局部重绘"
            @click="onCancel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            <span>重绘</span>
          </button>
          <span class="node-inpaint-divider" aria-hidden="true" />
          <button
            type="button"
            class="node-inpaint-btn"
            :class="{ 'is-on': tool === 'brush' }"
            data-testid="node-inpaint-brush"
            title="画笔（涂抹要重绘的区域，松手成芯片）"
            aria-label="画笔"
            @click="tool = 'brush'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" /><path d="M14.8 6.6l2.6 2.6" />
            </svg>
          </button>
          <button
            type="button"
            class="node-inpaint-btn"
            :class="{ 'is-on': tool === 'rect' }"
            data-testid="node-inpaint-rect"
            title="矩形选区（拖框圈出区域，可 8 手柄调整）"
            aria-label="矩形选区"
            @click="tool = 'rect'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
            </svg>
          </button>
          <input
            v-if="tool === 'brush'"
            v-model.number="brushSize"
            type="range"
            min="4"
            max="80"
            step="1"
            class="node-inpaint-slider"
            data-testid="node-inpaint-size"
            title="笔刷大小"
            aria-label="笔刷大小"
          >
          <button
            type="button"
            class="node-inpaint-btn"
            data-testid="node-inpaint-undo"
            title="撤销（移除最后一枚芯片）"
            aria-label="撤销"
            :disabled="!items.length"
            @click="undoLast"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 下沿 prompt 卡：芯片条（缩略 hover / × / + 替换图）+ 大输入区 + 确认（含积分） -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="promptCardStyle">
        <div
          class="neo-chrome flex flex-col gap-1.5 rounded-xl px-2 py-2"
          :style="counterScaleStyleCard"
          data-testid="node-inpaint-card"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <div v-if="items.length" class="node-inpaint-list" data-testid="node-inpaint-chips">
            <ElementChipRow
              v-for="item in items"
              :key="item.id"
              :item="item"
              :highlighted="highlightedId === item.id"
              name-placeholder="区域名（可选）"
              @update:name="item.name = $event"
              @update:modify="item.modify = $event"
              @update:ref-url="item.refUrl = $event"
              @remove="removeChip(item.id)"
              @highlight="highlightedId = $event ? item.id : null"
            />
          </div>
          <div v-else class="px-1 py-0.5 text-[11px]" style="color: var(--neo-text-muted)">
            {{ tool === 'brush' ? '在图上涂抹要重绘的区域，松手即成一处编辑' : '拖框圈出要重绘的区域，可 8 手柄调整与拖动' }}
          </div>
          <textarea
            v-model="prompt"
            class="node-inpaint-prompt"
            rows="3"
            placeholder="描述重绘内容，如：眼珠换成绿色，发蓝光"
            data-testid="node-inpaint-prompt"
          />
          <div class="flex items-center justify-end gap-1.5">
            <span v-if="items.length" class="mr-auto text-[11px]" style="color: var(--neo-text-muted)" data-testid="node-inpaint-count">{{ items.length }}处</span>
            <button
              type="button"
              class="node-inpaint-confirm"
              data-testid="node-inpaint-confirm"
              :disabled="!canConfirm"
              :title="
                !natural ? '原图加载失败，请重试'
                  : !items.length ? '请先在图上涂抹或框选要重绘的区域'
                    : (!prompt.trim() && !items.some((it) => it.modify.trim())) ? '请输入重绘描述'
                      : `生成重绘（消耗 ${CANVAS_TOOL_CREDITS.inpaint} 积分）`
              "
              @click="onConfirm"
            >{{ confirmLabel }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 芯片选区观感（与元素编辑同款） */
.node-inpaint-shape {
  position: absolute;
  border: 1.5px solid rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  border-radius: 2px;
}
.node-inpaint-shape.is-hl {
  border-color: #a89dff;
  background: rgba(168, 157, 255, 0.18);
}
.node-inpaint-shape.is-pending {
  border-style: dashed;
  border-color: #a89dff;
}
.node-inpaint-svg {
  position: absolute;
  pointer-events: none;
  overflow: visible;
}

/* 工具卡 / prompt 卡按钮（与裁剪确认卡同款观感） */
.node-inpaint-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 0.45rem;
  border-radius: 0.5rem;
  color: var(--neo-text);
  transition: background 0.15s ease;
}
.node-inpaint-btn:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-inpaint-btn.is-on {
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
  color: var(--neo-text-primary, var(--neo-text));
}
.node-inpaint-btn--label {
  gap: 0.3rem;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.node-inpaint-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.node-inpaint-divider {
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
}
.node-inpaint-slider {
  width: 76px;
  accent-color: #fff;
  margin: 0 0.35rem;
  cursor: pointer;
}
.node-inpaint-list {
  display: flex;
  max-height: 150px;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.node-inpaint-prompt {
  width: 100%;
  min-height: 72px;
  padding: 0.45rem 0.55rem;
  border: none;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  color: var(--neo-text);
  font-size: 13px;
  line-height: 1.45;
  resize: none;
}
.node-inpaint-prompt:focus {
  outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent);
}
.node-inpaint-prompt::placeholder {
  color: color-mix(in srgb, var(--neo-text) 45%, transparent);
}
.node-inpaint-confirm {
  padding: 0.5rem 1.1rem;
  border-radius: 0.6rem;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  transition: opacity 0.15s ease;
}
.node-inpaint-confirm:hover:not(:disabled) {
  opacity: 0.88;
}
.node-inpaint-confirm:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
