<script setup lang="ts">
import type { SidebarAttachment } from '@lnkpi/shared'
import AgentSidebarRefChip from '@/components/agent/AgentSidebarRefChip.vue'
import { computed } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'

const props = defineProps<{
  items: Array<{ attachment: SidebarAttachment; refKey: string }>
  removable?: boolean
}>()
const emit = defineEmits<{
  remove: [id: string]
  mention: [refKey: string]
}>()

const refs = computed<NodeRef[]>(() =>
  props.items.map(({ attachment, refKey }) => ({
    refId: attachment.id,
    refKey,
    mediaType: attachment.mediaType,
    sourceKind: attachment.sourceKind === 'canvasNode' ? 'edge' : attachment.sourceKind,
    label: attachment.label,
    preview: attachment.url ?? attachment.text ?? '',
    payload: { url: attachment.url, text: attachment.text },
  })),
)
</script>

<template>
  <div v-if="refs.length" class="agent-ref-strip">
    <div class="agent-ref-strip__scroll">
      <AgentSidebarRefChip
        v-for="refItem in refs"
        :key="refItem.refId"
        :ref-item="refItem"
        :clickable="removable !== false"
        :class="{ 'agent-ref-strip__chip--readonly': !removable }"
        @remove="emit('remove', refItem.refId)"
        @mention="emit('mention', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.agent-ref-strip {
  width: 100%;
  min-width: 0;
}

.agent-ref-strip__scroll {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 1px 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.agent-ref-strip__scroll::-webkit-scrollbar {
  height: 4px;
}

.agent-ref-strip__scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.agent-ref-strip__chip--readonly :deep(.dock-ref-chip__remove) {
  display: none;
}
</style>
