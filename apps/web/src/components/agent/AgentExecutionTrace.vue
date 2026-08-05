<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ExecutionTraceState, ExecutionStep } from '@/components/agent/executionTraceReducer'
import { formatDuration } from '@/components/agent/executionStepLabels'

const props = defineProps<{
  trace: ExecutionTraceState
  streaming?: boolean
}>()

const emit = defineEmits<{
  focusNode: [nodeId: string]
}>()

const expanded = ref(!props.trace.collapsed)

watch(
  () => props.trace.collapsed,
  (v) => {
    expanded.value = !v
  },
)

const stepCount = computed(() => props.trace.steps.length)

const headerLabel = computed(() => {
  if (props.streaming && stepCount.value === 0) return '执行过程（进行中…）'
  if (props.streaming) return `执行过程（进行中… · ${stepCount.value} 步）`
  if (stepCount.value === 0) return '执行过程'
  return `执行过程（${stepCount.value} 步）`
})

const durationLabel = computed(() => {
  if (props.streaming) return '· 进行中…'
  if (props.trace.totalMs != null) return `· ${formatDuration(props.trace.totalMs)}`
  return ''
})

function toggle() {
  expanded.value = !expanded.value
}

function statusIcon(step: ExecutionStep): string {
  switch (step.status) {
    case 'done':
      return '✓'
    case 'failed':
      return '✗'
    case 'running':
      return '…'
    case 'waiting_user':
      return '!'
    case 'skipped':
      return '–'
    default:
      return '○'
  }
}

function stepDuration(step: ExecutionStep): string {
  if (step.ms == null || step.status === 'running') return ''
  if (step.ms === 0) return ''
  return ` · ${formatDuration(step.ms)}`
}

function onStepClick(step: ExecutionStep) {
  const nodeId = step.meta?.nodeId
  if (nodeId) emit('focusNode', nodeId)
}
</script>

<template>
  <div v-if="stepCount > 0 || streaming" class="agent-trace mt-1.5 border-t border-white/10 pt-1.5">
    <button
      type="button"
      class="agent-trace-toggle flex w-full items-center gap-1 text-left text-[11px] text-[var(--neo-text-muted)] hover:text-[var(--neo-accent-text)]"
      @click="toggle"
    >
      <span class="inline-block w-3 shrink-0">{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ headerLabel }}</span>
      <span v-if="durationLabel && !expanded" class="opacity-70">{{ durationLabel }}</span>
    </button>
    <ul v-if="expanded" class="mt-1 space-y-0.5 pl-4">
      <li
        v-for="step in trace.steps"
        :key="step.id"
        class="text-[10px] leading-snug"
        :class="[
          step.meta?.nodeId ? 'cursor-pointer hover:text-[var(--neo-accent-text)]' : '',
          step.status === 'failed' ? 'text-red-400/90' : 'text-[var(--neo-text-muted)]',
          step.status === 'running' ? 'animate-pulse' : '',
          step.kind === 'thinking' ? 'italic opacity-80' : '',
          step.kind === 'explore' ? 'opacity-90' : '',
        ]"
        @click="onStepClick(step)"
      >
        <span>{{ statusIcon(step) }} {{ step.label }}{{ stepDuration(step) }}</span>
        <p v-if="step.detail" class="mt-0.5 pl-3 opacity-75">{{ step.detail }}</p>
      </li>
    </ul>
  </div>
</template>
