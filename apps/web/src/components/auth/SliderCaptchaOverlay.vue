<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { SliderCaptchaChallengePublic } from './captcha-types'

const emit = defineEmits<{
  verified: [ticket: string]
  close: []
}>()

const auth = useAuthStore()

const challenge = ref<SliderCaptchaChallengePublic | null>(null)
const offsetX = ref(0)
const dragging = ref(false)
const loading = ref(true)
const verifying = ref(false)
const successFlash = ref(false)
const error = ref('')
const reduceMotion = ref(false)
const snapping = ref(false)

let mediaQuery: MediaQueryList | null = null
let dragStartClientX = 0
let dragStartOffset = 0

const boardStyle = computed(() => {
  const c = challenge.value
  if (!c) return { width: '280px', height: '160px' }
  return { width: `${c.puzzle.width}px`, height: `${c.puzzle.height}px` }
})

const maxOffset = computed(() => {
  const c = challenge.value
  if (!c) return 0
  return Math.max(0, c.puzzle.width - c.puzzle.pieceSize)
})

const trackFillPct = computed(() => {
  if (maxOffset.value <= 0) return 0
  return (offsetX.value / maxOffset.value) * 100
})

const pieceStyle = computed(() => {
  const c = challenge.value
  if (!c) return {}
  return {
    left: `${offsetX.value}px`,
    top: `${c.puzzle.y}px`,
    width: `${c.puzzle.pieceSize}px`,
    height: `${c.puzzle.pieceSize}px`,
  }
})

function isExpiredError(err: unknown): boolean {
  const ax = err as {
    response?: { data?: { message?: string | string[] } }
    message?: string
  }
  const raw = ax.response?.data?.message ?? ax.message ?? ''
  const msg = Array.isArray(raw) ? raw.join(' ') : String(raw)
  return msg.includes('过期')
}

function resetSlider(animate = false) {
  snapping.value = animate && !reduceMotion.value
  offsetX.value = 0
  dragging.value = false
  if (snapping.value) {
    window.setTimeout(() => {
      snapping.value = false
    }, 220)
  }
}

async function loadChallenge() {
  loading.value = true
  error.value = ''
  challenge.value = null
  offsetX.value = 0
  successFlash.value = false
  verifying.value = false
  try {
    const c = await auth.fetchCaptchaChallenge()
    challenge.value = c
    resetSlider(false)
  } catch {
    error.value = '验证加载失败，请重试'
  } finally {
    loading.value = false
  }
}

async function onRefresh() {
  if (verifying.value) return
  await loadChallenge()
}

function onClose() {
  if (verifying.value) return
  emit('close')
}

async function submitVerify() {
  const c = challenge.value
  if (!c || verifying.value || loading.value) return

  verifying.value = true
  successFlash.value = true
  error.value = ''

  try {
    await new Promise((r) => setTimeout(r, reduceMotion.value ? 80 : 280))
    const out = await auth.verifyCaptcha(c.challengeId, Math.round(offsetX.value))
    emit('verified', out.captchaTicket)
  } catch (err) {
    verifying.value = false
    successFlash.value = false
    if (isExpiredError(err)) {
      error.value = '验证已过期，请重试'
      await loadChallenge()
      return
    }
    error.value = '再试一次'
    resetSlider(true)
  }
}

function onPointerDown(e: PointerEvent) {
  if (verifying.value || loading.value || !challenge.value) return
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  dragging.value = true
  snapping.value = false
  dragStartClientX = e.clientX
  dragStartOffset = offsetX.value
  error.value = ''
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || !challenge.value) return
  const delta = e.clientX - dragStartClientX
  const next = Math.max(0, Math.min(maxOffset.value, dragStartOffset + delta))
  offsetX.value = next
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  const target = e.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(e.pointerId)) {
    target.releasePointerCapture(e.pointerId)
  }
  dragging.value = false
  void submitVerify()
}

function onMotionChange() {
  reduceMotion.value = mediaQuery?.matches ?? false
}

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduceMotion.value = mediaQuery.matches
  mediaQuery.addEventListener('change', onMotionChange)
  void loadChallenge()
})

onUnmounted(() => {
  mediaQuery?.removeEventListener('change', onMotionChange)
})
</script>

<template>
  <div
    class="captcha-overlay z-[110] flex flex-col bg-[var(--neo-surface-elevated)]/95 backdrop-blur-md max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:h-[60vh] max-md:rounded-t-2xl max-md:border-t max-md:border-[var(--neo-border)] md:absolute md:inset-0"
    role="dialog"
    aria-modal="true"
    aria-label="滑块验证"
  >
    <div class="flex items-center justify-between border-b border-[var(--neo-border)] px-4 py-3">
      <p class="text-sm font-medium text-[var(--neo-text-primary)]">拖动滑块完成验证</p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn-ghost px-2 py-1 text-xs"
          :disabled="loading || verifying"
          @click="onRefresh"
        >
          换一题
        </button>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-[var(--neo-text-secondary)] transition hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-primary)]"
          aria-label="关闭验证"
          :disabled="verifying"
          @click="onClose"
        >
          ×
        </button>
      </div>
    </div>

    <div class="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto px-4 py-5">
      <p v-if="loading" class="text-sm text-[var(--neo-text-secondary)]">加载中…</p>

      <template v-else-if="challenge">
        <div
          class="captcha-board relative touch-none select-none overflow-hidden"
          :class="{ 'captcha-board--flash': successFlash }"
          :style="boardStyle"
        >
          <img
            class="pointer-events-none absolute inset-0 h-full w-full"
            :src="challenge.bgImage"
            alt=""
            draggable="false"
          />
          <img
            class="captcha-piece absolute pointer-events-none"
            :class="{ 'captcha-piece--snap': snapping }"
            :src="challenge.pieceImage"
            alt=""
            draggable="false"
            :style="pieceStyle"
          />
        </div>

        <div
          class="captcha-track relative touch-none select-none"
          :style="{ width: boardStyle.width }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div class="captcha-track__rail" aria-hidden="true">
            <div class="captcha-track__fill" :style="{ width: `${trackFillPct}%` }" />
          </div>
          <button
            type="button"
            class="captcha-track__thumb"
            :class="{
              'captcha-track__thumb--dragging': dragging,
              'captcha-track__thumb--snap': snapping,
            }"
            :style="{
              left: `${offsetX}px`,
              width: `${challenge.puzzle.pieceSize}px`,
              height: `${challenge.puzzle.pieceSize}px`,
            }"
            :disabled="verifying || loading"
            aria-label="拖动滑块"
            tabindex="-1"
          >
            ››
          </button>
        </div>
      </template>

      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <p v-else-if="verifying" class="text-sm text-[var(--neo-electric)]">验证中…</p>
      <p v-else class="text-xs text-[var(--neo-text-muted)]">将滑块拖动到正确位置</p>
    </div>
  </div>
</template>

<style scoped>
.captcha-board {
  background: color-mix(in srgb, var(--neo-bg) 88%, transparent);
  border: 1px solid var(--neo-border);
  border-radius: 12px;
}

.captcha-board--flash {
  box-shadow: 0 0 0 2px var(--neo-electric), 0 0 24px var(--neo-electric-glow);
  transition: box-shadow 0.2s ease;
}

.captcha-piece {
  box-sizing: border-box;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
  will-change: left;
}

.captcha-piece--snap,
.captcha-track__thumb--snap {
  transition: left 0.2s ease-out;
}

.captcha-track {
  position: relative;
  height: 44px;
  min-height: 44px;
  cursor: grab;
  touch-action: none;
}

.captcha-track:active {
  cursor: grabbing;
}

.captcha-track__rail {
  position: absolute;
  inset: 10px 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--neo-bg) 70%, transparent);
  border: 1px solid var(--neo-border);
  overflow: hidden;
}

.captcha-track__fill {
  height: 100%;
  background: color-mix(in srgb, var(--neo-electric) 28%, transparent);
  transition: none;
}

.captcha-track__thumb {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--neo-border-strong);
  background: linear-gradient(145deg, #3a3a4a 0%, #2a2a36 100%);
  color: var(--neo-electric);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -2px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  touch-action: none;
  cursor: grab;
  padding: 0;
}

.captcha-track__thumb--dragging {
  cursor: grabbing;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  transform: translateY(-50%) scale(1.04);
  border-color: color-mix(in srgb, var(--neo-electric) 60%, transparent);
}

.captcha-track__thumb:disabled {
  opacity: 0.7;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .captcha-board--flash {
    transition: none;
  }

  .captcha-piece--snap,
  .captcha-track__thumb--snap {
    transition: none;
  }

  .captcha-track__thumb--dragging {
    transform: translateY(-50%);
  }
}
</style>
