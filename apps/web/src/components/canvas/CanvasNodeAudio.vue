<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { resolveMediaUrl } from '@/services/api-base'
import { useNodeMediaUpload } from '@/composables/useNodeMediaUpload'
import { downloadMediaFile, mediaDownloadName } from '@/composables/useCanvasMedia'
import { saveAssetToLibrary } from '@/composables/useAssetLibrary'

const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    url?: string
    status: string
    prompt?: string
    label?: string
    errorMessage?: string
    errorCode?: string
    generationStartedAt?: string
    generationRecordId?: string
    materialId?: string
  }
}>()

const route = useRoute()
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
} = useNodeMediaUpload(props.id, 'audio')

function download() {
  if (!displayUrl.value) return
  void downloadMediaFile(
    displayUrl.value,
    mediaDownloadName(displayUrl.value, 'audio', props.data.label ?? props.data.prompt),
  )
}

function saveToLibrary() {
  const url = String(props.data.url ?? '').trim()
  if (!url) return
  void saveAssetToLibrary({
    kind: 'audio',
    url,
    label: props.data.label ?? props.data.prompt ?? '',
    sourceNodeId: props.id,
  })
}
</script>

<template>
  <NeoBaseNode node-type="audio" :selected="selected" :data="data" :status="data.status">
    <div
      class="neo-audio-card neo-node-upload-target"
      :class="{
        'is-drag-over': dragOver,
        'is-reject': rejectFlash,
      }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="data.url" class="relative">
        <audio :src="displayUrl" controls class="nodrag nowheel w-full" />
        <button
          type="button"
          class="neo-node-replace-btn nodrag"
          title="替换音频"
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
          title="下载音频"
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
      </div>
      <div
        v-else
        class="neo-node-placeholder"
        :class="{
          'is-generating': data.status === 'generating',
          'is-failed': data.status === 'failed' || data.status === 'error',
        }"
      >
        <div class="neo-placeholder-content">
          <button
            v-if="data.status !== 'generating'"
            type="button"
            class="neo-node-upload-btn nodrag"
            title="上传音频"
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
            {{ data.status === 'generating' ? '生成中...' : '上传或等待生成' }}
          </span>
        </div>
      </div>
      <p v-if="data.prompt" class="line-clamp-2 text-[11px] text-white/45">{{ data.prompt }}</p>
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
