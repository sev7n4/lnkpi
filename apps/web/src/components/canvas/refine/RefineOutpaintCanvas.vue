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

/** 权威草稿在 store（画布 / 右栏面板同源，§6.1 状态源、§7）。本组件只负责拖拽增量写入。 */
const rect = computed<OutpaintRect>(() => editor.refineOutpaintRect ?? initialOutpaintRect(base.value))

/** 落像素后的矩形：读数、底图贴位与提交链路消费。 */
const viewRect = computed(() => floorOutpaintRect(rect.value))

/**
 * 进入扩图模式时写入基准与原图矩形；参与父级 v-show 的组件在 select 模式下也挂载，
 * 因此只在扩图模式写入，避免污染 select 状态（setRefineMode('select') 会清空两者）。
 *
 * 原图尺寸未知（0×0）时不写退化矩形，保持 null —— 提交守卫据此禁用 CTA。
 */
function initOutpaintDraft() {
  editor.setRefineOutpaintBase(base.value)
  const initial = initialOutpaintRect(base.value)
  editor.setRefineOutpaintRect(initial.width > 0 && initial.height > 0 ? initial : null)
}

watch(
  () => editor.refineMode,
  (mode) => {
    if (mode !== 'outpaint') return
    if (!editor.refineOutpaintRect) initOutpaintDraft()
    else editor.setRefineOutpaintBase(base.value)
  },
  { immediate: true },
)

/** 基图尺寸晚到（mediaInfo 缺宽高 → 自然尺寸探测回填）时重置画布，避免退化矩形。 */
watch(base, () => {
  if (editor.refineMode === 'outpaint') initOutpaintDraft()
  else editor.setRefineOutpaintBase(base.value)
})

const MAX_FIT = 4
const MIN_FIT = 0.02
/** 留白：四周给手柄（出界 7px）留出可见空间，底部额外留白是视觉呼吸区，
 *  避免缩放后的画布贴住视口底边。 */
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

/** 缩放锚定原图（2026-09-22 用户验收修订，替换原「拖拽时自动缩放跟随」）：
 *  原图进入扩图模式即按可用区的 60% 定大小并保持不变——拖拽手柄只扩大蒙版区域，
 *  原图不再跟着缩小（「原图不变、变的是扩展蒙版」）。60% 预留 = 蒙版有初始扩展空间，
 *  配合 dragBounds 钳制保证手柄始终在视口内可抓取。 */
const FIT_ANCHOR_RATIO = 0.6
const fitScale = computed(() => {
  const vw = viewport.value.width
  const vh = viewport.value.height
  const bw = base.value.width
  const bh = base.value.height
  if (!(vw > 1) || !(vh > 1) || !(bw > 0) || !(bh > 0)) return 1
  // 极小容器兜底：留白后可用区不足容器一半时按容器一半算
  const availW = Math.max(vw * 0.5, vw - FIT_PAD_X * 2)
  const availH = Math.max(vh * 0.5, vh - FIT_PAD_TOP - FIT_PAD_BOTTOM)
  const s = FIT_ANCHOR_RATIO * Math.min(availW / bw, availH / bh)
  return Math.min(MAX_FIT, Math.max(MIN_FIT, s))
})

/** 拖拽边界：锚定缩放下视口能容纳的最大画布（px）。视口未测量（jsdom / 挂载前）不设限。 */
const dragBounds = computed<Size>(() => {
  const vw = viewport.value.width
  const vh = viewport.value.height
  const s = fitScale.value
  if (!(vw > 1) || !(vh > 1) || !(s > 0)) return { width: Infinity, height: Infinity }
  const availW = Math.max(vw * 0.5, vw - FIT_PAD_X * 2)
  const availH = Math.max(vh * 0.5, vh - FIT_PAD_TOP - FIT_PAD_BOTTOM)
  return { width: Math.floor(availW / s), height: Math.floor(availH / s) }
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

const dragging = ref<HandleDir | null>(null)
/** 上一帧指针位置：拖拽按增量施加，手柄始终跟随指针（规格 §3.1）。 */
let lastX = 0
let lastY = 0

function onHandleDown(dir: HandleDir, event: PointerEvent) {
  if (props.busy) return
  // 原图尺寸未知（基图尚未探测到）时不接受拖拽，避免算出退化矩形
  if (!(base.value.width > 0) || !(base.value.height > 0)) return
  event.preventDefault()
  dragging.value = dir
  editor.setRefineOutpaintDragging(true)
  lastX = event.clientX
  lastY = event.clientY
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(event: PointerEvent) {
  const dir = dragging.value
  if (!dir) return
  const scale = fitScale.value > 0 ? fitScale.value : 1
  const delta = {
    dx: (event.clientX - lastX) / scale,
    dy: (event.clientY - lastY) / scale,
  }
  lastX = event.clientX
  lastY = event.clientY
  if (delta.dx === 0 && delta.dy === 0) return
  // 逐帧增量写入 store：保留小数（对外落像素走 floorOutpaintRect），避免每帧取整漂移
  editor.setRefineOutpaintRect(resizeOutpaintRect(base.value, rect.value, delta, dir, dragBounds.value))
}

function onDragUp() {
  dragging.value = null
  editor.setRefineOutpaintDragging(false)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  onDragUp()
  // 退出扩图模式即重置（规格 §6.1）；组件卸载时清掉 store 中的 rect 与基准。
  editor.setRefineOutpaintRect(null)
  editor.setRefineOutpaintBase(null)
  editor.setRefineOutpaintDragging(false)
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

      <!-- 拖拽进行中：3×3 三分参考网格（松手即消失） -->
      <div v-if="dragging" class="refine-outpaint__grid" data-testid="outpaint-grid" aria-hidden="true">
        <span class="refine-outpaint__grid-v" style="left: 33.333%" />
        <span class="refine-outpaint__grid-v" style="left: 66.667%" />
        <span class="refine-outpaint__grid-h" style="top: 33.333%" />
        <span class="refine-outpaint__grid-h" style="top: 66.667%" />
      </div>
    </div>

    <!-- 拖拽进行中：顶部居中尺寸胶囊（松手即消失；常驻读数在右栏 OutpaintPanel） -->
    <div v-if="dragging" class="refine-outpaint__badge" data-testid="outpaint-drag-badge">
      {{ viewRect.width }} × {{ viewRect.height }} · {{ aspectLabel }}
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
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border: 1.5px solid #7cc0ff;
  border-radius: 50%;              /* 角手柄 = 圆形 16px */
  background: rgba(10, 16, 24, 0.92);
  cursor: pointer;
  padding: 0;
  z-index: 2;
}
/* 命中区外扩 ≥4px（伪元素参与按钮命中测试，不改变视觉尺寸） */
.refine-outpaint__handle::after { content: ''; position: absolute; inset: -4px; }

.refine-outpaint__handle--n,
.refine-outpaint__handle--s {
  width: 32px; height: 16px; margin: -8px 0 0 -16px; border-radius: 999px;  /* 边胶囊 32×16 */
}
.refine-outpaint__handle--e,
.refine-outpaint__handle--w {
  width: 16px; height: 32px; margin: -16px 0 0 -8px; border-radius: 999px;  /* 边胶囊 16×32 */
}

.refine-outpaint__grid { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.refine-outpaint__grid-v { position: absolute; top: 0; bottom: 0; border-left: 1px dashed rgba(124, 192, 255, 0.75); }
.refine-outpaint__grid-h { position: absolute; left: 0; right: 0; border-top: 1px dashed rgba(124, 192, 255, 0.75); }

.refine-outpaint__badge {
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%);
  padding: 4px 10px; border-radius: 8px;
  background: rgba(10, 16, 24, 0.86); color: #e6f0ff; font-size: 12px; white-space: nowrap;
  pointer-events: none; z-index: 4;
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
</style>
