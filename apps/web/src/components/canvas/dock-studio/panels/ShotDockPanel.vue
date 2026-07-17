<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import VideoSettingsSelector from '@/components/canvas/VideoSettingsSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockOptimizePrompt from '@/components/canvas/dock-studio/shared/DockOptimizePrompt.vue'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@lnkpi/shared'
import {
  SHOT_GENERATE_MODE_OPTIONS,
  type ShotGenerateMode,
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

const title = ref('')
const prompt = ref('')
const shotGenerateMode = ref<ShotGenerateMode>('auto')
const videoSettings = ref<VideoSettings>({ ...DEFAULT_VIDEO_SETTINGS })

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)

const modeLabel = computed(
  () => SHOT_GENERATE_MODE_OPTIONS.find((m) => m.value === shotGenerateMode.value)?.label ?? '自动',
)

function syncFromNode() {
  const data = props.node.data ?? {}
  title.value = String(data.title ?? '')
  prompt.value = String(data.prompt ?? '')
  shotGenerateMode.value = (data.shotGenerateMode as ShotGenerateMode | undefined) ?? 'auto'
  if (data.videoSettings && typeof data.videoSettings === 'object') {
    videoSettings.value = { ...DEFAULT_VIDEO_SETTINGS, ...(data.videoSettings as VideoSettings) }
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

function onTitleInput(value: string) {
  title.value = value
  emit('patch', { title: value })
}

function onOptimized(value: string) {
  prompt.value = value
  emit('patch', { prompt: value })
}

function setMode(mode: ShotGenerateMode) {
  shotGenerateMode.value = mode
  emit('patch', { shotGenerateMode: mode })
}

function onGenerate() {
  emit('patch', {
    title: title.value,
    prompt: prompt.value,
    shotGenerateMode: shotGenerateMode.value,
    videoSettings: shotGenerateMode.value === 'video' ? { ...videoSettings.value } : undefined,
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
  <DockToolbarShell
    type-label="分镜"
    show-title
    :title="title"
    title-placeholder="分镜标题"
    @update:title="onTitleInput"
    @close="emit('close')"
  >
    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="描述镜头画面、构图与氛围..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <div class="bottom-toolbar-actions flex-wrap">
      <div class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
        <button
          v-for="opt in SHOT_GENERATE_MODE_OPTIONS"
          :key="opt.value"
          type="button"
          class="rounded-md px-2 py-1 text-[10px] transition"
          :class="shotGenerateMode === opt.value ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/50'"
          :disabled="readonly"
          @click="setMode(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
      <span class="text-[10px] text-white/40">{{ modeLabel }}</span>

      <VideoSettingsSelector
        v-if="shotGenerateMode === 'video'"
        v-model="videoSettings"
        @update:model-value="emit('patch', { videoSettings: $event })"
      />

      <DockOptimizePrompt
        :prompt="prompt"
        optimize-style="cinematic"
        :disabled="readonly"
        @optimized="onOptimized"
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
          :disabled="!prompt.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
