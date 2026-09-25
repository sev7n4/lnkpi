import type { CropRect } from './refine/cropGeometry'

/**
 * 节点直裁（选中浮层 → 节点卡上覆盖裁剪）的纯函数模型，web 本地、无框架依赖。
 *
 * 坐标系：
 *  - display：节点卡显示坐标（(0,0) = 卡左上角，单位 = 节点坐标 px）。
 *    节点卡以 object-fit: cover 满铺原图（styles/neo-node.css .neo-gen-preview img），
 *    整卡都是图像内容（无 letterbox），裁剪框恒在卡内。
 *  - pixel：原图自然像素坐标（renderCropBlob θ=0 模型）。
 *
 * cover 变换 = 等比缩放 + 居中偏移，因此**宽高比在两个坐标系中一致**：
 * 比例预设可在 display 坐标直接锁定，导出像素天然同比例。
 */

export interface CoverTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/** object-fit: cover 的等比映射：scale = max(boxW/W, boxH/H)，居中偏移。 */
export function coverFitTransform(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): CoverTransform {
  if (!(naturalW > 0) || !(naturalH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { scale: 1, offsetX: 0, offsetY: 0 }
  }
  const scale = Math.max(boxW / naturalW, boxH / naturalH)
  return {
    scale,
    offsetX: (boxW - naturalW * scale) / 2,
    offsetY: (boxH - naturalH * scale) / 2,
  }
}

/**
 * display 裁剪框 → 原图像素裁剪框（导出用）。
 * 结果取整并钳进 [0, W]×[0, H]（≥1px），可直接交给 renderCropBlob(θ=0)。
 */
export function displayRectToPixelRect(
  rect: CropRect,
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): CropRect {
  const { scale, offsetX, offsetY } = coverFitTransform(naturalW, naturalH, boxW, boxH)
  const x0 = (rect.x - offsetX) / scale
  const y0 = (rect.y - offsetY) / scale
  const x1 = (rect.x + rect.width - offsetX) / scale
  const y1 = (rect.y + rect.height - offsetY) / scale
  const x = Math.min(Math.max(0, Math.round(x0)), Math.max(0, naturalW - 1))
  const y = Math.min(Math.max(0, Math.round(y0)), Math.max(0, naturalH - 1))
  const width = Math.min(Math.max(1, Math.round(x1 - x0)), naturalW - x)
  const height = Math.min(Math.max(1, Math.round(y1 - y0)), naturalH - y)
  return { x, y, width, height }
}

/** 裁剪框单边下限（display 坐标）：与 refine crop 的手感下限一致。 */
export const NODE_CROP_MIN_DISPLAY = 24

/** 比例预设 id：original = 原图宽高比；free 不锁比例。 */
export type NodeCropAspectId = 'original' | 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export const NODE_CROP_ASPECT_OPTIONS: { id: NodeCropAspectId; label: string }[] = [
  { id: 'original', label: '原图比例' },
  { id: 'free', label: '自定义' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
]

export const NODE_CROP_ASPECT_RATIOS: Record<Exclude<NodeCropAspectId, 'original' | 'free'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

/** 锁定比例（数值）→ 预设 id；供 resize 锁定判定，original 由调用方换算成数值。 */
export function nodeCropLockRatio(id: NodeCropAspectId, naturalW: number, naturalH: number): number | null {
  if (id === 'free') return null
  if (id === 'original') {
    if (!(naturalW > 0) || !(naturalH > 0)) return null
    return naturalW / naturalH
  }
  return NODE_CROP_ASPECT_RATIOS[id]
}

/** 比例适配：ratio=null → 全卡；否则卡内最大居中 ratio 矩形（切比例 / 进模式的落点）。 */
export function fitDisplayCropRect(boxW: number, boxH: number, ratio: number | null): CropRect {
  if (!(boxW > 0) || !(boxH > 0)) return { x: 0, y: 0, width: 0, height: 0 }
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) {
    return { x: 0, y: 0, width: boxW, height: boxH }
  }
  let w = boxW
  let h = w / ratio
  if (h > boxH) {
    h = boxH
    w = h * ratio
  }
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, width: w, height: h }
}

/** 平移裁剪框（display 坐标增量），钳进卡内。 */
export function moveDisplayCropRect(rect: CropRect, dx: number, dy: number, boxW: number, boxH: number): CropRect {
  const width = Math.min(rect.width, boxW)
  const height = Math.min(rect.height, boxH)
  const x = Math.min(Math.max(0, rect.x + dx), boxW - width)
  const y = Math.min(Math.max(0, rect.y + dy), boxH - height)
  return { x, y, width, height }
}

/**
 * 8 手柄拖拽调整（display 坐标，θ=0 直卡）：dir 决定动哪条边/角；
 * lockRatio（数值，null = 自由）只约束角手柄——边中点手柄（n/s/w/e 单字符）
 * 恒定只动对应一条边，不联动另一轴（2026-09-25 用户拍板：拖上下左右不许带动其他方向）；
 * 单边下限 NODE_CROP_MIN_DISPLAY；结果钳进卡内。
 */
export function resizeDisplayCropRect(
  rect: CropRect,
  dir: string,
  dx: number,
  dy: number,
  boxW: number,
  boxH: number,
  lockRatio: number | null,
): CropRect {
  const { x, y, width, height } = rect
  const moveLeft = dir.includes('w')
  const moveRight = dir.includes('e')
  const moveTop = dir.includes('n')
  const moveBottom = dir.includes('s')
  const isEdgeHandle = dir.length === 1
  const effectiveLock = isEdgeHandle ? null : lockRatio

  let nx = x
  let ny = y
  let nw = width
  let nh = height

  if (moveLeft) {
    const left = Math.min(x + dx, x + width - NODE_CROP_MIN_DISPLAY)
    nx = left
    nw = width + (x - left)
  }
  if (moveRight) {
    nw = Math.max(NODE_CROP_MIN_DISPLAY, width + dx)
  }
  if (moveTop) {
    const top = Math.min(y + dy, y + height - NODE_CROP_MIN_DISPLAY)
    ny = top
    nh = height + (y - top)
  }
  if (moveBottom) {
    nh = Math.max(NODE_CROP_MIN_DISPLAY, height + dy)
  }

  if (effectiveLock != null && effectiveLock > 0) {
    if (moveTop || moveBottom) {
      nw = Math.max(NODE_CROP_MIN_DISPLAY, nh * effectiveLock)
      if (moveLeft) nx = x + width - nw
    } else {
      nh = Math.max(NODE_CROP_MIN_DISPLAY, nw / effectiveLock)
      if (moveTop) ny = y + height - nh
    }
  }

  // 边缘保持钳制：被拖动的边钳进卡内，固定边保持不动（se 拖超界 → 左上角锚定不动），
  // 比例锁定驱动的边越界时以卡界为准（比例让位）。
  let left = nx
  let top = ny
  let right = nx + nw
  let bottom = ny + nh
  if (!moveLeft) right = Math.min(right, boxW)
  if (!moveRight) left = Math.max(left, 0)
  if (!moveTop) bottom = Math.min(bottom, boxH)
  if (!moveBottom) top = Math.max(top, 0)
  right = Math.min(right, boxW)
  bottom = Math.min(bottom, boxH)
  left = Math.max(left, 0)
  top = Math.max(top, 0)

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}
