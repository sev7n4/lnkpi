<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import type { CropRect } from './refine/cropGeometry'
import {
  ANNOTATE_TOOLS,
  drawAnnotates,
  type AnnotateShape,
  type AnnotateTool,
} from './annotateModel'

/**
 * 节点直出标注（2026-09-25 复刻竞品工具条 + 用户扩展）：
 * 上沿工具条 [✕ 标注] | [画笔][框选][文字][直线][箭头][马赛克][水印][签名] | [颜色][粗细][平铺] | [撤销][重做] | [保存·免费]
 *  - 展示与烧录同一套 drawAnnotates()（原图 + 马赛克像素化 + 矢量叠加）；
 *  - 文字 / 水印：点击落点 → 浮动输入框，Enter 确认（水印支持平铺开关）；
 *  - 撤销 / 重做：操作快照双栈；
 *  - 保存：canvas 烧录导出 → 下游新节点（纯本地处理，免费不消耗积分）。
 */
const props = defineProps<{
  node: { id: string; type?: string | null; data?: Record<string, unknown> }
  url: string
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: { ops: AnnotateShape[] }]
  cancel: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const TOOLBAR_GAP_PX = 8
const TOOLBAR_ESTIMATED_H = 40

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const natural = ref<{ w: number; h: number } | null>(null)
const loadToken = ref(0)
const sourceOk = ref(false)
let sourceImg: HTMLImageElement | null = null

const tool = ref<AnnotateTool>('brush')
const color = ref('#ff5a2b')
const strokeWidth = ref(6)
const watermarkTiled = ref(true)

/** 已确认操作（历史）+ 撤销 / 重做栈 */
const ops = ref<AnnotateShape[]>([])
const undoStack = ref<AnnotateShape[][]>([])
const redoStack = ref<AnnotateShape[][]>([])

const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

function pushHistory() {
  undoStack.value = [...undoStack.value.slice(-29), [...ops.value]]
  redoStack.value = []
}

function undo() {
  const prev = undoStack.value[undoStack.value.length - 1]
  if (!prev) return
  undoStack.value = undoStack.value.slice(0, -1)
  redoStack.value = [...redoStack.value, [...ops.value]]
  ops.value = prev
}

function redo() {
  const next = redoStack.value[redoStack.value.length - 1]
  if (!next) return
  redoStack.value = redoStack.value.slice(0, -1)
  undoStack.value = [...undoStack.value, [...ops.value]]
  ops.value = next
}

/** 拖拽中的临时形状（画笔/框选/直线/箭头/马赛克） */
const liveStroke = ref<{ points: { x: number; y: number }[] } | null>(null)
const liveRect = ref<CropRect | null>(null)
const liveLine = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
let dragStart: { x: number; y: number } | null = null

/** 文字 / 水印浮动输入 */
const textDraft = ref<{ x: number; y: number; value: string } | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)

const toolbarAbove = ref(true)

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
const counterScaleStyle = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: toolbarAbove.value ? '50% 100%' : '50% 0%',
}))

async function loadNatural() {
  const token = ++loadToken.value
  const url = props.url
  natural.value = null
  sourceOk.value = false
  sourceImg = null
  ops.value = []
  undoStack.value = []
  redoStack.value = []
  if (!url) return
  try {
    const img = await loadCropSourceImage(url)
    if (token !== loadToken.value) return
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      natural.value = { w: img.naturalWidth, h: img.naturalHeight }
      sourceImg = img
      sourceOk.value = true
      rerender()
    }
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
  toolbarAbove.value = topScreen - TOOLBAR_GAP_PX - TOOLBAR_ESTIMATED_H > 0
}

// —— 渲染（canvas 全量重画：已确认 ops + 拖拽中的 live 形状） ——

const canvasRef = ref<HTMLCanvasElement | null>(null)

function rerender() {
  const canvas = canvasRef.value
  const n = natural.value
  if (!canvas || !n || !sourceImg) return
  const all: AnnotateShape[] = [...ops.value]
  const size = strokeWidth.value
  const c = color.value
  if (liveStroke.value) {
    all.push({ kind: 'stroke', stroke: { points: liveStroke.value.points, size, color: c } })
  }
  if (liveRect.value) {
    all.push(
      tool.value === 'mosaic'
        ? { kind: 'mosaic', rect: liveRect.value, block: Math.max(8, size * 2) }
        : { kind: 'rect', rect: liveRect.value, size, color: c },
    )
  }
  if (liveLine.value) {
    all.push({ kind: 'line', ...liveLine.value, size, color: c, arrow: tool.value === 'arrow' })
  }
  drawAnnotates(canvas, all, sourceImg, n.w, n.h, box.value.w, box.value.h)
}

watch([ops, liveStroke, liveRect, liveLine, strokeWidth, color], rerender, { deep: true })

// —— 交互 ——

const stageRef = ref<HTMLElement | null>(null)
function stagePoint(event: PointerEvent): { x: number; y: number } | null {
  const el = stageRef.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * box.value.w,
    y: ((event.clientY - rect.top) / rect.height) * box.value.h,
  }
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
  if (tool.value === 'text' || tool.value === 'watermark') {
    textDraft.value = { x: p.x, y: p.y, value: '' }
    requestAnimationFrame(() => textInputRef.value?.focus())
    return
  }
  dragStart = p
  if (tool.value === 'brush' || tool.value === 'sign') {
    liveStroke.value = { points: [p] }
  } else if (tool.value === 'rect' || tool.value === 'mosaic') {
    liveRect.value = { x: p.x, y: p.y, width: 0, height: 0 }
  } else if (tool.value === 'line' || tool.value === 'arrow') {
    liveLine.value = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  }
  window.addEventListener('pointermove', onStagePointerMove)
  window.addEventListener('pointerup', onStagePointerUp)
}

function onStagePointerMove(event: PointerEvent) {
  const pt = stagePoint(event)
  if (!pt) return
  const p = clampPoint(pt)
  if ((tool.value === 'brush' || tool.value === 'sign') && liveStroke.value) {
    liveStroke.value.points.push(p)
    return
  }
  if ((tool.value === 'rect' || tool.value === 'mosaic') && dragStart) {
    liveRect.value = {
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      width: Math.abs(p.x - dragStart.x),
      height: Math.abs(p.y - dragStart.y),
    }
    return
  }
  if ((tool.value === 'line' || tool.value === 'arrow') && dragStart) {
    liveLine.value = { x0: dragStart.x, y0: dragStart.y, x1: p.x, y1: p.y }
  }
}

function onStagePointerUp() {
  window.removeEventListener('pointermove', onStagePointerMove)
  window.removeEventListener('pointerup', onStagePointerUp)
  const size = strokeWidth.value
  const c = color.value
  if ((tool.value === 'brush' || tool.value === 'sign') && liveStroke.value) {
    if (liveStroke.value.points.length > 0) {
      pushHistory()
      ops.value = [...ops.value, { kind: 'stroke', stroke: { points: liveStroke.value.points, size, color: c } }]
    }
    liveStroke.value = null
    return
  }
  if ((tool.value === 'rect' || tool.value === 'mosaic') && liveRect.value && dragStart) {
    const r = liveRect.value
    if (r.width >= 6 && r.height >= 6) {
      pushHistory()
      ops.value = tool.value === 'mosaic'
        ? [...ops.value, { kind: 'mosaic', rect: r, block: Math.max(8, size * 2) }]
        : [...ops.value, { kind: 'rect', rect: r, size, color: c }]
    }
    liveRect.value = null
    dragStart = null
    return
  }
  if ((tool.value === 'line' || tool.value === 'arrow') && liveLine.value && dragStart) {
    const l = liveLine.value
    if (Math.hypot(l.x1 - l.x0, l.y1 - l.y0) >= 8) {
      pushHistory()
      ops.value = [...ops.value, { kind: 'line', ...l, size, color: c, arrow: tool.value === 'arrow' }]
    }
    liveLine.value = null
    dragStart = null
  }
}

function commitTextDraft() {
  const draft = textDraft.value
  if (!draft) return
  const value = draft.value.trim()
  textDraft.value = null
  if (!value) return
  pushHistory()
  if (tool.value === 'watermark') {
    ops.value = [
      ...ops.value,
      {
        kind: 'watermark',
        x: draft.x,
        y: draft.y,
        text: value,
        size: Math.max(14, strokeWidth.value * 3),
        color: color.value,
        opacity: 0.55,
        tiled: watermarkTiled.value,
      },
    ]
  } else {
    ops.value = [
      ...ops.value,
      { kind: 'text', x: draft.x, y: draft.y, text: value, size: Math.max(14, strokeWidth.value * 3), color: color.value },
    ]
  }
}

function onCancel() {
  emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (textDraft.value) {
      textDraft.value = null
      return
    }
    onCancel()
  }
}

watch(
  () => props.node.id,
  () => {
    updateGeometry()
    tool.value = 'brush'
    textDraft.value = null
    void loadNatural()
  },
  { immediate: true },
)

watch(() => props.url, () => void loadNatural())
watch(viewport, updateGeometry, { deep: true })
watch(flowNodes, updateGeometry, { deep: true })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  rerender()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  onStagePointerUp()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[46] overflow-visible" data-testid="node-annotate-overlay">
    <div class="origin-top-left" :style="transformStyle">
      <!-- 标注画布层（原图 + 马赛克 + 矢量烧录预览） -->
      <div
        v-if="abs && natural"
        ref="stageRef"
        class="pointer-events-auto absolute overflow-hidden rounded-lg"
        :style="stageStyle"
        data-testid="node-annotate-stage"
        @pointerdown="onStagePointerDown"
        @mousedown.stop
        @click.stop
      >
        <canvas ref="canvasRef" class="annotate-canvas" />
        <!-- 文字 / 水印浮动输入 -->
        <input
          v-if="textDraft"
          ref="textInputRef"
          v-model="textDraft.value"
          class="annotate-text-input"
          data-testid="annotate-text-input"
          :placeholder="tool === 'watermark' ? '输入水印文字，Enter 确认' : '输入标注文字，Enter 确认'"
          @keydown.enter.prevent="commitTextDraft"
          @mousedown.stop
          @click.stop
        >
      </div>

      <!-- 上沿工具条 -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="toolbarStyle">
        <div
          class="neo-chrome flex items-center gap-0.5 rounded-xl px-1 py-1"
          :style="counterScaleStyle"
          data-testid="node-annotate-toolbar"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="annotate-btn annotate-btn--label"
            data-testid="node-annotate-cancel"
            title="退出标注"
            aria-label="退出标注"
            @click="onCancel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            <span>标注</span>
          </button>
          <span class="annotate-divider" aria-hidden="true" />
          <button
            v-for="t in ANNOTATE_TOOLS"
            :key="t.id"
            type="button"
            class="annotate-btn"
            :class="{ 'is-on': tool === t.id }"
            :data-testid="`node-annotate-tool-${t.id}`"
            :title="t.id === 'sign' ? '签名：手写自由绘制' : t.label"
            :aria-label="t.label"
            @click="tool = t.id"
          >
            <!-- 图标 -->
            <svg v-if="t.id === 'brush' || t.id === 'sign'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" /><path d="M14.8 6.6l2.6 2.6" />
            </svg>
            <svg v-else-if="t.id === 'rect'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" stroke-dasharray="3 2.4" />
            </svg>
            <svg v-else-if="t.id === 'text'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M5 6h14M12 6v13" />
            </svg>
            <svg v-else-if="t.id === 'line'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M5 19 19 5" />
            </svg>
            <svg v-else-if="t.id === 'arrow'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 19 19 5" /><path d="M11 5h8v8" />
            </svg>
            <svg v-else-if="t.id === 'mosaic'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="7" height="7" opacity="0.9" /><rect x="13" y="4" width="7" height="7" opacity="0.5" /><rect x="4" y="13" width="7" height="7" opacity="0.5" /><rect x="13" y="13" width="7" height="7" opacity="0.9" />
            </svg>
            <svg v-else-if="t.id === 'watermark'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 8h10M4 13h10M17 7.5v9M14.5 12H20" />
            </svg>
          </button>
          <span class="annotate-divider" aria-hidden="true" />
          <input
            v-model="color"
            type="color"
            class="annotate-color"
            data-testid="annotate-color"
            title="颜色"
            aria-label="标注颜色"
          >
          <input
            v-model.number="strokeWidth"
            type="range"
            min="2"
            max="40"
            step="1"
            class="annotate-slider"
            data-testid="annotate-width"
            title="粗细"
            aria-label="标注粗细"
          >
          <label v-if="tool === 'watermark'" class="annotate-tiled" data-testid="annotate-tiled" title="平铺整个画面">
            <input v-model="watermarkTiled" type="checkbox">
            平铺
          </label>
          <span class="annotate-divider" aria-hidden="true" />
          <button
            type="button"
            class="annotate-btn"
            data-testid="node-annotate-undo"
            title="撤销"
            aria-label="撤销"
            :disabled="!canUndo"
            @click="undo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
          <button
            type="button"
            class="annotate-btn"
            data-testid="node-annotate-redo"
            title="重做"
            aria-label="重做"
            :disabled="!canRedo"
            @click="redo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" />
            </svg>
          </button>
          <span class="annotate-divider" aria-hidden="true" />
          <button
            type="button"
            class="annotate-save"
            data-testid="node-annotate-save"
            :disabled="props.busy || !ops.length"
            :title="ops.length ? '烧录标注并生成下游新节点（免费）' : '先添加至少一处标注'"
            @click="emit('confirm', { ops: [...ops] })"
          >{{ props.busy ? '保存中…' : '保存 · 免费' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.annotate-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.annotate-text-input {
  position: absolute;
  min-width: 140px;
  padding: 0.3rem 0.45rem;
  border: none;
  border-radius: 0.4rem;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 13px;
  outline: 1.5px solid var(--neo-accent-text, #a89dff);
}

.annotate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 0.45rem;
  border-radius: 0.5rem;
  color: var(--neo-text);
  transition: background 0.15s ease;
}
.annotate-btn:hover { background: color-mix(in srgb, var(--neo-text) 8%, transparent); }
.annotate-btn.is-on {
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
  color: var(--neo-text-primary, var(--neo-text));
}
.annotate-btn--label {
  gap: 0.3rem;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.annotate-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.annotate-divider {
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
}
.annotate-color {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.annotate-slider {
  width: 72px;
  accent-color: #fff;
  margin: 0 0.35rem;
  cursor: pointer;
}
.annotate-tiled {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 11px;
  color: var(--neo-text);
  white-space: nowrap;
  cursor: pointer;
}
.annotate-save {
  margin-left: 0.25rem;
  padding: 0.42rem 0.85rem;
  border-radius: 0.55rem;
  background: #fff;
  color: #111;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.annotate-save:hover:not(:disabled) { opacity: 0.88; }
.annotate-save:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
