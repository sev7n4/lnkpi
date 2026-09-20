<script setup lang="ts">
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { useWorkbenchPanel } from '@/components/canvas/workbench/useWorkbenchPanel'
import type { ImageVersionEntry } from '@lnkpi/shared'
import RefineWorkViewport from './RefineWorkViewport.vue'
import RefineSidePanel from './RefineSidePanel.vue'

defineProps<{
  nodeId: string
  beforeUrl: string
  versions: ImageVersionEntry[]
  currentVersionId?: string
  sessionId: string
  generationRecordId?: string
  url: string
  width?: number
  height?: number
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: { url: string; prompt: string; recordId?: string }]
  revert: [payload: { versionId: string }]
  busy: [value: boolean]
}>()

const editor = useCanvasEditorStore()

/** Escape→close guard: mirror RefineSidePanel's requestClose, but keep the
 *  source of truth for collapsed/width in the shared composable. */
function onClose() {
  if (editor.compareLightboxOpen) {
    editor.setCompareLightboxOpen(false)
    return
  }
  emit('close')
}

const { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed } = useWorkbenchPanel({
  defaultWidth: 400,
  busy: () => editor.refineBusy,
  onClose,
})
</script>

<template>
  <RefineWorkViewport
    v-show="!editor.compareLightboxOpen"
    :url="url"
    :width="width"
    :height="height"
    :inset-right="insetRight"
  />
  <RefineSidePanel
    :node-id="nodeId"
    :before-url="beforeUrl"
    :versions="versions"
    :current-version-id="currentVersionId"
    :session-id="sessionId"
    :generation-record-id="generationRecordId"
    :width="width"
    :height="height"
    :panel-width="panelWidth"
    :collapsed="collapsed"
    :is-narrow="isNarrow"
    @close="emit('close')"
    @apply="emit('apply', $event)"
    @revert="emit('revert', $event)"
    @busy="emit('busy', $event)"
    @update:collapsed="setCollapsed($event)"
    @update:panel-width="setPanelWidth($event)"
  />
</template>
