<script setup lang="ts">
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'
import type { ShotTableRow } from './types'

defineProps<{
  shots: ShotTableRow[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  focusNode: [nodeId: string]
}>()

function onRowClick(row: ShotTableRow) {
  if (row.node_id) emit('focusNode', row.node_id)
}
</script>

<template>
  <div class="agent-shot-table overflow-hidden rounded-lg border border-[var(--neo-border)]" data-testid="shot-table">
    <table class="w-full text-xs">
      <thead>
        <tr class="border-b border-[var(--neo-border)] bg-[var(--neo-surface)] text-left text-[var(--neo-muted)]">
          <th class="px-2 py-1.5 font-medium">场景</th>
          <th class="px-2 py-1.5 font-medium">类型</th>
          <th class="hidden px-2 py-1.5 font-medium sm:table-cell">说明</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in shots"
          :key="row.shot_id"
          class="border-b border-[var(--neo-border)] last:border-b-0"
          :class="row.node_id ? 'cursor-pointer hover:bg-[var(--neo-hover)]' : ''"
          :data-shot-id="row.shot_id"
          @click="onRowClick(row)"
        >
          <td class="px-2 py-1.5 font-medium text-[var(--neo-text)]">
            <span class="inline-flex items-center gap-1">
              {{ row.label }}
              <span v-if="row.node_id" class="opacity-60" data-testid="shot-locate-pin">
                <CanvasLocatePinIcon :size="12" />
              </span>
            </span>
          </td>
          <td class="px-2 py-1.5 text-[var(--neo-muted)]">{{ row.type }}</td>
          <td class="hidden px-2 py-1.5 text-[var(--neo-muted)] sm:table-cell">
            <span class="line-clamp-2">{{ row.summary || '—' }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
