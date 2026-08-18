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
  const refineBusy = ref(false)

  function openImageEditor(target: ImageEditTarget) {
    imageTarget.value = target
  }

  function closeImageEditor() {
    if (refineBusy.value) return
    imageTarget.value = null
  }

  function setRefineBusy(value: boolean) {
    refineBusy.value = value
  }

  function openMediaPreview(target: MediaPreviewTarget) {
    previewTarget.value = target
  }

  function closeMediaPreview() {
    previewTarget.value = null
  }

  return {
    imageTarget,
    refineBusy,
    openImageEditor,
    closeImageEditor,
    setRefineBusy,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
