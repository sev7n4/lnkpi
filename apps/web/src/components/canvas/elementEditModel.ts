import type { CropRect } from './refine/cropGeometry'

/**
 * 元素编辑（多选区局部编辑，复刻竞品 2026-09-25）纯函数模型，web 本地、无框架依赖。
 *
 * 一条编辑项 = 一个选区形状（矩形或一笔画笔笔画序列，display 节点坐标）+
 * 元素名 + 改动描述。生成时全部项合并为一张整图蒙版（白色 = 编辑区）+
 * combined prompt（「元素名 描述」以「；」连接），走 image/edit mode:'inpaint' 单次生成。
 */

/** 笔画：一次按住拖出的完整折线（display 坐标点列 + 笔刷显示直径） */
export interface ElementEditStroke {
  points: { x: number; y: number }[]
  size: number
}

export type ElementEditShape =
  | { kind: 'rect'; rect: CropRect }
  | { kind: 'strokes'; strokes: ElementEditStroke[] }

export interface ElementEditItem {
  id: string
  name: string
  desc: string
  shape: ElementEditShape
}

/** 元素名预置下拉（竞品同款：常用部位快选；可自由输入） */
export const ELEMENT_EDIT_NAME_OPTIONS = [
  '眼睛', '鼻子', '耳朵', '嘴巴', '头发', '表情', '服装', '配饰', '背景', '其他',
] as const

/** combined prompt：「眼睛 换成蓝色发光；鼻子 增加闭环」——空段去重后以「；」连接。 */
export function combineElementEditPrompt(items: { name: string; desc: string }[]): string {
  return items
    .map((it) => `${it.name.trim()} ${it.desc.trim()}`.trim())
    .filter((seg) => seg.length > 0)
    .filter((seg, i, arr) => arr.indexOf(seg) === i)
    .join('；')
}

/** 简单递增 id（同帧多项不冲突即可；无需 uuid） */
let elementEditSeq = 0
export function nextElementEditId(): string {
  elementEditSeq += 1
  return `ee-${Date.now().toString(36)}-${elementEditSeq}`
}

/** 形状在 display 坐标系的包围盒（缩略图快照 / 命中定位用）。 */
export function elementEditShapeBBox(shape: ElementEditShape): CropRect {
  if (shape.kind === 'rect') return { ...shape.rect }
  const xs: number[] = []
  const ys: number[] = []
  for (const st of shape.strokes) {
    for (const p of st.points) {
      xs.push(p.x)
      ys.push(p.y)
    }
  }
  if (!xs.length) return { x: 0, y: 0, width: 0, height: 0 }
  const pad = 1
  const x0 = Math.min(...xs) - pad
  const y0 = Math.min(...ys) - pad
  const x1 = Math.max(...xs) + pad
  const y1 = Math.max(...ys) + pad
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export interface PixelMapper {
  toPixelX(x: number): number
  toPixelY(y: number): number
}

/**
 * display → 原图像素线性映射（cover 变换的逆）。矩形走双角映射；
 * 笔画逐点映射 + 半径按 scale 折算。
 */
export function coverDisplayMapper(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): PixelMapper {
  const scale = Math.max(naturalW > 0 && naturalH > 0 && boxW > 0 && boxH > 0
    ? Math.max(boxW / naturalW, boxH / naturalH)
    : 1, 1e-6)
  const offsetX = (boxW - naturalW * scale) / 2
  const offsetY = (boxH - naturalH * scale) / 2
  return {
    toPixelX: (x) => (x - offsetX) / scale,
    toPixelY: (y) => (y - offsetY) / scale,
  }
}

/**
 * 把全部编辑项绘制为整图蒙版（原图像素坐标，白色不透明 = 编辑区）。
 * 矩形映射双角；笔画逐点映射、lineWidth 按 display→pixel 缩放比折算。
 * 纯 DOM canvas（调用方保证运行环境有 2d context；jsdom 测试不触达）。
 */
export function paintElementEditMask(
  items: ElementEditItem[],
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalW))
  canvas.height = Math.max(1, Math.round(naturalH))
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const mapper = coverDisplayMapper(naturalW, naturalH, boxW, boxH)
  const scale = Math.max(canvas.width / Math.max(1, boxW), canvas.height / Math.max(1, boxH))
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const item of items) {
    if (item.shape.kind === 'rect') {
      const r = item.shape.rect
      const x0 = mapper.toPixelX(r.x)
      const y0 = mapper.toPixelY(r.y)
      const x1 = mapper.toPixelX(r.x + r.width)
      const y1 = mapper.toPixelY(r.y + r.height)
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
    } else {
      for (const stroke of item.shape.strokes) {
        if (!stroke.points.length) continue
        ctx.lineWidth = Math.max(1, stroke.size * scale)
        ctx.beginPath()
        const first = stroke.points[0]!
        ctx.moveTo(mapper.toPixelX(first.x), mapper.toPixelY(first.y))
        if (stroke.points.length === 1) {
          ctx.arc(mapper.toPixelX(first.x), mapper.toPixelY(first.y), ctx.lineWidth / 2, 0, Math.PI * 2)
          ctx.fill()
          continue
        }
        for (const p of stroke.points.slice(1)) {
          ctx.lineTo(mapper.toPixelX(p.x), mapper.toPixelY(p.y))
        }
        ctx.stroke()
      }
    }
  }
  return canvas
}
