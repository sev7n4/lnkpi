<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import type { HandleDir, Size } from './outpaintGeometry'
import {
  formatCropReadout,
  moveCropRect,
  resizeCropRect,
  rotatedSize,
} from './cropGeometry'

/**
 * 裁剪视口（crop 模式专属，仿 RefineOutpaintCanvas 的独立 v-show 块）：
 *  - 旋转后的原图居中显示，裁剪框叠加其上（恒直立，包围盒坐标系）；
 *  - 框体拖动 + 8 手柄调整；三分线；外部压暗（box-shadow）；
 *  - 视口由组件自身测量（父级 stage 在本模式下 display:none，测得恒 0，不能回流）。
 * 权威草稿在 store（画布 / 右栏面板同源），本组件只把拖拽增量写入。
 */
const props = withDefaults(
  defineProps<{
    baseUrl: string
    baseWidth: number
    baseHeight: number
    busy?: boolean
  }>(),
  { busy: false },
)

const editor = useCanvasEditorStore()

const base = computed<Size>(() => ({ width: Number(props.baseWidth) || 0, height: Number(props.baseHeight) || 0 }))
const theta = computed(() => editor.refineCropRotationDeg)
const bbox = computed(() => rotatedSize(base.value.width, base.value.height, theta.value))
const rect = computed(() => editor.refineCropRect)

/** 进入裁剪模式时写入基准并初始化适配框；基准晚到（自然尺寸探测回填）时重置。 */
function initCropDraft() {
  editor.setRefineCropBase(base.value)
  // 基准变化（换图 / 尺寸回填）后按当前角度 + 比例重适配
  if (editor.refineCropBase) editor.applyCropAspectPreset(editor.refineCropAspect)
}

watch(
  () => editor.refineMode,
  (mode) => {
    if (mode !== 'crop') return
    initCropDraft()
  },
  { immediate: true },
)

watch(base, () => {
  if (editor.refineMode === 'crop') initCropDraft()
})

// —— 视口自测量（同 RefineOutpaintCanvas）——
const rootRef = ref<HTMLElement | null>(null)
const viewport = ref<Size>({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

function measure() {
  const el = rootRef.value
  if (!el) return
  viewport.value = { width: el.clientWidth, height: el.clientHeight }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measure())
    if (rootRef.value) resizeObserver.observe(rootRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  stopDrag()
})

const FIT_PAD_X = 32
const FIT_PAD_TOP = 24
const FIT_PAD_BOTTOM = 48
const MAX_FIT = 4
const MIN_FIT = 0.02

/** 旋转后包围盒装进可用区（不放大超过 4 倍，不缩小到不可用）。 */
const fitScale = computed(() => {
  const vw = viewport.value.width
  const vh = viewport.value.height
  const bw = bbox.value.width
  const bh = bbox.value.height
  if (!(vw > 1) || !(vh > 1) || !(bw > 0) || !(bh > 0)) return 1
  const availW = Math.max(vw * 0.5, vw - FIT_PAD_X * 2)
  const availH = Math.max(vh * 0.5, vh - FIT_PAD_TOP - FIT_PAD_BOTTOM)
  const s = Math.min(availW / bw, availH / bh)
  return Math.min(MAX_FIT, Math.max(MIN_FIT, s))
})

const worldW = computed(() => Math.round(bbox.value.width * fitScale.value))
const worldH = computed(() => Math.round(bbox.value.height * fitScale.value))

const imgStyle = computed(() => ({
  width: `${base.value.width * fitScale.value}px`,
  height: `${base.value.height * fitScale.value}px`,
  transform: `translate(-50%, -50%) rotate(${theta.value}deg)`,
}))

const frameStyle = computed(() => {
  const r = rect.value
  if (!r) return { display: 'none' }
  return {
    left: `${r.x * fitScale.value}px`,
    top: `${r.y * fitScale.value}px`,
    width: `${r.width * fitScale.value}px`,
    height: `${r.height * fitScale.value}px`,
  }
})

const readout = computed(() => (rect.value ? formatCropReadout(rect.value) : '—'))

// —— 拖拽（框体平移 / 手柄调整），增量按 fitScale 折算回原图像素 ——
type DragKind = HandleDir | 'move'
const dragging = ref<DragKind | null>(null)
let lastX = 0
let lastY = 0

function onDragStart(kind: DragKind, event: PointerEvent) {
  if (props.busy || editor.refineBusy) return
  if (!(base.value.width > 0) || !(base.value.height > 0) || !rect.value) return
  event.preventDefault()
  event.stopPropagation()
  dragging.value = kind
  lastX = event.clientX
  lastY = event.clientY
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(event: PointerEvent) {
  const kind = dragging.value
  if (!kind || !rect.value) return
  const dx = (event.clientX - lastX) / fitScale.value
  const dy = (event.clientY - lastY) / fitScale.value
  lastX = event.clientX
  lastY = event.clientY
  const next =
    kind === 'move'
      ? moveCropRect(rect.value, dx, dy, base.value.width, base.value.height, theta.value)
      : resizeCropRect(
          rect.value,
          kind,
          dx,
          dy,
          base.value.width,
          base.value.height,
          theta.value,
          editor.refineCropAspect,
        )
  editor.setRefineCropRect(next)
}

function onDragUp() {
  stopDrag()
}

function stopDrag() {
  dragging.value = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
}
</script>

<template>
  <section ref="rootRef" class="crop-canvas" data-testid="crop-canvas">
    <div class="crop-canvas__world" :style="{ width: `${worldW}px`, height: `${worldH}px` }">
      <img
        class="crop-canvas__img"
        :src="baseUrl"
        :style="imgStyle"
        alt=""
        draggable="false"
      >
      <div
        v-if="rect"
        class="crop-canvas__frame"
        data-testid="crop-frame"
        :style="frameStyle"
        @pointerdown="onDragStart('move', $event)"
      >
        <span class="crop-canvas__line crop-canvas__line--v1" />
        <span class="crop-canvas__line crop-canvas__line--v2" />
        <span class="crop-canvas__line crop-canvas__line--h1" />
        <span class="crop-canvas__line crop-canvas__line--h2" />
        <span class="crop-canvas__readout" data-testid="crop-readout">{{ readout }}</span>
        <!-- 四角 L 形白括号手柄（与节点直裁同款竞品样式） -->
        <span
          v-for="dir in (['nw', 'ne', 'sw', 'se'] as const)"
          :key="`corner-${dir}`"
          class="crop-canvas__handle crop-canvas__handle--corner"
          :class="`crop-canvas__handle--${dir}`"
          :data-testid="`crop-handle-${dir}`"
          @pointerdown="onDragStart(dir, $event)"
        />
        <!-- 四边中点白色小手柄 -->
        <span
          v-for="dir in (['n', 's', 'w', 'e'] as const)"
          :key="`edge-${dir}`"
          class="crop-canvas__handle crop-canvas__handle--edge"
          :class="`crop-canvas__handle--${dir}`"
          :data-testid="`crop-handle-${dir}`"
          @pointerdown="onDragStart(dir, $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.crop-canvas {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(8, 8, 8, 0.4);
}

.crop-canvas__world {
  position: relative;
  flex: 0 0 auto;
}

.crop-canvas__img {
  position: absolute;
  top: 50%;
  left: 50%;
  user-select: none;
  pointer-events: none;
}

.crop-canvas__frame {
  position: absolute;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  cursor: move;
  touch-action: none;
}

.crop-canvas__line {
  position: absolute;
  background: rgba(255, 255, 255, 0.55);
  pointer-events: none;
}
.crop-canvas__line--v1 { top: 0; bottom: 0; left: 33.333%; width: 1px; }
.crop-canvas__line--v2 { top: 0; bottom: 0; left: 66.667%; width: 1px; }
.crop-canvas__line--h1 { left: 0; right: 0; top: 33.333%; height: 1px; }
.crop-canvas__line--h2 { left: 0; right: 0; top: 66.667%; height: 1px; }

.crop-canvas__readout {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10.5px;
  line-height: 1.3;
  pointer-events: none;
}

/* 手柄：与节点直裁（NodeCropOverlay）竞品同款——四角 L 形粗白括号 + 四边中点白条 */
.crop-canvas__handle {
  position: absolute;
  touch-action: none;
}
.crop-canvas__handle--corner {
  width: 24px;
  height: 24px;
}
.crop-canvas__handle--corner::before,
.crop-canvas__handle--corner::after {
  content: '';
  position: absolute;
  background: #fff;
  border-radius: 2px;
}
.crop-canvas__handle--corner::before {
  width: 24px;
  height: 4.5px;
}
.crop-canvas__handle--corner::after {
  width: 4.5px;
  height: 24px;
}
.crop-canvas__handle--nw { top: -4px; left: -4px; cursor: nwse-resize; }
.crop-canvas__handle--nw::before { left: 0; top: 0; }
.crop-canvas__handle--nw::after { left: 0; top: 0; }
.crop-canvas__handle--ne { top: -4px; right: -4px; cursor: nesw-resize; }
.crop-canvas__handle--ne::before { right: 0; top: 0; }
.crop-canvas__handle--ne::after { right: 0; top: 0; }
.crop-canvas__handle--sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
.crop-canvas__handle--sw::before { left: 0; bottom: 0; }
.crop-canvas__handle--sw::after { left: 0; bottom: 0; }
.crop-canvas__handle--se { right: -4px; bottom: -4px; cursor: nwse-resize; }
.crop-canvas__handle--se::before { right: 0; bottom: 0; }
.crop-canvas__handle--se::after { right: 0; bottom: 0; }

.crop-canvas__handle--edge {
  background: #fff;
  border-radius: 2px;
}
.crop-canvas__handle--n,
.crop-canvas__handle--s {
  width: 30px;
  height: 6px;
  cursor: ns-resize;
}
.crop-canvas__handle--n { top: -3px; left: 50%; margin-left: -15px; }
.crop-canvas__handle--s { bottom: -3px; left: 50%; margin-left: -15px; }
.crop-canvas__handle--w,
.crop-canvas__handle--e {
  width: 6px;
  height: 30px;
  cursor: ew-resize;
}
.crop-canvas__handle--w { top: 50%; left: -3px; margin-top: -15px; }
.crop-canvas__handle--e { top: 50%; right: -3px; margin-top: -15px; }
</style>
