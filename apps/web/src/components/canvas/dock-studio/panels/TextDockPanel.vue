<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockOptimizePrompt from '@/components/canvas/dock-studio/shared/DockOptimizePrompt.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { isNodeGenerating } from '@/constants/dockStudio'
import { estimateTextCredits } from '@/constants/credits'

const { getConfig } = useModelProviderSettings()

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  refs?: NodeRef[]
  mentions?: MentionOption[]
  generating?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  generate: []
  close: []
  removeRef: [ref: NodeRef]
}>()

const content = ref('')
const textModel = ref(getConfig('text').model)

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const wordCount = computed(() => content.value.replace(/\s/g, '').length)
const credits = computed(() => estimateTextCredits())

function syncFromNode() {
  const data = props.node.data ?? {}
  content.value = String(data.content ?? data.prompt ?? '')
  textModel.value = String(data.textModel ?? getConfig('text').model)
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  () => props.upstream,
  (ctx) => {
    if (!content.value.trim() && ctx.textPrompt) {
      content.value = ctx.textPrompt
      emit('patch', { content: ctx.textPrompt, prompt: ctx.textPrompt })
    }
  },
  { immediate: true },
)

function onContentInput(value: string) {
  content.value = value
  emit('patch', { content: value, prompt: value })
}

function onOptimized(value: string) {
  content.value = value
  emit('patch', { content: value, prompt: value })
}

function onGenerate() {
  emit('patch', { content: content.value, prompt: content.value, textModel: textModel.value })
  emit('generate')
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  speech.start((text, isFinal) => {
    if (isFinal) {
      const next = content.value ? `${content.value} ${text}` : text
      onContentInput(next)
    }
  })
}

function onRefReorder(refIds: string[]) {
  emit('patch', { refOrder: refIds })
}

function onRefRemove(ref: NodeRef) {
  emit('removeRef', ref)
}
</script>

<template>
  <DockToolbarShell type="text" @close="emit('close')">
    <DockRefStrip
      :refs="refs ?? []"
      @reorder="onRefReorder"
      @remove="onRefRemove"
    />

    <DockPromptSection
      :model-value="content"
      :mentions="mentions"
      placeholder="输入脚本、旁白或品牌文案..."
      @update:model-value="onContentInput"
      @submit="onGenerate"
    />

    <div class="bottom-toolbar-actions flex-wrap">
      <UniversalModelSelector
        v-model="textModel"
        type="text"
        @update:model-value="emit('patch', { textModel: $event })"
      />
      <DockOptimizePrompt
        :prompt="content"
        optimize-style="copywriting"
        :disabled="readonly"
        @optimized="onOptimized"
      />
      <span class="text-[10px] text-white/35">{{ wordCount }}</span>

      <div class="ml-auto flex items-center gap-2">
        <DockMicButton
          :listening="speech.listening.value"
          :disabled="readonly"
          @toggle="toggleVoice"
        />
        <DockCreditBadge :credits="credits" />
        <DockGenerateButton
          :generating="generating"
          :disabled="!content.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
