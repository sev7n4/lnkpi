<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNodeId, useVueFlow } from '@vue-flow/core'
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import PromptMarkdownEditor from '@/components/canvas/PromptMarkdownEditor.vue'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

const props = defineProps<{
  selected?: boolean
  data: { prompt?: string; content?: string; label?: string; status?: string; errorMessage?: string }
}>()

const nodeId = useNodeId()
const { updateNodeData } = useVueFlow()

const editorOpen = ref(false)
const draft = ref('')

const preview = computed(() => {
  const c = String(props.data.content ?? '').trim()
  if (c) return c.length > 180 ? `${c.slice(0, 180)}…` : c
  return ''
})

const isError = computed(
  () => props.data.status === NODE_GENERATION_STATUS.error || props.data.status === 'error',
)

function openEditor() {
  draft.value = String(props.data.content ?? '')
  editorOpen.value = true
}

function onSave(md: string) {
  updateNodeData(nodeId, { content: md })
}
</script>

<template>
  <NeoBaseNode node-type="prompt" :selected="selected" :data="data" :status="data.status">
    <div class="neo-text-card" @dblclick.stop="openEditor">
      <template v-if="preview">
        <p class="whitespace-pre-wrap text-left text-[12px] leading-relaxed text-white/80">{{ preview }}</p>
      </template>
      <template v-else>
        <p>输入需求生成提示词</p>
        <p class="text-[11px] text-white/35">双击编辑文本</p>
        <p v-if="data.prompt" class="mt-1 line-clamp-2 text-[11px] text-white/40">{{ data.prompt }}</p>
      </template>
      <p v-if="isError && data.errorMessage" class="mt-1 line-clamp-2 text-[10px] text-red-400/90">
        {{ data.errorMessage }}
      </p>
    </div>
    <PromptMarkdownEditor
      v-model:visible="editorOpen"
      v-model="draft"
      @save="onSave"
    />
  </NeoBaseNode>
</template>
