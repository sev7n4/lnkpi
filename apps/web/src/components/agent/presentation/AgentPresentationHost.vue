<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentStepper from './AgentStepper.vue'
import AgentProseBlock from './AgentProseBlock.vue'
import AgentMacroSchemeCards from './AgentMacroSchemeCards.vue'
import AgentTopoCardList from './AgentTopoCardList.vue'
import AgentDeliveryCards from './AgentDeliveryCards.vue'
import AgentDeliverySummaryTable from './AgentDeliverySummaryTable.vue'
import type { AgentPresentationEnvelope } from './types'

const FOCUS_ALL_MESSAGE = '__focus_all_canvas__'

const props = defineProps<{
  presentation: AgentPresentationEnvelope
  disabled?: boolean
  macroSelectedIds?: string[]
  deliverySelections?: Record<string, string>
}>()

const emit = defineEmits<{
  primaryAction: [message: string]
  macroToggle: [schemeId: string, checked: boolean]
  focusNode: [nodeId: string]
  focusAll: [nodeIds: string[]]
  deliverySwitch: [shotId: string, variantKey: string]
}>()

const macroSelections = ref<string[]>(props.macroSelectedIds ?? [])

const isProseBlock = computed(() => props.presentation.kind === 'prose_block')
const isMacroCards = computed(() => props.presentation.kind === 'macro_scheme_cards')
const isTopoCards = computed(() => props.presentation.kind === 'topo_card_list')
const isDeliveryCards = computed(() => props.presentation.kind === 'delivery_cards')
const isDeliverySummary = computed(() => props.presentation.kind === 'delivery_summary_table')
const proseContent = computed(() => String(props.presentation.body?.prose ?? ''))
const macroSchemes = computed(() => props.presentation.body?.schemes ?? [])
const topoNodes = computed(() => props.presentation.body?.nodes ?? [])
const deliveryGroups = computed(() => props.presentation.body?.groups ?? [])
const deliverySelectionsMap = computed(() => props.deliverySelections ?? {})
const deliveryHeadline = computed(() => String(props.presentation.body?.headline ?? ''))
const deliveryFinalized = computed(() => props.presentation.body?.finalized ?? [])
const deliveryBasics = computed(() => props.presentation.body?.basics ?? [])

function collectAllNodeIds(): string[] {
  const rows = [...deliveryFinalized.value, ...deliveryBasics.value]
  return rows.map((row) => row.node_id).filter((id): id is string => Boolean(id))
}

function onPrimaryAction() {
  const action = props.presentation.primary_action
  if (!action) return
  if (action.message === FOCUS_ALL_MESSAGE) {
    const ids = collectAllNodeIds()
    if (ids.length) emit('focusAll', ids)
    return
  }
  emit('primaryAction', action.message)
}
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
      v-if="presentation.body?.text && isTopoCards && topoNodes.length"
      class="text-xs leading-relaxed text-[var(--neo-muted)]"
      data-testid="presentation-hint"
    >
      {{ presentation.body.text }}
    </p>
    <AgentTopoCardList
      v-if="isTopoCards && topoNodes.length"
      :nodes="topoNodes"
      :eta-min="presentation.body?.eta_min"
      :scene-count="presentation.body?.scene_count"
      :credits-hint="presentation.body?.credits_hint"
      :mermaid="presentation.body?.mermaid"
      :disabled="disabled"
      @focus-node="emit('focusNode', $event)"
    />
    <AgentDeliverySummaryTable
      v-if="isDeliverySummary"
      :headline="deliveryHeadline"
      :finalized="deliveryFinalized"
      :basics="deliveryBasics"
      :basics-section-title="presentation.body?.basics_section_title"
      :disabled="disabled"
      @focus-node="emit('focusNode', $event)"
    />
    <p
      v-if="presentation.body?.hint && isDeliveryCards"
      class="text-xs leading-relaxed text-[var(--neo-muted)]"
      data-testid="delivery-hint"
    >
      {{ presentation.body.hint }}
    </p>
    <AgentDeliveryCards
      v-if="isDeliveryCards && deliveryGroups.length"
      :groups="deliveryGroups"
      :selections="deliverySelectionsMap"
      :disabled="disabled"
      @switch-variant="(shotId, variantKey) => emit('deliverySwitch', shotId, variantKey)"
    />
    <p
      v-if="presentation.body?.text && !(isTopoCards && topoNodes.length) && !isDeliveryCards && !isDeliverySummary"
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
        @click="onPrimaryAction"
      >
        {{ presentation.primary_action.label }}
      </button>
      <button
        v-for="(action, idx) in presentation.secondary_actions ?? []"
        :key="`${action.label}-${idx}`"
        type="button"
        class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
        :disabled="disabled || action.disabled"
        data-testid="secondary-action"
        @click="emit('primaryAction', action.message)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>
