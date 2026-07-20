<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import { dockFailureBindFromNode } from '@/components/canvas/dock-studio/shared/dockFailureChip'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockOptimizePrompt from '@/components/canvas/dock-studio/shared/DockOptimizePrompt.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { resolveGenerationModel, isDeepSeekV4Model } from '@/constants/studioModels'
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

/** Dock input only — never sync from generated `content` after prompt exists. */
const prompt = ref('')
const textModel = ref(getConfig('text').model)
const textThinking = ref(false)
const textThinkingEffort = ref<'high' | 'max'>('high')
/** One-shot legacy content→prompt seed for the current node visit. */
const legacySeededForId = ref<string | null>(null)

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const failureBind = computed(() => dockFailureBindFromNode(props.node))
const wordCount = computed(() => prompt.value.replace(/\s/g, '').length)
const credits = computed(() => estimateTextCredits())
const showThinkingControls = computed(() => isDeepSeekV4Model(textModel.value))

function syncFromNode() {
  const data = props.node.data ?? {}
  const nodeId = props.node.id

  // Prefer `prompt` whenever the key is present as a string — including "" after clear.
  // Only fall back to `content` when `prompt` is truly absent (legacy nodes).
  if (typeof data.prompt === 'string') {
    prompt.value = data.prompt
  } else if (legacySeededForId.value !== nodeId) {
    prompt.value = String(data.content ?? '')
    legacySeededForId.value = nodeId
  }

  textModel.value = resolveGenerationModel('text', data.textModel as string | undefined)
  textThinking.value = data.textThinking === true
  textThinkingEffort.value = data.textThinkingEffort === 'max' ? 'max' : 'high'
}

watch(
  () => props.node.id,
  () => {
    legacySeededForId.value = null
    syncFromNode()
  },
  { immediate: true },
)
watch(
  () =>
    [
      props.node.data?.prompt,
      props.node.data?.textModel,
      props.node.data?.textThinking,
      props.node.data?.textThinkingEffort,
    ] as const,
  () => syncFromNode(),
)

function onPromptInput(value: string) {
  prompt.value = value
  emit('patch', { prompt: value })
}

function onOptimized(value: string) {
  prompt.value = value
  emit('patch', { prompt: value })
}

function setThinking(enabled: boolean) {
  textThinking.value = enabled
  emit('patch', {
    textThinking: enabled,
    textThinkingEffort: enabled ? textThinkingEffort.value : undefined,
  })
}

function setThinkingEffort(effort: 'high' | 'max') {
  textThinkingEffort.value = effort
  emit('patch', { textThinking: true, textThinkingEffort: effort })
}

function onGenerate() {
  emit('patch', {
    prompt: prompt.value,
    textModel: textModel.value,
    textThinking: showThinkingControls.value ? textThinking.value : false,
    textThinkingEffort:
      showThinkingControls.value && textThinking.value ? textThinkingEffort.value : undefined,
  })
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

function onRefReorder(refIds: string[]) {
  emit('patch', { refOrder: refIds })
}

function onRefRemove(ref: NodeRef) {
  emit('removeRef', ref)
}
</script>

<template>
  <DockToolbarShell type="text" v-bind="failureBind" @close="emit('close')">
    <DockRefStrip
      :refs="refs ?? []"
      @reorder="onRefReorder"
      @remove="onRefRemove"
    />

    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="输入脚本、旁白或品牌文案..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <div class="bottom-toolbar-actions flex-wrap">
      <UniversalModelSelector
        v-model="textModel"
        type="text"
        @update:model-value="emit('patch', { textModel: $event })"
      />
      <div
        v-if="showThinkingControls"
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
      >
        <button
          type="button"
          class="text-[10px] transition"
          :class="textThinking ? 'text-[#818cf8]' : 'text-white/50 hover:text-white/70'"
          :disabled="readonly"
          title="深度思考（DeepSeek V4）"
          @click="setThinking(!textThinking)"
        >
          深度思考 {{ textThinking ? '开' : '关' }}
        </button>
        <template v-if="textThinking">
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] transition"
            :class="textThinkingEffort === 'high' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/45 hover:bg-white/10'"
            :disabled="readonly"
            @click="setThinkingEffort('high')"
          >
            high
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] transition"
            :class="textThinkingEffort === 'max' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/45 hover:bg-white/10'"
            :disabled="readonly"
            @click="setThinkingEffort('max')"
          >
            max
          </button>
        </template>
      </div>
      <DockOptimizePrompt
        :prompt="prompt"
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
          :disabled="!generating && !prompt.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
