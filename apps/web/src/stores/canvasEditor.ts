import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'
import { clampLoupeZoom } from '@/components/canvas/refine/refineWorkLayout'
import { clampWandTolerance } from '@/components/canvas/refine/maskWand'
import { clampWipeRatio, type CompareMode } from '@/utils/refineChrome'

export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon' | 'point'
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
  nodeId?: string
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
  const compareLightboxOpen = ref(false)
  /** 精修对照方式。左栏工具条与右栏对照带都读它，所以归属 store（spec P1-7）。 */
  const refineCompareMode = ref<CompareMode>('split')
  /** 滑竿对照的分割线位置，0..1 */
  const refineWipeRatio = ref(0.5)
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

  function resetRefineChromeState() {
    compareLightboxOpen.value = false
    refineCompareMode.value = 'split'
    refineWipeRatio.value = 0.5
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

  function setCompareLightboxOpen(open: boolean) {
    compareLightboxOpen.value = open
  }

  function setRefineCompareMode(mode: CompareMode) {
    refineCompareMode.value = mode
  }

  function setRefineWipeRatio(ratio: number) {
    refineWipeRatio.value = clampWipeRatio(ratio)
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

  function openMediaPreview(target: MediaPreviewTarget) {
    previewTarget.value = target
  }

  function closeMediaPreview() {
    previewTarget.value = null
  }

  return {
    imageTarget,
    refineBusy,
    compareLightboxOpen,
    refineCompareMode,
    refineWipeRatio,
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
    openImageEditor,
    closeImageEditor,
    setRefineBusy,
    setCompareLightboxOpen,
    setRefineCompareMode,
    setRefineWipeRatio,
    registerRefineMask,
    getRefineMask,
    setRefineLoupe,
    setRefineLoupeShape,
    setRefineLoupeZoom,
    setRefineBrushColor,
    setRefineMaskMenuOpen,
    setRefineWandTolerance,
    setRefineTool,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
