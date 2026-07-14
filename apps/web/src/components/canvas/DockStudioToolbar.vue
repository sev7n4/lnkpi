<script setup lang="ts">
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import DockStudioRouter from '@/components/canvas/dock-studio/DockStudioRouter.vue'
import { EDITABLE_NODE_TYPES } from '@/composables/useSelectedNodeEditor'
import { computed } from 'vue'
import { isNodeGenerating } from '@/constants/dockStudio'
import type { CompositionTrack } from '@/utils/compositionUpstream'

const props = defineProps<{
  node: EditableFlowNode | null
  upstream: UpstreamNodeContext
  compositionTracks?: CompositionTrack[]
  mentions?: MentionOption[]
  generating?: boolean
  scale?: number
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

const visible = computed(() => {
  if (!props.node) return false
  return EDITABLE_NODE_TYPES.has(String(props.node.type ?? ''))
})

const dockScale = computed(() => {
  const value = props.scale ?? 1
  return Math.min(2, Math.max(0.8, value))
})

const dockStyle = computed(() => ({
  transform: `scale(${dockScale.value})`,
  transformOrigin: 'bottom center',
}))

const dockLocked = computed(() => {
  if (props.generating) return true
  const status = props.node?.data?.status
  return isNodeGenerating(status) || status === 'uploading'
})
</script>

<template>
  <Transition name="dock-studio">
    <div
      v-if="visible"
      class="dock-studio-toolbar pointer-events-none absolute inset-x-0 bottom-3 z-[45] flex justify-center px-4"
      :class="{ 'is-dock-locked': dockLocked }"
    >
      <div class="pointer-events-auto w-full flex justify-center" :style="dockStyle">
        <DockStudioRouter
          :node="node"
          :upstream="upstream"
          :composition-tracks="compositionTracks"
          :mentions="mentions"
          :generating="generating"
          @patch="emit('patch', $event)"
          @generate="emit('generate')"
          @close="emit('close')"
          @upload="emit('upload', $event)"
          @convert="emit('convert', $event)"
          @save="emit('save')"
          @expand="emit('expand')"
          @batch-generate="emit('batchGenerate')"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dock-studio-enter-active,
.dock-studio-leave-active {
  transition: opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.dock-studio-enter-from,
.dock-studio-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}
</style>
