<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import ImageParamsSelector, {
  type ImageAspectRatio,
  type ImageCount,
  type ImageResolution,
} from '@/components/canvas/ImageParamsSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import GuidePickerPopover from '@/components/canvas/dock-studio/shared/GuidePickerPopover.vue'
import type { LocalRefBinding, NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { catalogModelKeyFromValue, resolveGenerationModel } from '@/constants/studioModels'
import { estimateImageCredits } from '@/constants/credits'
import {
  TURNAROUND_PIPELINE_DOCK_HINT,
  defaultGuideCapabilities,
  getGenerationScene,
  getModelEntry,
  isTurnaroundLikePrompt,
  resolveImageModelProfile,
} from '@lnkpi/shared'
import { applyGuideSceneToPrompt, clearGuideScene } from './guideSceneApply'
import { isImageDockReadonly } from './imageDockRefineEntry'
import { mapPreferredSizeToAspect } from './mapPreferredSizeToAspect'
import { useDockLocalImageUpload } from '@/components/canvas/dock-studio/shared/useDockLocalImageUpload'

const { getConfig } = useModelProviderSettings()

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
  readonly?: boolean
  refs?: NodeRef[]
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  generate: []
  close: []
  removeRef: [ref: NodeRef]
}>()

const prompt = ref('')
const imageModel = ref(getConfig('image').model)
const imageAspect = ref<ImageAspectRatio>('16:9')
const imageResolution = ref<ImageResolution>('1K')
const imageCount = ref<ImageCount>(1)
const referenceImageUrl = ref('')
const promptSectionRef = ref<InstanceType<typeof DockPromptSection> | null>(null)
const guidePickerOpen = ref(false)

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
    }
    emit('patch', patch)
  },
  syncReferenceImageUrl: true,
})

const speech = useSpeechRecognition()
const readonly = computed(() =>
  isImageDockReadonly({
    parentReadonly: props.readonly,
    generating: props.generating,
    status: props.node.data?.status,
  }),
)
const credits = computed(() => estimateImageCredits(imageCount.value))

const showTurnaroundHint = computed(() => {
  const data = props.node.data ?? {}
  if (data.pipeline === 'turnaround_image') return true
  return isTurnaroundLikePrompt(prompt.value)
})

const guideCapabilities = computed(() => {
  const modelKey = catalogModelKeyFromValue(imageModel.value)
  const gatewayModelId = getModelEntry(modelKey)?.gatewayModelId ?? modelKey
  return (
    resolveImageModelProfile(modelKey, gatewayModelId).capabilities ??
    defaultGuideCapabilities()
  )
})
const activeGuideSceneId = computed(() => {
  const id = props.node.data?.guideSceneId
  return typeof id === 'string' && id.trim() ? id.trim() : ''
})
const activeGuideScene = computed(() =>
  activeGuideSceneId.value ? getGenerationScene(activeGuideSceneId.value) ?? null : null,
)

function onSelectGuideScene(sceneId: string) {
  if (readonly.value) return
  const result = applyGuideSceneToPrompt({ sceneId, currentPrompt: prompt.value })
  prompt.value = result.prompt
  const patch: Record<string, unknown> = {
    prompt: result.prompt,
    guideSceneId: result.guideSceneId,
  }
  // preferredParams.size → aspect when unambiguous; resolution/quality deferred (Image 2.5 specialty).
  const preferredSize = getGenerationScene(sceneId)?.preferredParams?.size
  const mappedAspect = mapPreferredSizeToAspect(preferredSize)
  if (mappedAspect) {
    imageAspect.value = mappedAspect
    patch.imageAspect = mappedAspect
  }
  emit('patch', patch)
  if (!result.didPrefill) {
    ElMessage.info(`已套用「${result.label}」场景约束（未改写现有提示词）`)
  }
}

function onClearGuideScene() {
  if (readonly.value) return
  emit('patch', clearGuideScene())
}

function selectGuideScene(sceneId: string) {
  onSelectGuideScene(sceneId)
  guidePickerOpen.value = false
}

function clearSelectedGuideScene() {
  onClearGuideScene()
  guidePickerOpen.value = false
}

const effectiveRefUrl = computed(() => {
  const local = referenceImageUrl.value.trim()
  if (local) return local
  return props.upstream.referenceImageUrl.trim()
})

const stripRefs = computed((): NodeRef[] => {
  if (props.refs !== undefined) return props.refs

  const items: NodeRef[] = []
  props.upstream.textNodeIds.forEach((nodeId, index) => {
    items.push({
      refId: nodeId,
      refKey: `T${index + 1}`,
      mediaType: 'text',
      sourceKind: 'edge',
      label: '文本引用',
      preview: props.upstream.textPrompt.slice(0, 48),
      payload: { text: props.upstream.textPrompt },
      sourceNodeId: nodeId,
    })
  })
  if (props.upstream.referenceImageUrl) {
    items.push({
      refId: props.upstream.referenceImageNodeId ?? 'upstream-image',
      refKey: `I${items.filter((r) => r.mediaType === 'image').length + 1}`,
      mediaType: 'image',
      sourceKind: 'edge',
      label: '参考图',
      preview: props.upstream.referenceImageUrl,
      payload: { url: props.upstream.referenceImageUrl },
      sourceNodeId: props.upstream.referenceImageNodeId ?? undefined,
    })
  }
  return items
})

function onRefReorder(refIds: string[]) {
  emit('patch', { refOrder: refIds })
}

function onRefRemove(ref: NodeRef) {
  emit('removeRef', ref)
}

function onRefMention(refKey: string) {
  promptSectionRef.value?.insertRefMention(refKey)
}

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? data.content ?? '')
  imageModel.value = resolveGenerationModel('image', data.imageModel as string | undefined)
  imageAspect.value = (data.imageAspect as ImageAspectRatio | undefined) ?? '16:9'
  imageResolution.value = (data.imageResolution as ImageResolution | undefined) ?? '1K'
  const count = Number(data.imageCount ?? 1)
  imageCount.value = 1
  if (count !== 1) {
    syncField('imageCount', 1)
  }
  referenceImageUrl.value = String(data.referenceImageUrl ?? '')
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  () => props.upstream,
  (ctx) => {
    if (!referenceImageUrl.value.trim() && ctx.referenceImageUrl) {
      referenceImageUrl.value = ctx.referenceImageUrl
      emit('patch', { referenceImageUrl: ctx.referenceImageUrl })
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

function onGenerate() {
  emit('patch', {
    prompt: prompt.value,
    imageModel: imageModel.value,
    imageAspect: imageAspect.value,
    imageResolution: imageResolution.value,
    imageCount: imageCount.value,
    referenceImageUrl: effectiveRefUrl.value || undefined,
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
  <DockToolbarShell type="image" :show-close="false" @close="emit('close')">
    <template #header-end>
      <div class="relative">
        <button
          type="button"
          class="dock-guide-scene-btn relative"
          :class="{ 'is-guide-active': activeGuideSceneId }"
          :disabled="readonly"
          aria-label="场景模板"
          :title="activeGuideScene?.label ?? '场景模板'"
          :aria-expanded="guidePickerOpen"
          @click="guidePickerOpen = !guidePickerOpen"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <rect x="14" y="14" width="6" height="6" rx="1" />
          </svg>
          <span class="dock-guide-scene-btn__label">{{ activeGuideScene?.label ?? '场景模板' }}</span>
          <span
            v-if="activeGuideSceneId"
            class="dock-guide-scene-btn__dot"
            aria-hidden="true"
          />
        </button>
        <GuidePickerPopover
          mode="generation_scene"
          :active-id="activeGuideSceneId || null"
          :capabilities="guideCapabilities"
          :open="guidePickerOpen"
          placement="above-end"
          @select="selectGuideScene"
          @clear="clearSelectedGuideScene"
          @close="guidePickerOpen = false"
        />
      </div>
    </template>

    <DockRefStrip
      :refs="stripRefs"
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

    <DockPromptSection
      ref="promptSectionRef"
      :model-value="prompt"
      :mentions="mentions"
      placeholder="描述画面内容，@ 引用节点..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

    <p
      v-if="showTurnaroundHint"
      class="mx-3 mb-2 rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2 text-[11px] leading-relaxed text-indigo-200/90"
    >
      {{ TURNAROUND_PIPELINE_DOCK_HINT }}
    </p>

    <div class="bottom-toolbar-actions flex-wrap items-center">
      <UniversalModelSelector
        v-model="imageModel"
        type="image"
        @update:model-value="syncField('imageModel', $event)"
      />
      <ImageParamsSelector
        :aspect="imageAspect"
        :resolution="imageResolution"
        :count="imageCount"
        @update:aspect="imageAspect = $event; syncField('imageAspect', $event)"
        @update:resolution="imageResolution = $event; syncField('imageResolution', $event)"
        @update:count="imageCount = $event; syncField('imageCount', $event)"
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
          :disabled="!generating && !prompt.trim()"
          @generate="onGenerate"
        />
      </div>
    </div>
  </DockToolbarShell>
</template>
