<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { studioApi } from '@/services/studio-api'
import { countMaskPixelsFromImageData, exportMaskPng } from './maskExport'

export type MaskTool = 'brush' | 'eraser' | 'rect'

const props = withDefaults(
  defineProps<{
    url: string
    width?: number
    height?: number
    tool?: MaskTool
    brushSize?: number
    disabled?: boolean
  }>(),
  {
    tool: 'brush',
    brushSize: 24,
    disabled: false,
  },
)

const emit = defineEmits<{
  coverage: [payload: { ratio: number; width: number; height: number }]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

let drawing = false
let lastX = 0
let lastY = 0
let rectStart: { x: number; y: number } | null = null
let snapshot: ImageData | null = null
let sizeToken = 0

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
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  emitCoverage()
}

function resizeCanvas(width: number, height: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  emitCoverage()
}

async function resolveBitmapSize() {
  const token = ++sizeToken
  if (props.width && props.height) {
    if (token === sizeToken) resizeCanvas(props.width, props.height)
    return
  }
  try {
    const probed = await studioApi.probeMedia(props.url)
    if (token !== sizeToken) return
    if (probed.width && probed.height) {
      resizeCanvas(probed.width, probed.height)
      return
    }
  } catch {
    // fall through to image element
  }
  if (token !== sizeToken) return
  const img = new Image()
  img.onload = () => {
    if (token !== sizeToken) return
    resizeCanvas(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1)
  }
  img.onerror = () => {
    if (token !== sizeToken) return
    resizeCanvas(1, 1)
  }
  img.src = props.url
}

watch(
  () => [props.url, props.width, props.height] as const,
  () => {
    void resolveBitmapSize()
  },
)

onMounted(() => {
  void resolveBitmapSize()
})

function canvasPoint(event: PointerEvent): { x: number; y: number } {
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
  if (props.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
    ctx.fillStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(255,255,255,1)'
    ctx.fillStyle = 'rgba(255,255,255,1)'
  }
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  canvas.setPointerCapture(event.pointerId)
  drawing = true
  const pt = canvasPoint(event)
  lastX = pt.x
  lastY = pt.y
  applyToolStyle(ctx)
  if (props.tool === 'rect') {
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    rectStart = pt
    return
  }
  paintDot(ctx, pt.x, pt.y)
}

function onPointerMove(event: PointerEvent) {
  if (!drawing || props.disabled) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const pt = canvasPoint(event)
  if (props.tool === 'rect' && rectStart && snapshot) {
    ctx.putImageData(snapshot, 0, 0)
    applyToolStyle(ctx)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(255,255,255,1)'
    const x = Math.min(rectStart.x, pt.x)
    const y = Math.min(rectStart.y, pt.y)
    ctx.fillRect(x, y, Math.abs(pt.x - rectStart.x), Math.abs(pt.y - rectStart.y))
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

onBeforeUnmount(() => {
  drawing = false
})

async function exportPng(): Promise<Blob> {
  const canvas = canvasRef.value
  if (!canvas) throw new Error('mask canvas unavailable')
  return exportMaskPng(canvas)
}

defineExpose({
  getCanvas: () => canvasRef.value,
  exportPng,
  clear: clearCanvas,
})
</script>

<template>
  <div class="mask-editor">
    <img
      class="mask-editor__image"
      :src="url"
      alt=""
      draggable="false"
    >
    <canvas
      ref="canvasRef"
      class="mask-editor__canvas"
      :class="{ 'is-disabled': disabled }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerUp"
    />
  </div>
</template>

<style scoped>
.mask-editor {
  position: relative;
  display: flex;
  max-width: 100%;
  max-height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
}

.mask-editor__image {
  display: block;
  max-width: 100%;
  max-height: 100%;
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
</style>
