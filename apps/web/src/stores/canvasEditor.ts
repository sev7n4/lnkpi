import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import type { MediaInfo } from '@lnkpi/shared'
import { randomId } from '@lnkpi/shared'
import { studioApi } from '@/services/studio-api'
import { clampLoupeZoom } from '@/components/canvas/refine/refineWorkLayout'
import { clampWandTolerance } from '@/components/canvas/refine/maskWand'
import type { RefineCompareMetadata } from '@/components/canvas/refine/compareViewModel'
import { clampWipeRatio, type CompareMode } from '@/utils/refineChrome'
import { sameOriginApiMediaUrl } from '@/services/media-url'
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
  fitCropRectWithRatio,
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

/** 元素编辑芯片（element 模式）：一块蒙版碎片 + 识别对象名 + 修改内容。 */
export interface RefineElementItem {
  id: string
  /** 识别出的对象名（焦点点击自动识别；框选/画笔默认「选区」），面板内可二次编辑 */
  name: string
  /** 想要的修改内容（芯片【修改】输入） */
  modify: string
  /** 蒙版碎片快照缩略图（dataURL） */
  thumb: string
  /** 该项的蒙版碎片（原图尺寸位图，白色 = 选中）；markRaw 防深度代理 */
  piece: HTMLCanvasElement
  /** 焦点识别进行中 */
  recognizing?: boolean
  /** 替换图（本地/资产库上传）：生成时作为参考图传给模型做对象替换，自然融入原图 */
  refUrl?: string | null
}

/** 加载同源化后的图片（sameOriginApiMediaUrl 折叠外部地址 → 代理/相对路径，canvas 不污染）。 */
function loadSameOriginImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = sameOriginApiMediaUrl(url)
    setTimeout(() => resolve(img.complete ? img : null), 0)
  })
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

/** 精修工作区模式：select 普通蒙版精修；outpaint 扩图（Task 7）；matting 抠图（Task 7）；crop 裁剪；inpaint 局部重绘（画笔蒙版 + prompt 直出）；element 元素编辑（多选区累积蒙版）。 */
export type RefineMode = 'select' | 'outpaint' | 'matting' | 'crop' | 'inpaint' | 'element'

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
  /** 选区抠图引导（2026-09-24）：rail「选取抠图」/ 抠图面板「用当前选区抠」切到选区后置位，
   *  选区面板显示「返回抠图」CTA；回到 matting 模式即清除。放 store 以便 rail 与面板双侧读写。 */
  const refineMattingReturnPending = ref(false)
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
  /** 裁剪自定义比例（2026-09-25 目标尺寸输入 W×H → 宽高比）；预设拾取时清空。 */
  const refineCropCustomRatio = ref<number | null>(null)
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
    refineTool.value = 'rect' // 2026-09-24 用户拍板：选区默认矩形框
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
    refineCropCustomRatio.value = null
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

  /** 当前是否已有可用选区蒙版（有画布句柄且覆盖 > 0）：选区引导高亮 / 面板守卫的单一判据。 */
  const refineMaskAvailable = computed(() => !!refineMask.value?.getCanvas() && refineCoverage.value > 0)

  // —— 元素编辑（element 模式）：芯片（每项一块蒙版碎片，累积蒙版按项重建）+ 焦点识别 ——

  const refineElementItems = ref<RefineElementItem[]>([])
  /** 累积蒙版（原图尺寸位图，白色 = 全部编辑区）；由全部碎片按序重建 */
  const refineElementMaskCanvas = shallowRef<HTMLCanvasElement | null>(null)

  function rebuildElementMask() {
    const list = refineElementItems.value
    if (!list.length) {
      refineElementMaskCanvas.value = null
      return
    }
    const first = list[0]!.piece
    let canvas = refineElementMaskCanvas.value
    if (!canvas || canvas.width !== first.width || canvas.height !== first.height) {
      canvas = document.createElement('canvas')
      canvas.width = first.width
      canvas.height = first.height
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const it of list) ctx.drawImage(it.piece, 0, 0)
    refineElementMaskCanvas.value = canvas
  }

  /** 登记一枚芯片（蒙版碎片），返回该项；碎片为原图尺寸位图。 */
  function addRefineElementItem(piece: HTMLCanvasElement, name = '选区', modify = ''): RefineElementItem | null {
    if (refineBusy.value) return null
    const item: RefineElementItem = {
      id: `re-${Date.now().toString(36)}-${refineElementItems.value.length + 1}`,
      name,
      modify,
      thumb: '',
      piece: markRaw(piece),
    }
    try {
      item.thumb = piece.toDataURL('image/png')
    } catch {
      /* 缩略图失败留空 */
    }
    refineElementItems.value.push(item)
    rebuildElementMask()
    return item
  }

  function updateRefineElementItem(id: string, patch: { name?: string; modify?: string; refUrl?: string | null }) {
    const item = refineElementItems.value.find((it) => it.id === id)
    if (!item) return
    if (patch.name !== undefined) item.name = patch.name
    if (patch.modify !== undefined) item.modify = patch.modify
    if (patch.refUrl !== undefined) item.refUrl = patch.refUrl
  }

  /** 删除指定芯片（碎片随之移除，累积蒙版重建；识别中的芯片先不删——由调用方中断）。 */
  function removeRefineElementItem(id: string) {
    const idx = refineElementItems.value.findIndex((it) => it.id === id)
    if (idx === -1) return
    refineElementItems.value.splice(idx, 1)
    rebuildElementMask()
  }

  /** inpaint 芯片化：删除芯片时同步把该碎片区域从 MaskEditor 主蒙版擦除（视觉一致）。 */
  function erasePieceFromMainMask(piece: HTMLCanvasElement) {
    const mask = refineMask.value?.getCanvas()
    const mctx = mask?.getContext('2d')
    if (!mask || !mctx) return
    mctx.globalCompositeOperation = 'destination-out'
    mctx.drawImage(piece, 0, 0)
    mctx.globalCompositeOperation = 'source-over'
  }

  /** inpaint 芯片化（2026-09-25）：一次画笔笔画松手 → 自动登记芯片。 */
  function addInpaintStrokeChip(piece: HTMLCanvasElement): RefineElementItem | null {
    if (refineBusy.value) return null
    return addRefineElementItem(piece, '重绘区域', '')
  }

  /** inpaint 芯片化：撤销最后一枚芯片（并从主蒙版擦除该笔画区域）。 */
  function undoInpaintChip() {
    const last = refineElementItems.value[refineElementItems.value.length - 1]
    if (!last) return
    removeInpaintChip(last.id)
  }

  /** inpaint 芯片化：删除指定芯片（芯片条 × 按钮；并从主蒙版擦除该笔画区域）。 */
  function removeInpaintChip(id: string) {
    const item = refineElementItems.value.find((it) => it.id === id)
    const piece = item?.piece
    removeRefineElementItem(id)
    if (piece) erasePieceFromMainMask(piece)
  }

  /** 撤销最后一枚芯片（碎片随之移除，累积蒙版重建）。 */
  function removeLastRefineElementItem() {
    refineElementItems.value.pop()
    rebuildElementMask()
  }

  /** 清空元素编辑（芯片 + 累积蒙版）。 */
  function clearRefineElementItems() {
    refineElementItems.value = []
    refineElementMaskCanvas.value = null
  }

  /**
   * 焦点识别（element 模式核心，2026-09-25 用户需求）：点选 → element-recognize
   * （SAM 分割对象蒙版 + 识图命名）→ 用服务端精确蒙版替换点框碎片 + 回填对象名。
   */
  async function recognizeElementAtPoint(pt: { x: number; y: number }) {
    const src = refineMask.value?.getCanvas()
    const url = imageTarget.value?.url
    if (!src || !url || refineBusy.value) return
    if (pt.x < 0 || pt.y < 0 || pt.x >= src.width || pt.y >= src.height) return

    const piece = document.createElement('canvas')
    piece.width = src.width
    piece.height = src.height
    const ctx = piece.getContext('2d')
    if (!ctx) return
    const r = Math.max(10, Math.round(Math.min(src.width, src.height) * 0.02))
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
    ctx.fill()

    const item = addRefineElementItem(piece, '', '')
    if (!item) return
    item.recognizing = true
    try {
      const { data } = await studioApi.recognizeElement({ imageUrl: url, x: pt.x, y: pt.y })
      item.name = data.data.name || '未识别对象'
      const maskImg = await loadSameOriginImage(data.data.maskUrl)
      if (maskImg) {
        const sam = document.createElement('canvas')
        sam.width = src.width
        sam.height = src.height
        const sctx = sam.getContext('2d')
        if (sctx) {
          sctx.drawImage(maskImg, 0, 0, sam.width, sam.height)
          const d = sctx.getImageData(0, 0, sam.width, sam.height)
          const px = d.data
          for (let i = 0; i < px.length; i += 4) {
            const hit = px[i + 3]! > 127 || 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! > 127
            if (hit) {
              px[i] = 255
              px[i + 1] = 255
              px[i + 2] = 255
              px[i + 3] = 255
            } else {
              px[i + 3] = 0
            }
          }
          sctx.putImageData(d, 0, 0)
          item.piece = markRaw(sam)
          try {
            item.thumb = sam.toDataURL('image/png')
          } catch {
            /* keep */
          }
          rebuildElementMask()
        }
      }
    } catch {
      item.name = '未识别对象'
    } finally {
      item.recognizing = false
    }
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

  function setRefineMattingReturnPending(v: boolean) {
    refineMattingReturnPending.value = v
  }

  /** 进入 / 退出扩图模式。退出时重置扩图矩形（拖拽状态不进蒙版历史栈，退出即重置）。busy 时禁止切换。 */
  function setRefineMode(mode: RefineMode) {
    if (refineBusy.value) return
    if (mode === 'matting') refineMattingReturnPending.value = false
    if (mode === 'element' || mode === 'inpaint') {
      // 元素编辑 / 重绘（芯片化）：清掉旧芯片草稿（列表属会话态，进模式重来）；
      // element 默认焦点选择工具，inpaint 默认画笔
      refineElementItems.value = []
      refineElementMaskCanvas.value = null
      setRefineTool(mode === 'element' ? 'point' : 'brush')
    }
    if (mode === 'select') {
      refineOutpaintRect.value = null
      refineOutpaintBase.value = null
      refineOutpaintDragging.value = false
      refineCropTurns.value = 0
      refineCropFine.value = 0
      refineCropAspect.value = 'free'
      refineCropCustomRatio.value = null
      refineCropBase.value = null
      refineCropRect.value = null
      // 2026-09-24 用户拍板：进选区默认矩形框（此前默认画笔）
      if (refineMode.value !== 'select') setRefineTool('rect')
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
    refineCropCustomRatio.value = null
    refineCropRect.value = fitCropRect(
      refineCropBase.value!.width,
      refineCropBase.value!.height,
      refineCropRotationDeg.value,
      aspect,
    )
  }

  /**
   * 目标尺寸（2026-09-25：填写如 1024x768 → 锁定该宽高比）：重算适配矩形。
   * 非法输入（非正数）不改状态。
   */
  function applyCropCustomRatio(width: number, height: number) {
    if (!cropActionReady()) return
    if (!(width > 0) || !(height > 0)) return
    refineCropAspect.value = 'free'
    refineCropCustomRatio.value = width / height
    refineCropRect.value = fitCropRectWithRatio(
      refineCropBase.value!.width,
      refineCropBase.value!.height,
      refineCropRotationDeg.value,
      width / height,
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
    refineMattingReturnPending,
    refineMode,
    refineOutpaintRect,
    refineOutpaintBase,
    refineOutpaintDragging,
    refineCropTurns,
    refineCropFine,
    refineCropAspect,
    refineCropCustomRatio,
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
    refineMaskAvailable,
    refineElementItems,
    refineElementMaskCanvas,
    addRefineElementItem,
    updateRefineElementItem,
    removeRefineElementItem,
    addInpaintStrokeChip,
    undoInpaintChip,
    removeInpaintChip,
    removeLastRefineElementItem,
    recognizeElementAtPoint,
    clearRefineElementItems,
    setRefineLoupe,
    setRefineLoupeShape,
    setRefineLoupeZoom,
    setRefineBrushColor,
    setRefineMaskMenuOpen,
    setRefineWandTolerance,
    setRefineMattingReturnPending,
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
    applyCropCustomRatio,
    previewTarget,
    openMediaPreview,
    closeMediaPreview,
  }
})
