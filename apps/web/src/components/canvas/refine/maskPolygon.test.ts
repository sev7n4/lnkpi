import { describe, expect, it } from 'vitest'
import { fillPolygonMask, isNearPolygonStart } from './maskPolygon'

function rgba(pixels: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels)
}

describe('isNearPolygonStart', () => {
  it('is true within 12px of the first vertex', () => {
    expect(isNearPolygonStart([{ x: 10, y: 10 }], 15, 10)).toBe(true)
    expect(isNearPolygonStart([{ x: 10, y: 10 }], 30, 10)).toBe(false)
    expect(isNearPolygonStart([], 0, 0)).toBe(false)
  })
})

describe('fillPolygonMask', () => {
  it('fills a right triangle with even-odd and leaves outside empty', () => {
    const mask = rgba(new Array(4 * 4 * 4).fill(0))
    const next = fillPolygonMask({
      width: 4,
      height: 4,
      maskRgba: mask,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      fillRgb: [255, 255, 255],
      mode: 'add',
    })
    const count = () => {
      let n = 0
      for (let i = 3; i < next.length; i += 4) if (next[i] > 127) n += 1
      return n
    }
    expect(count()).toBeGreaterThanOrEqual(3)
    expect(count()).toBeLessThan(16)
    expect([...next.slice(15 * 4, 16 * 4)]).toEqual([0, 0, 0, 0])
  })

  it('subtract clears interior pixels', () => {
    const mask = rgba(new Array(4 * 4 * 4).fill(255))
    const next = fillPolygonMask({
      width: 4,
      height: 4,
      maskRgba: mask,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      fillRgb: [1, 2, 3],
      mode: 'subtract',
    })
    expect(next[3]).toBe(0)
    expect(next[15 * 4 + 3]).toBe(255)
  })

  it('returns original buffer on invalid input', () => {
    const mask = rgba([1, 2, 3, 4])
    const out = fillPolygonMask({
      width: 2,
      height: 2,
      maskRgba: mask,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      fillRgb: [255, 255, 255],
      mode: 'add',
    })
    expect(out).toBe(mask)
  })
})
