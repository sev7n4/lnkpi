<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import ImageAspectSelector, { type ImageAspectRatio } from '@/components/canvas/ImageAspectSelector.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { isNodeGenerating } from '@/constants/dockStudio'

const { getConfig } = useModelProviderSettings()

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
  /** Task 4 will pass resolveNodeRefs output from CanvasPage */
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
const referenceImageUrl = ref('')
const refInput = ref<HTMLInputElement | null>(null)

const speech = useSpeechRecognition()
const readonly = computed(() => isNodeGenerating(props.node.data?.status) || !!props.generating)

const effectiveRefUrl = computed(() => {
  const local = referenceImageUrl.value.trim()
  if (local) return local
  return props.upstream.referenceImageUrl.trim()
})

/** Prefer CanvasPage refs when prop is passed, even if empty */
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
  imageModel.value = String(data.imageModel ?? getConfig('image').model)
  imageAspect.value = (data.imageAspect as ImageAspectRatio | undefined) ?? '16:9'
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

function onRefFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const url = URL.createObjectURL(file)
  referenceImageUrl.value = url
  syncField('referenceImageUrl', url)
  ;(event.target as HTMLInputElement).value = ''
}

function clearReferenceImage() {
  referenceImageUrl.value = ''
  syncField('referenceImageUrl', '')
}
</script>

<template>
  <DockToolbarShell type-label="图片生成" @close="emit('close')">
    <!-- Task 4: selectedRefs from CanvasPage; upstream fallback only when refs prop omitted -->
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
      <ImageAspectSelector
        v-model="imageAspect"
        @update:model-value="syncField('imageAspect', $event)"
      />

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
        <span v-else class="text-[10px] text-white/35">无参考图</span>
        <input ref="refInput" type="file" accept="image/*" class="hidden" @change="onRefFileChange">
      </div>

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
