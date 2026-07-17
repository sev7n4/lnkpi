<script setup lang="ts">
import { computed } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import TextDockPanel from '@/components/canvas/dock-studio/panels/TextDockPanel.vue'
import PromptDockPanel from '@/components/canvas/dock-studio/panels/PromptDockPanel.vue'
import ImageDockPanel from '@/components/canvas/dock-studio/panels/ImageDockPanel.vue'
import VideoDockPanel from '@/components/canvas/dock-studio/panels/VideoDockPanel.vue'
import AudioDockPanel from '@/components/canvas/dock-studio/panels/AudioDockPanel.vue'
import ShotDockPanel from '@/components/canvas/dock-studio/panels/ShotDockPanel.vue'
import MediaInputDockPanel from '@/components/canvas/dock-studio/panels/MediaInputDockPanel.vue'
import SceneComposerDockPanel from '@/components/canvas/dock-studio/panels/SceneComposerDockPanel.vue'
import VideoCompositionDockPanel from '@/components/canvas/dock-studio/panels/VideoCompositionDockPanel.vue'
import LegacyDockPanel from '@/components/canvas/dock-studio/panels/LegacyDockPanel.vue'
import { isNodeGenerating } from '@/constants/dockStudio'
import type { CompositionTrack } from '@/utils/compositionUpstream'
import type { NodeRef } from '@/composables/useNodeRefs'

const props = defineProps<{
  node: EditableFlowNode | null
  upstream: UpstreamNodeContext
  refs?: NodeRef[]
  compositionTracks?: CompositionTrack[]
  mentions?: MentionOption[]
  generating?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  removeRef: [ref: NodeRef]
  generate: []
  close: []
  upload: [file: File]
  convert: [targetType: 'image' | 'video' | 'audio']
  save: []
  expand: []
  batchGenerate: []
  export: []
}>()

const nodeType = computed(() => String(props.node?.type ?? ''))

const dockReadonly = computed(() => {
  if (props.generating) return true
  const status = props.node?.data?.status
  return isNodeGenerating(status) || status === 'uploading'
})

const panelBindings = {
  patch: (patch: Record<string, unknown>) => emit('patch', patch),
  removeRef: (ref: NodeRef) => emit('removeRef', ref),
  generate: () => emit('generate'),
  close: () => emit('close'),
}
</script>

<template>
  <TextDockPanel
    v-if="node && nodeType === 'text'"
    :node="node"
    :upstream="upstream"
    :refs="refs"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @remove-ref="panelBindings.removeRef"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <PromptDockPanel
    v-else-if="node && nodeType === 'prompt'"
    :node="node"
    :upstream="upstream"
    :refs="refs"
    :mentions="mentions"
    :generating="generating"
    @patch="panelBindings.patch"
    @remove-ref="panelBindings.removeRef"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <ImageDockPanel
    v-else-if="node && nodeType === 'image'"
    :node="node"
    :upstream="upstream"
    :refs="refs"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @remove-ref="panelBindings.removeRef"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <VideoDockPanel
    v-else-if="node && nodeType === 'video'"
    :node="node"
    :upstream="upstream"
    :refs="refs"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @remove-ref="panelBindings.removeRef"
    @generate="panelBindings.generate"
    @close="panelBindings.close"
  />
  <AudioDockPanel
    v-else-if="node && nodeType === 'audio'"
    :node="node"
    :upstream="upstream"
    :refs="refs"
    :mentions="mentions"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @remove-ref="panelBindings.removeRef"
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
  <VideoCompositionDockPanel
    v-else-if="node && nodeType === 'videoComposition'"
    :node="node"
    :upstream="upstream"
    :tracks="compositionTracks ?? []"
    :generating="generating"
    :readonly="dockReadonly"
    @patch="panelBindings.patch"
    @close="panelBindings.close"
    @export="emit('export')"
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
