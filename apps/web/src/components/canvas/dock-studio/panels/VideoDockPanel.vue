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
import { catalogModelKeyFromValue, resolveGenerationModel } from '@/constants/studioModels'
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@lnkpi/shared'
import { isNodeGenerating } from '@/constants/dockStudio'
import { estimateVideoCredits } from '@/constants/credits'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { useVideoModelCapabilities } from '@/composables/useVideoModelCapabilities'
import VideoCapabilityBadges from '@/components/canvas/dock-studio/shared/VideoCapabilityBadges.vue'
import {
  countValidImageRefs,
  hasUnsupportedMediaRefs,
} from '@/components/canvas/dock-studio/shared/dockRefRoleLabels'

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
  continueShot: []
}>()

const prompt = ref('')
const videoModel = ref(getConfig('video').model)
const videoSettings = ref<VideoSettings>({ ...DEFAULT_VIDEO_SETTINGS })
const videoMode = ref<VideoGenerationMode>('text_to_video')
const referenceImageUrl = ref('')
const seed = ref<number | undefined>(undefined)
const negativePrompt = ref('')
const refInput = ref<HTMLInputElement | null>(null)
const refUploading = ref(false)
const refUploadProgress = ref(0)
const refUploadError = ref('')

const speech = useSpeechRecognition()
const promptSectionRef = ref<InstanceType<typeof DockPromptSection> | null>(null)
const { capabilities } = useVideoModelCapabilities(videoModel)
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const credits = computed(() => estimateVideoCredits(videoSettings.value.duration))

const imageRefCount = computed(() => countValidImageRefs(props.refs ?? []))
const canUseFirstLastFrame = computed(() => imageRefCount.value >= 2)
const firstLastFrameInvalid = computed(
  () => videoMode.value === 'first_last_frame' && imageRefCount.value !== 2,
)

const unsupportedMediaRefs = computed(() =>
  hasUnsupportedMediaRefs(
    props.refs ?? [],
    capabilities.value.supportsVideoRef,
    capabilities.value.supportsAudioRef,
  ),
)

const generateDisabled = computed(() => {
  if (props.generating) return false
  if (!prompt.value.trim()) return true
  if (videoMode.value === 'image_to_video' && !effectiveRefUrl.value) return true
  if (firstLastFrameInvalid.value) return true
  return false
})

const generateButtonTitle = computed(() => {
  if (firstLastFrameInvalid.value) {
    return '严格首尾帧模式需要恰好 2 张参考图'
  }
  return undefined
})

const ownLastFrameUrl = computed(() => String(props.node.data?.lastFrameUrl ?? '').trim())

const showContinueShotButton = computed(
  () => !!ownLastFrameUrl.value && capabilities.value.supportsReturnLastFrame,
)

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
  const seedRaw = data.seed
  seed.value =
    typeof seedRaw === 'number' && Number.isFinite(seedRaw) ? Math.trunc(seedRaw) : undefined
  negativePrompt.value = String(data.negativePrompt ?? '')
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  () => props.upstream,
  (ctx) => {
    if (!props.node.data?.videoMode && ctx.referenceImageUrl) {
      videoMode.value = 'image_to_video'
    }
  },
  { immediate: true, deep: true },
)

watch(
  capabilities,
  (caps) => {
    if (!caps.supportsFirstLastFrame && videoMode.value === 'first_last_frame') {
      setVideoMode('image_to_video')
    }
  },
  { immediate: true },
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

function onNegativePromptInput(value: string) {
  negativePrompt.value = value
  syncField('negativePrompt', value.trim() || undefined)
}

function onSeedInput(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    seed.value = undefined
    syncField('seed', undefined)
    return
  }
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n)) return
  seed.value = n
  syncField('seed', n)
}

function onGenerate() {
  emit('patch', {
    prompt: prompt.value,
    videoModel: videoModel.value,
    videoSettings: { ...videoSettings.value },
    videoMode: videoMode.value,
    seed: seed.value,
    negativePrompt: negativePrompt.value.trim() || undefined,
  })
  emit('generate')
}

function continueFromLastFrame() {
  const url = props.upstream.lastFrameUrl.trim()
  if (!url) return
  referenceImageUrl.value = url
  videoMode.value = 'image_to_video'
  const binding: LocalRefBinding = {
    id: createLocalRefId('last-frame'),
    mediaType: 'image',
    sourceKind: 'upload',
    label: '上一镜末帧',
    url,
  }
  const prev = (props.node.data?.localRefs as LocalRefBinding[]) ?? []
  emit('patch', { localRefs: [...prev, binding], videoMode: 'image_to_video' })
}

function continueNextShot() {
  if (!showContinueShotButton.value) return
  emit('continueShot')
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
  refUploadProgress.value = 0
  refUploading.value = true
  const blobUrl = URL.createObjectURL(file)
  referenceImageUrl.value = blobUrl
  videoMode.value = 'image_to_video'

  try {
    const url = await persistMediaUrl(file, blobUrl, {
      onProgress: (p) => {
        refUploadProgress.value = p
      },
    })
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
      videoMode: 'image_to_video',
    })
  } catch (err) {
    refUploadError.value = err instanceof Error ? err.message : '参考图上传失败，请重试'
    URL.revokeObjectURL(blobUrl)
    referenceImageUrl.value = ''
  } finally {
    refUploading.value = false
    refUploadProgress.value = 0
  }
}

function clearReferenceImage() {
  referenceImageUrl.value = ''
  videoMode.value = 'text_to_video'
  const prev = (props.node.data?.localRefs as LocalRefBinding[]) ?? []
  emit('patch', {
    localRefs: prev.filter((r) => r.mediaType !== 'image'),
    videoMode: 'text_to_video',
  })
}

function onRefReorder(refIds: string[]) {
  emit('patch', { refOrder: refIds })
}

function onRefRemove(ref: NodeRef) {
  emit('removeRef', ref)
}

function onRefMention(refKey: string) {
  promptSectionRef.value?.insertRefMention(refKey)
}
</script>

<template>
  <DockToolbarShell type="video" @close="emit('close')">
    <DockRefStrip
      :refs="refs ?? []"
      :video-mode="videoMode"
      @reorder="onRefReorder"
      @remove="onRefRemove"
      @mention="onRefMention"
    />

    <p
      v-if="unsupportedMediaRefs.showWarning"
      class="dock-ref-warning"
      role="status"
    >
      当前模型不支持视频/音频参考，请换 Seedance
    </p>

    <DockPromptSection
      ref="promptSectionRef"
      :model-value="prompt"
      :mentions="mentions"
      placeholder="描述视频内容，@ 引用节点..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <details class="dock-advanced">
      <summary class="dock-advanced-summary">高级</summary>
      <div class="dock-advanced-body">
        <label class="dock-advanced-field">
          <span class="dock-advanced-label">Seed</span>
          <input
            type="number"
            class="dock-advanced-input"
            :value="seed ?? ''"
            :disabled="readonly"
            placeholder="随机"
            step="1"
            @input="onSeedInput(($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="dock-advanced-field dock-advanced-field-grow">
          <span class="dock-advanced-label">Negative prompt</span>
          <input
            type="text"
            class="dock-advanced-input"
            :value="negativePrompt"
            :disabled="readonly"
            placeholder="排除内容，如 watermark, blur"
            @input="onNegativePromptInput(($event.target as HTMLInputElement).value)"
          >
        </label>
      </div>
    </details>

    <div class="bottom-toolbar-actions flex-wrap">
      <div class="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
        <button
          type="button"
          class="dock-seg-btn rounded-md px-1.5 py-1"
          :class="{ 'is-on': videoMode === 'text_to_video' }"
          :disabled="readonly"
          title="文生视频"
          @click="setVideoMode('text_to_video')"
        >
          <DockTypeIcon icon="text" :size="12" />
        </button>
        <button
          type="button"
          class="dock-seg-btn rounded-md px-1.5 py-1"
          :class="{ 'is-on': videoMode === 'image_to_video' }"
          :disabled="readonly"
          title="图生视频"
          @click="setVideoMode('image_to_video')"
        >
          <DockTypeIcon icon="image" :size="12" />
        </button>
        <button
          v-if="capabilities.supportsFirstLastFrame && canUseFirstLastFrame"
          type="button"
          class="dock-seg-btn rounded-md px-1.5 py-1 text-[10px]"
          :class="{ 'is-on': videoMode === 'first_last_frame' }"
          :disabled="readonly"
          :title="capabilities.firstLastFrameLabel"
          @click="setVideoMode('first_last_frame')"
        >
          {{ capabilities.firstLastFrameLabel }}
        </button>
      </div>

      <button
        v-if="upstream.lastFrameUrl"
        type="button"
        class="neo-chip rounded-md px-2 py-1 text-[10px]"
        :disabled="readonly"
        title="使用上游视频末帧作为参考图"
        @click="continueFromLastFrame"
      >
        延续上一镜
      </button>

      <button
        v-if="showContinueShotButton"
        type="button"
        class="neo-chip rounded-md px-2 py-1 text-[10px]"
        :disabled="readonly"
        title="以上一镜末帧为参考，创建下一段视频"
        @click="continueNextShot"
      >
        接下一段
      </button>

      <div class="flex flex-col gap-1">
        <UniversalModelSelector
          v-model="videoModel"
          type="video"
          @update:model-value="syncField('videoModel', $event)"
        />
        <VideoCapabilityBadges :capabilities="capabilities" />
      </div>
      <VideoSettingsSelector
        v-model="videoSettings"
        :capabilities="capabilities"
        :model-key="catalogModelKeyFromValue(videoModel)"
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
            <span v-else class="whitespace-nowrap text-[9px] text-white/60">
              {{ refUploadProgress > 0 ? `上传中 ${refUploadProgress}%` : '上传中...' }}
            </span>
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
          :disabled="generateDisabled"
          :title="generateButtonTitle"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>

<style scoped>
.dock-ref-warning {
  margin: 0 2px 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.1);
  font-size: 10px;
  line-height: 1.4;
  color: rgba(253, 224, 71, 0.95);
}

.dock-advanced {
  margin: 0 2px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.dock-advanced-summary {
  cursor: pointer;
  padding: 4px 8px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  user-select: none;
  list-style: none;
}

.dock-advanced-summary::-webkit-details-marker {
  display: none;
}

.dock-advanced-body {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 8px 8px;
}

.dock-advanced-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 88px;
}

.dock-advanced-field-grow {
  flex: 1;
  min-width: 160px;
}

.dock-advanced-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.45);
}

.dock-advanced-input {
  width: 100%;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  padding: 4px 6px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.9);
}

.dock-advanced-input:disabled {
  opacity: 0.5;
}
</style>
