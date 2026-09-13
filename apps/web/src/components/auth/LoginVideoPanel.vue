<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

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
  el.muted = true
  el.playsInline = true
  try {
    await el.play()
  } catch {
    try {
      await new Promise((r) => setTimeout(r, 120))
      await el.play()
    } catch {
      // Autoplay may be blocked; poster remains — form stays usable
    }
  }
}

function scheduleAdvance() {
  clearAdvanceTimer()
  if (reduceMotion.value) return
  advanceTimer = setTimeout(() => {
    void goNext('timer')
  }, TIMER_FALLBACK_MS)
}

async function goNext(reason: 'ended' | 'timer' | 'error' | 'dot' = 'timer', forcedIndex?: number) {
  if (fading.value && reason !== 'dot') return

  const from = currentIndex.value
  const next =
    typeof forcedIndex === 'number'
      ? failed.value.has(forcedIndex)
        ? null
        : forcedIndex
      : nextPlayableIndex(from)

  if (next === null || (next === from && reason !== 'dot')) {
    if (reason !== 'dot') scheduleAdvance()
    return
  }

  if (reduceMotion.value || reason === 'dot') {
    clearAdvanceTimer()
    clearFadeTimer()
    fading.value = false
    activeSlot.value = 0
    slotIndex.value = [next, next]
    await nextTick()
    const el = elForSlot(0)
    if (el) {
      el.currentTime = 0
      await playSlot(0)
    }
    if (!reduceMotion.value) scheduleAdvance()
    return
  }

  const inactive: 0 | 1 = activeSlot.value === 0 ? 1 : 0
  slotIndex.value = activeSlot.value === 0 ? [from, next] : [next, from]

  await nextTick()
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

function onDotClick(i: number) {
  if (i === currentIndex.value && !failed.value.has(i)) {
    void playSlot(activeSlot.value)
    return
  }
  void goNext('dot', i)
}

function onLoaded(slot: 0 | 1) {
  if (slot === activeSlot.value) void playSlot(slot)
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
  <div class="relative h-full w-full overflow-hidden bg-[var(--neo-bg)] p-3 md:p-4">
    <div
      class="video-stage relative h-full w-full overflow-hidden rounded-[16px] border border-[var(--neo-border-strong)] shadow-[0_24px_60px_rgba(0,0,0,0.45)] md:rounded-[20px]"
    >
      <video
        ref="videoA"
        class="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
        :class="
          activeSlot === 0 && !fading
            ? 'opacity-100'
            : activeSlot === 0 && fading
              ? 'opacity-0'
              : activeSlot === 1 && fading
                ? 'opacity-100'
                : 'opacity-0'
        "
        :style="{ transitionDuration: `${CROSSFADE_MS}ms` }"
        :src="clips[slotIndex[0]].src"
        :poster="poster"
        autoplay
        muted
        playsinline
        preload="auto"
        @ended="onEnded(0)"
        @error="onError(0)"
        @loadeddata="onLoaded(0)"
        @canplay="onLoaded(0)"
      />
      <video
        ref="videoB"
        class="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
        :class="
          activeSlot === 1 && !fading
            ? 'opacity-100'
            : activeSlot === 1 && fading
              ? 'opacity-0'
              : activeSlot === 0 && fading
                ? 'opacity-100'
                : 'opacity-0'
        "
        :style="{ transitionDuration: `${CROSSFADE_MS}ms` }"
        :src="clips[slotIndex[1]].src"
        muted
        playsinline
        preload="auto"
        @ended="onEnded(1)"
        @error="onError(1)"
        @loadeddata="onLoaded(1)"
        @canplay="onLoaded(1)"
      />
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-[var(--neo-bg)]/35" />

      <div
        class="absolute left-3 top-1/2 z-[2] flex -translate-y-1/2 flex-col gap-2.5 md:left-4"
        role="tablist"
        aria-label="视频主题"
      >
        <button
          v-for="(clip, i) in clips"
          :key="clip.label"
          type="button"
          class="dot"
          :class="{ 'dot--on': currentIndex === i }"
          :title="clip.label"
          :aria-label="clip.label"
          :aria-selected="currentIndex === i"
          role="tab"
          @click="onDotClick(i)"
        />
      </div>

      <p class="absolute bottom-5 left-1/2 z-[2] -translate-x-1/2 text-xs tracking-wide text-white/55">
        {{ caption }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  cursor: pointer;
  transition: height 0.2s ease, background 0.2s ease;
}
.dot--on {
  height: 22px;
  background: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .dot {
    transition: none;
  }
}
</style>
