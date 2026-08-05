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
import { resolveGenerationModel } from '@/constants/studioModels'
import { isNodeGenerating } from '@/constants/dockStudio'
import {
  PROMPT_MODE_LABELS,
  buildPromptNodeCardPreview,
  countMarkdownTableDataRows,
} from '@lnkpi/shared'

const MODE_LABELS = PROMPT_MODE_LABELS

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

const generatedContent = computed(() => String(props.node.data?.content ?? '').trim())
const generatedPreview = computed(() =>
  buildPromptNodeCardPreview({
    content: generatedContent.value,
    promptMode: promptMode.value,
    maxChars: 360,
  }),
)
const tableRowCount = computed(() =>
  promptMode.value === 'commercial_storyboard'
    ? countMarkdownTableDataRows(generatedContent.value)
    : 0,
)

const textRefs = computed(() => (props.refs ?? []).filter((ref) => ref.mediaType === 'text'))

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? '')
  textModel.value = resolveGenerationModel('text', data.textModel as string | undefined)
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

    <section
      v-if="generatedContent"
      class="mx-3 mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-[10px] font-medium text-fuchsia-300/90">
          {{ promptModeLabel || '生成结果' }}
        </span>
        <span v-if="tableRowCount" class="text-[10px] text-white/45">
          含 {{ tableRowCount }} 镜表格
        </span>
      </div>
      <pre class="max-h-36 overflow-auto whitespace-pre-wrap text-left text-[11px] leading-relaxed text-white/75">{{ generatedPreview }}</pre>
      <p class="mt-2 text-[10px] text-white/35">双击画布节点可打开表格编辑器查看完整分镜表</p>
    </section>

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
          :disabled="!generating && !prompt.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
