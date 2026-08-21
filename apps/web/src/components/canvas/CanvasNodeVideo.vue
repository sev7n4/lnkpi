<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'
import MediaInfoSummary from '@/components/media/MediaInfoSummary.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { resolveMediaUrl } from '@/services/api-base'
import { useNodeMediaUpload } from '@/composables/useNodeMediaUpload'
import { useMediaInspector, type NodeMediaInfoSummary } from '@/composables/useMediaInspector'
import { useNodeMediaInfoFooter } from '@/composables/useNodeMediaInfoFooter'
import { downloadMediaFile, isUpstreamMediaUrl, mediaDownloadName, UPSTREAM_MEDIA_DOWNLOAD_HINT } from '@/composables/useCanvasMedia'
import { saveAssetToLibrary } from '@/composables/useAssetLibrary'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    url?: string
    status: string
    uploadProgress?: number
    duration?: number
    label?: string
    errorMessage?: string
    errorCode?: string
    generationStartedAt?: string
    generationRecordId?: string
    materialId?: string
    mediaInfo?: NodeMediaInfoSummary
  }
}>()

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
    : '下载视频',
)
const showMediaSummary = computed(() => Boolean(props.data.url && props.data.mediaInfo))
const showInspectorBtn = computed(() => Boolean(props.data.generationRecordId))
const isCompleted = computed(() => props.data.status === NODE_GENERATION_STATUS.completed)
useNodeMediaInfoFooter({
  nodeId: props.id,
  url: computed(() => props.data.url),
  kind: 'video',
  mediaInfo: computed(() => props.data.mediaInfo),
})
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
} = useNodeMediaUpload(props.id, 'video')

function download() {
  if (!displayUrl.value) return
  void downloadMediaFile(
    displayUrl.value,
    mediaDownloadName(displayUrl.value, 'video', props.data.label),
    { sessionId: sessionId.value },
  )
}

function saveToLibrary() {
  const url = String(props.data.url ?? '').trim()
  if (!url) return
  void saveAssetToLibrary({
    kind: 'video',
    url,
    label: props.data.label ?? '',
    sourceNodeId: props.id,
    generationRecordId: props.data.generationRecordId,
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
    nodeLabel: props.data.label,
    url: props.data.url,
    kind: 'video',
  })
}

const mode = ref<'drag' | 'play'>('drag')

watch(
  () => props.selected,
  (sel) => {
    if (!sel) mode.value = 'drag'
  },
)

function enterPlay(e: Event) {
  e.stopPropagation()
  mode.value = 'play'
}

function onPreviewDblclick(e: Event) {
  if (mode.value === 'drag') enterPlay(e)
}

function exitPlay() {
  mode.value = 'drag'
}

function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && mode.value === 'play') exitPlay()
}

watch(mode, (m, _prev, onCleanup) => {
  if (m !== 'play') return
  window.addEventListener('keydown', onEscape)
  onCleanup(() => window.removeEventListener('keydown', onEscape))
})

onUnmounted(() => {
  window.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <NeoBaseNode node-type="video" :selected="selected" :data="data" :status="data.status">
    <template v-if="showMediaSummary && data.mediaInfo" #footer>
      <MediaInfoSummary v-bind="data.mediaInfo" />
    </template>
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
      <div v-if="data.url" class="neo-gen-preview" @dblclick.stop="onPreviewDblclick">
        <template v-if="mode === 'drag'">
          <video
            :src="displayUrl"
            muted
            playsinline
            preload="metadata"
            class="neo-gen-video-poster"
          />
          <button
            type="button"
            class="neo-gen-video-play-btn nodrag"
            title="播放视频"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="enterPlay"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </template>
        <template v-else>
          <video :src="displayUrl" controls autoplay class="nodrag nowheel" />
          <button
            type="button"
            class="neo-gen-video-exit-btn nodrag"
            title="退出播放"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="exitPlay"
          >
            退出
          </button>
        </template>
        <button
          type="button"
          class="neo-node-replace-btn nodrag"
          title="替换视频"
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
            title="上传视频"
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
                  ? '视频生成中...'
                  : '上传或等待生成'
            }}
          </span>
          <button
            v-if="showInspectorBtn"
            type="button"
            class="neo-media-inspector-btn neo-media-inspector-btn--placeholder nodrag"
            aria-label="媒体属性"
            title="媒体属性"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="openMediaInspector"
          >
            ⓘ
          </button>
          <div v-if="data.status === 'uploading'" class="neo-upload-progress">
            <div class="neo-upload-progress-bar" :style="{ width: `${data.uploadProgress ?? 0}%` }" />
          </div>
          <span v-if="data.duration" class="text-[11px] text-white/35">{{ data.duration }}s</span>
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
