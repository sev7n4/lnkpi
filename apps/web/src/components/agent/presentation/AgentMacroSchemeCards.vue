<script setup lang="ts">
import { computed } from 'vue'
import type { ProductVisualMacroScheme } from '../agentInterruptGate'
import { truncateMacroSummary } from './schemeDraftProse'

const props = defineProps<{
  schemes: ProductVisualMacroScheme[]
  selectedIds: string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  toggle: [schemeId: string, checked: boolean]
}>()

const displaySchemes = computed(() =>
  props.schemes.map((scheme) => ({
    ...scheme,
    summary: truncateMacroSummary(scheme.summary),
    tags: (scheme.tags ?? []).map((tag) => String(tag).trim().replace(/^#/, '')).filter(Boolean),
  })),
)
</script>

<template>
  <div class="agent-macro-scheme-cards space-y-2" data-testid="macro-scheme-cards">
    <div
      v-for="scheme in displaySchemes"
      :key="scheme.id"
      class="rounded-lg border border-[var(--neo-border)] p-2"
      :data-scheme-id="scheme.id"
    >
      <label class="flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          class="mt-0.5"
          :checked="selectedIds.includes(scheme.id)"
          :disabled="disabled"
          @change="emit('toggle', scheme.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="min-w-0 flex-1">
          <span class="font-medium">{{ scheme.label || scheme.id }}</span>
          <span v-if="scheme.recommended" class="ml-1 text-[var(--neo-accent)]">推荐</span>
          <span
            v-if="scheme.tags?.length"
            class="mt-1 flex flex-wrap gap-1"
            data-testid="macro-scheme-tags"
          >
            <span
              v-for="tag in scheme.tags"
              :key="tag"
              class="rounded bg-[var(--neo-panel)] px-1.5 py-0.5 text-[10px] text-[var(--neo-muted)]"
            >
              #{{ tag }}
            </span>
          </span>
          <span
            v-if="scheme.summary"
            class="mt-1 block text-[var(--neo-muted)]"
            data-testid="macro-scheme-summary"
          >
            {{ scheme.summary }}
          </span>
          <span
            v-if="scheme.recommend_reason"
            class="mt-1 block text-[var(--neo-text-secondary)]"
            data-testid="macro-scheme-reason"
          >
            {{ scheme.recommend_reason }}
          </span>
        </span>
      </label>
    </div>
  </div>
</template>
