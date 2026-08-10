<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { CanvasTheme } from '@/composables/useCanvasTheme'

/** 画布空白处单击/双击涟漪：暗色主题用亮白圈，亮色主题用淡灰圈 */
interface RippleCircle {
  id: number
  x: number
  y: number
  radius: number
  opacity: number
  strokeWidth: number
  color: string
  maxRadius: number
  minRadius: number
  baseStrokeWidth: number
  startTime: number
}

const props = withDefaults(
  defineProps<{
    container?: HTMLElement | null
    theme?: CanvasTheme
  }>(),
  { theme: 'dark' },
)

const RIPPLE_DURATION = 520
const BASE_STROKE = 1.5

const circles = ref<RippleCircle[]>([])
let circleId = 0
let boundEl: HTMLElement | null = null

const clickColor = computed(() =>
  props.theme === 'light' ? 'rgba(23, 25, 35, 0.5)' : 'rgba(255, 255, 255, 0.78)',
)

const SKIP_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[contenteditable="true"]',
  '[data-no-ripple]',
  '.vue-flow__node',
  '.vue-flow__handle',
  '.vue-flow__edge',
  '.vue-flow__panel',
  '.node-panel-dock',
  '.canvas-floating-chrome',
  '.dock-studio-toolbar',
  '.canvas-bottom-toolbar',
  '.agent-side-rail',
  '.multi-select-toolbar',
  '.node-editor-toolbar',
  '.connect-node-picker',
].join(',')

function shouldSkip(target: EventTarget | null) {
  if (!(target instanceof Element)) return true
  return Boolean(target.closest(SKIP_SELECTOR))
}

function animateCircle(seed: RippleCircle) {
  const frameBudget = 1000 / 60
  let lastFrame = seed.startTime

  const tick = (now: number) => {
    const elapsed = now - seed.startTime
    const progress = Math.min(elapsed / RIPPLE_DURATION, 1)

    if (now - lastFrame < frameBudget && progress < 1) {
      requestAnimationFrame(tick)
      return
    }
    lastFrame = now

    const idx = circles.value.findIndex((c) => c.id === seed.id)
    if (idx === -1) return

    if (progress >= 1) {
      circles.value.splice(idx, 1)
      return
    }

    circles.value[idx] = {
      ...circles.value[idx],
      radius: seed.minRadius + (seed.maxRadius - seed.minRadius) * progress,
      opacity: (1 - progress) * 0.95,
      strokeWidth: seed.baseStrokeWidth * (1 - progress * 0.45),
    }
    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}

function spawnCircle(
  clientX: number,
  clientY: number,
  opts?: { minRadius?: number; maxRadius?: number; stroke?: number },
) {
  const minRadius = opts?.minRadius ?? 5
  const maxRadius = opts?.maxRadius ?? 26
  const seed: RippleCircle = {
    id: circleId++,
    x: clientX,
    y: clientY,
    radius: minRadius,
    opacity: 0.95,
    color: clickColor.value,
    strokeWidth: opts?.stroke ?? BASE_STROKE,
    baseStrokeWidth: opts?.stroke ?? BASE_STROKE,
    maxRadius,
    minRadius,
    startTime: performance.now(),
  }
  circles.value.push(seed)
  animateCircle(seed)
}

function onClick(event: MouseEvent) {
  if (event.button !== 0) return
  if (shouldSkip(event.target)) return
  spawnCircle(event.clientX, event.clientY)
}

function onDblClick(event: MouseEvent) {
  if (event.button !== 0) return
  if (shouldSkip(event.target)) return
  spawnCircle(event.clientX, event.clientY, { minRadius: 8, maxRadius: 42, stroke: 2 })
}

function bindTarget(el: HTMLElement | null | undefined) {
  if (boundEl) {
    boundEl.removeEventListener('click', onClick, { capture: true })
    boundEl.removeEventListener('dblclick', onDblClick, { capture: true })
    boundEl = null
  }
  if (!el) return
  boundEl = el
  boundEl.addEventListener('click', onClick, { capture: true })
  boundEl.addEventListener('dblclick', onDblClick, { capture: true })
}

watch(
  () => props.container,
  (el) => bindTarget(el),
  { immediate: true },
)

onUnmounted(() => bindTarget(null))
</script>

<template>
  <Teleport to="body">
    <div class="mouse-trail-container">
      <svg class="trail-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="neo-click-ripple-glow">
            <feGaussianBlur stdDeviation="0.8" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          v-for="c in circles"
          :key="c.id"
          class="click-ripple"
          :cx="c.x"
          :cy="c.y"
          :r="c.radius"
          fill="none"
          :stroke="c.color"
          :stroke-width="c.strokeWidth"
          :opacity="c.opacity"
          filter="url(#neo-click-ripple-glow)"
        />
      </svg>
    </div>
  </Teleport>
</template>

<style scoped>
.mouse-trail-container {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 120;
  overflow: hidden;
}

.trail-svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .click-ripple {
    display: none;
  }
}
</style>
