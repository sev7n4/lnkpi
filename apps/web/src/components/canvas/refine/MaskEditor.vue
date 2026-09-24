<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { studioApi } from '@/services/studio-api'
import { sameOriginApiMediaUrl } from '@/services/media-url'
import { isMaskDrawReady, isRealBitmapSize } from './maskCanvasReady'
import { countMaskPixelsFromImageData, exportMaskPng } from './maskExport'
import { fillPolygonMask, isNearPolygonStart } from './maskPolygon'
import { floodFillMask, invertMaskRgba, parseFillHex } from './maskWand'
import { ellipseFromDrag } from './maskEllipse'
import { shapeStyleForOp } from './maskShape'

export type MaskTool = 'brush' | 'eraser' | 'rect' | 'ellipse' | 'wand' | 'polygon' | 'point'
export type MaskOp = 'add' | 'subtract'

const props = withDefaults(
  defineProps<{
    url: string
    width?: number
    height?: number
    tool?: MaskTool
    brushSize?: number
    disabled?: boolean
    surface?: 'panel' | 'node'
    color?: string
    wandTolerance?: number
    maskOp?: MaskOp
  }>(),
  {
    tool: 'brush',
    brushSize: 24,
    disabled: false,
    surface: 'panel',
    color: '#ffffff',
    wandTolerance: 24,
    maskOp: 'add',
  },
)

const emit = defineEmits<{
  coverage: [payload: { ratio: number; width: number; height: number }]
  pointSelect: [payload: { x: number; y: number }]
  /** 撤销 / 重做栈深变化（rail 的撤销重做按钮据此置灰） */
  history: [payload: { undo: number; redo: number }]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const sizeReady = ref(false)
const drawReady = computed(() =>
  isMaskDrawReady({ disabled: props.disabled, sizeReady: sizeReady.value }),
)

let drawing = false
let lastX = 0
let lastY = 0
let rectStart: { x: number; y: number } | null = null
let snapshot: ImageData | null = null
let sizeToken = 0
let imageRgba: Uint8ClampedArray | null = null
let polygonPoints: Array<{ x: number; y: number }> = []
const polygonPreview = ref<Array<{ x: number; y: number }> | null>(null)

/** 蒙版历史栈：每次「落笔生效」前压栈，供 rail 撤销 / 重做（follow-up 需求 #13） */
const MASK_HISTORY_LIMIT = 30
const maskUndoStack: ImageData[] = []
const maskRedoStack: ImageData[] = []
const historyDepth = ref({ undo: 0, redo: 0 })

function notifyMaskHistory() {
  historyDepth.value = { undo: maskUndoStack.length, redo: maskRedoStack.length }
  emit('history', { ...historyDepth.value })
}

function pushMaskHistory(ctx: CanvasRenderingContext2D) {
  const canvas = canvasRef.value
  if (!canvas) return
  maskUndoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  if (maskUndoStack.length > MASK_HISTORY_LIMIT) maskUndoStack.shift()
  maskRedoStack.length = 0
}

function undoMask() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || !maskUndoStack.length) return
  cancelPolygonDraft()
  maskRedoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  ctx.putImageData(maskUndoStack.pop()!, 0, 0)
  emitCoverage()
  notifyMaskHistory()
}

function redoMask() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || !maskRedoStack.length) return
  cancelPolygonDraft()
  maskUndoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  ctx.putImageData(maskRedoStack.pop()!, 0, 0)
  emitCoverage()
  notifyMaskHistory()
}

function cancelPolygonDraft() {
  polygonPoints = []
  polygonPreview.value = null
}

function commitPolygon(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  if (polygonPoints.length < 3) {
    cancelPolygonDraft()
    return
  }
  const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const next = fillPolygonMask({
    width: canvas.width,
    height: canvas.height,
    maskRgba: mask.data,
    points: polygonPoints,
    fillRgb: parseFillHex(props.color),
    mode: props.maskOp === 'subtract' ? 'subtract' : 'add',
  })
  pushMaskHistory(ctx)
  putRgba(ctx, next, canvas.width, canvas.height)
  cancelPolygonDraft()
  emitCoverage()
}

function emitCoverage() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const counted = countMaskPixelsFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
  emit('coverage', counted)
}

function clearCanvas() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  pushMaskHistory(ctx)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  emitCoverage()
}

function resizeCanvas(width: number, height: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  if (!isRealBitmapSize(width, height)) return
  const nextWidth = Math.round(width)
  const nextHeight = Math.round(height)
  if (sizeReady.value) return
  canvas.width = nextWidth
  canvas.height = nextHeight
  sizeReady.value = true
  // 位图尺寸变了，旧快照尺寸不匹配，历史栈必须作废
  maskUndoStack.length = 0
  maskRedoStack.length = 0
  notifyMaskHistory()
  emitCoverage()
  loadImageRgba(nextWidth, nextHeight)
}

function loadImageRgba(width: number, height: number) {
  imageRgba = null
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const off = document.createElement('canvas')
    off.width = width
    off.height = height
    const ctx = off.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0, width, height)
    try {
      imageRgba = ctx.getImageData(0, 0, width, height).data
    } catch {
      imageRgba = null
    }
  }
  img.src = sameOriginApiMediaUrl(props.url)
}

async function resolveBitmapSize() {
  const token = ++sizeToken
  if (isRealBitmapSize(props.width, props.height)) {
    if (token === sizeToken) resizeCanvas(Number(props.width), Number(props.height))
    return
  }
  try {
    const probed = await studioApi.probeMedia(props.url)
    if (token !== sizeToken) return
    const probedWidth = Number(probed.width)
    const probedHeight = Number(probed.height)
    if (isRealBitmapSize(probedWidth, probedHeight)) {
      resizeCanvas(probedWidth, probedHeight)
      return
    }
  } catch {
    // fall through to image element
  }
  if (token !== sizeToken) return
  const img = new Image()
  img.onload = () => {
    if (token !== sizeToken) return
    resizeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height)
  }
  img.src = props.url
}

watch(
  () => props.url,
  () => {
    sizeReady.value = false
    imageRgba = null
    void resolveBitmapSize()
  },
)

watch(
  () => [props.width, props.height] as const,
  () => {
    void resolveBitmapSize()
  },
)

function canvasPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / Math.max(rect.width, 1)
  const scaleY = canvas.height / Math.max(rect.height, 1)
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

function paintDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const radius = Math.max(1, props.brushSize / 2)
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function paintStroke(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function applyToolStyle(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, props.brushSize)
  const style = shapeStyleForOp(props.tool === 'eraser' || props.maskOp === 'subtract' ? 'subtract' : 'add', props.color)
  ctx.globalCompositeOperation = style.composite
  ctx.strokeStyle = style.stroke
  ctx.fillStyle = style.fill
}

function putRgba(ctx: CanvasRenderingContext2D, rgba: Uint8ClampedArray, width: number, height: number) {
  const data = new Uint8ClampedArray(rgba)
  ctx.putImageData(new ImageData(data, width, height), 0, 0)
}

function invertCanvas() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  pushMaskHistory(ctx)
  const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
  putRgba(ctx, invertMaskRgba(mask.data), canvas.width, canvas.height)
  emitCoverage()
}

function onPointerDown(event: PointerEvent) {
  if (!drawReady.value) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const pt = canvasPoint(event)
  if (props.tool === 'point') {
    emit('pointSelect', { x: Math.round(pt.x), y: Math.round(pt.y) })
    return
  }
  if (props.tool === 'wand') {
    if (!imageRgba) return
    pushMaskHistory(ctx)
    const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const filled = floodFillMask({
      width: canvas.width,
      height: canvas.height,
      imageRgba,
      maskRgba: mask.data,
      x: pt.x,
      y: pt.y,
      tolerance: props.wandTolerance,
      fillRgb: parseFillHex(props.color),
      mode: props.maskOp === 'subtract' ? 'subtract' : 'add',
    })
    putRgba(ctx, filled, canvas.width, canvas.height)
    emitCoverage()
    return
  }
  if (props.tool === 'polygon') {
    if (polygonPoints.length >= 3 && isNearPolygonStart(polygonPoints, pt.x, pt.y)) {
      commitPolygon(ctx, canvas)
      return
    }
    polygonPoints.push(pt)
    polygonPreview.value = [...polygonPoints]
    return
  }
  canvas.setPointerCapture(event.pointerId)
  drawing = true
  lastX = pt.x
  lastY = pt.y
  applyToolStyle(ctx)
  if (props.tool === 'rect' || props.tool === 'ellipse') {
    pushMaskHistory(ctx)
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    rectStart = pt
    return
  }
  pushMaskHistory(ctx)
  paintDot(ctx, pt.x, pt.y)
}

function onDblClick(event: MouseEvent) {
  if (props.tool !== 'polygon' || !drawReady.value) return
  event.preventDefault()
  if (polygonPoints.length >= 4) polygonPoints.pop()
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  commitPolygon(ctx, canvas)
}

function onPointerMove(event: PointerEvent) {
  if (props.tool === 'wand' || props.tool === 'point') return
  if (props.tool === 'polygon') {
    if (!drawReady.value) return
    const pt = canvasPoint(event)
    polygonPreview.value = [...polygonPoints, pt]
    return
  }
  if (!drawing || !drawReady.value) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const pt = canvasPoint(event)
  if ((props.tool === 'rect' || props.tool === 'ellipse') && rectStart && snapshot) {
    ctx.putImageData(snapshot, 0, 0)
    const style = shapeStyleForOp(props.maskOp === 'subtract' ? 'subtract' : 'add', props.color)
    ctx.globalCompositeOperation = style.composite
    ctx.fillStyle = style.fill
    if (props.tool === 'rect') {
      const x = Math.min(rectStart.x, pt.x)
      const y = Math.min(rectStart.y, pt.y)
      ctx.fillRect(x, y, Math.abs(pt.x - rectStart.x), Math.abs(pt.y - rectStart.y))
    } else {
      const e = ellipseFromDrag({ start: rectStart, end: pt, shiftKey: event.shiftKey })
      ctx.beginPath()
      ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }
  applyToolStyle(ctx)
  paintStroke(ctx, lastX, lastY, pt.x, pt.y)
  lastX = pt.x
  lastY = pt.y
}

function onPointerUp(event: PointerEvent) {
  if (!drawing) return
  drawing = false
  rectStart = null
  snapshot = null
  try {
    canvasRef.value?.releasePointerCapture(event.pointerId)
  } catch {
    // already released
  }
  emitCoverage()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') cancelPolygonDraft()
}

watch(
  () => props.tool,
  () => {
    cancelPolygonDraft()
  },
)

onMounted(() => {
  void resolveBitmapSize()
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  drawing = false
  window.removeEventListener('keydown', onKeyDown)
})

async function exportPng(): Promise<Blob> {
  const canvas = canvasRef.value
  if (!canvas) throw new Error('mask canvas unavailable')
  return exportMaskPng(canvas)
}

const polygonPolyline = computed(() => {
  const pts = polygonPreview.value
  if (!pts?.length) return ''
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
})

defineExpose({
  getCanvas: () => canvasRef.value,
  exportPng,
  clear: clearCanvas,
  invert: invertCanvas,
  cancelPolygonDraft,
  undo: undoMask,
  redo: redoMask,
  historyDepth,
})
</script>

<template>
  <div class="mask-editor" :class="{ 'mask-editor--node': surface === 'node' }">
    <img
      v-if="surface !== 'node'"
      class="mask-editor__image"
      :src="url"
      alt=""
      draggable="false"
    >
    <canvas
      ref="canvasRef"
      class="mask-editor__canvas nodrag nowheel"
      :class="{ 'is-disabled': !drawReady }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDblClick"
    />
    <svg
      v-if="polygonPolyline && canvasRef"
      class="mask-editor__polygon-preview"
      :viewBox="`0 0 ${canvasRef.width} ${canvasRef.height}`"
      preserveAspectRatio="none"
    >
      <polyline
        :points="polygonPolyline"
        fill="none"
        :stroke="color"
        stroke-width="2"
        stroke-dasharray="4 3"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  </div>
</template>

<style scoped>
.mask-editor {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.mask-editor__image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  pointer-events: none;
}

.mask-editor__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
  opacity: 0.55;
  mix-blend-mode: screen;
}

.mask-editor__canvas.is-disabled {
  pointer-events: none;
  cursor: not-allowed;
}

.mask-editor__polygon-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.9;
}

.mask-editor--node {
  position: absolute;
  inset: 0;
  display: block;
  max-width: none;
}

.mask-editor--node .mask-editor__canvas {
  width: 100%;
  height: 100%;
  opacity: 0.55;
  mix-blend-mode: screen;
}
</style>
