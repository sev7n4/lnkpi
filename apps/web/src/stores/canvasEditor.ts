import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'
import type { RefineChromeMode } from '@/utils/refineChrome'
import { clampLoupeZoom } from '@/components/canvas/refine/refineWorkLayout'
import { clampWandTolerance } from '@/components/canvas/refine/maskWand'

export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon'
export type RefineMaskOp = 'add' | 'subtract'
export type RefineLoupeShape = 'circle' | 'rect'

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
  invert: () => void
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
  const refineLoupeOn = ref(false)
  const refineLoupeShape = ref<RefineLoupeShape>('circle')
  const refineLoupeZoom = ref(2.5)
  const refineBrushColor = ref('#22d3ee')
  const refineMaskMenuOpen = ref(false)
  const refineWandTolerance = ref(24)
  const refineMaskOp = ref<RefineMaskOp>('add')
  const refinePanelWidth = ref(400)
  const refinePanelCollapsed = ref(false)

  function resetRefineChromeState() {
    refineChrome.value = 'docked'
    compareLightboxOpen.value = false
    refineTool.value = 'brush'
    refineBrushSize.value = 24
    refineCoverage.value = 0
    refineMask.value = null
    refineLoupeOn.value = false
    refineLoupeShape.value = 'circle'
    refineLoupeZoom.value = 2.5
    refineBrushColor.value = '#22d3ee'
    refineMaskMenuOpen.value = false
    refineWandTolerance.value = 24
    refineMaskOp.value = 'add'
    refinePanelWidth.value = 400
    refinePanelCollapsed.value = false
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

  function setRefineLoupe(on: boolean) {
    refineLoupeOn.value = on
  }

  function setRefineLoupeShape(shape: RefineLoupeShape) {
    refineLoupeShape.value = shape
  }

  function setRefineLoupeZoom(zoom: number) {
    refineLoupeZoom.value = clampLoupeZoom(zoom)
  }

  function setRefineBrushColor(color: string) {
    refineBrushColor.value = color
  }

  function setRefineMaskMenuOpen(open: boolean) {
    refineMaskMenuOpen.value = open
  }

  function setRefineWandTolerance(n: number) {
    refineWandTolerance.value = clampWandTolerance(n)
  }

  function setRefineTool(tool: RefineMaskTool) {
    refineTool.value = tool
    if (tool === 'eraser') refineMaskOp.value = 'subtract'
    else if (tool === 'brush' || tool === 'rect') refineMaskOp.value = 'add'
  }

  function setRefinePanelWidth(width: number) {
    refinePanelWidth.value = width
  }

  function setRefinePanelCollapsed(collapsed: boolean) {
    refinePanelCollapsed.value = collapsed
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
    refineLoupeOn,
    refineLoupeShape,
    refineLoupeZoom,
    refineBrushColor,
    refineMaskMenuOpen,
    refineWandTolerance,
    refineMaskOp,
    refinePanelWidth,
    refinePanelCollapsed,
    openImageEditor,
    closeImageEditor,
    setRefineBusy,
    setRefineChrome,
    setCompareLightboxOpen,
    registerRefineMask,
    getRefineMask,
    setRefineLoupe,
    setRefineLoupeShape,
    setRefineLoupeZoom,
    setRefineBrushColor,
    setRefineMaskMenuOpen,
    setRefineWandTolerance,
    setRefineTool,
    setRefinePanelWidth,
    setRefinePanelCollapsed,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
