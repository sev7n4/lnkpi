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
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import type { LocalRefBinding, NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { resolveGenerationModel } from '@/constants/studioModels'
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@lnkpi/shared'
import { isNodeGenerating } from '@/constants/dockStudio'
import { estimateVideoCredits } from '@/constants/credits'
import { persistMediaUrl } from '@/composables/useMediaUpload'

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
const refUploading = ref(false)
const refUploadError = ref('')

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const credits = computed(() => estimateVideoCredits(videoSettings.value.duration))

const effectiveRefUrl = computed(() => {
  const local = referenceImageUrl.value.trim()
  if (local) return local
  return props.upstream.referenceImageUrl.trim()
})

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? data.content ?? '')
  videoModel.value = resolveGenerationModel('video', data.videoModel as string | undefined)
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

function createLocalRefId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function onRefFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return

  refUploadError.value = ''
  refUploading.value = true
  const blobUrl = URL.createObjectURL(file)
  referenceImageUrl.value = blobUrl
  videoMode.value = 'image_to_video'

  try {
    const url = await persistMediaUrl(file, blobUrl)
    const loggedIn = !!localStorage.getItem('token')
    if (url.startsWith('blob:') && loggedIn) {
      refUploadError.value = '参考图上传失败，请重试'
      URL.revokeObjectURL(blobUrl)
      referenceImageUrl.value = ''
      return
    }
    if (url !== blobUrl) URL.revokeObjectURL(blobUrl)

    referenceImageUrl.value = url
    const binding: LocalRefBinding = {
      id: createLocalRefId('upload'),
      mediaType: 'image',
      sourceKind: 'upload',
      label: file.name,
      url,
    }
    const prev = (props.node.data?.localRefs as LocalRefBinding[]) ?? []
    emit('patch', {
      localRefs: [...prev, binding],
      referenceImageUrl: url,
      videoMode: 'image_to_video',
    })
  } catch {
    refUploadError.value = '参考图上传失败，请重试'
    URL.revokeObjectURL(blobUrl)
    referenceImageUrl.value = ''
  } finally {
    refUploading.value = false
  }
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
  <DockToolbarShell type="video" @close="emit('close')">
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
      <div class="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
        <button
          type="button"
          class="rounded-md px-1.5 py-1 transition"
          :class="videoMode === 'text_to_video' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/45'"
          :disabled="readonly"
          title="文生视频"
          @click="setVideoMode('text_to_video')"
        >
          <DockTypeIcon icon="text" :size="12" />
        </button>
        <button
          type="button"
          class="rounded-md px-1.5 py-1 transition"
          :class="videoMode === 'image_to_video' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/45'"
          :disabled="readonly"
          title="图生视频"
          @click="setVideoMode('image_to_video')"
        >
          <DockTypeIcon icon="image" :size="12" />
        </button>
      </div>

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
            class="dock-icon-btn"
            :disabled="readonly || refUploading"
            title="参考图"
            @click="pickReferenceImage"
          >
            <DockTypeIcon v-if="!refUploading" icon="image" :size="13" />
            <span v-else class="text-[9px] text-white/60">…</span>
          </button>
          <div
            v-if="effectiveRefUrl"
            class="relative h-7 w-7 overflow-hidden rounded-md border border-white/15"
          >
            <img :src="effectiveRefUrl" alt="" class="h-full w-full object-cover">
            <button
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition hover:opacity-100"
              @click="clearReferenceImage"
            >
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <input ref="refInput" type="file" accept="image/*" class="hidden" @change="onRefFileChange">
          <p v-if="refUploadError" class="text-[10px] text-red-400/90">{{ refUploadError }}</p>
        </div>
      </template>

      <div class="ml-auto flex items-center gap-2">
        <DockMicButton
          :listening="speech.listening.value"
          :disabled="readonly"
          @toggle="toggleVoice"
        />
        <DockCreditBadge :credits="credits" />
        <DockGenerateButton
          :generating="generating"
          :disabled="!generating && (!prompt.trim() || (videoMode === 'image_to_video' && !effectiveRefUrl))"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
