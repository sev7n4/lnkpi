<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AgentJourneyStepList from '@/components/agent/AgentJourneyStepList.vue'
import type { ExecutionTraceState, ExecutionStep } from '@/components/agent/executionTraceReducer'
import { formatDuration } from '@/components/agent/executionStepLabels'
import type { JourneyTraceSnapshot } from '@/components/agent/journeyTraceTypes'
import { PRESENTATION_STEPS } from '@/components/agent/presentation/types'
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'

const props = defineProps<{
  trace: ExecutionTraceState
  streaming?: boolean
  journeySnapshot?: JourneyTraceSnapshot | null
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

const workflowSteps = computed(() => props.trace.steps.filter((s) => s.kind === 'workflow_step'))
const operationSteps = computed(() => props.trace.steps.filter((s) => s.kind !== 'workflow_step'))
const hasWorkflow = computed(() => workflowSteps.value.length > 0)
const stepCount = computed(() => props.trace.steps.length)

const currentJourneyStepNumber = computed(() => {
  const running = workflowSteps.value.find((s) => s.status === 'running')
  if (running?.journeyStepId) {
    const idx = PRESENTATION_STEPS.findIndex((step) => step.id === running.journeyStepId)
    if (idx >= 0) return idx + 1
  }
  const current = props.journeySnapshot?.current
  if (current) {
    const idx = PRESENTATION_STEPS.findIndex((step) => step.id === current)
    if (idx >= 0) return idx + 1
  }
  return null
})

const headerLabel = computed(() => {
  const count = hasWorkflow.value ? 9 : stepCount.value
  if (props.streaming) {
    const n = currentJourneyStepNumber.value
    if (n != null) return `执行过程（进行中… · 第 ${n}/9 步）`
    if (stepCount.value === 0) return '执行过程（进行中…）'
    return `执行过程（进行中… · ${stepCount.value} 步）`
  }
  if (count === 0) return '执行过程'
  return `执行过程（${count} 步）`
})

const durationLabel = computed(() => {
  if (props.streaming) return '· 进行中…'
  if (props.trace.totalMs != null) return `· ${formatDuration(props.trace.totalMs)}`
  return ''
})

const showTrace = computed(
  () => hasWorkflow.value || operationSteps.value.length > 0 || props.streaming,
)

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
  <div v-if="showTrace" class="agent-trace mt-1.5 border-t border-white/10 pt-1.5">
    <button
      type="button"
      class="agent-trace-toggle flex w-full items-center gap-1 text-left text-[11px] text-[var(--neo-text-muted)] hover:text-[var(--neo-text-primary)]"
      @click="toggle"
    >
      <span class="inline-block w-3 shrink-0">{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ headerLabel }}</span>
      <span v-if="durationLabel && !expanded" class="opacity-70">{{ durationLabel }}</span>
    </button>
    <div v-if="expanded" class="mt-1 space-y-2 pl-4">
      <section v-if="hasWorkflow" data-testid="journey-section">
        <p class="mb-1 text-[10px] font-medium text-[var(--neo-text-muted)]">工作流进度</p>
        <AgentJourneyStepList
          :steps="workflowSteps"
          :journey-steps="journeySnapshot?.steps"
        />
      </section>
      <section v-if="operationSteps.length > 0" data-testid="operation-section">
        <p class="mb-1 text-[10px] font-medium text-[var(--neo-text-muted)]">操作明细</p>
        <ul class="space-y-0.5">
          <li
            v-for="step in operationSteps"
            :key="step.id"
            data-testid="operation-step"
            class="flex items-start gap-1.5 text-[10px] leading-snug"
            :class="[
              step.meta?.nodeId ? 'cursor-pointer hover:text-[var(--neo-text-primary)]' : '',
              step.status === 'failed' ? 'text-red-400/90' : 'text-[var(--neo-text-muted)]',
              step.status === 'running' ? 'animate-pulse' : '',
              step.kind === 'thinking' ? 'italic opacity-80' : '',
              step.kind === 'explore' ? 'opacity-90' : '',
            ]"
            @click="onStepClick(step)"
          >
            <span class="min-w-0 flex-1">
              <span>{{ statusIcon(step) }} {{ step.label }}{{ stepDuration(step) }}</span>
              <p v-if="step.detail" class="mt-0.5 pl-3 opacity-75">{{ step.detail }}</p>
            </span>
            <CanvasLocatePinIcon
              v-if="step.meta?.nodeId"
              :size="11"
              class="mt-0.5 shrink-0 opacity-60"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
