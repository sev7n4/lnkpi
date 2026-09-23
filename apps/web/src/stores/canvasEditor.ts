import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'
import { randomId } from '@lnkpi/shared'
import { clampLoupeZoom } from '@/components/canvas/refine/refineWorkLayout'
import { clampWandTolerance } from '@/components/canvas/refine/maskWand'
import type { RefineCompareMetadata } from '@/components/canvas/refine/compareViewModel'
import { clampWipeRatio, type CompareMode } from '@/utils/refineChrome'
import {
  fitRectToAspect,
  initialOutpaintRect,
  resizeOutpaintAbsolute,
  type OutpaintRect,
  type Size,
} from '@/components/canvas/refine/outpaintGeometry'
import { refineSelectionOpAfterToolPick } from '@/components/canvas/refine/refineSelectionModel'
import {
  clampCropRect,
  clampFineRotation,
  fitCropRect,
  normalizeCropRotation,
  type CropAspectId,
  type CropRect,
} from '@/components/canvas/refine/cropGeometry'

export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon' | 'point' | 'ellipse'
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

/** 精修会话内生成的结果（胶片条数据源，最多 8 张挤旧，退出/换图清空）。 */
export interface RefineSessionResult {
  id: string
  url: string
  recordId?: string
  prompt: string
  /** 扩图结果的对照元数据（与 apply payload metadata 契约同形）；普通精修/抠图无此字段。 */
  metadata?: RefineCompareMetadata
  createdAt: string
}

/** 精修工作区模式：select 普通蒙版精修；outpaint 扩图（Task 7）；matting 抠图（Task 7）；crop 裁剪。 */
export type RefineMode = 'select' | 'outpaint' | 'matting' | 'crop'

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
  /** 扩图基准（原图尺寸）：进入扩图模式时由 RefineOutpaintCanvas 写入，供预设 / 尺寸输入 / 读数共用。 */
  const refineOutpaintBase = ref<Size | null>(null)
  /** 扩图手柄拖拽进行中（2026-09-22 用户验收修订）：悬浮 dock 据此隐藏，不挡画布拖拽。 */
  const refineOutpaintDragging = ref(false)
  /** 裁剪：90° 步进数（可负）+ −45..45 微调角，合成总旋转角。 */
  const refineCropTurns = ref(0)
  const refineCropFine = ref(0)
  /** 裁剪比例预设。 */
  const refineCropAspect = ref<CropAspectId>('free')
  /** 裁剪基准（原图自然尺寸）：进入裁剪模式时由 CropCanvas 写入。 */
  const refineCropBase = ref<Size | null>(null)
  /** 裁剪框（旋转后包围盒坐标系，原图像素）。null = 未进入裁剪或基准未就绪。 */
  const refineCropRect = ref<CropRect | null>(null)
  /** 精修会话生成结果（胶片条数据源）。 */
  const refineSessionResults = ref<RefineSessionResult[]>([])
  /** 当前选中的会话结果 id。 */
  const refineSessionCurrentId = ref<string | null>(null)

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
    refineOutpaintBase.value = null
    refineOutpaintDragging.value = false
    refineCropTurns.value = 0
    refineCropFine.value = 0
    refineCropAspect.value = 'free'
    refineCropBase.value = null
    refineCropRect.value = null
    refineSessionResults.value = []
    refineSessionCurrentId.value = null
  }

  function openImageEditor(target: ImageEditTarget) {
    const currentId = imageTarget.value?.nodeId
    if (refineBusy.value && currentId && currentId !== target.nodeId) return
    if (currentId && currentId !== target.nodeId) clearRefineSessionResults()
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
    refineMaskOp.value = refineSelectionOpAfterToolPick(tool, refineMaskOp.value)
  }

  /** 进入 / 退出扩图模式。退出时重置扩图矩形（拖拽状态不进蒙版历史栈，退出即重置）。busy 时禁止切换。 */
  function setRefineMode(mode: RefineMode) {
    if (refineBusy.value) return
    if (mode === 'select') {
      refineOutpaintRect.value = null
      refineOutpaintBase.value = null
      refineOutpaintDragging.value = false
      refineCropTurns.value = 0
      refineCropFine.value = 0
      refineCropAspect.value = 'free'
      refineCropBase.value = null
      refineCropRect.value = null
    }
    refineMode.value = mode
  }

  /** 写入当前扩图矩形（由 RefineOutpaintCanvas 拖拽时实时调用）。 */
  function setRefineOutpaintRect(rect: OutpaintRect | null) {
    refineOutpaintRect.value = rect
  }

  /** 写入扩图基准（原图尺寸）。null = 退出扩图，后续三个面板动作随之 no-op。 */
  function setRefineOutpaintBase(size: Size | null) {
    refineOutpaintBase.value = size
  }

  /** 写入手柄拖拽进行中状态（onHandleDown 置 true / onDragUp 置 false）。 */
  function setRefineOutpaintDragging(value: boolean) {
    refineOutpaintDragging.value = value
  }

  /** 扩图面板动作的公共前置：busy 或基准缺失时不改状态。 */
  function outpaintActionReady(): boolean {
    const base = refineOutpaintBase.value
    return !refineBusy.value && !!base && base.width > 0 && base.height > 0
  }

  /** 比例预设：以包含原图的最小该比例矩形重算画布（替换，非累积）。null = 恢复原图。 */
  function applyOutpaintAspectPreset(ratio: { w: number; h: number } | null) {
    if (!outpaintActionReady()) return
    refineOutpaintRect.value = fitRectToAspect(refineOutpaintBase.value!, ratio)
  }

  /** 画布尺寸数字输入：绝对值语义，内部 clamp（单边 ≥256、面积 ≤9 倍、恒包含原图）。 */
  function applyOutpaintSize(width: number, height: number) {
    if (!outpaintActionReady()) return
    refineOutpaintRect.value = resizeOutpaintAbsolute(refineOutpaintBase.value!, width, height)
  }

  /** 重置为原图矩形（等效「原图」比例预设）。 */
  function resetOutpaintRect() {
    if (!outpaintActionReady()) return
    refineOutpaintRect.value = initialOutpaintRect(refineOutpaintBase.value!)
  }

  // —— 裁剪（crop 模式）——

  /** 总旋转角（90° 步进 + 微调，归一化 (-180, 180]）。 */
  const refineCropRotationDeg = computed(() => normalizeCropRotation(refineCropTurns.value * 90 + refineCropFine.value))

  /** 裁剪动作公共前置：busy 或基准缺失时不改状态。 */
  function cropActionReady(): boolean {
    const base = refineCropBase.value
    return !refineBusy.value && !!base && base.width > 0 && base.height > 0
  }

  /** 写入裁剪基准（CropCanvas 进入模式时调用），并在无草稿时初始化为适配矩形。 */
  function setRefineCropBase(size: Size | null) {
    refineCropBase.value = size
    if (size && size.width > 0 && size.height > 0 && !refineCropRect.value) {
      refineCropRect.value = fitCropRect(size.width, size.height, refineCropRotationDeg.value, refineCropAspect.value)
    }
  }

  /** 写入裁剪框（CropCanvas 拖拽实时调用；防御性再钳一次）。 */
  function setRefineCropRect(rect: CropRect | null) {
    const base = refineCropBase.value
    refineCropRect.value =
      base && rect
        ? clampCropRect(rect, base.width, base.height, refineCropRotationDeg.value)
        : rect
  }

  /** 旋转（步进 + 微调）：重算适配矩形（旧框在新角度下可能越界，统一回适配位）。 */
  function applyCropRotation(turns: number, fine: number) {
    if (!cropActionReady()) return
    refineCropTurns.value = turns
    refineCropFine.value = clampFineRotation(fine)
    refineCropRect.value = fitCropRect(
      refineCropBase.value!.width,
      refineCropBase.value!.height,
      refineCropRotationDeg.value,
      refineCropAspect.value,
    )
  }

  /** 比例预设：重算适配矩形（替换，非累积）。 */
  function applyCropAspectPreset(aspect: CropAspectId) {
    if (!cropActionReady()) return
    refineCropAspect.value = aspect
    refineCropRect.value = fitCropRect(
      refineCropBase.value!.width,
      refineCropBase.value!.height,
      refineCropRotationDeg.value,
      aspect,
    )
  }

  /** 会话结果容量上限：挤旧策略（超出丢最旧）。 */
  const REFINE_SESSION_RESULTS_MAX = 8

  /** 写入一条会话生成结果：自动补 id/时间；push 后 current 指向它；超过 8 张挤掉最旧，被挤者若是 current 则 current 顺移到新的最旧。 */
  function pushRefineSessionResult(r: Omit<RefineSessionResult, 'id' | 'createdAt'> & { id?: string }) {
    const entry: RefineSessionResult = {
      ...r,
      // 明文 HTTP（非安全上下文）下 crypto.randomUUID 不存在，统一走 shared 的降级实现。
      id: r.id ?? randomId(),
      createdAt: new Date().toISOString(),
    }
    refineSessionResults.value.push(entry)
    let evictedCurrent = false
    if (refineSessionResults.value.length > REFINE_SESSION_RESULTS_MAX) {
      const evicted = refineSessionResults.value.shift()
      if (evicted && refineSessionCurrentId.value === evicted.id) {
        refineSessionCurrentId.value = refineSessionResults.value[0]?.id ?? null
        evictedCurrent = true
      }
    }
    if (!evictedCurrent) refineSessionCurrentId.value = entry.id
  }

  /** 胶片条选中：切换 current。 */
  function selectRefineSessionResult(id: string) {
    refineSessionCurrentId.value = refineSessionResults.value.some((r) => r.id === id) ? id : null
  }

  /** 清空会话结果（退出精修 / 换图时调用）。 */
  function clearRefineSessionResults() {
    refineSessionResults.value = []
    refineSessionCurrentId.value = null
  }

  /** 当前选中的会话结果（胶片条高亮 / 对照读它）。 */
  const currentRefineSessionResult = computed<RefineSessionResult | null>(
    () => refineSessionResults.value.find((r) => r.id === refineSessionCurrentId.value) ?? null,
  )

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
    refineOutpaintBase,
    refineOutpaintDragging,
    refineCropTurns,
    refineCropFine,
    refineCropAspect,
    refineCropBase,
    refineCropRect,
    refineCropRotationDeg,
    refineSessionResults,
    refineSessionCurrentId,
    currentRefineSessionResult,
    pushRefineSessionResult,
    selectRefineSessionResult,
    clearRefineSessionResults,
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
    setRefineOutpaintRect,
    setRefineOutpaintBase,
    setRefineOutpaintDragging,
    applyOutpaintAspectPreset,
    applyOutpaintSize,
    resetOutpaintRect,
    setRefineCropBase,
    setRefineCropRect,
    applyCropRotation,
    applyCropAspectPreset,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
