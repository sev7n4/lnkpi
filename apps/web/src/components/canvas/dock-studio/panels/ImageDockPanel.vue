<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import type { LocalRefBinding, NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { resolveGenerationModel } from '@/constants/studioModels'
import { isNodeGenerating } from '@/constants/dockStudio'
import { estimateImageCredits } from '@/constants/credits'
import { persistMediaUrl } from '@/composables/useMediaUpload'

const { getConfig } = useModelProviderSettings()

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
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
const refInput = ref<HTMLInputElement | null>(null)
const refUploading = ref(false)
const refUploadError = ref('')

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)
const credits = computed(() => estimateImageCredits(imageCount.value))

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

function syncFromNode() {
  const data = props.node.data ?? {}
  prompt.value = String(data.prompt ?? data.content ?? '')
  imageModel.value = resolveGenerationModel('image', data.imageModel as string | undefined)
  imageAspect.value = (data.imageAspect as ImageAspectRatio | undefined) ?? '16:9'
  imageResolution.value = (data.imageResolution as ImageResolution | undefined) ?? '1K'
  const count = Number(data.imageCount ?? 1)
  imageCount.value = (count === 2 || count === 4 ? count : 1) as ImageCount
  referenceImageUrl.value = String(data.referenceImageUrl ?? '')
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
  syncField('referenceImageUrl', '')
}
</script>

<template>
  <DockToolbarShell type="image" @close="emit('close')">
    <DockRefStrip
      :refs="stripRefs"
      @reorder="onRefReorder"
      @remove="onRefRemove"
    />

    <DockPromptSection
      :model-value="prompt"
      :mentions="mentions"
      placeholder="描述画面内容，@ 引用节点..."
      @update:model-value="onPromptInput"
      @submit="onGenerate"
    />

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
            class="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] opacity-0 transition hover:opacity-100"
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
