/**
 * 扩图（outpaint）提交时的「合成规格」纯函数。
 *
 * 不绘制 canvas，只产出供 Task 7 组件消费的两张 PNG 的规格对象：
 *  - baseSpec：新画布底图——原图贴位 + 扩出区填充（fill）。
 *  - maskSpec：同尺寸蒙版——扩出区白、原图区黑。
 *
 * 契约对齐（设计规格 §3.2 / §3.4）：
 *  - 底图与蒙版必须同尺寸（服务端 assertSameDimensions）；baseSpec / maskSpec 共用 rect 尺寸保证。
 *  - 蒙版语义：整片扩出区 = 生成蒙版（白），原图区不可被改（黑）。
 *
 * 关于 maskRect：本字段是「原图矩形在新画布中的坐标」（即黑 / 原图区）。
 * 扩出区（蒙版白区）是其补集——消费者只需先把蒙版整片填白、再将该矩形填黑即得正确蒙版。
 * 这样单矩形字段即可正确表达任意 2D 扩图（角手柄拖拽产生的 L 形扩出区）的蒙版，
 * 比把 maskRect 直接设为「补集矩形」更通用（后者仅在单向扩图时可表示为单矩形）。
 */

import type { OutpaintRect, Size } from './outpaintGeometry'

export type OutpaintFill = 'transparent' | 'white'

/**
 * 扩出区填充开关。
 * 默认 'transparent'（设计规格 §3.4 期望透明 PNG）；
 * 若 Task 0 spike 发现上游对透明底图渲染异常（黑边等），部署时翻为 'white'。
 */
export const OUTPAINT_FILL: OutpaintFill = 'transparent'

export type OutpaintBaseSpec = {
  width: number
  height: number
  /** 原图绘制到新画布时的左上角偏移（= -rect.x / -rect.y）。消费者据此 drawImage(img, -srcX, -srcY) 把原图贴到 (rect.x, rect.y)。 */
  srcX: number
  srcY: number
  /** 扩出区填充：`OUTPAINT_FILL` 或显式覆盖值。 */
  fill: OutpaintFill
}

export type OutpaintMaskSpec = {
  width: number
  height: number
  /** 原图矩形在新画布中的坐标（黑 / 原图区）；其补集即蒙版白区（扩出区）。 */
  maskRect: { x: number; y: number; width: number; height: number }
}

export type OutpaintLayers = { baseSpec: OutpaintBaseSpec; maskSpec: OutpaintMaskSpec }

/**
 * 由「原图尺寸」与「Task 5 已 clamp 的新画布矩形」计算底图 / 蒙版合成规格。
 *
 * @param fill 可选覆盖；缺省用 `OUTPAINT_FILL`（默认 transparent）。用于测试 'white' 态与部署切换。
 */
export function computeOutpaintLayers(
  base: Size,
  rect: OutpaintRect,
  fill: OutpaintFill = OUTPAINT_FILL,
): OutpaintLayers {
  const width = rect.width
  const height = rect.height

  const baseSpec: OutpaintBaseSpec = {
    width,
    height,
    srcX: -rect.x,
    srcY: -rect.y,
    fill,
  }

  const maskSpec: OutpaintMaskSpec = {
    width,
    height,
    maskRect: { x: rect.x, y: rect.y, width: base.width, height: base.height },
  }

  return { baseSpec, maskSpec }
}
