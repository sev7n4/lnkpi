import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'
import { clampLoupeZoom } from '@/components/canvas/refine/refineWorkLayout'
import { clampWandTolerance } from '@/components/canvas/refine/maskWand'
import { clampWipeRatio, type CompareMode } from '@/utils/refineChrome'
import type { OutpaintRect } from '@/components/canvas/refine/outpaintGeometry'

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

/** 精修工作区模式：select 普通蒙版精修；outpaint 扩图（Task 7）。 */
export type RefineMode = 'select' | 'outpaint'

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
  /** 工作区模式：select 普通精修 / outpaint 扩图（Task 7）。 */
  const refineMode = ref<RefineMode>('select')
  /** 扩图模式下当前 clamp 后的新画布矩形（base 贴位 + 扩出区）。null 表示未进入扩图或未产生合法 rect。 */
  const refineOutpaintRect = ref<OutpaintRect | null>(null)

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
    refineMode.value = 'select'
    refineOutpaintRect.value = null
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

  /** 进入 / 退出扩图模式。退出时重置扩图矩形（拖拽状态不进蒙版历史栈，退出即重置）。busy 时禁止切换。 */
  function setRefineMode(mode: RefineMode) {
    if (refineBusy.value) return
    if (mode === 'select') refineOutpaintRect.value = null
    refineMode.value = mode
  }

  /** 在 select / outpaint 之间切换（rail 扩图按钮用）。 */
  function toggleRefineMode() {
    setRefineMode(refineMode.value === 'outpaint' ? 'select' : 'outpaint')
  }

  /** 写入当前扩图矩形（由 RefineOutpaintCanvas 拖拽时实时调用）。 */
  function setRefineOutpaintRect(rect: OutpaintRect | null) {
    refineOutpaintRect.value = rect
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
    refineMode,
    refineOutpaintRect,
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
    setRefineMode,
    toggleRefineMode,
    setRefineOutpaintRect,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
