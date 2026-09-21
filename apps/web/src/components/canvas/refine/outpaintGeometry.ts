/**
 * 扩图（outpaint）画布几何纯函数。
 *
 * 约束（见规格 §3.1）：
 *  - 单边最小 OUTPAINT_MIN_EDGE（256px）：生成模型对过窄扩展效果差；
 *  - 面积上限 OUTPAINT_MAX_AREA_RATIO（9 倍原图面积）：不设单边 3 倍，避免挡住
 *    「宽不变、高拉 4 倍」的分镜板场景。
 *
 * 输出对齐 Task 2 服务端 metadata 契约：
 *  - 返回 width/height = 新画布尺寸（outpaintTo）；
 *  - 返回 x/y = 原图左上角在新画布中的位置（beforeOffset，CompareView 贴图用）。
 */

export const OUTPAINT_MIN_EDGE = 256
export const OUTPAINT_MAX_AREA_RATIO = 9

export type Size = { width: number; height: number }

export type AnchorAxis = 'start' | 'end' | 'center'
export type Anchor = { x: AnchorAxis; y: AnchorAxis }

/** 新画布矩形：width/height 为新画布尺寸，x/y 为原图左上角在新画布中的偏移。 */
export type OutpaintRect = { x: number; y: number; width: number; height: number }

/**
 * 将拖拽手柄产生的新画布请求 `next` clamp 到合法区间，并按 `anchor` 计算原图左上角
 * 在新画布中的偏移。违反单边下限 / 面积上限时 clamp；clamp 后仍非法（极小原图无解）
 * 则抛错。
 */
export function clampOutpaintCanvas(base: Size, next: Size, anchor: Anchor): OutpaintRect {
  const baseArea = base.width * base.height
  const maxArea = OUTPAINT_MAX_AREA_RATIO * baseArea
  // 新画布必须容纳原图，故单边下限取 max(原边, 256)
  const minW = Math.max(base.width, OUTPAINT_MIN_EDGE)
  const minH = Math.max(base.height, OUTPAINT_MIN_EDGE)

  let w = next.width
  let h = next.height

  // 单边下限
  if (w < minW) w = minW
  if (h < minH) h = minH

  // 面积上限：等比缩放到 maxArea 以内（保留用户拖出的形状）
  if (w * h > maxArea) {
    const scale = Math.sqrt(maxArea / (w * h))
    w = Math.floor(w * scale)
    h = Math.floor(h * scale)
    // 缩放后重新保证单边下限
    if (w < minW) w = minW
    if (h < minH) h = minH
  }

  // clamp 后必须仍合法，否则抛错（极小原图可能无解）
  if (!(w >= minW && h >= minH && w * h <= maxArea)) {
    throw new Error(
      `clampOutpaintCanvas: 无法在约束内生成合法画布 (base=${base.width}x${base.height}, next=${next.width}x${next.height})`,
    )
  }

  const x = anchorOffset(anchor.x, w, base.width)
  const y = anchorOffset(anchor.y, h, base.height)

  return { x, y, width: w, height: h }
}

function anchorOffset(axis: AnchorAxis, canvasSize: number, baseSize: number): number {
  switch (axis) {
    case 'start':
      return 0
    case 'end':
      return canvasSize - baseSize
    case 'center':
      return Math.round((canvasSize - baseSize) / 2)
  }
}
