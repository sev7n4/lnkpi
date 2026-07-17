<script setup lang="ts">
import { ref } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import DockRefChip from '@/components/canvas/dock-studio/shared/DockRefChip.vue'

const props = defineProps<{
  refs: NodeRef[]
}>()

const emit = defineEmits<{
  reorder: [refIds: string[]]
  remove: [ref: NodeRef]
}>()

const dragRefId = ref<string | null>(null)
const dragOverRefId = ref<string | null>(null)

function onDragStart(refId: string, event: DragEvent) {
  dragRefId.value = refId
  dragOverRefId.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', refId)
  }
}

function onDragOver(refId: string, event: DragEvent) {
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
  event.preventDefault()
  const sourceRefId = dragRefId.value ?? event.dataTransfer?.getData('text/plain')
  dragRefId.value = null
  dragOverRefId.value = null
  if (!sourceRefId || sourceRefId === targetRefId) return

  const ids = props.refs.map((r) => r.refId)
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
</script>

<template>
  <div v-if="refs.length" class="dock-ref-strip">
    <div class="dock-ref-strip__scroll">
      <DockRefChip
        v-for="refItem in refs"
        :key="refItem.refId"
        :ref-item="refItem"
        draggable
        :dragging="dragRefId === refItem.refId"
        :drag-over="dragOverRefId === refItem.refId"
        @dragstart="onDragStart(refItem.refId, $event)"
        @dragover="onDragOver(refItem.refId, $event)"
        @dragleave="onDragLeave(refItem.refId)"
        @drop="onDrop(refItem.refId, $event)"
        @dragend="onDragEnd"
        @remove="emit('remove', refItem)"
      />
    </div>
  </div>
</template>

<style scoped>
.dock-ref-strip {
  width: 100%;
  min-width: 0;
}

.dock-ref-strip__scroll {
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

.dock-ref-strip__scroll::-webkit-scrollbar {
  height: 4px;
}

.dock-ref-strip__scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}
</style>
