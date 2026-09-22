<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import {
  HANDLE_DIRS,
  floorOutpaintRect,
  formatAspectLabel,
  initialOutpaintRect,
  resizeOutpaintRect,
  type HandleDir,
  type OutpaintRect,
  type Size,
} from './outpaintGeometry'

const props = withDefaults(
  defineProps<{
    /** 原图 URL（底图贴位用）。 */
    baseUrl: string
    /** 原图尺寸（px）。 */
    baseWidth: number
    baseHeight: number
    /** busy 时手柄冻结、不可拖拽（规格 §3）。 */
    busy?: boolean
  }>(),
  { busy: false },
)

const editor = useCanvasEditorStore()

const base = computed<Size>(() => ({ width: Number(props.baseWidth) || 0, height: Number(props.baseHeight) || 0 }))

/**
 * 当前新画布矩形：四边扩展量独立累积的状态源（规格 §3.1）。
 * 刻意保留小数——组件按 pointermove 逐帧增量拖拽，若每帧取整会累计出可见漂移；
 * 对外（读数 / store / 提交合成）一律用 floorOutpaintRect 落像素。
 */
const rect = ref<OutpaintRect>(initialOutpaintRect(base.value))

/** 基图尺寸晚到（mediaInfo 缺宽高 → 自然尺寸探测回填）时重置画布，避免退化矩形。 */
watch(base, (b) => {
  rect.value = initialOutpaintRect(b)
})

/** 落像素后的矩形：读数、底图贴位与提交链路消费。 */
const viewRect = computed(() => floorOutpaintRect(rect.value))

const MAX_FIT = 4
const MIN_FIT = 0.02
/** 留白：四周给手柄（出界 7px）留出可见空间，底部给读数条留出空间。 */
const FIT_PAD_X = 24
const FIT_PAD_TOP = 24
const FIT_PAD_BOTTOM = 64

/** 可用视口：组件自身容器的内容盒尺寸。本组件在扩图模式下始终可见，测量恒有效；
 *  不能依赖外部（父级的 stage 在本模式下 display:none，测得恒 0 → fit 恒 1，见 2026-09-22 缺陷）。 */
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

/** 自动缩放跟随：画布超出可用视口时缩小（小图最多放大到 4 倍），手柄与读数不跑出屏幕（规格 §3）。 */
const fitScale = computed(() => {
  const vw = viewport.value.width
  const vh = viewport.value.height
  if (!(vw > 1) || !(vh > 1) || !rect.value.width || !rect.value.height) return 1
  // 极小容器兜底：留白后可用区不足容器一半时按容器一半算
  const availW = Math.max(vw * 0.5, vw - FIT_PAD_X * 2)
  const availH = Math.max(vh * 0.5, vh - FIT_PAD_TOP - FIT_PAD_BOTTOM)
  const s = Math.min(availW / rect.value.width, availH / rect.value.height)
  return Math.min(MAX_FIT, Math.max(MIN_FIT, s))
})

const aspectLabel = computed(() => formatAspectLabel(viewRect.value.width, viewRect.value.height))

const displayW = computed(() => Math.round(rect.value.width * fitScale.value))
const displayH = computed(() => Math.round(rect.value.height * fitScale.value))
const baseDisplay = computed(() => ({
  left: viewRect.value.x * fitScale.value,
  top: viewRect.value.y * fitScale.value,
  width: base.value.width * fitScale.value,
  height: base.value.height * fitScale.value,
}))

/** 拖拽状态不进蒙版历史栈；只有进入扩图模式才把 rect 写入 store 供提交 / 视口跟随消费。
 *  退化矩形（基图尺寸未知时 0×0）写 null，避免提交按钮被误启用。 */
watch(
  viewRect,
  (r) => {
    if (editor.refineMode !== 'outpaint') return
    editor.setRefineOutpaintRect(r.width > 0 && r.height > 0 ? r : null)
  },
  { immediate: true },
)

let dragging: HandleDir | null = null
/** 上一帧指针位置：拖拽按增量施加，手柄始终跟随指针（规格 §3.1）。 */
let lastX = 0
let lastY = 0

function onHandleDown(dir: HandleDir, event: PointerEvent) {
  if (props.busy) return
  // 原图尺寸未知（基图尚未探测到）时不接受拖拽，避免算出退化矩形
  if (!(base.value.width > 0) || !(base.value.height > 0)) return
  event.preventDefault()
  dragging = dir
  lastX = event.clientX
  lastY = event.clientY
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(event: PointerEvent) {
  if (!dragging) return
  const scale = fitScale.value > 0 ? fitScale.value : 1
  const delta = {
    dx: (event.clientX - lastX) / scale,
    dy: (event.clientY - lastY) / scale,
  }
  lastX = event.clientX
  lastY = event.clientY
  if (delta.dx === 0 && delta.dy === 0) return
  rect.value = resizeOutpaintRect(base.value, rect.value, delta, dragging)
}

function onDragUp() {
  dragging = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  onDragUp()
  // 退出扩图模式即重置（规格 §3）；组件卸载时清掉 store 中的 rect。
  editor.setRefineOutpaintRect(null)
})
</script>

<template>
  <div
    ref="rootRef"
    class="refine-outpaint"
    data-testid="refine-outpaint-canvas"
    :data-fit="fitScale"
    :class="{ 'is-busy': busy }"
  >
    <div class="refine-outpaint__stage" :style="{ width: `${displayW}px`, height: `${displayH}px` }">
      <!-- 扩出区斜纹底（原图矩形之外的区域透出斜纹），原图覆盖在上方 -->
      <div class="refine-outpaint__stripes" :style="{ width: `${displayW}px`, height: `${displayH}px` }" />
      <img
        class="refine-outpaint__base"
        :src="baseUrl"
        alt=""
        draggable="false"
        :style="{
          left: `${baseDisplay.left}px`,
          top: `${baseDisplay.top}px`,
          width: `${baseDisplay.width}px`,
          height: `${baseDisplay.height}px`,
        }"
      />
      <!-- 8 个拖拽手柄（4 角 + 4 边） -->
      <button
        v-for="dir in HANDLE_DIRS"
        :key="dir"
        type="button"
        class="refine-outpaint__handle"
        :class="`refine-outpaint__handle--${dir}`"
        :data-testid="`outpaint-handle-${dir}`"
        :disabled="busy"
        :aria-label="`扩图手柄 ${dir}`"
        @pointerdown="onHandleDown(dir, $event)"
      />
    </div>

    <div class="refine-outpaint__readout" data-testid="outpaint-readout">
      {{ viewRect.width }} × {{ viewRect.height }} · {{ aspectLabel }}
      <span class="refine-outpaint__readout-sub">原图 {{ base.width }} × {{ base.height }}</span>
    </div>
  </div>
</template>

<style scoped>
.refine-outpaint {
  /* 参与父级 flex 列布局（与普通 stage 同一槽位）：只覆盖工作区，不盖左栏工具条；
     同时自身就是视口测量源（进入本模式后恒可见）。 */
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(8, 8, 8, 0.72);
}
.refine-outpaint.is-busy { cursor: not-allowed; }

.refine-outpaint__stage {
  position: relative;
  box-shadow: 0 0 0 1px var(--neo-border);
}

/* 斜纹：扩出区底色，原图覆盖上方后仅在扩出区可见（规格 §3 斜纹） */
.refine-outpaint__stripes {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    45deg,
    rgba(124, 192, 255, 0.18) 0,
    rgba(124, 192, 255, 0.18) 8px,
    rgba(124, 192, 255, 0.06) 8px,
    rgba(124, 192, 255, 0.06) 16px
  );
}

.refine-outpaint__base {
  position: absolute;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.refine-outpaint__handle {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border: 1.5px solid #7cc0ff;
  border-radius: 3px;
  background: rgba(10, 16, 24, 0.92);
  cursor: pointer;
  padding: 0;
  z-index: 2;
}
.refine-outpaint__handle:disabled { opacity: 0.4; cursor: not-allowed; }
.refine-outpaint__handle--nw { left: 0; top: 0; cursor: nwse-resize; }
.refine-outpaint__handle--n { left: 50%; top: 0; cursor: ns-resize; }
.refine-outpaint__handle--ne { left: 100%; top: 0; cursor: nesw-resize; }
.refine-outpaint__handle--e { left: 100%; top: 50%; cursor: ew-resize; }
.refine-outpaint__handle--se { left: 100%; top: 100%; cursor: nwse-resize; }
.refine-outpaint__handle--s { left: 50%; top: 100%; cursor: ns-resize; }
.refine-outpaint__handle--sw { left: 0; top: 100%; cursor: nesw-resize; }
.refine-outpaint__handle--w { left: 0; top: 50%; cursor: ew-resize; }

.refine-outpaint__readout {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(10, 16, 24, 0.82);
  color: #e6f0ff;
  font-size: 12px;
  white-space: nowrap;
}
.refine-outpaint__readout-sub { margin-left: 8px; color: var(--neo-text-muted); font-size: 10.5px; }
</style>
