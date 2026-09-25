import type { CropRect } from './refine/cropGeometry'
import { coverDisplayMapper, type PixelMapper } from './elementEditModel'

/**
 * 标注（annotate，2026-09-25 复刻竞品 + 用户扩展）纯函数模型，web 本地、无框架依赖。
 *
 * 一条标注 = 一个矢量操作（display 节点卡坐标）：
 * 画笔 / 签名（自由笔画）、框选（矩形）、文字、直线 / 箭头、马赛克（区域像素化）、
 * 水印（文字，平铺或单个）。
 * 展示与保存共用 drawAnnotates()：canvas 全量重画（马赛克对原图像素化，
 * 其余矢量绘制），保存 = 导出烧录 PNG（免费，不消耗积分）。
 */

export interface AnnotateStroke {
  points: { x: number; y: number }[]
  size: number
  color: string
}

export type AnnotateShape =
  | { kind: 'stroke'; stroke: AnnotateStroke }
  | { kind: 'rect'; rect: CropRect; size: number; color: string }
  | { kind: 'text'; x: number; y: number; text: string; size: number; color: string }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; size: number; color: string; arrow: boolean }
  | { kind: 'mosaic'; rect: CropRect; block: number }
  | { kind: 'watermark'; x: number; y: number; text: string; size: number; color: string; opacity: number; tiled: boolean }

export type AnnotateTool = 'brush' | 'rect' | 'text' | 'line' | 'arrow' | 'mosaic' | 'watermark' | 'sign'

/** 签名 = 手写自由笔画（与画笔同结构，默认细笔、墨色由取色器决定）。 */
export const ANNOTATE_TOOLS: { id: AnnotateTool; label: string }[] = [
  { id: 'brush', label: '画笔' },
  { id: 'rect', label: '框选' },
  { id: 'text', label: '文字' },
  { id: 'line', label: '直线' },
  { id: 'arrow', label: '箭头' },
  { id: 'mosaic', label: '马赛克' },
  { id: 'watermark', label: '水印' },
  { id: 'sign', label: '签名' },
]

let annotateSeq = 0
export function nextAnnotateId(): string {
  annotateSeq += 1
  return `an-${Date.now().toString(36)}-${annotateSeq}`
}

/** 画一条带可选箭头的线段（箭头在终点，两翼为线长的 22%，随线宽自适应）。 */
function strokeArrowLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  arrow: boolean,
) {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  if (!arrow) return
  const ang = Math.atan2(y1 - y0, x1 - x0)
  const wing = Math.max(8, ctx.lineWidth * 2.6)
  for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + Math.cos(ang + da) * wing, y1 + Math.sin(ang + da) * wing)
    ctx.stroke()
  }
}

/** 在 ctx（原图像素坐标系）上绘制马赛克：区域像素化（缩小再放大，关闭平滑）。 */
function drawMosaic(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: { x: number; y: number; width: number; height: number },
  block: number,
) {
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  if (w < 2 || h < 2) return
  const tiny = document.createElement('canvas')
  const tw = Math.max(1, Math.round(w / Math.max(2, block)))
  const th = Math.max(1, Math.round(h / Math.max(2, block)))
  tiny.width = tw
  tiny.height = th
  const tctx = tiny.getContext('2d')
  if (!tctx) return
  tctx.imageSmoothingEnabled = true
  tctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, tw, th)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tiny, 0, 0, tw, th, rect.x, rect.y, rect.width, rect.height)
  ctx.imageSmoothingEnabled = true
}

/** 在 ctx（原图像素坐标系）上绘制水印文字（单点或平铺）。 */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  opacity: number,
  tiled: boolean,
  W: number,
  H: number,
) {
  ctx.save()
  ctx.globalAlpha = Math.min(1, Math.max(0.08, opacity))
  ctx.fillStyle = color
  ctx.font = `600 ${size}px system-ui, -apple-system, 'PingFang SC', sans-serif`
  ctx.textBaseline = 'middle'
  if (!tiled) {
    ctx.fillText(text, x, y)
    ctx.restore()
    return
  }
  const tw = Math.max(size * text.length * 0.62, size * 2)
  const th = size * 2.2
  const gapX = tw * 1.6
  const gapY = th * 2.2
  const rot = -Math.PI / 9
  ctx.translate(W / 2, H / 2)
  ctx.rotate(rot)
  const spanX = Math.hypot(W, H)
  const spanY = Math.hypot(W, H)
  for (let ry = -spanY / 2; ry <= spanY / 2; ry += gapY) {
    for (let rx = -spanX / 2; rx <= spanX / 2; rx += gapX) {
      ctx.fillText(text, rx, ry)
    }
  }
  ctx.restore()
}

/**
 * 全量绘制标注到 canvas（W×H = 原图像素）。
 * source 为原图（供马赛克取像素）；display→pixel 用 cover 逆映射（boxW/boxH 为节点卡尺寸）。
 */
export function drawAnnotates(
  canvas: HTMLCanvasElement,
  ops: AnnotateShape[],
  source: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): void {
  canvas.width = Math.max(1, Math.round(naturalW))
  canvas.height = Math.max(1, Math.round(naturalH))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const mapper: PixelMapper = coverDisplayMapper(naturalW, naturalH, boxW, boxH)
  const scale = Math.max(canvas.width / Math.max(1, boxW), canvas.height / Math.max(1, boxH))
  const toPx = (v: number) => v * scale

  for (const op of ops) {
    switch (op.kind) {
      case 'stroke': {
        const st = op.stroke
        if (!st.points.length) break
        ctx.save()
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = st.color
        ctx.fillStyle = st.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(1, toPx(st.size))
        if (st.points.length === 1) {
          const p = st.points[0]!
          ctx.beginPath()
          ctx.arc(mapper.toPixelX(p.x), mapper.toPixelY(p.y), ctx.lineWidth / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.beginPath()
          const first = st.points[0]!
          ctx.moveTo(mapper.toPixelX(first.x), mapper.toPixelY(first.y))
          for (const p of st.points.slice(1)) ctx.lineTo(mapper.toPixelX(p.x), mapper.toPixelY(p.y))
          ctx.stroke()
        }
        ctx.restore()
        break
      }
      case 'rect': {
        const x0 = mapper.toPixelX(op.rect.x)
        const y0 = mapper.toPixelY(op.rect.y)
        const x1 = mapper.toPixelX(op.rect.x + op.rect.width)
        const y1 = mapper.toPixelY(op.rect.y + op.rect.height)
        ctx.save()
        ctx.strokeStyle = op.color
        ctx.lineWidth = Math.max(1, toPx(op.size))
        ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
        ctx.restore()
        break
      }
      case 'text': {
        ctx.save()
        ctx.fillStyle = op.color
        ctx.font = `600 ${Math.max(10, toPx(op.size))}px system-ui, -apple-system, 'PingFang SC', sans-serif`
        ctx.textBaseline = 'middle'
        ctx.fillText(op.text, mapper.toPixelX(op.x), mapper.toPixelY(op.y))
        ctx.restore()
        break
      }
      case 'line': {
        ctx.save()
        ctx.strokeStyle = op.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(1, toPx(op.size))
        strokeArrowLine(
          ctx,
          mapper.toPixelX(op.x0),
          mapper.toPixelY(op.y0),
          mapper.toPixelX(op.x1),
          mapper.toPixelY(op.y1),
          op.arrow,
        )
        ctx.restore()
        break
      }
      case 'mosaic': {
        const r = op.rect
        drawMosaic(
          ctx,
          source,
          {
            x: Math.min(mapper.toPixelX(r.x), mapper.toPixelX(r.x + r.width)),
            y: Math.min(mapper.toPixelY(r.y), mapper.toPixelY(r.y + r.height)),
            width: Math.abs(mapper.toPixelX(r.x + r.width) - mapper.toPixelX(r.x)),
            height: Math.abs(mapper.toPixelY(r.y + r.height) - mapper.toPixelY(r.y)),
          },
          Math.max(4, toPx(op.block)),
        )
        break
      }
      case 'watermark': {
        drawWatermark(
          ctx,
          op.text,
          mapper.toPixelX(op.x),
          mapper.toPixelY(op.y),
          Math.max(10, toPx(op.size)),
          op.color,
          op.opacity,
          op.tiled,
          canvas.width,
          canvas.height,
        )
        break
      }
    }
  }
}
