<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { useNodeId } from '@vue-flow/core'
import { resolveTaskChrome, truncateError } from '@/components/canvas/nodeTaskChrome'
import { CANVAS_NODE_CANCEL_KEY, CANVAS_NODE_RETRY_KEY } from '@/composables/canvasNodeActions'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

const props = defineProps<{
  status?: unknown
  startedAt?: string
  errorMessage?: string
}>()

const nodeId = useNodeId()
const cancel = inject(CANVAS_NODE_CANCEL_KEY, null)
const retry = inject(CANVAS_NODE_RETRY_KEY, null)

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
    if (s === NODE_GENERATION_STATUS.generating) {
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

const chrome = computed(() =>
  resolveTaskChrome({
    status: props.status,
    startedAt: props.startedAt,
    nowMs: nowMs.value,
    completedFlash: completedFlash.value,
  }),
)

const err = computed(() => truncateError(props.errorMessage))
const showError = computed(
  () =>
    Boolean(err.value) &&
    (props.status === NODE_GENERATION_STATUS.error ||
      props.status === NODE_GENERATION_STATUS.failed),
)

const isClickable = computed(
  () => chrome.value?.action === 'cancel' || chrome.value?.action === 'retry',
)

function onAction(e: Event) {
  e.stopPropagation()
  e.preventDefault()
  if (!nodeId || !chrome.value?.action) return
  if (chrome.value.action === 'cancel') cancel?.(nodeId)
  if (chrome.value.action === 'retry') void retry?.(nodeId)
}
</script>

<template>
  <div
    v-if="chrome"
    class="neo-task-chrome nodrag nopan"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
  >
    <p v-if="showError" class="neo-task-error">{{ err }}</p>
    <div class="neo-task-chrome-row">
      <span v-if="chrome.elapsedText" class="neo-task-elapsed">{{ chrome.elapsedText }}</span>
      <button
        type="button"
        class="neo-task-chrome-btn"
        :class="[
          `is-${chrome.tone}`,
          {
            'is-clickable': isClickable,
            'is-flash': chrome.flashSuccess,
          },
        ]"
        :title="
          chrome.action === 'cancel'
            ? '取消生成'
            : chrome.action === 'retry'
              ? '重试'
              : chrome.tone === 'pending'
                ? '待确认'
                : undefined
        "
        :aria-label="
          chrome.action === 'cancel'
            ? '取消生成'
            : chrome.action === 'retry'
              ? '重试'
              : chrome.tone === 'pending'
                ? '待确认'
                : '已完成'
        "
        :disabled="!isClickable"
        @click="onAction"
      >
        <span v-if="chrome.showSpinner" class="neo-task-spinner" aria-hidden="true" />
        <svg
          v-else-if="chrome.action === 'retry'"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        <svg
          v-else-if="chrome.tone === 'pending'"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <svg
          v-else-if="chrome.flashSuccess"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>
    </div>
  </div>
</template>
