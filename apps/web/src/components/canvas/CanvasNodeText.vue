<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useNodeId, useVueFlow } from '@vue-flow/core'
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'
import PromptMarkdownEditor from '@/components/canvas/PromptMarkdownEditor.vue'

const props = defineProps<{
  selected?: boolean
  data: {
    content: string
    label?: string
    status?: string
    errorMessage?: string
    errorCode?: string
    generationStartedAt?: string
    generationRecordId?: string
    materialId?: string
  }
}>()

const nodeId = useNodeId()
const { updateNodeData } = useVueFlow()
const route = useRoute()
const sessionId = computed(() => route.params.sessionId as string | undefined)
const taskId = computed(
  () =>
    (typeof props.data.generationRecordId === 'string' && props.data.generationRecordId) ||
    (typeof props.data.materialId === 'string' && props.data.materialId) ||
    undefined,
)
const taskKind = computed(() =>
  typeof props.data.generationRecordId === 'string' && props.data.generationRecordId
    ? ('generation' as const)
    : typeof props.data.materialId === 'string' && props.data.materialId
      ? ('material' as const)
      : undefined,
)

const editorOpen = ref(false)
const draft = ref('')

function openEditor() {
  draft.value = String(props.data.content ?? '')
  editorOpen.value = true
}

function onSave(md: string) {
  updateNodeData(nodeId, { content: md })
}
</script>

<template>
  <NeoBaseNode node-type="text" :selected="selected" :data="data" :status="data.status">
    <div class="neo-text-card" @dblclick.stop="openEditor">
      <p>{{ data.content || '点击下方 Dock Studio 编辑...' }}</p>
      <NodeTaskCornerActions
        :status="data.status"
        :started-at="typeof data.generationStartedAt === 'string' ? data.generationStartedAt : undefined"
        :error-message="data.errorMessage as string | undefined"
        :error-code="data.errorCode as string | undefined"
        :task-kind="taskKind"
        :task-id="taskId"
        :node-label="typeof data.label === 'string' ? data.label : undefined"
        :session-id="sessionId"
      />
    </div>
    <PromptMarkdownEditor
      v-model:visible="editorOpen"
      v-model="draft"
      @save="onSave"
    />
  </NeoBaseNode>
</template>
