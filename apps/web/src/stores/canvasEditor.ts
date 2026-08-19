import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'
import type { RefineChromeMode } from '@/utils/refineChrome'

export type RefineMaskTool = 'brush' | 'eraser' | 'rect'

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

export type RefineMaskHandle = {
  exportPng: () => Promise<Blob>
  clear: () => void
  getCanvas: () => HTMLCanvasElement | null
}

export const useCanvasEditorStore = defineStore('canvasEditor', () => {
  const imageTarget = ref<ImageEditTarget | null>(null)
  const previewTarget = ref<MediaPreviewTarget | null>(null)
  const refineBusy = ref(false)
  const refineChrome = ref<RefineChromeMode>('docked')
  const compareLightboxOpen = ref(false)
  const refineTool = ref<RefineMaskTool>('brush')
  const refineBrushSize = ref(24)
  const refineCoverage = ref(0)
  const refineMask = shallowRef<RefineMaskHandle | null>(null)

  function resetRefineChromeState() {
    refineChrome.value = 'docked'
    compareLightboxOpen.value = false
    refineTool.value = 'brush'
    refineBrushSize.value = 24
    refineCoverage.value = 0
    refineMask.value = null
  }

  function openImageEditor(target: ImageEditTarget) {
    const currentId = imageTarget.value?.nodeId
    if (refineBusy.value && currentId && currentId !== target.nodeId) return
    imageTarget.value = target
  }

  function closeImageEditor() {
    if (refineBusy.value) return
    imageTarget.value = null
    resetRefineChromeState()
  }

  function setRefineBusy(value: boolean) {
    refineBusy.value = value
  }

  function setRefineChrome(mode: RefineChromeMode) {
    refineChrome.value = mode
  }

  function setCompareLightboxOpen(open: boolean) {
    compareLightboxOpen.value = open
  }

  function registerRefineMask(handle: RefineMaskHandle | null) {
    refineMask.value = handle
  }

  function getRefineMask(): RefineMaskHandle | null {
    return refineMask.value
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
    refineChrome,
    compareLightboxOpen,
    refineTool,
    refineBrushSize,
    refineCoverage,
    openImageEditor,
    closeImageEditor,
    setRefineBusy,
    setRefineChrome,
    setCompareLightboxOpen,
    registerRefineMask,
    getRefineMask,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
