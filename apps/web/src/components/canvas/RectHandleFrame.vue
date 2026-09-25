<script setup lang="ts">
import { reactive, ref } from 'vue'
import { moveDisplayCropRect, resizeDisplayCropRect } from './nodeCropModel'
import type { CropRect } from './refine/cropGeometry'

/**
 * 矩形选区 8 手柄变换层（2026-09-25 统一能力）：
 * 4 顶点自由缩放 + 4 边单向缩放 + 框体拖动，渲染 L 形白角 + 边中点白条（与扩图/裁剪同款）。
 * 几何复用 nodeCropModel.resizeDisplayCropRect / moveDisplayCropRect（边缘保持钳制）。
 *
 * 坐标系 = 挂载父层的本地坐标（local px）；scale = 屏幕 px / local px（节点浮层传 viewport.zoom，
 * 面板内 1:1 传 1）。lockRatio 只约束角手柄，边手柄恒单轴（2026-09-25 用户拍板）。
 */
const props = withDefaults(
  defineProps<{
    rect: CropRect
    /** 可用区域（local px），拖拽结果钳在其内 */
    bounds: { w: number; h: number }
    /** 屏幕 px / local px（浮层跟随画布缩放时传 1/zoom） */
    scale?: number
    min?: number
    lockRatio?: number | null
  }>(),
  { scale: 1, min: 24, lockRatio: null },
)

const emit = defineEmits<{
  'update:rect': [rect: CropRect]
  /** 一次拖拽结束（松手）：宿主刷新缩略图 / 落蒙版 */
  'drag-end': []
}>()

const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

type Drag = { mode: 'move' | 'resize'; dir: string; lastX: number; lastY: number }
const drag = ref<Drag | null>(null)
/** 拖动中把 rect 本地化，避免每帧改 props */
const live = reactive<{ rect: CropRect | null }>({ rect: null })

const shownRect = (): CropRect => live.rect ?? props.rect

function onFramePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  event.stopPropagation()
  drag.value = { mode: 'move', dir: '', lastX: event.clientX, lastY: event.clientY }
  live.rect = { ...props.rect }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onHandlePointerDown(dir: string, event: PointerEvent) {
  if (event.button !== 0) return
  event.stopPropagation()
  drag.value = { mode: 'resize', dir, lastX: event.clientX, lastY: event.clientY }
  live.rect = { ...props.rect }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(event: PointerEvent) {
  const d = drag.value
  if (!d || !live.rect) return
  const k = props.scale > 0 ? 1 / props.scale : 1
  const dx = (event.clientX - d.lastX) * k
  const dy = (event.clientY - d.lastY) * k
  d.lastX = event.clientX
  d.lastY = event.clientY
  live.rect =
    d.mode === 'move'
      ? moveDisplayCropRect(live.rect, dx, dy, props.bounds.w, props.bounds.h)
      : resizeDisplayCropRect(live.rect, d.dir, dx, dy, props.bounds.w, props.bounds.h, props.lockRatio)
  emit('update:rect', { ...live.rect })
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  drag.value = null
  live.rect = null
  emit('drag-end')
}
</script>

<template>
  <div
    class="rhf"
    :style="{
      left: `${shownRect().x}px`,
      top: `${shownRect().y}px`,
      width: `${shownRect().width}px`,
      height: `${shownRect().height}px`,
    }"
    data-testid="rect-handle-frame"
    @pointerdown="onFramePointerDown"
  >
    <button
      v-for="dir in DIRS"
      :key="dir"
      type="button"
      class="rhf__handle absolute"
      :class="[`rhf__handle--${dir}`, { 'is-corner': dir.length === 2 }]"
      :data-handle="dir"
      :aria-label="`调整选区 ${dir}`"
      @pointerdown="onHandlePointerDown(dir, $event)"
    />
  </div>
</template>

<style scoped>
.rhf {
  position: absolute;
  border: 1.5px solid rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  cursor: move;
  touch-action: none;
}
.rhf__handle {
  background: #fff;
  border: none;
  padding: 0;
  touch-action: none;
}
.rhf__handle.is-corner {
  width: 16px;
  height: 16px;
  background: transparent;
}
.rhf__handle.is-corner::before,
.rhf__handle.is-corner::after {
  content: '';
  position: absolute;
  background: #fff;
  border-radius: 2px;
}
.rhf__handle.is-corner::before {
  width: 16px;
  height: 3px;
}
.rhf__handle.is-corner::after {
  width: 3px;
  height: 16px;
}
.rhf__handle--nw { left: -3px; top: -3px; cursor: nwse-resize; }
.rhf__handle--nw::before { left: 0; top: 0; }
.rhf__handle--nw::after { left: 0; top: 0; }
.rhf__handle--ne { right: -3px; top: -3px; cursor: nesw-resize; }
.rhf__handle--ne::before { right: 0; top: 0; }
.rhf__handle--ne::after { right: 0; top: 0; }
.rhf__handle--sw { left: -3px; bottom: -3px; cursor: nesw-resize; }
.rhf__handle--sw::before { left: 0; bottom: 0; }
.rhf__handle--sw::after { left: 0; bottom: 0; }
.rhf__handle--se { right: -3px; bottom: -3px; cursor: nwse-resize; }
.rhf__handle--se::before { right: 0; bottom: 0; }
.rhf__handle--se::after { right: 0; bottom: 0; }
.rhf__handle--n,
.rhf__handle--s {
  width: 20px;
  height: 5px;
  border-radius: 2px;
  cursor: ns-resize;
}
.rhf__handle--n { left: 50%; top: -2.5px; transform: translateX(-50%); }
.rhf__handle--s { left: 50%; bottom: -2.5px; transform: translateX(-50%); }
.rhf__handle--w,
.rhf__handle--e {
  width: 5px;
  height: 20px;
  border-radius: 2px;
  cursor: ew-resize;
}
.rhf__handle--w { top: 50%; left: -2.5px; transform: translateY(-50%); }
.rhf__handle--e { top: 50%; right: -2.5px; transform: translateY(-50%); }
</style>
