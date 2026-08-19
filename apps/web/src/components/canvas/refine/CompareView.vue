<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CompareMode } from '@/utils/refineChrome'
import { clampWipeRatio } from '@/utils/refineChrome'
import { wipeHoldRatio } from './compareViewModel'

const props = withDefaults(
  defineProps<{
    beforeUrl: string
    afterUrl?: string
    mode?: CompareMode
    wipeRatio?: number
    showingOriginal?: boolean
    compact?: boolean
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

const localHold = ref(false)
const wipeFrameRef = ref<HTMLElement | null>(null)
let draggingWipe = false

const showingOriginal = computed(() => props.showingOriginal ?? localHold.value)
const useWipe = computed(() => props.mode === 'wipe' && Boolean(props.afterUrl))
const effectiveRatio = computed(() => wipeHoldRatio(showingOriginal.value, props.wipeRatio))
const beforeClip = computed(() => `inset(0 ${effectiveRatio.value * 100}% 0 0)`)
const handleLeft = computed(() =>
  showingOriginal.value ? '0%' : `${(1 - effectiveRatio.value) * 100}%`,
)

const afterDisplayUrl = computed(() => {
  if (showingOriginal.value) return props.beforeUrl
  return props.afterUrl || props.beforeUrl
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
    <div v-if="useWipe" ref="wipeFrameRef" class="compare-view__wipe">
      <img class="compare-view__wipe-img compare-view__wipe-img--after" :src="afterUrl" alt="">
      <img
        class="compare-view__wipe-img compare-view__wipe-img--before"
        :src="beforeUrl"
        alt=""
        :style="{ clipPath: beforeClip }"
      >
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
            <img class="compare-view__image" :src="beforeUrl" alt="">
          </slot>
        </div>
      </div>
      <div class="compare-view__pane">
        <span class="compare-view__label">After</span>
        <div class="compare-view__frame">
          <img class="compare-view__image" :src="afterDisplayUrl" alt="">
        </div>
      </div>
    </div>
    <button
      type="button"
      class="compare-view__original"
      @mousedown.prevent="setHold(true)"
      @mouseup="setHold(false)"
      @mouseleave="setHold(false)"
    >
      原图
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

.compare-view__wipe-img--before {
  position: absolute;
  inset: 0;
  width: 100%;
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
  align-self: flex-start;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.compare-view__original:hover {
  color: var(--neo-text-primary);
}
</style>
