<script setup lang="ts">
import { computed } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import NodeEditorToolbar from '@/components/canvas/NodeEditorToolbar.vue'

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  generate: []
  close: []
}>()

/** Sprint B：sceneComposer / prompt 仍走 Legacy 面板 */
const legacyNode = computed(() => props.node)
</script>

<template>
  <NodeEditorToolbar
    :node="legacyNode"
    :mentions="mentions"
    :generating="generating"
    @patch="emit('patch', $event)"
    @generate="emit('generate')"
    @close="emit('close')"
  />
</template>
