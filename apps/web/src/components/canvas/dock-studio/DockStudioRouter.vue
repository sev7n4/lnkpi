<script setup lang="ts">
import { computed } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import TextDockPanel from '@/components/canvas/dock-studio/panels/TextDockPanel.vue'
import ImageDockPanel from '@/components/canvas/dock-studio/panels/ImageDockPanel.vue'
import VideoDockPanel from '@/components/canvas/dock-studio/panels/VideoDockPanel.vue'
import AudioDockPanel from '@/components/canvas/dock-studio/panels/AudioDockPanel.vue'
import ShotDockPanel from '@/components/canvas/dock-studio/panels/ShotDockPanel.vue'
import MediaInputDockPanel from '@/components/canvas/dock-studio/panels/MediaInputDockPanel.vue'
import SceneComposerDockPanel from '@/components/canvas/dock-studio/panels/SceneComposerDockPanel.vue'
import LegacyDockPanel from '@/components/canvas/dock-studio/panels/LegacyDockPanel.vue'
import { isNodeGenerating } from '@/constants/dockStudio'

const props = defineProps<{
  node: EditableFlowNode | null
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  generate: []
  close: []
  upload: [file: File]
  convert: [targetType: 'image' | 'video' | 'audio']
  save: []
  expand: []
  batchGenerate: []
}>()

const nodeType = computed(() => String(props.node?.type ?? ''))

const dockReadonly = computed(() => {
  if (props.generating) return true
  const status = props.node?.data?.status
  return isNodeGenerating(status) || status === 'uploading'
})

const panelBindings = {
  patch: (patch: Record<string, unknown>) => emit('patch', patch),
  generate: () => emit('generate'),
  close: () => emit('close'),
}
</script>

<template>
  <TextDockPanel
    v-if="node && nodeType === 'text'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <ImageDockPanel
    v-else-if="node && nodeType === 'image'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <VideoDockPanel
    v-else-if="node && nodeType === 'video'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <AudioDockPanel
    v-else-if="node && nodeType === 'audio'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <ShotDockPanel
    v-else-if="node && nodeType === 'shot'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <MediaInputDockPanel
    v-else-if="node && nodeType === 'mediaInput'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @upload="emit('upload', $event)"
    @convert="emit('convert', $event)"
    @close="panelBindings.close"
  />
  <SceneComposerDockPanel
    v-else-if="node && nodeType === 'sceneComposer'"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @save="emit('save')"
    @expand="emit('expand')"
    @batch-generate="emit('batchGenerate')"
    @close="panelBindings.close"
  />
  <LegacyDockPanel
    v-else-if="node"
    :node="node"
    :upstream="upstream"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
</template>
