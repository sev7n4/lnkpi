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
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import {
  DEFAULT_AUDIO_EMOTION,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_AUDIO_SPEED,
  DEFAULT_AUDIO_VOICE,
} from '@/constants/dockAudio'
import { isNodeGenerating } from '@/constants/dockStudio'

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
const audioVoice = ref(DEFAULT_AUDIO_VOICE)
const voiceSettings = ref<AudioVoiceSettings>({
  emotion: DEFAULT_AUDIO_EMOTION,
  language: DEFAULT_AUDIO_LANGUAGE,
  speed: DEFAULT_AUDIO_SPEED,
})

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)

const upstreamHint = computed(() => {
  if (props.upstream.textNodeIds.length && !String(props.node.data?.prompt ?? '').trim()) {
    return '已连接文本节点，生成时将优先使用连线文案'
  }
  return ''
})

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
</script>

<template>
  <DockToolbarShell type-label="音频生成" @close="emit('close')">
    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="输入台词或旁白文本..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <p v-if="upstreamHint" class="mb-2 px-1 text-[10px] text-[#818cf8]/80">{{ upstreamHint }}</p>

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
          :disabled="!prompt.trim() && !upstream.textPrompt.trim()"
          label="生成音频"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
