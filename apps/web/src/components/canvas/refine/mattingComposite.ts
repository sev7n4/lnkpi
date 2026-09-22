// mattingComposite.ts
/** mask 的 r 通道（0-255）映射为目标 alpha；返回新 RGBA 数组（不改入参）。 */
export function applyAlphaFromMask(
  image: Uint8ClampedArray,
  mask: Uint8ClampedArray,
): Uint8ClampedArray {
  const pxCount = image.length / 4
  if (mask.length !== pxCount * 4) throw new Error('mask 尺寸与图像不匹配')
  const out = new Uint8ClampedArray(image)
  for (let i = 0; i < pxCount; i += 1) out[i * 4 + 3] = mask[i * 4]
  return out
}

/** 原图 + mask → 透明 PNG blob（canvas 路径，浏览器专用）。 */
export async function compositeMattingPng(opts: {
  image: HTMLImageElement
  maskRgba: Uint8ClampedArray
}): Promise<Blob> {
  const { image, maskRgba } = opts
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  data.data.set(applyAlphaFromMask(data.data, maskRgba))
  ctx.putImageData(data, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png')
  })
}
