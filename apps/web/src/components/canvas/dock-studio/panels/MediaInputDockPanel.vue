<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import { inferMediaInputKind, type MediaInputKind } from '@/composables/useMediaUpload'
import { isNodeGenerating } from '@/constants/dockStudio'

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  upload: [file: File]
  convert: [targetType: 'image' | 'video' | 'audio']
  close: []
}>()

const fileName = ref('')
const title = ref('')
const url = ref('')
const mimeType = ref('')
const mediaKind = ref<MediaInputKind>('image')
const fileInput = ref<HTMLInputElement | null>(null)

const locked = computed(
  () => !!props.readonly || isNodeGenerating(props.node.data?.status) || props.node.data?.status === 'uploading',
)
const canConvertVideo = computed(() => mediaKind.value === 'image' || mediaKind.value === 'video')
const canConvertImage = computed(() => mediaKind.value === 'image')
const canConvertAudio = computed(() => mediaKind.value === 'audio')

function syncFromNode() {
  const data = props.node.data ?? {}
  fileName.value = String(data.fileName ?? data.title ?? '')
  title.value = String(data.title ?? data.fileName ?? '')
  url.value = String(data.url ?? '')
  mimeType.value = String(data.mimeType ?? '')
  const kind = data.mediaKind as MediaInputKind | undefined
  mediaKind.value = kind ?? inferMediaInputKind(mimeType.value, url.value)
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

function onTitleInput(value: string) {
  title.value = value
  emit('patch', { title: value, fileName: fileName.value || value })
}

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  emit('upload', file)
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <DockToolbarShell
    type="mediaInput"
    show-title
    :title="title"
    title-placeholder="素材名称"
    :readonly="locked"
    @update:title="onTitleInput"
    @close="emit('close')"
  >
    <div class="mb-3 flex gap-3 px-1">
      <div class="h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <video v-if="url && mediaKind === 'video'" :src="url" class="h-full w-full object-cover" muted />
        <audio v-else-if="url && mediaKind === 'audio'" :src="url" controls class="w-full p-1" />
        <img v-else-if="url" :src="url" alt="" class="h-full w-full object-cover">
        <div v-else class="flex h-full items-center justify-center text-[10px] text-white/30">无预览</div>
      </div>
      <div class="min-w-0 flex-1 space-y-1 text-[11px]">
        <p class="truncate text-white/70">{{ fileName || '未命名素材' }}</p>
        <p class="text-white/35">{{ mimeType || '未知类型' }} · {{ mediaKind }}</p>
        <p v-if="url.startsWith('blob:')" class="text-amber-400/80">本地预览（登录后上传可持久化）</p>
        <p v-else-if="url" class="text-emerald-400/70">已上传</p>
      </div>
    </div>

    <div class="bottom-toolbar-actions flex-wrap">
      <button
        type="button"
        class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/70 transition hover:bg-white/10"
        :disabled="locked"
        @click="pickFile"
      >
        {{ locked ? '处理中...' : '上传 / 替换' }}
      </button>
      <input ref="fileInput" type="file" accept="image/*,video/*,audio/*" class="hidden" @change="onFileChange">

      <button
        v-if="canConvertImage && url"
        type="button"
        class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/70 hover:bg-white/10"
        :disabled="locked"
        @click="emit('convert', 'image')"
      >
        转为图片节点
      </button>
      <button
        v-if="canConvertVideo && url"
        type="button"
        class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/70 hover:bg-white/10"
        :disabled="locked"
        @click="emit('convert', 'video')"
      >
        转为视频节点
      </button>
      <button
        v-if="canConvertAudio && url"
        type="button"
        class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/70 hover:bg-white/10"
        :disabled="locked"
        @click="emit('convert', 'audio')"
      >
        转为音频节点
      </button>
    </div>
  </DockToolbarShell>
</template>
