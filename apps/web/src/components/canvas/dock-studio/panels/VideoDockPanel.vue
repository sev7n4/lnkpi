<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import {
  resolveVideoMode,
  type UpstreamNodeContext,
  type VideoGenerationMode,
} from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import VideoSettingsSelector from '@/components/canvas/VideoSettingsSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@lnkpi/shared'
import { isNodeGenerating } from '@/constants/dockStudio'

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
const videoModel = ref(getConfig('video').model)
const videoSettings = ref<VideoSettings>({ ...DEFAULT_VIDEO_SETTINGS })
const videoMode = ref<VideoGenerationMode>('text_to_video')
const referenceImageUrl = ref('')
const refInput = ref<HTMLInputElement | null>(null)

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)

const effectiveRefUrl = computed(() => {
  const local = referenceImageUrl.value.trim()
  if (local) return local
  return props.upstream.referenceImageUrl.trim()
})

const modeLabel = computed(() => (videoMode.value === 'image_to_video' ? '图生视频' : '文生视频'))

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? data.content ?? '')
  videoModel.value = String(data.videoModel ?? getConfig('video').model)
  if (data.videoSettings && typeof data.videoSettings === 'object') {
    videoSettings.value = { ...DEFAULT_VIDEO_SETTINGS, ...(data.videoSettings as VideoSettings) }
  }
  referenceImageUrl.value = String(data.referenceImageUrl ?? '')
  videoMode.value = resolveVideoMode(data, props.upstream)
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  () => props.upstream,
  (ctx) => {
    if (!prompt.value.trim() && ctx.textPrompt) {
      prompt.value = ctx.textPrompt
      emit('patch', { prompt: ctx.textPrompt })
    }
    if (!referenceImageUrl.value.trim() && ctx.referenceImageUrl) {
      referenceImageUrl.value = ctx.referenceImageUrl
      emit('patch', { referenceImageUrl: ctx.referenceImageUrl })
    }
    if (!props.node.data?.videoMode) {
      videoMode.value = ctx.referenceImageUrl ? 'image_to_video' : videoMode.value
    }
  },
  { immediate: true, deep: true },
)

function syncField(field: string, value: unknown) {
  emit('patch', { [field]: value })
}

function onPromptInput(value: string) {
  prompt.value = value
  syncField('prompt', value)
}

function setVideoMode(mode: VideoGenerationMode) {
  videoMode.value = mode
  syncField('videoMode', mode)
}

function onGenerate() {
  emit('patch', {
    prompt: prompt.value,
    videoModel: videoModel.value,
    videoSettings: { ...videoSettings.value },
    videoMode: videoMode.value,
    referenceImageUrl: videoMode.value === 'image_to_video' ? (effectiveRefUrl.value || undefined) : undefined,
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

function pickReferenceImage() {
  refInput.value?.click()
}

function onRefFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const url = URL.createObjectURL(file)
  referenceImageUrl.value = url
  videoMode.value = 'image_to_video'
  emit('patch', { referenceImageUrl: url, videoMode: 'image_to_video' })
  ;(event.target as HTMLInputElement).value = ''
}

function clearReferenceImage() {
  referenceImageUrl.value = ''
  videoMode.value = 'text_to_video'
  emit('patch', { referenceImageUrl: '', videoMode: 'text_to_video' })
}

function onRefReorder(refIds: string[]) {
  emit('patch', { refOrder: refIds })
}

function onRefRemove(ref: NodeRef) {
  emit('removeRef', ref)
}
</script>

<template>
  <DockToolbarShell type-label="视频生成" @close="emit('close')">
    <DockRefStrip
      :refs="refs ?? []"
      @reorder="onRefReorder"
      @remove="onRefRemove"
    />

    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="描述视频内容，@ 引用节点..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <div class="bottom-toolbar-actions flex-wrap">
      <div class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-[10px] transition"
          :class="videoMode === 'text_to_video' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/50'"
          :disabled="readonly"
          @click="setVideoMode('text_to_video')"
        >
          文生视频
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-[10px] transition"
          :class="videoMode === 'image_to_video' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/50'"
          :disabled="readonly"
          @click="setVideoMode('image_to_video')"
        >
          图生视频
        </button>
      </div>

      <span class="text-[10px] text-white/40">{{ modeLabel }}</span>

      <UniversalModelSelector
        v-model="videoModel"
        type="video"
        @update:model-value="syncField('videoModel', $event)"
      />
      <VideoSettingsSelector
        v-model="videoSettings"
        @update:model-value="syncField('videoSettings', $event)"
      />

      <template v-if="videoMode === 'image_to_video'">
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="dock-icon-btn text-xs"
            :disabled="readonly"
            title="参考图"
            @click="pickReferenceImage"
          >
            🖼
          </button>
          <div
            v-if="effectiveRefUrl"
            class="relative h-8 w-8 overflow-hidden rounded-md border border-white/15"
          >
            <img :src="effectiveRefUrl" alt="" class="h-full w-full object-cover">
            <button
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] opacity-0 transition hover:opacity-100"
              @click="clearReferenceImage"
            >
              ✕
            </button>
          </div>
          <span v-else class="text-[10px] text-amber-400/80">请连接或上传参考图</span>
          <input ref="refInput" type="file" accept="image/*" class="hidden" @change="onRefFileChange">
        </div>
      </template>

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
          :disabled="!prompt.trim() || (videoMode === 'image_to_video' && !effectiveRefUrl)"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
