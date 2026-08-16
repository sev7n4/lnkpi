import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'

export interface ImageEditTarget {
  nodeId: string
  url: string
  prompt?: string
}

export interface MediaPreviewTarget {
  url: string
  kind: 'image' | 'video' | 'audio'
  label?: string
  generationRecordId?: string
  assetMediaInfo?: MediaInfo
  assetMeta?: Record<string, unknown>
}

export const useCanvasEditorStore = defineStore('canvasEditor', () => {
  const imageTarget = ref<ImageEditTarget | null>(null)
  const previewTarget = ref<MediaPreviewTarget | null>(null)

  function openImageEditor(target: ImageEditTarget) {
    imageTarget.value = target
  }

  function closeImageEditor() {
    imageTarget.value = null
  }

  function openMediaPreview(target: MediaPreviewTarget) {
    previewTarget.value = target
  }

  function closeMediaPreview() {
    previewTarget.value = null
  }

  return {
    imageTarget,
    openImageEditor,
    closeImageEditor,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
