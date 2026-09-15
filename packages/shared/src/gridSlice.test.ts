import { describe, expect, it } from 'vitest'
import { clampGridDims, equalSliceRects, GRID_SLICE_MAX_EDGE } from './gridSlice'

describe('GRID_SLICE_MAX_EDGE', () => {
  it('is 8192', () => {
    expect(GRID_SLICE_MAX_EDGE).toBe(8192)
  })
})

describe('clampGridDims', () => {
  it('clamps 0 to 1', () => {
    expect(clampGridDims(0, 0)).toEqual({ cols: 1, rows: 1 })
  })

  it('clamps 9 to 7', () => {
    expect(clampGridDims(9, 9)).toEqual({ cols: 7, rows: 7 })
  })
})

describe('equalSliceRects', () => {
  it('returns a single rect covering the image for 1×1', () => {
    expect(equalSliceRects(10, 10, 1, 1)).toEqual([{ x: 0, y: 0, w: 10, h: 10 }])
  })

  it('splits 10×10 into 3×3 with last col/row absorbing remainder', () => {
    const rects = equalSliceRects(10, 10, 3, 3)

    expect(rects).toHaveLength(9)
    expect(rects).toEqual([
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 6, y: 0, w: 4, h: 3 },
      { x: 0, y: 3, w: 3, h: 3 },
      { x: 3, y: 3, w: 3, h: 3 },
      { x: 6, y: 3, w: 4, h: 3 },
      { x: 0, y: 6, w: 3, h: 4 },
      { x: 3, y: 6, w: 3, h: 4 },
      { x: 6, y: 6, w: 4, h: 4 },
    ])
  })

  it('covers 10×10 with integer pixels and no gaps or overlaps', () => {
    const width = 10
    const height = 10
    const rects = equalSliceRects(width, height, 3, 3)
    const coverage = Array.from({ length: height }, () => Array(width).fill(0))

    for (const rect of rects) {
      expect(Number.isInteger(rect.x)).toBe(true)
      expect(Number.isInteger(rect.y)).toBe(true)
      expect(Number.isInteger(rect.w)).toBe(true)
      expect(Number.isInteger(rect.h)).toBe(true)

      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          coverage[y][x] += 1
        }
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        expect(coverage[y][x], `pixel ${x},${y}`).toBe(1)
      }
    }
  })
})
