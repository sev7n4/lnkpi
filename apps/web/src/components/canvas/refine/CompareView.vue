<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useCanvasEditorStore } from '@/stores/canvasEditor'
import {
  wipeAfterSrc,
  wipeHoldRatio,
  shouldRenderWipe,
  type CompareBaseCanvas,
} from './compareViewModel'
import ImageLoupe from './ImageLoupe.vue'

defineOptions({ name: 'CompareView' })
import type { CompareMode } from '@/utils/refineChrome'
import { clampWipeRatio } from '@/utils/refineChrome'

const props = withDefaults(
  defineProps<{
    beforeUrl: string
    afterUrl?: string
    mode?: CompareMode
    wipeRatio?: number
    showingOriginal?: boolean
    compact?: boolean
    /** 基准画布模式（Task 8，扩图版本）：存在时以新画布为基准，Before 按偏移贴入、扩出区渲染斜纹占位。 */
    baseCanvas?: CompareBaseCanvas
  }>(),
  {
    mode: 'split',
    wipeRatio: 0.5,
    compact: false,
  },
)

const emit = defineEmits<{
  'update:showingOriginal': [value: boolean]
  'update:wipeRatio': [value: number]
}>()

const editor = useCanvasEditorStore()

const localHold = ref(false)
const wipeFrameRef = ref<HTMLElement | null>(null)
let draggingWipe = false

const showingOriginal = computed(() => props.showingOriginal ?? localHold.value)
const useWipe = computed(() => shouldRenderWipe(props.mode))
const wipeAfterUrl = computed(() => wipeAfterSrc(props.afterUrl, props.beforeUrl))
const effectiveRatio = computed(() => wipeHoldRatio(showingOriginal.value, props.wipeRatio))
const beforeClip = computed(() => `inset(0 ${effectiveRatio.value * 100}% 0 0)`)
const handleLeft = computed(() =>
  showingOriginal.value ? '0%' : `${(1 - effectiveRatio.value) * 100}%`,
)

const afterDisplayUrl = computed(() => {
  if (showingOriginal.value) return props.beforeUrl
  return props.afterUrl || props.beforeUrl
})

// ---- 基准画布模式（Task 8）：容器=新画布比例，Before 按偏移贴入，扩出区斜纹占位 ----
const baseCanvas = computed(() => props.baseCanvas)

/** 百分比取 4 位小数，避免无限循环小数导致 DOM 样式串不稳定。 */
function pct(value: number): string {
  return `${Number(value.toFixed(4))}%`
}

/** 基准画布 stage / wipe 容器样式：锁定新画布宽高比。 */
const stageStyle = computed(() => {
  const bc = baseCanvas.value
  if (!bc) return undefined
  return { aspectRatio: `${bc.width} / ${bc.height}` }
})

/**
 * Before 图在新画布内的贴位：beforeOffset 之外按 (canvas − 2×offset) 推导原图框
 * （metadata 只有两侧尺寸，规格语义即居中贴图）。
 */
const beforePlacement = computed(() => {
  const bc = baseCanvas.value
  if (!bc) return undefined
  const { width, height, beforeOffset } = bc
  return {
    left: pct((beforeOffset.x / width) * 100),
    top: pct((beforeOffset.y / height) * 100),
    width: pct(((width - 2 * beforeOffset.x) / width) * 100),
    height: pct(((height - 2 * beforeOffset.y) / height) * 100),
  }
})

const beforeWipeStyle = computed(() => {
  const style: Record<string, string> = { clipPath: beforeClip.value }
  if (baseCanvas.value && beforePlacement.value) {
    // 覆盖 .compare-view__wipe-img--before 的 inset:0 全幅默认
    Object.assign(style, beforePlacement.value, { right: 'auto', bottom: 'auto' })
  }
  return style
})

function setHold(value: boolean) {
  localHold.value = value
  emit('update:showingOriginal', value)
}

function ratioFromClientX(clientX: number): number {
  const frame = wipeFrameRef.value
  if (!frame) return props.wipeRatio
  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0) return props.wipeRatio
  const divider = (clientX - rect.left) / rect.width
  return clampWipeRatio(1 - divider)
}

function onWipePointerDown(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  draggingWipe = true
  emit('update:wipeRatio', ratioFromClientX(event.clientX))
  window.addEventListener('pointermove', onWipePointerMove)
  window.addEventListener('pointerup', onWipePointerUp)
}

function onWipePointerMove(event: PointerEvent) {
  if (!draggingWipe) return
  emit('update:wipeRatio', ratioFromClientX(event.clientX))
}

function onWipePointerUp() {
  draggingWipe = false
  window.removeEventListener('pointermove', onWipePointerMove)
  window.removeEventListener('pointerup', onWipePointerUp)
}

function shouldSkipSpaceHold(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return true
  return target.isContentEditable
}

function onKeyDown(event: KeyboardEvent) {
  if (event.code !== 'Space' || event.repeat) return
  if (shouldSkipSpaceHold(event.target)) return
  event.preventDefault()
  setHold(true)
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code !== 'Space') return
  if (shouldSkipSpaceHold(event.target)) return
  setHold(false)
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  onWipePointerUp()
})
</script>

<template>
  <div class="compare-view" :class="{ 'compare-view--compact': compact }">
    <div v-if="useWipe" ref="wipeFrameRef" class="compare-view__wipe" :style="stageStyle">
      <ImageLoupe :src="wipeAfterUrl" :active="editor.refineLoupeOn" :shape="editor.refineLoupeShape" :zoom="editor.refineLoupeZoom">
        <img
          class="compare-view__wipe-img compare-view__wipe-img--after"
          :class="{ 'compare-view__wipe-img--canvas': !!baseCanvas }"
          :src="wipeAfterUrl"
          alt=""
        >
        <!-- 扩出区斜纹占位：夹在 After 与 Before 之间，clip 与 Before 同步（只在 Before 侧可见） -->
        <div
          v-if="baseCanvas"
          class="compare-view__wipe-hatch"
          data-testid="compare-base-hatch"
          :style="{ clipPath: beforeClip }"
        />
        <img
          class="compare-view__wipe-img compare-view__wipe-img--before"
          :src="beforeUrl"
          alt=""
          :style="beforeWipeStyle"
        >
      </ImageLoupe>
      <div
        class="compare-view__wipe-handle"
        :style="{ left: handleLeft }"
        @pointerdown="onWipePointerDown"
      >
        <span class="compare-view__wipe-knob" />
      </div>
    </div>
    <div v-else class="compare-view__panes">
      <div class="compare-view__pane">
        <span class="compare-view__label">Before</span>
        <div class="compare-view__frame">
          <slot name="before">
            <!-- 基准画布模式：Before 居中贴入新画布框，扩出区斜纹占位 -->
            <div
              v-if="baseCanvas && beforePlacement"
              data-testid="compare-base-stage"
              class="compare-view__stage"
              :style="stageStyle"
            >
              <div
                data-testid="compare-base-hatch"
                class="compare-view__stage-hatch"
              />
              <img
                class="compare-view__stage-img"
                :src="beforeUrl"
                alt=""
                :style="beforePlacement"
              >
            </div>
            <ImageLoupe v-else :src="beforeUrl" :active="editor.refineLoupeOn" :shape="editor.refineLoupeShape" :zoom="editor.refineLoupeZoom">
              <img class="compare-view__image" :src="beforeUrl" alt="">
            </ImageLoupe>
          </slot>
        </div>
      </div>
      <div class="compare-view__pane">
        <span class="compare-view__label">After</span>
        <div class="compare-view__frame">
          <ImageLoupe :src="afterDisplayUrl" :active="editor.refineLoupeOn" :shape="editor.refineLoupeShape" :zoom="editor.refineLoupeZoom">
            <img class="compare-view__image" :src="afterDisplayUrl" alt="">
          </ImageLoupe>
        </div>
      </div>
    </div>
    <!-- 「按住查看原图」（follow-up #3）：紧凑模式（右栏固定对照带）下不渲染 —— P0-6 对照带只留 ⛶ 一枚动作；
         空格按住仍生效。全屏对照（lightbox）里保留这枚眼睛。 -->
    <button
      v-if="!compact"
      type="button"
      class="compare-view__original"
      title="按住查看原图"
      @mousedown.prevent="setHold(true)"
      @mouseup="setHold(false)"
      @mouseleave="setHold(false)"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75">
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.compare-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.compare-view__panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  min-height: 140px;
}

.compare-view__pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.compare-view__label {
  font-size: 11px;
  color: var(--neo-text-muted);
}

.compare-view__frame {
  position: relative;
  display: flex;
  min-height: 120px;
  max-height: 220px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  background: #0a0a0a;
}

.compare-view__image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}

.compare-view--compact .compare-view__frame,
.compare-view--compact .compare-view__wipe {
  max-height: none;
  height: 100%;
  min-height: 0;
}

.compare-view--compact .compare-view__image,
.compare-view--compact .compare-view__wipe-img {
  max-height: none;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.compare-view__wipe {
  position: relative;
  overflow: hidden;
  min-height: 140px;
  max-height: 220px;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  background: #0a0a0a;
}

.compare-view__wipe :deep(.image-loupe-host) {
  width: 100%;
  height: 100%;
}

.compare-view__wipe-img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.compare-view__wipe-img--after {
  position: relative;
}

/* 基准画布模式：After 图铺满新画布框（容器 aspect-ratio 已对齐画布比例） */
.compare-view__wipe-img--canvas {
  position: absolute;
  inset: 0;
  max-height: none;
  width: 100%;
  height: 100%;
}

.compare-view__wipe-img--before {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
}

/* 扩出区斜纹占位（基准画布模式）：夹在 After 与 Before 之间 */
.compare-view__wipe-hatch {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.09) 0,
    rgba(255, 255, 255, 0.09) 8px,
    transparent 8px,
    transparent 16px
  );
  pointer-events: none;
}

/* 基准画布 stage（split 模式 Before 侧）：新画布比例的框，原图按偏移贴入 */
.compare-view__stage {
  position: relative;
  width: 100%;
  max-height: 220px;
  overflow: hidden;
  border-radius: 10px;
  background: #0a0a0a;
}

.compare-view__stage-hatch {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.09) 0,
    rgba(255, 255, 255, 0.09) 8px,
    transparent 8px,
    transparent 16px
  );
  pointer-events: none;
}

.compare-view__stage-img {
  position: absolute;
  max-width: none;
  max-height: none;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.compare-view--compact .compare-view__stage {
  max-height: none;
  height: 100%;
}

.compare-view__wipe-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 16px;
  margin-left: -8px;
  cursor: ew-resize;
  touch-action: none;
}

.compare-view__wipe-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  background: #fff;
  transform: translateX(-50%);
}

.compare-view__wipe-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: var(--neo-hi-bg, #3b82f6);
  transform: translate(-50%, -50%);
}

.compare-view__original {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  height: 26px;
  width: 26px;
  padding: 0;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
  cursor: pointer;
}

.compare-view__original:hover {
  color: var(--neo-text-primary);
}
</style>
