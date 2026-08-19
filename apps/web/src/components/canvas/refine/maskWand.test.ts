import { describe, expect, it } from 'vitest'
import { clampWandTolerance, floodFillMask, invertMaskRgba, parseFillHex } from './maskWand'

function rgba(pixels: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels)
}

describe('clampWandTolerance', () => {
  it('clamps to 0–48 and defaults non-finite to 24', () => {
    expect(clampWandTolerance(-1)).toBe(0)
    expect(clampWandTolerance(49)).toBe(48)
    expect(clampWandTolerance(24.6)).toBe(25)
    expect(clampWandTolerance(Number.NaN)).toBe(24)
  })
})

describe('parseFillHex', () => {
  it('parses #rrggbb and falls back to white', () => {
    expect(parseFillHex('#22d3ee')).toEqual([34, 211, 238])
    expect(parseFillHex('bad')).toEqual([255, 255, 255])
  })
})

describe('floodFillMask', () => {
  it('fills a 4-connected same-color run and leaves other pixels', () => {
    const image = rgba([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255])
    const mask = rgba(new Array(12).fill(0))
    const next = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [255, 255, 255],
    })
    expect([...next.slice(0, 8)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255])
    expect([...next.slice(8, 12)]).toEqual([0, 0, 0, 0])
  })

  it('does not fill diagonally and respects tolerance', () => {
    const image = rgba([
      255, 0, 0, 255, 0, 0, 255, 255,
      0, 0, 255, 255, 255, 0, 0, 255,
    ])
    const mask = rgba(new Array(16).fill(0))
    const next = floodFillMask({
      width: 2,
      height: 2,
      imageRgba: image,
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [9, 9, 9],
    })
    expect([...next.slice(0, 4)]).toEqual([9, 9, 9, 255])
    expect([...next.slice(4, 8)]).toEqual([0, 0, 0, 0])
    expect([...next.slice(8, 12)]).toEqual([0, 0, 0, 0])
    expect([...next.slice(12, 16)]).toEqual([0, 0, 0, 0])
  })

  it('returns the original mask buffer unchanged on invalid input', () => {
    const mask = rgba([1, 2, 3, 4])
    const out = floodFillMask({
      width: 2,
      height: 2,
      imageRgba: rgba([0, 0, 0, 255]),
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [255, 255, 255],
    })
    expect(out).toBe(mask)
  })

  it('covers more pixels when tolerance increases on a gradient', () => {
    const image = rgba([0, 0, 0, 255, 20, 0, 0, 255, 40, 0, 0, 255])
    const empty = () => rgba(new Array(12).fill(0))
    const tight = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: empty(),
      x: 0,
      y: 0,
      tolerance: 10,
      fillRgb: [255, 255, 255],
    })
    const wide = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: empty(),
      x: 0,
      y: 0,
      tolerance: 40,
      fillRgb: [255, 255, 255],
    })
    const count = (m: Uint8ClampedArray) => {
      let n = 0
      for (let i = 3; i < m.length; i += 4) if (m[i] > 127) n += 1
      return n
    }
    expect(count(tight)).toBe(1)
    expect(count(wide)).toBe(3)
  })
})

describe('invertMaskRgba', () => {
  it('swaps opaque edit pixels with empty keep pixels as white+A255', () => {
    const mask = rgba([255, 255, 255, 255, 0, 0, 0, 0])
    const next = invertMaskRgba(mask)
    expect([...next]).toEqual([0, 0, 0, 0, 255, 255, 255, 255])
  })
})
