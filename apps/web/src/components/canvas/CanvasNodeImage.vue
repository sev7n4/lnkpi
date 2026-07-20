<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { resolveMediaUrl } from '@/services/api-base'
import { computed } from 'vue'
import { useNodeMediaUpload } from '@/composables/useNodeMediaUpload'

const props = defineProps<{
  id: string
  selected?: boolean
  data: { url?: string; status: string; prompt?: string; label?: string; errorMessage?: string }
}>()

const editor = useCanvasEditorStore()
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
} = useNodeMediaUpload(props.id, 'image')

function openEdit() {
  if (!displayUrl.value) return
  editor.openImageEditor({
    nodeId: props.id,
    url: displayUrl.value,
    prompt: props.data.prompt,
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
      <div v-if="data.url" class="neo-gen-preview">
        <img :src="displayUrl" alt="">
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
          class="absolute bottom-1.5 right-1.5 rounded-xl border-none bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/85"
          @click.stop="openEdit"
        >
          编辑
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
            {{ data.status === 'generating' ? '生成中...' : '上传或等待生成' }}
          </span>
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
      />
    </div>
  </NeoBaseNode>
</template>
