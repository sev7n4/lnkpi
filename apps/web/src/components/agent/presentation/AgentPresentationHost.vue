<script setup lang="ts">
import AgentStepper from './AgentStepper.vue'
import type { AgentPresentationEnvelope } from './types'

defineProps<{
  presentation: AgentPresentationEnvelope
  disabled?: boolean
}>()

const emit = defineEmits<{
  primaryAction: [message: string]
}>()
</script>

<template>
  <div class="agent-presentation-host mb-2 space-y-2 px-0.5" data-testid="agent-presentation-host">
    <AgentStepper
      :current="presentation.stepper.current"
      :completed="presentation.stepper.completed"
    />
    <p
      v-if="presentation.context_recap"
      class="rounded-lg border border-[var(--neo-border)] bg-[var(--neo-panel)] px-2 py-1.5 text-xs text-[var(--neo-muted)]"
      data-testid="context-recap"
    >
      {{ presentation.context_recap }}
    </p>
    <p
      v-if="presentation.body?.text"
      class="text-xs leading-relaxed text-[var(--neo-muted)]"
      data-testid="presentation-hint"
    >
      {{ presentation.body.text }}
    </p>
    <div v-if="presentation.primary_action" class="flex flex-wrap gap-2">
      <button
        type="button"
        class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
        data-testid="primary-action"
        :disabled="disabled"
        @click="emit('primaryAction', presentation.primary_action!.message)"
      >
        {{ presentation.primary_action.label }}
      </button>
    </div>
  </div>
</template>
