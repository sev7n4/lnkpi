/**
 * 扩图提交时的「两张 PNG 合成」：把 Task 6 的 `computeOutpaintLayers` 规格真正画出来。
 *
 *  - 底图（base）：新画布尺寸画布，先按 fill 填扩出区（transparent 留空、white 填白），
 *    再把原图贴到 (rect.x, rect.y)；
 *  - 蒙版（mask）：同尺寸画布，整片填白（生成区），再把原图矩形填黑（保留区）。
 *
 * 消费契约（Task 6 规格 §3.2 / §3.4）：底图与蒙版同尺寸；蒙版整面白 → 原图矩形涂黑。
 * 这里直接照此绘制，与 `computeOutpaintLayers` 的 maskRect 字段同源。
 */
import type { OutpaintLayers } from './outpaintComposite'

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('outpaint canvas toBlob failed'))
    }, 'image/png')
  })
}

export async function renderOutpaintPngs(
  img: HTMLImageElement | null,
  layers: OutpaintLayers,
): Promise<{ baseBlob: Blob; maskBlob: Blob }> {
  const { baseSpec, maskSpec } = layers
  const w = baseSpec.width
  const h = baseSpec.height

  // —— 底图：扩出区填充 + 原图贴位 ——
  const baseCanvas = document.createElement('canvas')
  baseCanvas.width = w
  baseCanvas.height = h
  const bctx = baseCanvas.getContext('2d')
  if (!bctx) throw new Error('outpaint base context unavailable')
  if (baseSpec.fill === 'white') {
    bctx.fillStyle = '#ffffff'
    bctx.fillRect(0, 0, w, h)
  }
  // transparent：不填充，扩出区保持透明 PNG。
  if (img && img.width && img.height) {
    // 原图贴到新画布中 (rect.x, rect.y) = maskRect 的左上角。
    bctx.drawImage(img, maskSpec.maskRect.x, maskSpec.maskRect.y)
  }

  // —— 蒙版：整片白（生成区）+ 原图矩形黑（保留区） ——
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = w
  maskCanvas.height = h
  const mctx = maskCanvas.getContext('2d')
  if (!mctx) throw new Error('outpaint mask context unavailable')
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, w, h)
  const r = maskSpec.maskRect
  mctx.fillStyle = '#000000'
  mctx.fillRect(r.x, r.y, r.width, r.height)

  const [baseBlob, maskBlob] = await Promise.all([canvasToBlob(baseCanvas), canvasToBlob(maskCanvas)])
  return { baseBlob, maskBlob }
}
