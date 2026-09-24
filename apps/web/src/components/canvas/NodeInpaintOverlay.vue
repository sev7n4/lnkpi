<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import { countMaskPixelsFromImageData } from './refine/maskExport'

/**
 * 节点直出局部重绘（轻量复刻竞品，2026-09-24 用户拍板）：
 * 单击图片节点 → 浮层「局部重绘」→ 节点卡上直接刷蒙版（半透明白笔刷），
 * 上沿工具卡：[✕ 重绘] [画笔/橡皮] [大小滑块] [撤销/重做/清空]；
 * 下沿 prompt 卡：textarea + 确认（**无张数/比例/分辨率**，size 'auto'，用户微调要求）。
 *
 * 蒙版 canvas 按原图自然分辨率建立（与 imageUrl 同尺寸），显示层缩放至节点卡；
 * 确认时上抛 { prompt, maskCanvas }，宿主（CanvasPage）exportMaskPng → persist →
 * image/edit mode:'edit' 生成链路。
 */
const props = defineProps<{
  node: { id: string; type?: string | null; data?: Record<string, unknown> }
  /** 节点原图 url（蒙版按其自然尺寸建立） */
  url: string
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: { prompt: string; maskCanvas: HTMLCanvasElement }]
  cancel: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const TOOLBAR_GAP_PX = 8
const TOOLBAR_ESTIMATED_H = 40
const PROMPT_GAP_PX = 8
/** prompt 卡估高（屏幕 px）与底部生成 dock 预留高度：用于「下沿放不下 → 整卡翻上沿」判定。 */
const CARD_ESTIMATED_H = 180
const DOCK_RESERVE_PX = 330
const HISTORY_MAX = 10

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const natural = ref<{ w: number; h: number } | null>(null)
const tool = ref<'brush' | 'eraser'>('brush')
const brushSize = ref(24)
const prompt = ref('')
/** 蒙版是否已有可提交的覆盖（>0.3% 与服务端 MIN_MASK_COVERAGE 对齐的空提示走 maskCoverage） */
const coverage = ref(0)
const loadToken = ref(0)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const toolbarAbove = ref(true)
const cardAbove = ref(false)

const canConfirm = computed(
  () => !props.busy && !!natural.value && coverage.value > 0 && prompt.value.trim().length > 0,
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

/** prompt 卡默认下沿（工具条翻下时顺延错开，避免同位重叠）；下沿空间不足（含底部 dock 预留）翻上沿。
 *  2026-09-24 用户反馈：卡体对齐竞品——与节点同宽（下限 320），大输入区。 */
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

async function loadNatural() {
  const token = ++loadToken.value
  const url = props.url
  natural.value = null
  coverage.value = 0
  resetHistory()
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
  // prompt 卡：下方空间不足（含底部生成 dock 预留）且上方有足够空间才翻上沿；
  // 节点贴顶时保持下沿（部分被 dock 遮挡，用户平移画布即可），避免卡片大部分落到视口外。
  const belowAvail = window.innerHeight - DOCK_RESERVE_PX - bottomScreen
  cardAbove.value =
    belowAvail < CARD_ESTIMATED_H && topScreen - PROMPT_GAP_PX > CARD_ESTIMATED_H * 0.6
  toolbarAbove.value =
    !cardAbove.value && topScreen - TOOLBAR_GAP_PX - TOOLBAR_ESTIMATED_H > 0
}

// —— 蒙版绘制（画笔 / 橡皮 + 撤销重做） ——

type Ctx2D = CanvasRenderingContext2D

function ctxOf(): Ctx2D | null {
  return canvasRef.value?.getContext('2d') ?? null
}

/** 撤销 / 重做栈（ImageData 快照；换图 / 清空时重置） */
const undoStack: ImageData[] = []
const redoStack: ImageData[] = []

function resetHistory() {
  undoStack.length = 0
  redoStack.length = 0
}

function snapshot(): ImageData | null {
  const ctx = ctxOf()
  const c = canvasRef.value
  if (!ctx || !c) return null
  return ctx.getImageData(0, 0, c.width, c.height)
}

function refreshCoverage() {
  const ctx = ctxOf()
  const c = canvasRef.value
  if (!ctx || !c) {
    coverage.value = 0
    return
  }
  coverage.value = countMaskPixelsFromImageData(ctx.getImageData(0, 0, c.width, c.height)).ratio
}

function pushUndo() {
  const snap = snapshot()
  if (!snap) return
  undoStack.push(snap)
  if (undoStack.length > HISTORY_MAX) undoStack.shift()
  redoStack.length = 0
}

function undo() {
  const ctx = ctxOf()
  const c = canvasRef.value
  if (!ctx || !c || !undoStack.length) return
  const current = snapshot()
  if (current) redoStack.push(current)
  ctx.putImageData(undoStack.pop()!, 0, 0)
  refreshCoverage()
}

function redo() {
  const ctx = ctxOf()
  const c = canvasRef.value
  if (!ctx || !c || !redoStack.length) return
  const current = snapshot()
  if (current) undoStack.push(current)
  ctx.putImageData(redoStack.pop()!, 0, 0)
  refreshCoverage()
}

function clearMask() {
  const ctx = ctxOf()
  const c = canvasRef.value
  if (!ctx || !c) return
  pushUndo()
  ctx.clearRect(0, 0, c.width, c.height)
  coverage.value = 0
}

/** 笔刷半径（画布像素）= 显示直径/2 × (画布宽 / 显示宽) */
function brushRadiusPx(stageRect: DOMRect): number {
  const c = canvasRef.value
  if (!c) return 12
  return (brushSize.value / 2) * (c.width / Math.max(1, stageRect.width))
}

function canvasPoint(event: PointerEvent): { x: number; y: number; rect: DOMRect } | null {
  const c = canvasRef.value
  if (!c) return null
  const rect = c.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * c.width,
    y: ((event.clientY - rect.top) / rect.height) * c.height,
    rect,
  }
}

function strokeTo(ctx: Ctx2D, p: { x: number; y: number }, r: number) {
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  // 单击点也要成点：补一个圆
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
}

let drawing = false
let drawCtx: Ctx2D | null = null
let drawRadius = 12

function onStagePointerDown(event: PointerEvent) {
  if (props.busy || !natural.value) return
  const ctx = ctxOf()
  const pt = canvasPoint(event)
  if (!ctx || !pt) return
  event.stopPropagation()
  pushUndo()
  drawing = true
  drawCtx = ctx
  drawRadius = brushRadiusPx(pt.rect)
  ctx.save()
  ctx.globalCompositeOperation = tool.value === 'eraser' ? 'destination-out' : 'source-over'
  // 蒙版像素恒为不透明白（擦除走 destination-out 连 premultiplied rgb 一起清零，
  // 保证 exportMaskPng 的 alpha/luma 阈值判定可靠）；半透明观感由 CSS opacity 提供
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = drawRadius * 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pt.x, pt.y)
  strokeTo(ctx, pt, drawRadius)
  window.addEventListener('pointermove', onStagePointerMove)
  window.addEventListener('pointerup', onStagePointerUp)
}

function onStagePointerMove(event: PointerEvent) {
  if (!drawing || !drawCtx) return
  const pt = canvasPoint(event)
  if (!pt) return
  strokeTo(drawCtx, pt, drawRadius)
}

function onStagePointerUp() {
  if (drawing && drawCtx) {
    drawCtx.restore()
    refreshCoverage()
  }
  drawing = false
  drawCtx = null
  window.removeEventListener('pointermove', onStagePointerMove)
  window.removeEventListener('pointerup', onStagePointerUp)
}

function onConfirm() {
  const c = canvasRef.value
  if (!canConfirm.value || !c) return
  emit('confirm', { prompt: prompt.value.trim(), maskCanvas: c })
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
      <!-- 蒙版绘制层：节点卡上直接刷 -->
      <div
        v-if="abs && natural"
        class="pointer-events-auto absolute overflow-hidden rounded-lg"
        :style="stageStyle"
        data-testid="node-inpaint-stage"
        @pointerdown="onStagePointerDown"
        @mousedown.stop
        @click.stop
      >
        <canvas
          ref="canvasRef"
          class="node-inpaint-canvas"
          :width="natural.w"
          :height="natural.h"
          data-testid="node-inpaint-canvas"
        />
      </div>

      <!-- 上沿工具卡：[✕ 重绘] [画笔|橡皮] [大小] [撤销 重做 清空] -->
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
            title="画笔（涂抹要重绘的区域）"
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
            :class="{ 'is-on': tool === 'eraser' }"
            data-testid="node-inpaint-eraser"
            title="橡皮（擦除蒙版）"
            aria-label="橡皮"
            @click="tool = 'eraser'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 20H8.5l-4.2-4.2a1.5 1.5 0 0 1 0-2.1L13.7 4.3a1.5 1.5 0 0 1 2.1 0l4.9 4.9a1.5 1.5 0 0 1 0 2.1L13 19" />
            </svg>
          </button>
          <input
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
          <span class="node-inpaint-divider" aria-hidden="true" />
          <button
            type="button"
            class="node-inpaint-btn"
            data-testid="node-inpaint-undo"
            title="撤销 (⌘Z)"
            aria-label="撤销"
            @click="undo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
          <button
            type="button"
            class="node-inpaint-btn"
            data-testid="node-inpaint-redo"
            title="重做 (⇧⌘Z)"
            aria-label="重做"
            @click="redo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" />
            </svg>
          </button>
          <button
            type="button"
            class="node-inpaint-btn"
            data-testid="node-inpaint-clear"
            title="清空蒙版"
            aria-label="清空蒙版"
            @click="clearMask"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 下沿 prompt 卡（竞品尺寸）：大输入区 + 底部右侧确认（无张数/比例/分辨率） -->
      <div v-if="abs && natural" class="pointer-events-auto absolute" :style="promptCardStyle">
        <div
          class="neo-chrome flex flex-col gap-1.5 rounded-xl px-2 py-2"
          data-testid="node-inpaint-card"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <textarea
            v-model="prompt"
            class="node-inpaint-prompt"
            rows="4"
            placeholder="描述重绘内容，如：眼珠换成绿色，发蓝光"
            data-testid="node-inpaint-prompt"
            @keydown.enter.exact.prevent="onConfirm"
          />
          <div class="flex items-center justify-end">
            <button
              type="button"
              class="node-inpaint-confirm"
              data-testid="node-inpaint-confirm"
              :disabled="!canConfirm"
              :title="
                !natural ? '原图加载失败，请重试'
                  : coverage <= 0 ? '请先在图上涂抹要重绘的区域'
                    : !prompt.trim() ? '请输入重绘描述'
                      : '生成重绘（下游新节点）'
              "
              @click="onConfirm"
            >{{ busy ? '重绘中…' : '确认' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-inpaint-canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* 蒙版像素为不透明白，显示层用 opacity 提供半透明涂抹观感 */
  opacity: 0.55;
  cursor: crosshair;
  touch-action: none;
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
.node-inpaint-prompt {
  width: 100%;
  min-height: 96px;
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
