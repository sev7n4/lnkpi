import { maskCoverageRatio } from '@/utils/maskCoverage'

function pixelLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function isMaskPixelSelected(r: number, g: number, b: number, a: number): boolean {
  return a > 127 || pixelLuma(r, g, b) > 127
}

export function countMaskPixelsFromImageData(data: ImageData): {
  ratio: number
  width: number
  height: number
} {
  const { width, height, data: pixels } = data
  const pixelCount = width * height
  const coverage = new Uint8ClampedArray(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4
    coverage[i] = isMaskPixelSelected(pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3])
      ? 255
      : 0
  }
  return { ratio: maskCoverageRatio(coverage, pixelCount), width, height }
}

/**
 * Export an inpaint mask PNG: white = edit, black = keep.
 * Keep pixels are written as transparent black (A=0), never opaque-black RGBA.
 * Server composite uses max(luma, alpha); A=255 on black would mark keep as editable.
 */
export function exportMaskPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const srcCtx = canvas.getContext('2d')
  if (!srcCtx) return Promise.reject(new Error('mask canvas context unavailable'))

  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height)
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const outCtx = out.getContext('2d')
  if (!outCtx) return Promise.reject(new Error('mask export context unavailable'))

  const dst = outCtx.createImageData(out.width, out.height)
  for (let i = 0; i < src.data.length; i += 4) {
    const selected = isMaskPixelSelected(src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3])
    if (selected) {
      dst.data[i] = 255
      dst.data[i + 1] = 255
      dst.data[i + 2] = 255
      dst.data[i + 3] = 255
    } else {
      dst.data[i] = 0
      dst.data[i + 1] = 0
      dst.data[i + 2] = 0
      dst.data[i + 3] = 0
    }
  }
  outCtx.putImageData(dst, 0, 0)

  return new Promise((resolve, reject) => {
    out.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('mask export failed'))
    }, 'image/png')
  })
}

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}
