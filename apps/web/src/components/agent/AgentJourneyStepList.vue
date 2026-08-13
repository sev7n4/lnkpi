<script setup lang="ts">
import { computed } from 'vue'
import type { ProductVisualMacroScheme } from '@/components/agent/agentInterruptGate'
import type { ExecutionStep } from '@/components/agent/executionTraceReducer'
import { formatDuration } from '@/components/agent/executionStepLabels'
import type { JourneyStepId, JourneyStepRecord } from '@/components/agent/journeyTraceTypes'
import AgentMacroSchemeCards from '@/components/agent/presentation/AgentMacroSchemeCards.vue'
import { PRESENTATION_STEPS } from '@/components/agent/presentation/types'

const props = defineProps<{
  steps: ExecutionStep[]
  journeySteps?: JourneyStepRecord[]
}>()

const stepById = computed(() => {
  const map = new Map<JourneyStepId, ExecutionStep>()
  for (const step of props.steps) {
    if (step.journeyStepId) map.set(step.journeyStepId, step)
  }
  return map
})

const journeyById = computed(() => {
  const map = new Map<JourneyStepId, JourneyStepRecord>()
  for (const record of props.journeySteps ?? []) {
    map.set(record.id, record)
  }
  return map
})

function statusIcon(status: ExecutionStep['status']): string {
  switch (status) {
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

function stepDuration(step: ExecutionStep | undefined): string {
  if (!step || step.ms == null || step.status === 'running') return ''
  if (step.ms === 0) return ''
  return ` · ${formatDuration(step.ms)}`
}

function macroSnapshot(record: JourneyStepRecord | undefined): {
  schemes: ProductVisualMacroScheme[]
  selectedIds: string[]
} | null {
  const snapshot = record?.snapshot
  if (!snapshot || snapshot.kind !== 'macro_select') return null
  const schemes = Array.isArray(snapshot.schemes)
    ? (snapshot.schemes as ProductVisualMacroScheme[])
    : []
  const selectedIds = Array.isArray(snapshot.selectedIds)
    ? (snapshot.selectedIds as string[])
    : []
  if (schemes.length === 0) return null
  return { schemes, selectedIds }
}
</script>

<template>
  <ol class="agent-journey-step-list space-y-1" data-testid="agent-journey-step-list">
    <li
      v-for="(def, idx) in PRESENTATION_STEPS"
      :key="def.id"
      class="text-[10px] leading-snug"
      :data-journey-step-id="def.id"
      :data-journey-step-status="stepById.get(def.id as JourneyStepId)?.status ?? 'pending'"
    >
      <span
        data-testid="journey-step-label"
        class="inline-flex flex-wrap items-center gap-x-1 rounded px-0.5"
        :class="{
          'bg-[var(--neo-accent)] font-medium text-white': stepById.get(def.id as JourneyStepId)?.status === 'running',
          'text-[var(--neo-text-muted)] line-through opacity-70':
            stepById.get(def.id as JourneyStepId)?.status === 'done',
          'text-[var(--neo-text-muted)] opacity-50':
            (stepById.get(def.id as JourneyStepId)?.status ?? 'pending') === 'pending',
          'text-red-400/90': stepById.get(def.id as JourneyStepId)?.status === 'failed',
          'animate-pulse': stepById.get(def.id as JourneyStepId)?.status === 'running',
        }"
      >
        <span>
          {{ statusIcon(stepById.get(def.id as JourneyStepId)?.status ?? 'pending') }}
          {{ idx + 1 }}. {{ stepById.get(def.id as JourneyStepId)?.label ?? def.label
          }}{{ stepDuration(stepById.get(def.id as JourneyStepId)) }}
        </span>
      </span>
      <p
        v-if="stepById.get(def.id as JourneyStepId)?.detail"
        class="mt-0.5 pl-3 text-[var(--neo-text-muted)] opacity-75"
        data-testid="journey-step-summary"
      >
        {{ stepById.get(def.id as JourneyStepId)?.detail }}
      </p>
      <div
        v-if="macroSnapshot(journeyById.get(def.id as JourneyStepId))"
        class="mt-1 pl-3"
        data-testid="journey-macro-snapshot"
      >
        <AgentMacroSchemeCards
          :schemes="macroSnapshot(journeyById.get(def.id as JourneyStepId))!.schemes"
          :selected-ids="macroSnapshot(journeyById.get(def.id as JourneyStepId))!.selectedIds"
          :disabled="true"
        />
      </div>
    </li>
  </ol>
</template>
