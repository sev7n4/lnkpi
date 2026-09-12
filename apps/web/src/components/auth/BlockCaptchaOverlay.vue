<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { CaptchaBlockShape, CaptchaChallenge, CaptchaPlacement } from './captcha-types'

const emit = defineEmits<{
  verified: [ticket: string]
  close: []
}>()

const auth = useAuthStore()

const PIECE = 40
const SNAP_PX = 12

type DragState = { blockId: string; ox: number; oy: number; x: number; y: number }

const challenge = ref<CaptchaChallenge | null>(null)
const positions = ref<Record<string, { x: number; y: number }>>({})
const snapped = ref<Record<string, string>>({}) // blockId -> slotId
const drag = ref<DragState | null>(null)
const loading = ref(true)
const verifying = ref(false)
const successFlash = ref(false)
const error = ref('')
const reduceMotion = ref(false)
const dropIn = ref(true)

let mediaQuery: MediaQueryList | null = null

const boardStyle = computed(() => {
  const c = challenge.value
  if (!c) return { width: '280px', height: '200px' }
  return { width: `${c.canvas.w}px`, height: `${c.canvas.h}px` }
})

const occupiedSlots = computed(() => new Set(Object.values(snapped.value)))

function pieceCenter(pos: { x: number; y: number }) {
  return { x: pos.x + PIECE / 2, y: pos.y + PIECE / 2 }
}

function slotCenter(slot: { x: number; y: number }) {
  return { x: slot.x + PIECE / 2, y: slot.y + PIECE / 2 }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function resetBoard(c: CaptchaChallenge) {
  const next: Record<string, { x: number; y: number }> = {}
  for (const b of c.blocks) {
    next[b.id] = { ...b.home }
  }
  positions.value = next
  snapped.value = {}
  drag.value = null
  successFlash.value = false
  verifying.value = false
  error.value = ''
  dropIn.value = !reduceMotion.value
  if (dropIn.value) {
    window.setTimeout(() => {
      dropIn.value = false
    }, 450)
  }
}

async function loadChallenge() {
  loading.value = true
  error.value = ''
  challenge.value = null
  try {
    const c = await auth.fetchCaptchaChallenge()
    challenge.value = c
    resetBoard(c)
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

function unsnapBlock(blockId: string) {
  const next = { ...snapped.value }
  delete next[blockId]
  snapped.value = next
}

function trySnap(blockId: string) {
  const c = challenge.value
  if (!c) return
  const block = c.blocks.find((b) => b.id === blockId)
  const pos = positions.value[blockId]
  if (!block || !pos) return

  const bc = pieceCenter(pos)
  let best: { slotId: string; d: number; x: number; y: number } | null = null

  for (const slot of c.slots) {
    if (slot.shape !== block.shape) continue
    if (occupiedSlots.value.has(slot.id) && snapped.value[blockId] !== slot.id) continue
    const d = dist(bc, slotCenter(slot))
    if (d <= SNAP_PX && (!best || d < best.d)) {
      best = { slotId: slot.id, d, x: slot.x, y: slot.y }
    }
  }

  if (best) {
    positions.value = { ...positions.value, [blockId]: { x: best.x, y: best.y } }
    snapped.value = { ...snapped.value, [blockId]: best.slotId }
    void maybeVerify()
  } else {
    unsnapBlock(blockId)
  }
}

async function maybeVerify() {
  const c = challenge.value
  if (!c || verifying.value) return
  if (Object.keys(snapped.value).length !== c.blocks.length) return

  verifying.value = true
  successFlash.value = true
  error.value = ''

  const placements: CaptchaPlacement[] = Object.entries(snapped.value).map(([blockId, slotId]) => ({
    blockId,
    slotId,
  }))

  try {
    await new Promise((r) => setTimeout(r, reduceMotion.value ? 80 : 280))
    const out = await auth.verifyCaptcha(c.challengeId, placements)
    emit('verified', out.captchaTicket)
  } catch {
    error.value = '拼图不正确'
    verifying.value = false
    successFlash.value = false
    await loadChallenge()
  }
}

function onPointerDown(e: PointerEvent, blockId: string) {
  if (verifying.value || loading.value) return
  if (snapped.value[blockId]) unsnapBlock(blockId)
  const pos = positions.value[blockId]
  if (!pos) return
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  drag.value = {
    blockId,
    ox: e.clientX - pos.x,
    oy: e.clientY - pos.y,
    x: pos.x,
    y: pos.y,
  }
}

function onPointerMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const c = challenge.value
  if (!c) return
  let x = e.clientX - d.ox
  let y = e.clientY - d.oy
  x = Math.max(0, Math.min(c.canvas.w - PIECE, x))
  y = Math.max(0, Math.min(c.canvas.h - PIECE, y))
  drag.value = { ...d, x, y }
  positions.value = { ...positions.value, [d.blockId]: { x, y } }
}

function onPointerUp(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const target = e.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(e.pointerId)) {
    target.releasePointerCapture(e.pointerId)
  }
  drag.value = null
  trySnap(d.blockId)
}

function shapeClass(shape: CaptchaBlockShape) {
  return shape === 'l' ? 'captcha-piece--l' : 'captcha-piece--rect'
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
    aria-label="拼图验证"
  >
    <div class="flex items-center justify-between border-b border-[var(--neo-border)] px-4 py-3">
      <p class="text-sm font-medium text-[var(--neo-text-primary)]">拖动积木到对应位置</p>
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

    <div class="flex flex-1 flex-col items-center justify-center gap-3 overflow-auto px-4 py-5">
      <p v-if="loading" class="text-sm text-[var(--neo-text-secondary)]">加载中…</p>

      <div
        v-else-if="challenge"
        class="captcha-board relative touch-none select-none"
        :class="{ 'captcha-board--flash': successFlash }"
        :style="boardStyle"
      >
        <div
          v-for="slot in challenge.slots"
          :key="slot.id"
          class="captcha-slot absolute"
          :class="shapeClass(slot.shape)"
          :style="{ left: `${slot.x}px`, top: `${slot.y}px` }"
          aria-hidden="true"
        />
        <div
          v-for="(block, index) in challenge.blocks"
          :key="block.id"
          class="captcha-piece absolute cursor-grab touch-none active:cursor-grabbing"
          :class="[
            shapeClass(block.shape),
            {
              'captcha-piece--dragging': drag?.blockId === block.id,
              'captcha-piece--snapped': !!snapped[block.id],
              'captcha-piece--drop-in': dropIn,
            },
          ]"
          :style="{
            left: `${positions[block.id]?.x ?? 0}px`,
            top: `${positions[block.id]?.y ?? 0}px`,
            zIndex: drag?.blockId === block.id ? 20 : snapped[block.id] ? 5 : 10,
            animationDelay: dropIn ? `${index * 60}ms` : undefined,
          }"
          @pointerdown="onPointerDown($event, block.id)"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />
      </div>

      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <p v-else-if="verifying" class="text-sm text-[var(--neo-electric)]">验证中…</p>
      <p v-else class="text-xs text-[var(--neo-text-muted)]">将积木拖入虚线槽位，松手自动吸附</p>
    </div>
  </div>
</template>

<style scoped>
.captcha-board {
  background: color-mix(in srgb, var(--neo-bg) 88%, transparent);
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  overflow: hidden;
}

.captcha-board--flash {
  box-shadow: 0 0 0 2px var(--neo-electric), 0 0 24px var(--neo-electric-glow);
  transition: box-shadow 0.2s ease;
}

.captcha-slot {
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  border: 1.5px dashed color-mix(in srgb, var(--neo-electric) 55%, transparent);
  background: color-mix(in srgb, var(--neo-electric) 8%, transparent);
  pointer-events: none;
}

.captcha-piece {
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  background: linear-gradient(145deg, #3a3a4a 0%, #2a2a36 100%);
  border: 1px solid var(--neo-border-strong);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  touch-action: none;
}

.captcha-piece--rect {
  border-radius: 8px;
}

.captcha-piece--l {
  border-radius: 4px;
  clip-path: polygon(0 0, 42% 0, 42% 58%, 100% 58%, 100% 100%, 0 100%);
}

.captcha-slot.captcha-piece--l {
  clip-path: polygon(0 0, 42% 0, 42% 58%, 100% 58%, 100% 100%, 0 100%);
}

.captcha-piece--snapped {
  background: linear-gradient(145deg, color-mix(in srgb, var(--neo-electric) 35%, #3a3a4a), #2a2a36);
  border-color: color-mix(in srgb, var(--neo-electric) 60%, transparent);
}

.captcha-piece--dragging {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  transform: scale(1.04);
}

@keyframes captcha-drop-in {
  from {
    opacity: 0;
    transform: translateY(-18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.captcha-piece--drop-in {
  animation: captcha-drop-in 0.35s ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .captcha-piece--drop-in {
    animation: none;
  }

  .captcha-piece--dragging {
    transform: none;
  }
}
</style>
