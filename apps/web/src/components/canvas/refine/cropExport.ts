/**
 * 裁剪导出（浏览器专用）：原图 + 旋转角 + 裁剪框 → PNG blob。
 *
 * 坐标模型与 cropGeometry.ts 同源：裁剪框 rect 在「旋转后包围盒」坐标系里恒直立，
 * 导出 = 把旋转后的原图按 (rect.x, rect.y) 平移贴进 rect 尺寸的画布。
 * θ=0 时退化为普通 drawImage 九参裁剪。
 */
import type { CropRect } from './cropGeometry'

/** 加载原图像素源（crossOrigin anonymous，与 matting/outpaint 同款）。 */
export function loadCropSourceImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('原图加载失败'))
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('crop canvas toBlob failed'))
    }, 'image/png')
  })
}

/**
 * 按裁剪框渲染 PNG。rect 必须已经 clampCropRect 合法（四角在旋转原图内），
 * 这里只做防御性 round（≥1px），不再二次几何钳制。
 */
export async function renderCropBlob(
  img: HTMLImageElement,
  opts: { rect: CropRect; rotationDeg: number },
): Promise<Blob> {
  const { rect, rotationDeg } = opts
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!(w > 0) || !(h > 0)) throw new Error('原图尺寸无效')

  const t = (rotationDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  const bw = w * c + h * s
  const bh = w * s + h * c

  const outW = Math.max(1, Math.round(rect.width))
  const outH = Math.max(1, Math.round(rect.height))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')

  ctx.translate(-rect.x, -rect.y)
  ctx.translate(bw / 2, bh / 2)
  ctx.rotate(t)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)

  return canvasToBlob(canvas)
}
