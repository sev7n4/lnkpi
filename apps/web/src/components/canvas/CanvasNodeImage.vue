<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'
import MediaInfoSummary from '@/components/media/MediaInfoSummary.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { resolveMediaUrl } from '@/services/api-base'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useNodeMediaUpload } from '@/composables/useNodeMediaUpload'
import { useMediaInspector } from '@/composables/useMediaInspector'
import { downloadMediaFile, isUpstreamMediaUrl, mediaDownloadName, UPSTREAM_MEDIA_DOWNLOAD_HINT } from '@/composables/useCanvasMedia'
import { saveAssetToLibrary } from '@/composables/useAssetLibrary'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import type { MediaRefWarningLevel } from '@lnkpi/shared'

const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    url?: string
    status: string
    uploadProgress?: number
    prompt?: string
    label?: string
    errorMessage?: string
    errorCode?: string
    generationStartedAt?: string
    generationRecordId?: string
    materialId?: string
    mediaInfo?: {
      kind?: 'image' | 'video'
      width?: number
      height?: number
      bytes?: number
      aspectRatio?: string
      duration?: number
      resolution?: string
      refWarning?: MediaRefWarningLevel
    }
  }
}>()

const editor = useCanvasEditorStore()
const route = useRoute()
const { openInspector } = useMediaInspector()
const sessionId = computed(() => route.params.sessionId as string | undefined)
const taskId = computed(
  () =>
    (typeof props.data.generationRecordId === 'string' && props.data.generationRecordId) ||
    (typeof props.data.materialId === 'string' && props.data.materialId) ||
    undefined,
)
const taskKind = computed(() =>
  typeof props.data.generationRecordId === 'string' && props.data.generationRecordId
    ? ('generation' as const)
    : typeof props.data.materialId === 'string' && props.data.materialId
      ? ('material' as const)
      : undefined,
)
const displayUrl = computed(() => resolveMediaUrl(String(props.data.url ?? '')))
const downloadTitle = computed(() =>
  isUpstreamMediaUrl(String(props.data.url ?? ''))
    ? UPSTREAM_MEDIA_DOWNLOAD_HINT
    : '下载图片',
)
const showMediaSummary = computed(
  () => props.data.status === NODE_GENERATION_STATUS.completed && Boolean(props.data.mediaInfo),
)
const showInspectorBtn = computed(() => Boolean(props.data.generationRecordId))
const isCompleted = computed(() => props.data.status === NODE_GENERATION_STATUS.completed)
const {
  accept,
  dragOver,
  rejectFlash,
  fileInput,
  openPicker,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
} = useNodeMediaUpload(props.id, 'image')

function openEdit() {
  if (!displayUrl.value) return
  editor.openImageEditor({
    nodeId: props.id,
    url: displayUrl.value,
    prompt: props.data.prompt,
  })
}

function openPreview() {
  if (!displayUrl.value) return
  editor.openMediaPreview({
    url: displayUrl.value,
    kind: 'image',
    label: props.data.label ?? props.data.prompt,
  })
}

function download() {
  if (!displayUrl.value) return
  void downloadMediaFile(
    displayUrl.value,
    mediaDownloadName(displayUrl.value, 'image', props.data.label ?? props.data.prompt),
    { sessionId: sessionId.value },
  )
}

function saveToLibrary() {
  const url = String(props.data.url ?? '').trim()
  if (!url) return
  void saveAssetToLibrary({
    kind: 'image',
    url,
    label: props.data.label ?? props.data.prompt ?? '',
    sourceNodeId: props.id,
  })
}

function openMediaInspector(e: Event) {
  e.stopPropagation()
  e.preventDefault()
  const recordId = props.data.generationRecordId
  if (!recordId) return
  void openInspector({
    generationRecordId: recordId,
    nodeId: props.id,
    nodeLabel: props.data.label ?? props.data.prompt,
    url: props.data.url,
    kind: 'image',
  })
}
</script>

<template>
  <NeoBaseNode node-type="image" :selected="selected" :data="data" :status="data.status">
    <div
      class="neo-gen-card neo-node-upload-target"
      :class="{
        'is-drag-over': dragOver,
        'is-reject': rejectFlash,
      }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div
        v-if="data.url"
        class="neo-gen-preview"
        title="双击预览大图"
        @dblclick.stop="openPreview"
      >
        <img :src="displayUrl" alt="" class="pointer-events-none" draggable="false">
        <button
          type="button"
          class="neo-node-preview-btn nodrag"
          title="预览大图"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="openPreview"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          type="button"
          class="neo-node-replace-btn nodrag"
          title="替换图片"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="openPicker"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <button
          type="button"
          class="neo-node-download-btn nodrag"
          :title="downloadTitle"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="download"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button
          type="button"
          class="neo-node-save-btn nodrag"
          title="存入资产库"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="saveToLibrary"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          type="button"
          class="absolute bottom-1.5 right-1.5 rounded-xl border-none bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/85 nodrag"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="openEdit"
        >
          编辑
        </button>
        <MediaInfoSummary
          v-if="showMediaSummary && data.mediaInfo"
          v-bind="data.mediaInfo"
          class="neo-media-info-summary--overlay"
        />
        <button
          v-if="showInspectorBtn"
          type="button"
          class="neo-media-inspector-btn nodrag"
          :class="{ 'is-completed': isCompleted }"
          aria-label="媒体属性"
          title="媒体属性"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="openMediaInspector"
        >
          ⓘ
        </button>
      </div>
      <div
        v-else
        class="neo-node-placeholder"
        :class="{
          'is-generating': data.status === 'generating',
          'is-uploading': data.status === 'uploading',
          'is-failed': data.status === 'failed' || data.status === 'error',
        }"
      >
        <div class="neo-placeholder-content">
          <button
            v-if="data.status !== 'generating' && data.status !== 'uploading'"
            type="button"
            class="neo-node-upload-btn nodrag"
            title="上传图片"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="openPicker"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
          <span class="neo-placeholder-text">
            {{
              data.status === 'uploading'
                ? `上传中 ${data.uploadProgress ?? 0}%`
                : data.status === 'generating'
                  ? '生成中...'
                  : '上传或等待生成'
            }}
          </span>
          <div v-if="data.status === 'uploading'" class="neo-upload-progress">
            <div class="neo-upload-progress-bar" :style="{ width: `${data.uploadProgress ?? 0}%` }" />
          </div>
        </div>
      </div>
      <input
        ref="fileInput"
        type="file"
        :accept="accept"
        class="nodrag hidden"
        @click.stop
        @change="onFileChange"
      >
      <NodeTaskCornerActions
        :status="data.status"
        :started-at="typeof data.generationStartedAt === 'string' ? data.generationStartedAt : undefined"
        :error-message="data.errorMessage as string | undefined"
        :error-code="data.errorCode as string | undefined"
        :task-kind="taskKind"
        :task-id="taskId"
        :node-label="typeof data.label === 'string' ? data.label : undefined"
        :session-id="sessionId"
      />
    </div>
  </NeoBaseNode>
</template>
