<script setup lang="ts">
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'
import type { DeliverySummaryBasicsRow, DeliverySummaryFinalizedRow } from './types'

defineProps<{
  headline: string
  finalized: DeliverySummaryFinalizedRow[]
  basics: DeliverySummaryBasicsRow[]
  basicsSectionTitle?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  focusNode: [nodeId: string]
}>()

function onLocate(nodeId?: string | null) {
  if (nodeId) emit('focusNode', nodeId)
}
</script>

<template>
  <div class="agent-delivery-summary space-y-3" data-testid="delivery-summary-table">
    <p
      v-if="headline"
      class="text-sm font-medium leading-relaxed text-[var(--neo-text)]"
      data-testid="delivery-summary-headline"
    >
      {{ headline }}
    </p>

    <div v-if="finalized.length" class="overflow-hidden rounded-lg border border-[var(--neo-border)]">
      <table class="w-full text-xs">
        <thead class="bg-[var(--neo-surface)] text-[var(--neo-muted)]">
          <tr>
            <th class="px-2 py-1.5 text-left font-medium">交付项</th>
            <th class="px-2 py-1.5 text-left font-medium">方案</th>
            <th class="px-2 py-1.5 text-right font-medium">画布定位</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in finalized"
            :key="row.shot_id || row.title"
            class="border-t border-[var(--neo-border)]"
            :class="row.node_id ? 'hover:bg-[var(--neo-hover)]' : ''"
            :data-shot-id="row.shot_id"
          >
            <td class="px-2 py-1.5 text-[var(--neo-text)]">{{ row.title }}</td>
            <td class="px-2 py-1.5 text-[var(--neo-muted)]">
              <span v-if="row.macro">方案{{ row.macro }}</span>
              <span v-else>—</span>
            </td>
            <td class="px-2 py-1.5 text-right">
              <button
                v-if="row.node_id"
                type="button"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--neo-accent)] hover:bg-[var(--neo-surface)]"
                :disabled="disabled"
                data-testid="delivery-locate-row"
                @click="onLocate(row.node_id)"
              >
                <CanvasLocatePinIcon :size="12" />
                定位
              </button>
              <span v-else class="text-[var(--neo-muted)]">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="basics.length" class="space-y-1.5">
      <p class="text-xs font-medium text-[var(--neo-muted)]" data-testid="delivery-basics-title">
        {{ basicsSectionTitle || '基础资产' }}
      </p>
      <div class="overflow-hidden rounded-lg border border-[var(--neo-border)]">
        <table class="w-full text-xs">
          <thead class="bg-[var(--neo-surface)] text-[var(--neo-muted)]">
            <tr>
              <th class="px-2 py-1.5 text-left font-medium">资产</th>
              <th class="px-2 py-1.5 text-right font-medium">画布定位</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in basics"
              :key="row.title"
              class="border-t border-[var(--neo-border)]"
              :class="row.node_id ? 'hover:bg-[var(--neo-hover)]' : ''"
            >
              <td class="px-2 py-1.5 text-[var(--neo-text)]">{{ row.title }}</td>
              <td class="px-2 py-1.5 text-right">
                <button
                  v-if="row.node_id"
                  type="button"
                  class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--neo-accent)] hover:bg-[var(--neo-surface)]"
                  :disabled="disabled"
                  data-testid="delivery-basics-locate"
                  @click="onLocate(row.node_id)"
                >
                  <CanvasLocatePinIcon :size="12" />
                  定位
                </button>
                <span v-else class="text-[var(--neo-muted)]">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
