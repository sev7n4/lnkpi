<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  state: 'idle' | 'running' | 'stopping' | 'done'
  /** 是否为批量重新生成（标题区分） */
  regenerate?: boolean
  progress: {
    done: number
    failed: number
    cancelled: number
    timeout: number
    skipped: number
    total: number
    abortReason: string
  }
}>()

const emit = defineEmits<{ stop: [] }>()

const visible = computed(() => props.state === 'running' || props.state === 'stopping')

const settled = computed(() => props.progress.done + props.progress.failed + props.progress.cancelled + props.progress.timeout)

const percent = computed(() => {
  if (props.progress.total <= 0) return 0
  return Math.round((settled.value / props.progress.total) * 100)
})

const title = computed(() => {
  const verb = props.regenerate ? '批量重新生成中' : '批量生成中'
  return props.state === 'stopping' ? '停止中…' : verb
})
</script>

<template>
  <div
    v-if="visible"
    data-testid="batch-progress-card"
    class="neo-chrome pointer-events-auto fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-3"
    role="status"
  >
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--neo-accent-text)]" />
        <span class="text-xs font-medium text-[var(--neo-text-primary)]">{{ title }}</span>
        <span class="text-xs tabular-nums text-[var(--neo-text-muted)]">{{ settled }}/{{ progress.total }}</span>
      </div>
      <button
        v-if="state === 'running'"
        type="button"
        data-testid="batch-progress-stop"
        class="rounded-lg border border-[var(--neo-border)] px-2 py-1 text-[11px] text-[var(--neo-text-secondary)] transition hover:text-[var(--neo-text-primary)]"
        @click="emit('stop')"
      >
        停止
      </button>
    </div>
    <div class="mt-2 h-1 w-56 overflow-hidden rounded-full bg-[var(--neo-hover-bg)]">
      <div
        data-testid="batch-progress-bar"
        class="h-full rounded-full bg-[var(--neo-accent-text)] transition-all duration-300"
        :style="{ width: `${percent}%` }"
      />
    </div>
    <div class="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--neo-text-muted)] tabular-nums">
      <span v-if="progress.done" class="text-emerald-500">完成 {{ progress.done }}</span>
      <span v-if="progress.failed" class="text-red-400">失败 {{ progress.failed }}</span>
      <span v-if="progress.cancelled" class="text-amber-400">取消 {{ progress.cancelled }}</span>
      <span v-if="progress.timeout" class="text-orange-400">超时 {{ progress.timeout }}</span>
      <span v-if="progress.skipped">跳过 {{ progress.skipped }}</span>
    </div>
  </div>
</template>
