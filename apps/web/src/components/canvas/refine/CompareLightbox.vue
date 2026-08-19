<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CompareMode } from '@/utils/refineChrome'
import CompareView from './CompareView.vue'
import { panFromDrag, panZoomFromWheel } from './compareLightboxTransform'

const props = defineProps<{
  open: boolean
  beforeUrl: string
  afterUrl?: string
  mode: CompareMode
  wipeRatio: number
}>()

const emit = defineEmits<{
  close: []
  'update:mode': [value: CompareMode]
  'update:wipeRatio': [value: number]
}>()

const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const draggingPan = ref(false)
let lastX = 0
let lastY = 0

const wipeDisabled = computed(() => !props.afterUrl)
const transformStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
}))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    scale.value = 1
    panX.value = 0
    panY.value = 0
  },
)

function setMode(mode: CompareMode) {
  if (mode === 'wipe' && wipeDisabled.value) return
  emit('update:mode', mode)
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const next = panZoomFromWheel({
    scale: scale.value,
    panX: panX.value,
    panY: panY.value,
    deltaY: event.deltaY,
  })
  scale.value = next.scale
  panX.value = next.panX
  panY.value = next.panY
}

function onPanPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target
  if (target instanceof Element && target.closest('.compare-view__wipe-handle')) return
  draggingPan.value = true
  lastX = event.clientX
  lastY = event.clientY
  window.addEventListener('pointermove', onPanPointerMove)
  window.addEventListener('pointerup', onPanPointerUp)
}

function onPanPointerMove(event: PointerEvent) {
  if (!draggingPan.value) return
  const next = panFromDrag({
    panX: panX.value,
    panY: panY.value,
    dx: event.clientX - lastX,
    dy: event.clientY - lastY,
  })
  panX.value = next.panX
  panY.value = next.panY
  lastX = event.clientX
  lastY = event.clientY
}

function onPanPointerUp() {
  draggingPan.value = false
  window.removeEventListener('pointermove', onPanPointerMove)
  window.removeEventListener('pointerup', onPanPointerUp)
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  onPanPointerUp()
})
</script>

<template>
  <div
    v-if="open"
    class="compare-lightbox"
    @wheel.prevent="onWheel"
  >
    <header class="compare-lightbox__bar">
      <div class="compare-lightbox__modes">
        <button
          type="button"
          class="compare-lightbox__mode"
          :class="{ 'is-active': mode === 'split' }"
          @click="setMode('split')"
        >
          左右
        </button>
        <button
          type="button"
          class="compare-lightbox__mode"
          :class="{ 'is-active': mode === 'wipe' }"
          :disabled="wipeDisabled"
          @click="setMode('wipe')"
        >
          重叠
        </button>
      </div>
      <button type="button" class="compare-lightbox__close" aria-label="关闭对照" @click="emit('close')">
        关闭
      </button>
    </header>
    <div class="compare-lightbox__stage" @pointerdown="onPanPointerDown">
      <div class="compare-lightbox__zoom" :style="transformStyle">
        <CompareView
          compact
          :before-url="beforeUrl"
          :after-url="afterUrl"
          :mode="mode"
          :wipe-ratio="wipeRatio"
          @update:wipe-ratio="emit('update:wipeRatio', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare-lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: rgba(8, 8, 8, 0.92);
}

.compare-lightbox__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.compare-lightbox__modes {
  display: flex;
  gap: 6px;
}

.compare-lightbox__mode,
.compare-lightbox__close {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.compare-lightbox__mode.is-active,
.compare-lightbox__close:hover {
  color: var(--neo-text-primary);
  border-color: var(--neo-border-strong);
}

.compare-lightbox__mode:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.compare-lightbox__stage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
}

.compare-lightbox__zoom {
  width: 100%;
  height: 100%;
  transform-origin: center center;
}

.compare-lightbox__zoom :deep(.compare-view) {
  height: 100%;
}

.compare-lightbox__zoom :deep(.compare-view__wipe),
.compare-lightbox__zoom :deep(.compare-view__panes) {
  height: calc(100% - 34px);
}
</style>
