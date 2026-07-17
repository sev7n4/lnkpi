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
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { isNodeGenerating } from '@/constants/dockStudio'

const { getConfig } = useModelProviderSettings()

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
