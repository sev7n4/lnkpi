<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

type Clip = { src: string; label: string }

const clips: Clip[] = [
  { src: '/auth/login-loop-01.mp4', label: '运镜' },
  { src: '/auth/login-loop-02.mp4', label: '科幻' },
  { src: '/auth/login-loop-03.mp4', label: '电商' },
  { src: '/auth/login-loop-04.mp4', label: '护肤' },
  { src: '/auth/login-loop-05.mp4', label: '微观' },
]

const CROSSFADE_MS = 700
const TIMER_FALLBACK_MS = 15_000
const poster = '/auth/login-loop-poster.jpg'

const reduceMotion = ref(false)
const activeSlot = ref<0 | 1>(0)
const slotIndex = ref<[number, number]>([0, 0])
const fading = ref(false)
const failed = ref<Set<number>>(new Set())

const videoA = ref<HTMLVideoElement | null>(null)
const videoB = ref<HTMLVideoElement | null>(null)

let advanceTimer: ReturnType<typeof setTimeout> | null = null
let fadeTimer: ReturnType<typeof setTimeout> | null = null
let mq: MediaQueryList | null = null

const currentIndex = computed(() => slotIndex.value[activeSlot.value])
const caption = computed(() => `超创 · ${clips[currentIndex.value]?.label ?? ''}`)

function clearAdvanceTimer() {
  if (advanceTimer) {
    clearTimeout(advanceTimer)
    advanceTimer = null
  }
}

function clearFadeTimer() {
  if (fadeTimer) {
    clearTimeout(fadeTimer)
    fadeTimer = null
  }
}

function nextPlayableIndex(from: number): number | null {
  const n = clips.length
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n
    if (!failed.value.has(idx)) return idx
  }
  return null
}

function elForSlot(slot: 0 | 1) {
  return slot === 0 ? videoA.value : videoB.value
}

async function playSlot(slot: 0 | 1) {
  const el = elForSlot(slot)
  if (!el) return
  try {
    el.muted = true
    await el.play()
  } catch {
    // Autoplay may be blocked; keep silent — form stays usable
  }
}

function scheduleAdvance() {
  clearAdvanceTimer()
  if (reduceMotion.value) return
  advanceTimer = setTimeout(() => {
    void goNext('timer')
  }, TIMER_FALLBACK_MS)
}

async function goNext(reason: 'ended' | 'timer' | 'error' = 'timer') {
  if (fading.value) return
  if (reduceMotion.value && reason !== 'error') return

  const from = currentIndex.value
  const next = nextPlayableIndex(from)
  if (next === null || next === from) {
    scheduleAdvance()
    return
  }

  // Reduced motion: hard-cut to next playable clip (error recovery only)
  if (reduceMotion.value) {
    clearAdvanceTimer()
    activeSlot.value = 0
    slotIndex.value = [next, next]
    const el = elForSlot(0)
    if (el) {
      el.currentTime = 0
      await playSlot(0)
    }
    return
  }

  const inactive: 0 | 1 = activeSlot.value === 0 ? 1 : 0
  slotIndex.value = activeSlot.value === 0 ? [from, next] : [next, from]

  const incoming = elForSlot(inactive)
  if (incoming) {
    incoming.currentTime = 0
    await playSlot(inactive)
  }

  fading.value = true
  clearAdvanceTimer()
  clearFadeTimer()
  fadeTimer = setTimeout(() => {
    const outgoing = elForSlot(activeSlot.value)
    outgoing?.pause()
    activeSlot.value = inactive
    fading.value = false
    scheduleAdvance()
  }, CROSSFADE_MS)
}

function onEnded(slot: 0 | 1) {
  if (slot !== activeSlot.value || reduceMotion.value) return
  void goNext('ended')
}

function onError(slot: 0 | 1) {
  const idx = slotIndex.value[slot]
  failed.value = new Set([...failed.value, idx])
  if (slot === activeSlot.value) {
    fading.value = false
    void goNext('error')
  }
}

function onReduceMotionChange() {
  reduceMotion.value = mq?.matches ?? false
  if (reduceMotion.value) {
    clearAdvanceTimer()
    clearFadeTimer()
    fading.value = false
    activeSlot.value = 0
    slotIndex.value = [0, 0]
    videoB.value?.pause()
    void playSlot(0)
  } else {
    scheduleAdvance()
  }
}

onMounted(() => {
  mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduceMotion.value = mq.matches
  mq.addEventListener('change', onReduceMotionChange)
  void playSlot(0)
  if (!reduceMotion.value) scheduleAdvance()
})

onUnmounted(() => {
  clearAdvanceTimer()
  clearFadeTimer()
  mq?.removeEventListener('change', onReduceMotionChange)
})
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-[var(--neo-bg)]">
    <video
      ref="videoA"
      class="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
      :class="activeSlot === 0 && !fading ? 'opacity-100' : activeSlot === 0 && fading ? 'opacity-0' : activeSlot === 1 && fading ? 'opacity-100' : 'opacity-0'"
      :style="{ transitionDuration: `${CROSSFADE_MS}ms` }"
      :src="clips[slotIndex[0]].src"
      :poster="poster"
      muted
      playsinline
      preload="auto"
      @ended="onEnded(0)"
      @error="onError(0)"
    />
    <video
      ref="videoB"
      class="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
      :class="activeSlot === 1 && !fading ? 'opacity-100' : activeSlot === 1 && fading ? 'opacity-0' : activeSlot === 0 && fading ? 'opacity-100' : 'opacity-0'"
      :style="{ transitionDuration: `${CROSSFADE_MS}ms` }"
      :src="clips[slotIndex[1]].src"
      muted
      playsinline
      preload="auto"
      @ended="onEnded(1)"
      @error="onError(1)"
    />
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-[var(--neo-bg)]/40" />
    <p class="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-white/50">{{ caption }}</p>
  </div>
</template>
