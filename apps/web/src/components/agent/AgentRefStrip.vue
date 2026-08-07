<script setup lang="ts">
import type { SidebarAttachment } from '@lnkpi/shared'
import AgentSidebarRefChip from '@/components/agent/AgentSidebarRefChip.vue'
import { computed, ref } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'

const props = defineProps<{
  items: Array<{ attachment: SidebarAttachment; refKey: string }>
  removable?: boolean
  /** History messages: click re-adds attachment to composer */
  historyInteractive?: boolean
}>()
const emit = defineEmits<{
  remove: [id: string]
  mention: [refKey: string]
  reattach: [attachment: SidebarAttachment]
  reorder: [ids: string[]]
}>()

const dragRefId = ref<string | null>(null)
const dragOverRefId = ref<string | null>(null)

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

const canReorder = computed(() => props.removable !== false && props.items.length > 1)

function onDragStart(refId: string, event: DragEvent) {
  if (!canReorder.value) return
  dragRefId.value = refId
  dragOverRefId.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', refId)
  }
}

function onDragOver(refId: string, event: DragEvent) {
  if (!canReorder.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (dragRefId.value && dragRefId.value !== refId) {
    dragOverRefId.value = refId
  }
}

function onDragLeave(refId: string) {
  if (dragOverRefId.value === refId) dragOverRefId.value = null
}

function onDrop(targetRefId: string, event: DragEvent) {
  if (!canReorder.value) return
  event.preventDefault()
  const sourceRefId = dragRefId.value ?? event.dataTransfer?.getData('text/plain')
  dragRefId.value = null
  dragOverRefId.value = null
  if (!sourceRefId || sourceRefId === targetRefId) return

  const ids = props.items.map((i) => i.attachment.id)
  const from = ids.indexOf(sourceRefId)
  const to = ids.indexOf(targetRefId)
  if (from < 0 || to < 0) return

  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, sourceRefId)
  emit('reorder', next)
}

function onDragEnd() {
  dragRefId.value = null
  dragOverRefId.value = null
}

function onChipMention(refKey: string) {
  if (props.historyInteractive) {
    const item = props.items.find((i) => i.refKey === refKey)
    if (item) emit('reattach', item.attachment)
    return
  }
  emit('mention', refKey)
}
</script>

<template>
  <div v-if="refs.length" class="agent-ref-strip">
    <div class="agent-ref-strip__scroll">
      <AgentSidebarRefChip
        v-for="refItem in refs"
        :key="refItem.refId"
        :ref-item="refItem"
        :clickable="removable !== false || historyInteractive === true"
        :draggable="canReorder"
        :dragging="dragRefId === refItem.refId"
        :drag-over="dragOverRefId === refItem.refId"
        :class="{ 'agent-ref-strip__chip--readonly': !removable && !historyInteractive }"
        @remove="emit('remove', refItem.refId)"
        @mention="onChipMention"
        @dragstart="onDragStart(refItem.refId, $event)"
        @dragover="onDragOver(refItem.refId, $event)"
        @dragleave="onDragLeave(refItem.refId)"
        @drop="onDrop(refItem.refId, $event)"
        @dragend="onDragEnd"
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
