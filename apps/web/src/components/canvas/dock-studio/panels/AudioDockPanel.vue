<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import VoiceModelSelector from '@/components/canvas/VoiceModelSelector.vue'
import AudioVoiceSettingsSelector, {
  type AudioVoiceSettings,
} from '@/components/canvas/AudioVoiceSettingsSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import {
  DEFAULT_AUDIO_EMOTION,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_AUDIO_SPEED,
  DEFAULT_AUDIO_VOICE,
} from '@/constants/dockAudio'
import { isNodeGenerating } from '@/constants/dockStudio'
import { estimateAudioCredits } from '@/constants/credits'

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
const audioVoice = ref(DEFAULT_AUDIO_VOICE)
const voiceSettings = ref<AudioVoiceSettings>({
  emotion: DEFAULT_AUDIO_EMOTION,
  language: DEFAULT_AUDIO_LANGUAGE,
  speed: DEFAULT_AUDIO_SPEED,
})

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const credits = computed(() => estimateAudioCredits())

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? data.content ?? '')
  audioVoice.value = String(data.audioVoice ?? DEFAULT_AUDIO_VOICE)
  const emotion = data.audioEmotion as AudioVoiceSettings['emotion'] | undefined
  const language = data.audioLanguage as AudioVoiceSettings['language'] | undefined
  const speed = typeof data.audioSpeed === 'number' ? data.audioSpeed : DEFAULT_AUDIO_SPEED
  voiceSettings.value = {
    emotion: emotion ?? DEFAULT_AUDIO_EMOTION,
    language: language ?? DEFAULT_AUDIO_LANGUAGE,
    speed,
  }
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

function syncVoiceSettings(value: AudioVoiceSettings) {
  voiceSettings.value = value
  emit('patch', {
    audioEmotion: value.emotion,
    audioLanguage: value.language,
    audioSpeed: value.speed,
  })
}

function onGenerate() {
  emit('patch', {
    prompt: prompt.value,
    audioVoice: audioVoice.value,
    audioEmotion: voiceSettings.value.emotion,
    audioLanguage: voiceSettings.value.language,
    audioSpeed: voiceSettings.value.speed,
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
  <DockToolbarShell type="audio" @close="emit('close')">
    <DockRefStrip
      :refs="refs ?? []"
      @reorder="onRefReorder"
      @remove="onRefRemove"
    />

    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="输入台词或旁白文本..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <div class="bottom-toolbar-actions flex-wrap">
      <VoiceModelSelector
        v-model="audioVoice"
        @update:model-value="emit('patch', { audioVoice: $event })"
      />
      <AudioVoiceSettingsSelector
        v-model="voiceSettings"
        @update:model-value="syncVoiceSettings"
      />

      <div class="ml-auto flex items-center gap-2">
        <DockMicButton
          :listening="speech.listening.value"
          :disabled="readonly"
          @toggle="toggleVoice"
        />
        <DockCreditBadge :credits="credits" />
        <DockGenerateButton
          :generating="generating"
          :disabled="!prompt.trim() && !upstream.textPrompt.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
