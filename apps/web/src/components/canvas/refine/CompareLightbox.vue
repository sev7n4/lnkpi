<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CompareMode } from '@/utils/refineChrome'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import CompareView from './CompareView.vue'
import { panFromDrag, panZoomFromWheel } from './compareLightboxTransform'
import { refineWorkInsetRight } from './refineWorkLayout'

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

const editor = useCanvasEditorStore()
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const draggingPan = ref(false)
let lastX = 0
let lastY = 0

const insetRight = computed(() =>
  refineWorkInsetRight({
    innerWidth: typeof window === 'undefined' ? 1280 : window.innerWidth,
    chrome: editor.refineChrome,
    collapsed: editor.refinePanelCollapsed,
    panelWidth: editor.refinePanelWidth,
  }),
)
const frameStyle = computed(() => ({
  right: `${insetRight.value}px`,
}))
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
    :style="frameStyle"
    @wheel.prevent="onWheel"
  >
    <header class="compare-lightbox__bar">
      <button type="button" class="compare-lightbox__back" title="回到工作图" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path stroke-linecap="round" d="M9 12h6M12 9v6" />
        </svg>
        <span>工作图</span>
      </button>
      <div class="compare-lightbox__modes">
        <button
          type="button"
          class="compare-lightbox__mode"
          :class="{ 'is-active': mode === 'split' }"
          title="左右对照"
          @click="setMode('split')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="3" y="5" width="7" height="14" rx="1.5" />
            <rect x="14" y="5" width="7" height="14" rx="1.5" />
          </svg>
        </button>
        <button
          type="button"
          class="compare-lightbox__mode"
          :class="{ 'is-active': mode === 'wipe' }"
          title="重叠滑竿"
          @click="setMode('wipe')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="3" y="5" width="18" height="14" rx="1.5" />
            <path stroke-linecap="round" d="M12 5v14" />
          </svg>
        </button>
      </div>
      <button type="button" class="compare-lightbox__close" title="回到工作图" aria-label="回到工作图" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
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
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: rgba(8, 8, 8, 0.92);
}

.compare-lightbox__modes {
  display: flex;
  gap: 6px;
}

.compare-lightbox__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.compare-lightbox__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.compare-lightbox__mode,
.compare-lightbox__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  min-width: 28px;
  padding: 0;
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
