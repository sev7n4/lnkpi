<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { isNodeGenerating } from '@/constants/dockStudio'

const { getConfig } = useModelProviderSettings()

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

const prompt = ref('')
const textModel = ref(getConfig('text').model)

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const promptMode = computed(() => {
  const mode = props.node.data?.promptMode
  return mode ? String(mode) : ''
})

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? '')
  textModel.value = String(data.textModel ?? getConfig('text').model)
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  () => props.upstream,
  (ctx) => {
    if (!prompt.value.trim() && ctx.textPrompt) {
      prompt.value = ctx.textPrompt
      emit('patch', { prompt: ctx.textPrompt })
    }
  },
  { immediate: true },
)

function onPromptInput(value: string) {
  prompt.value = value
  emit('patch', { prompt: value })
}

function onGenerate() {
  emit('patch', { prompt: prompt.value, textModel: textModel.value })
  emit('generate')
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  speech.start((text, isFinal) => {
    if (isFinal) {
      const next = prompt.value ? `${prompt.value} ${text}` : text
      onPromptInput(next)
    }
  })
}
</script>

<template>
  <DockToolbarShell type-label="提示词" @close="emit('close')">
    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="描述创作需求，生成结构化提示词..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <div class="bottom-toolbar-actions flex-wrap">
      <UniversalModelSelector
        v-model="textModel"
        type="text"
        @update:model-value="emit('patch', { textModel: $event })"
      />
      <span
        v-if="promptMode"
        class="rounded-md bg-fuchsia-500/15 px-2 py-0.5 text-[10px] text-fuchsia-300"
      >
        {{ promptMode }}
      </span>

      <button
        type="button"
        class="dock-icon-btn"
        :class="speech.listening.value ? 'animate-pulse text-red-400' : ''"
        title="语音输入"
        :disabled="readonly"
        @click="toggleVoice"
      >
        🎤
      </button>

      <DockGenerateButton
        :generating="generating"
        :disabled="!prompt.trim()"
        label="生成提示词"
        @generate="onGenerate"
      />
    </div>
  </DockToolbarShell>
</template>
