<script setup lang="ts">
import type { DeliveryCardGroup } from './types'

const props = defineProps<{
  groups: DeliveryCardGroup[]
  selections: Record<string, string>
  disabled?: boolean
}>()

const emit = defineEmits<{
  switchVariant: [shotId: string, variantKey: string]
}>()

function isSelected(shotId: string, variantKey: string) {
  return props.selections[shotId] === variantKey
}

function onSwitch(shotId: string, variantKey: string) {
  if (props.disabled || isSelected(shotId, variantKey)) return
  emit('switchVariant', shotId, variantKey)
}
</script>

<template>
  <div class="space-y-2" data-testid="delivery-cards">
    <div
      v-for="group in groups"
      :key="group.shot_id"
      class="rounded-lg border border-[var(--neo-border)] p-2"
    >
      <div class="mb-0.5 text-xs font-medium text-[var(--neo-text)]">{{ group.label }}</div>
      <div v-if="group.subtitle" class="mb-1.5 text-[10px] text-[var(--neo-muted)]">
        {{ group.subtitle }}
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="candidate in group.candidates"
          :key="candidate.variant_key"
          type="button"
          class="neo-ctl flex min-w-[88px] max-w-[120px] flex-col items-stretch rounded-lg p-1.5 text-left text-[10px]"
          :class="{
            'ring-2 ring-[var(--neo-accent)]': isSelected(group.shot_id, candidate.variant_key),
          }"
          :disabled="disabled || !candidate.url"
          @click="onSwitch(group.shot_id, candidate.variant_key)"
        >
          <div
            class="mb-1 flex h-16 items-center justify-center overflow-hidden rounded bg-[var(--neo-surface-2)] text-[var(--neo-muted)]"
          >
            <img
              v-if="candidate.url"
              :src="candidate.url"
              :alt="candidate.title || candidate.variant_key"
              class="h-full w-full object-cover"
            />
            <span v-else>{{ (candidate.title || candidate.variant_key).slice(0, 8) }}</span>
          </div>
          <span class="font-medium">{{ candidate.title || candidate.variant_key }}</span>
          <span
            v-if="candidate.recommended"
            class="text-[var(--neo-accent)]"
          >
            推荐
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
