<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { studioApi } from '@/services/studio-api'
import { isMaskDrawReady, isRealBitmapSize } from './maskCanvasReady'
import { countMaskPixelsFromImageData, exportMaskPng } from './maskExport'
import { floodFillMask, invertMaskRgba, parseFillHex } from './maskWand'

export type MaskTool = 'brush' | 'eraser' | 'rect' | 'wand'

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
  }>(),
  {
    tool: 'brush',
    brushSize: 24,
    disabled: false,
    surface: 'panel',
    color: '#ffffff',
    wandTolerance: 24,
  },
)

const emit = defineEmits<{
  coverage: [payload: { ratio: number; width: number; height: number }]
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
  if (!isRealBitmapSize(width, height)) return
  const nextWidth = Math.round(width)
  const nextHeight = Math.round(height)
  if (sizeReady.value) return
  canvas.width = nextWidth
  canvas.height = nextHeight
  sizeReady.value = true
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
  img.src = props.url
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
    ctx.strokeStyle = props.color
    ctx.fillStyle = props.color
  }
}

function invertCanvas() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const next = invertMaskRgba(mask.data)
  ctx.putImageData(new ImageData(next, canvas.width, canvas.height), 0, 0)
  emitCoverage()
}

function onPointerDown(event: PointerEvent) {
  if (!drawReady.value) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const pt = canvasPoint(event)
  if (props.tool === 'wand') {
    if (!imageRgba) return
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
    })
    ctx.putImageData(new ImageData(filled, canvas.width, canvas.height), 0, 0)
    emitCoverage()
    return
  }
  canvas.setPointerCapture(event.pointerId)
  drawing = true
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
  if (props.tool === 'wand') return
  if (!drawing || !drawReady.value) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const pt = canvasPoint(event)
  if (props.tool === 'rect' && rectStart && snapshot) {
    ctx.putImageData(snapshot, 0, 0)
    applyToolStyle(ctx)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = props.color
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
  invert: invertCanvas,
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
    />
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
