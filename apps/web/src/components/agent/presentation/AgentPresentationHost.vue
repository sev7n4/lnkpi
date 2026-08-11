<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentStepper from './AgentStepper.vue'
import AgentProseBlock from './AgentProseBlock.vue'
import AgentMacroSchemeCards from './AgentMacroSchemeCards.vue'
import type { AgentPresentationEnvelope } from './types'

const props = defineProps<{
  presentation: AgentPresentationEnvelope
  disabled?: boolean
  macroSelectedIds?: string[]
}>()

const emit = defineEmits<{
  primaryAction: [message: string]
  macroToggle: [schemeId: string, checked: boolean]
}>()

const macroSelections = ref<string[]>(props.macroSelectedIds ?? [])

const isProseBlock = computed(() => props.presentation.kind === 'prose_block')
const isMacroCards = computed(() => props.presentation.kind === 'macro_scheme_cards')
const proseContent = computed(() => String(props.presentation.body?.prose ?? ''))
const macroSchemes = computed(() => props.presentation.body?.schemes ?? [])
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
      v-if="presentation.body?.callout"
      class="rounded-lg border border-[var(--neo-border)] bg-[var(--neo-panel)] px-2 py-1.5 text-xs text-[var(--neo-muted)]"
      data-testid="presentation-callout"
    >
      {{ presentation.body.callout }}
    </p>
    <AgentProseBlock
      v-if="isProseBlock && proseContent"
      :content="proseContent"
    />
    <AgentMacroSchemeCards
      v-if="isMacroCards && macroSchemes.length"
      :schemes="macroSchemes"
      :selected-ids="macroSelections"
      :disabled="disabled"
      @toggle="(id, checked) => emit('macroToggle', id, checked)"
    />
    <p
      v-if="presentation.body?.text"
      class="text-xs leading-relaxed text-[var(--neo-muted)]"
      data-testid="presentation-hint"
    >
      {{ presentation.body.text }}
    </p>
    <p
      v-if="presentation.body?.footer_hint"
      class="text-xs text-[var(--neo-muted)]"
      data-testid="presentation-footer-hint"
    >
      {{ presentation.body.footer_hint }}
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
