<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { resolveTaskBadge } from '@/components/canvas/nodeTaskChrome'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

const props = defineProps<{
  status?: unknown
  startedAt?: string
}>()

const nowMs = ref(Date.now())
const completedFlash = ref(false)
let tick: ReturnType<typeof setInterval> | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.status,
  (s, prev) => {
    if (s === NODE_GENERATION_STATUS.completed && prev && prev !== NODE_GENERATION_STATUS.completed) {
      completedFlash.value = true
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => {
        completedFlash.value = false
      }, 2000)
    }
  },
)

watch(
  () => props.status,
  (s) => {
    clearInterval(tick)
    if (s === NODE_GENERATION_STATUS.generating || s === NODE_GENERATION_STATUS.fallback_pending) {
      nowMs.value = Date.now()
      tick = setInterval(() => {
        nowMs.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  clearInterval(tick)
  clearTimeout(flashTimer)
})

const badge = computed(() =>
  resolveTaskBadge({
    status: props.status,
    startedAt: props.startedAt,
    nowMs: nowMs.value,
    completedFlash: completedFlash.value,
  }),
)
</script>

<template>
  <span v-if="badge" class="neo-task-badge" :class="`is-${badge.tone}`">{{ badge.text }}</span>
</template>
