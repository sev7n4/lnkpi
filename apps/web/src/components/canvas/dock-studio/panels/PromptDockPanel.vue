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
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import { estimateTextCredits } from '@/constants/credits'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { resolveModelKey } from '@/constants/studioModels'
import { isNodeGenerating } from '@/constants/dockStudio'

const MODE_LABELS: Record<string, string> = {
  image_prompt_multi_style: '多风格绘画提示词',
  character_turnaround: '人物三视图',
  storyboard: '分镜提示词',
  script: '剧本',
  copywriting: '文案/旁白',
  generic: '通用创作',
}

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

const prompt = ref('')
const textModel = ref(getConfig('text').model)

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const promptMode = computed(() => {
  const mode = props.node.data?.promptMode
  return mode ? String(mode) : ''
})

const promptModeLabel = computed(() => {
  const mode = promptMode.value
  return mode ? (MODE_LABELS[mode] ?? mode) : ''
})

const textRefs = computed(() => (props.refs ?? []).filter((ref) => ref.mediaType === 'text'))

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? '')
  textModel.value = resolveModelKey('text', data.textModel as string | undefined).modelKey
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  textRefs,
  (refs) => {
    if (prompt.value.trim()) return
    const data = props.node.data ?? {}
    if (data.promptPrefillFromRefId) return

    const textRef = refs.find((ref) => ref.payload.text || ref.preview)
    if (!textRef) return

    const raw = textRef.payload.text ?? textRef.preview
    const summary = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw
    if (!summary.trim()) return

    prompt.value = summary
    emit('patch', { prompt: summary, promptPrefillFromRefId: textRef.refId })
  },
  { immediate: true, deep: true },
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

function mergeRefOrder(reorderedTextRefIds: string[]): string[] {
  const allRefs = props.refs ?? []
  const textIdSet = new Set(reorderedTextRefIds)
  const nonTextIds = allRefs.filter((ref) => ref.mediaType !== 'text').map((ref) => ref.refId)
  const prevOrder = (props.node.data?.refOrder as string[]) ?? allRefs.map((ref) => ref.refId)
  const preservedNonText = prevOrder.filter((id) => nonTextIds.includes(id) && !textIdSet.has(id))
  const missingNonText = nonTextIds.filter((id) => !preservedNonText.includes(id))
  return [...reorderedTextRefIds, ...preservedNonText, ...missingNonText]
}

function onRefReorder(refIds: string[]) {
  emit('patch', { refOrder: mergeRefOrder(refIds) })
}

function onRefRemove(ref: NodeRef) {
  emit('removeRef', ref)
}
</script>

<template>
  <DockToolbarShell type="prompt" @close="emit('close')">
    <DockRefStrip
      :refs="textRefs"
      @reorder="onRefReorder"
      @remove="onRefRemove"
    />

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
        v-if="promptModeLabel"
        class="rounded-md bg-fuchsia-500/15 px-2 py-0.5 text-[10px] text-fuchsia-300"
      >
        {{ promptModeLabel }}
      </span>

      <div class="ml-auto flex items-center gap-2">
        <DockMicButton
          :listening="speech.listening.value"
          :disabled="readonly"
          @toggle="toggleVoice"
        />
        <DockCreditBadge :credits="estimateTextCredits()" />
        <DockGenerateButton
          :generating="generating"
          :disabled="!prompt.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
