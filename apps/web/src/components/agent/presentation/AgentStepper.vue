<script setup lang="ts">
import { computed } from 'vue'
import { PRESENTATION_STEPS } from './types'

const props = defineProps<{
  current: string
  completed?: string[]
}>()

const completedSet = computed(() => new Set(props.completed ?? []))

function stepState(id: string): 'done' | 'current' | 'pending' {
  if (id === props.current) return 'current'
  if (completedSet.value.has(id)) return 'done'
  return 'pending'
}
</script>

<template>
  <ol
    class="agent-stepper flex flex-wrap gap-x-1 gap-y-1 text-[10px] leading-tight"
    data-testid="agent-stepper"
  >
    <li
      v-for="(step, idx) in PRESENTATION_STEPS"
      :key="step.id"
      class="flex items-center gap-0.5"
      :data-step-id="step.id"
      :data-step-state="stepState(step.id)"
    >
      <span
        class="rounded px-1 py-0.5"
        :class="{
          'bg-[var(--neo-accent)] text-white font-medium': stepState(step.id) === 'current',
          'text-[var(--neo-muted)] line-through opacity-70': stepState(step.id) === 'done',
          'text-[var(--neo-muted)] opacity-50': stepState(step.id) === 'pending',
        }"
      >
        {{ idx + 1 }}. {{ step.label }}
      </span>
      <span v-if="idx < PRESENTATION_STEPS.length - 1" class="text-[var(--neo-muted)] opacity-40">›</span>
    </li>
  </ol>
</template>
