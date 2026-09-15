<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElMessage } from 'element-plus'
import {
  assertMiniMaxH3ReferenceLimits,
  evaluateMediaRefPreflight,
  type MediaRefPreflight,
  type ProbedMediaFile,
} from '@lnkpi/shared'
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
import type { LocalRefBinding, NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { catalogModelKeyFromValue, resolveGenerationModel } from '@/constants/studioModels'
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@lnkpi/shared'
import { isNodeGenerating, NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import { estimateVideoCredits } from '@/constants/credits'
import { useDockLocalImageUpload, createLocalRefId } from '@/components/canvas/dock-studio/shared/useDockLocalImageUpload'
import { useVideoModelCapabilities } from '@/composables/useVideoModelCapabilities'
import {
  countValidImageRefs,
  hasUnsupportedMediaRefs,
  isValidImageRef,
} from '@/components/canvas/dock-studio/shared/dockRefRoleLabels'
import { studioApi } from '@/services/studio-api'
import { inferVideoDockMode } from './inferVideoDockMode'

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
const refPreflight = ref<MediaRefPreflight | null>(null)
const refPreflightLoading = ref(false)
const pendingPreflightToast = ref(false)
let preflightSeq = 0

const {
  inputRef: refInput,
  uploading: refUploading,
  uploadError: refUploadError,
  pick: pickReferenceImage,
  onFileChange: onRefFileChange,
} = useDockLocalImageUpload({
  getExistingLocalRefs: () => (props.node.data?.localRefs as LocalRefBinding[]) ?? [],
  onPatch: (patch) => {
    if (typeof patch.referenceImageUrl === 'string') {
      referenceImageUrl.value = patch.referenceImageUrl
      videoMode.value = 'image_to_video'
    }
    emit('patch', { ...patch, videoMode: 'image_to_video' })
  },
  syncReferenceImageUrl: true,
})

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

const hasVideoOrAudioRef = computed(
  () => unsupportedMediaRefs.value.hasVideo || unsupportedMediaRefs.value.hasAudio,
)

const referenceModeLocked = computed(
  () => capabilities.value.supportsReferenceToVideo && hasVideoOrAudioRef.value,
)

const showChipActions = computed(
  () =>
    (capabilities.value.supportsFirstLastFrame && canUseFirstLastFrame.value)
    || capabilities.value.supportsReferenceToVideo
    || !!props.upstream.lastFrameUrl
    || showContinueShotButton.value,
)

const generateDisabled = computed(() => {
  if (props.generating) return false
  if (!prompt.value.trim()) return true
  if (
    videoMode.value === 'image_to_video'
    && imageRefCount.value === 0
    && !effectiveRefUrl.value
  ) return true
  if (firstLastFrameInvalid.value) return true
  if (videoMode.value === 'reference_to_video') {
    const refs = props.refs ?? []
    let imageCount = 0
    let videoCount = 0
    let audioCount = 0
    for (const ref of refs) {
      if (ref.stale || !ref.payload.url?.trim()) continue
      if (ref.mediaType === 'image') imageCount++
      else if (ref.mediaType === 'video') videoCount++
      else if (ref.mediaType === 'audio') audioCount++
    }
    try {
      assertMiniMaxH3ReferenceLimits({
        imageCount,
        videoCount,
        audioCount,
        promptLength: prompt.value.length,
      })
    } catch {
      return true
    }
  }
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

function isProbeableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

const imageRefSources = computed(() => {
  const items: Array<{ url: string; refKey?: string }> = []
  const seen = new Set<string>()
  for (const ref of props.refs ?? []) {
    if (!isValidImageRef(ref)) continue
    const url = ref.payload.url?.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    items.push({ url, refKey: ref.refKey })
  }
  const localUrl = effectiveRefUrl.value.trim()
  if (localUrl && !seen.has(localUrl)) {
    items.push({ url: localUrl })
  }
  return items
})

const probeableRefSources = computed(() =>
  imageRefSources.value.filter((src) => isProbeableUrl(src.url)),
)

const showRefPreflightAlert = computed(
  () => refPreflight.value != null && refPreflight.value.level !== 'none',
)

async function loadCachedRefPreflight(): Promise<MediaRefPreflight | null> {
  const recordId = props.node.data?.generationRecordId
  if (typeof recordId !== 'string' || !recordId.trim()) return null
  try {
    const { data: res } = await studioApi.getGeneration(recordId.trim())
    const pf = res.data.refPreflight
    if (pf && pf.level !== 'none') return pf
  } catch {
    // ignore — fall back to client-side probe
  }
  return null
}

async function refreshRefPreflight() {
  const seq = ++preflightSeq
  if (!imageRefSources.value.length) {
    refPreflight.value = null
    return
  }

  const cached = await loadCachedRefPreflight()
  if (seq !== preflightSeq) return
  if (cached) refPreflight.value = cached

  if (!probeableRefSources.value.length) {
    if (!cached) refPreflight.value = null
    return
  }

  refPreflightLoading.value = true
  try {
    const probed: Array<ProbedMediaFile & { refKey?: string }> = []
    for (const src of probeableRefSources.value) {
      if (seq !== preflightSeq) return
      try {
        const file = await studioApi.probeMedia(src.url)
        probed.push({ ...file, refKey: src.refKey })
      } catch {
        probed.push({
          url: src.url,
          refKey: src.refKey,
          probeStatus: 'failed',
        })
      }
    }
    if (seq !== preflightSeq) return
    refPreflight.value = evaluateMediaRefPreflight(probed)
  } finally {
    if (seq === preflightSeq) refPreflightLoading.value = false
  }
}

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
  () =>
    [
      videoMode.value,
      imageRefCount.value,
      effectiveRefUrl.value,
      hasVideoOrAudioRef.value,
      capabilities.value.supportsFirstLastFrame,
      capabilities.value.supportsReferenceToVideo,
    ] as const,
  () => {
    const next = inferVideoDockMode({
      current: videoMode.value,
      imageCount: imageRefCount.value,
      hasFallbackImage: Boolean(effectiveRefUrl.value.trim()),
      hasVideoOrAudioRef: hasVideoOrAudioRef.value,
      supportsFirstLastFrame: capabilities.value.supportsFirstLastFrame,
      supportsReferenceToVideo: capabilities.value.supportsReferenceToVideo,
    })
    if (next !== videoMode.value) setVideoMode(next)
  },
  { immediate: true },
)

watch(
  () =>
    [props.node.id, imageRefSources.value.map((src) => `${src.refKey ?? ''}:${src.url}`).join('|')] as const,
  () => {
    void refreshRefPreflight()
  },
  { immediate: true },
)

watch(
  () => [props.node.data?.status, props.generating] as const,
  ([status, generating]) => {
    if (generating) return
    if (status === NODE_GENERATION_STATUS.completed) {
      pendingPreflightToast.value = false
    }
  },
)

watch(
  () =>
    [
      props.node.data?.status,
      props.node.data?.errorMessage,
      props.node.data?.errorCode,
    ] as const,
  ([status, msg, code]) => {
    if (!pendingPreflightToast.value) return
    if (status !== NODE_GENERATION_STATUS.error || !msg) return
    pendingPreflightToast.value = false
    const message = typeof msg === 'string' ? msg : String(msg)
    const isPreflight =
      code === 'invalid_input' ||
      (message.includes('参考图') && (message.includes('过大') || message.includes('偏大')))
    if (isPreflight) ElMessage.error(message)
  },
)

watch(
  capabilities,
  (caps) => {
    if (!caps.supportsFirstLastFrame && videoMode.value === 'first_last_frame') {
      ElMessage.warning('当前模型不支持严格首尾帧，已切换为图生视频')
      setVideoMode('image_to_video')
    }
    if (!caps.supportsReferenceToVideo && videoMode.value === 'reference_to_video') {
      setVideoMode(
        effectiveRefUrl.value || imageRefCount.value > 0 ? 'image_to_video' : 'text_to_video',
      )
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

function toggleFirstLastFrame() {
  setVideoMode(videoMode.value === 'first_last_frame' ? 'image_to_video' : 'first_last_frame')
}

function toggleReferenceMode() {
  if (referenceModeLocked.value) return
  if (videoMode.value === 'reference_to_video') {
    setVideoMode(
      imageRefCount.value > 0 || effectiveRefUrl.value ? 'image_to_video' : 'text_to_video',
    )
    return
  }
  setVideoMode('reference_to_video')
}

function onGenerate() {
  pendingPreflightToast.value = true
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

function onSeedUpdate(value: number | undefined) {
  seed.value = value
  syncField('seed', value)
}

function onNegativePromptUpdate(value: string) {
  negativePrompt.value = value
  syncField('negativePrompt', value.trim() || undefined)
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
      show-add-upload
      :add-upload-disabled="readonly"
      :add-upload-busy="refUploading"
      @reorder="onRefReorder"
      @remove="onRefRemove"
      @mention="onRefMention"
      @add-upload="pickReferenceImage"
    />
    <input ref="refInput" type="file" accept="image/*" class="hidden" @change="onRefFileChange">
    <p v-if="refUploadError" class="mx-3 mb-1 text-[10px] text-red-400/90">{{ refUploadError }}</p>

    <div v-if="showChipActions" class="dock-video-chip-actions">
      <button
        v-if="capabilities.supportsFirstLastFrame && canUseFirstLastFrame"
        type="button"
        class="neo-chip rounded-md px-2 py-1 text-[10px]"
        :class="{ 'is-on': videoMode === 'first_last_frame' }"
        :disabled="readonly"
        :title="capabilities.firstLastFrameLabel"
        @click="toggleFirstLastFrame"
      >
        {{ capabilities.firstLastFrameLabel }}
      </button>
      <button
        v-if="capabilities.supportsReferenceToVideo"
        type="button"
        class="neo-chip rounded-md px-2 py-1 text-[10px]"
        :class="{ 'is-on': videoMode === 'reference_to_video' }"
        :disabled="readonly || referenceModeLocked"
        :title="referenceModeLocked ? '已根据视频/音频参考自动选用' : '参考生成'"
        @click="toggleReferenceMode"
      >
        参考生成
      </button>
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
    </div>

    <p
      v-if="capabilities.supportsReferenceToVideo && (unsupportedMediaRefs.hasVideo || unsupportedMediaRefs.hasAudio) && videoMode !== 'reference_to_video'"
      class="dock-ref-warning"
      role="status"
    >
      请切到参考生成
    </p>
    <p
      v-else-if="unsupportedMediaRefs.showWarning"
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

    <ElAlert
      v-if="showRefPreflightAlert"
      :type="refPreflight!.level === 'error' ? 'error' : 'warning'"
      :closable="false"
      show-icon
      class="dock-ref-preflight-alert"
      :title="refPreflightLoading ? `${refPreflight!.message}（检测中…）` : refPreflight!.message"
    />

    <div class="bottom-toolbar-actions flex-wrap items-center">
      <UniversalModelSelector
        v-model="videoModel"
        type="video"
        @update:model-value="syncField('videoModel', $event)"
      />
      <VideoSettingsSelector
        v-model="videoSettings"
        :capabilities="capabilities"
        :model-key="catalogModelKeyFromValue(videoModel)"
        :seed="seed"
        :negative-prompt="negativePrompt"
        @update:model-value="syncField('videoSettings', $event)"
        @update:seed="onSeedUpdate"
        @update:negative-prompt="onNegativePromptUpdate"
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
          :disabled="generateDisabled"
          :title="generateButtonTitle"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>

<style scoped>
.dock-ref-preflight-alert {
  margin: 0 2px 4px;
}

.dock-ref-preflight-alert :deep(.el-alert__title) {
  font-size: 10px;
  line-height: 1.4;
}

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

.dock-video-chip-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 8px 6px;
}
</style>
