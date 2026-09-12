<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import type { VideoGenerationMode } from '@/composables/useUpstreamNodeContext'
import DockRefChip from '@/components/canvas/dock-studio/shared/DockRefChip.vue'
import { resolveRefRoleLabel } from '@/components/canvas/dock-studio/shared/dockRefRoleLabels'

const props = withDefaults(
  defineProps<{
    refs: NodeRef[]
    videoMode?: VideoGenerationMode
    /** Show trailing + for local image upload. */
    showAddUpload?: boolean
    addUploadDisabled?: boolean
    addUploadBusy?: boolean
  }>(),
  {
    showAddUpload: false,
    addUploadDisabled: false,
    addUploadBusy: false,
  },
)

const roleLabels = computed(() => {
  const mode = props.videoMode ?? 'text_to_video'
  const map = new Map<string, string>()
  for (const refItem of props.refs) {
    const label = resolveRefRoleLabel(refItem, props.refs, mode)
    if (label) map.set(refItem.refId, label)
  }
  return map
})

const showStrip = computed(() => props.refs.length > 0 || props.showAddUpload)
const addUploadProminent = computed(() => props.refs.length > 0)

const emit = defineEmits<{
  reorder: [refIds: string[]]
  remove: [ref: NodeRef]
  mention: [refKey: string]
  addUpload: []
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
  <div v-if="showStrip" class="dock-ref-strip">
    <div class="dock-ref-strip__scroll">
      <DockRefChip
        v-for="refItem in refs"
        :key="refItem.refId"
        :ref-item="refItem"
        :role-label="roleLabels.get(refItem.refId)"
        draggable
        :dragging="dragRefId === refItem.refId"
        :drag-over="dragOverRefId === refItem.refId"
        @dragstart="onDragStart(refItem.refId, $event)"
        @dragover="onDragOver(refItem.refId, $event)"
        @dragleave="onDragLeave(refItem.refId)"
        @drop="onDrop(refItem.refId, $event)"
        @dragend="onDragEnd"
        @remove="emit('remove', refItem)"
        @mention="emit('mention', $event)"
      />
      <button
        v-if="showAddUpload"
        type="button"
        class="dock-ref-strip__add"
        :class="{ 'is-prominent': addUploadProminent, 'is-busy': addUploadBusy }"
        :disabled="addUploadDisabled || addUploadBusy"
        :title="addUploadBusy ? '上传中…' : '上传参考图'"
        aria-label="上传参考图"
        @click="emit('addUpload')"
      >
        <span v-if="addUploadBusy" class="dock-ref-strip__add-busy">…</span>
        <span v-else aria-hidden="true">+</span>
      </button>
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

.dock-ref-strip__add {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px dashed color-mix(in srgb, var(--neo-border) 80%, transparent);
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  font-size: 16px;
  line-height: 1;
  opacity: 0.45;
  cursor: pointer;
  transition: opacity 0.15s ease, border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.dock-ref-strip__add.is-prominent {
  opacity: 0.85;
  border-style: solid;
  border-color: var(--neo-border);
}

.dock-ref-strip__add:hover:not(:disabled) {
  opacity: 1;
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.dock-ref-strip__add:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.dock-ref-strip__add-busy {
  font-size: 12px;
  letter-spacing: 0.05em;
}
</style>
