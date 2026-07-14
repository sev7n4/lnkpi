<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import MentionInput, { type MentionOption } from '@/components/canvas/MentionInput.vue'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'

const props = defineProps<{
  node: EditableFlowNode | null
  mentions?: MentionOption[]
  generating?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  generate: []
  close: []
}>()

const prompt = ref('')
const title = ref('')

const speech = useSpeechRecognition()

const nodeType = computed(() => String(props.node?.type ?? ''))
const visible = computed(() => props.node && nodeType.value === 'prompt')

const typeLabel = computed(() => '提示词')

watch(
  () => props.node,
  (node) => {
    if (!node) return
    const data = node.data as Record<string, unknown>
    prompt.value = String(data.prompt ?? data.content ?? '')
    title.value = String(data.title ?? '')
  },
  { immediate: true },
)

function onPromptInput(value: string) {
  prompt.value = value
  emit('patch', { prompt: value })
}

function onGenerate() {
  emit('patch', { prompt: prompt.value, title: title.value })
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
  <div v-if="visible" class="bottom-toolbar-container" @click.stop>
    <div class="bottom-toolbar-header">
      <div class="flex items-center gap-2">
        <span class="bottom-toolbar-type">{{ typeLabel }}</span>
      </div>
      <button type="button" class="bottom-toolbar-close" aria-label="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="prompt-input-section">
      <MentionInput
        :model-value="prompt"
        :mentions="mentions ?? []"
        placeholder="描述场景编排或提示词..."
        @update:model-value="onPromptInput"
        @submit="onGenerate"
      />
    </div>

    <div class="bottom-toolbar-actions">
      <button
        type="button"
        class="dock-icon-btn"
        :class="speech.listening.value ? 'animate-pulse text-red-400' : ''"
        title="语音输入"
        @click="toggleVoice"
      >
        🎤
      </button>

      <button
        type="button"
        class="btn-primary ml-auto px-4 py-1.5 text-xs"
        :disabled="!prompt.trim() || generating"
        @click="onGenerate"
      >
        {{ generating ? '保存中...' : '应用' }}
      </button>
    </div>
  </div>
</template>
