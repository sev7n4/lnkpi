<script setup lang="ts">
import { ref } from 'vue'
import { useNodeId, useVueFlow } from '@vue-flow/core'
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'
import PromptMarkdownEditor from '@/components/canvas/PromptMarkdownEditor.vue'

const props = defineProps<{
  selected?: boolean
  data: { content: string; label?: string; status?: string; errorMessage?: string; generationStartedAt?: string }
}>()

const nodeId = useNodeId()
const { updateNodeData } = useVueFlow()

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
      />
    </div>
    <PromptMarkdownEditor
      v-model:visible="editorOpen"
      v-model="draft"
      @save="onSave"
    />
  </NeoBaseNode>
</template>
