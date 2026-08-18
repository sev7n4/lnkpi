import { describe, expect, it } from 'vitest'
import { countMaskPixelsFromImageData } from './maskExport'

if (typeof ImageData === 'undefined') {
  // jsdom does not implement ImageData; keep the brief's `new ImageData(w, h)` API.
  globalThis.ImageData = class ImageData {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
    readonly colorSpace = 'srgb' as const
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
      this.data = new Uint8ClampedArray(width * height * 4)
    }
  } as unknown as typeof ImageData
}

describe('countMaskPixelsFromImageData', () => {
  it('reports coverage from alpha channel', () => {
    const data = new ImageData(2, 1)
    data.data.set([0, 0, 0, 0, 255, 255, 255, 255])
    const { ratio, width, height } = countMaskPixelsFromImageData(data)
    expect(width).toBe(2)
    expect(height).toBe(1)
    expect(ratio).toBe(0.5)
  })

  it('reports coverage from luma when alpha is transparent', () => {
    const data = new ImageData(2, 1)
    data.data.set([0, 0, 0, 0, 200, 200, 200, 0])
    const { ratio } = countMaskPixelsFromImageData(data)
    expect(ratio).toBe(0.5)
  })

  it('treats luma and alpha at 127 as keep, 128 as edit', () => {
    const data = new ImageData(2, 1)
    data.data.set([127, 127, 127, 127, 128, 128, 128, 128])
    expect(countMaskPixelsFromImageData(data).ratio).toBe(0.5)
  })
})
