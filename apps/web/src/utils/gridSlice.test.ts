import { describe, expect, it } from 'vitest'
import {
  canSliceAtCell,
  clampGridDims,
  equalSliceRects,
  gridSlicePresetOptions,
  layoutSliceChildPositions,
  resolveDropdownPlacement,
} from './gridSlice'

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

describe('gridSlicePresetOptions', () => {
  it('lists 4/9/16/25 presets with n×n labels', () => {
    expect(gridSlicePresetOptions()).toEqual([
      { n: 4, label: '4宫格 (2×2)' },
      { n: 9, label: '9宫格 (3×3)' },
      { n: 16, label: '16宫格 (4×4)' },
      { n: 25, label: '25宫格 (5×5)' },
    ])
  })
})

describe('canSliceAtCell', () => {
  it('rejects 7×7 on a 300×200 image (min cell 64px)', () => {
    expect(canSliceAtCell({ width: 300, height: 200 }, 7, 7)).toBe(false)
  })

  it('accepts 3×3 on a 1024×1024 image', () => {
    expect(canSliceAtCell({ width: 1024, height: 1024 }, 3, 3)).toBe(true)
  })

  it('rejects when only one edge falls below the minimum', () => {
    // 320/2=160 ok but 120/2=60 < 64
    expect(canSliceAtCell({ width: 320, height: 120 }, 2, 2)).toBe(false)
  })

  it('accepts exactly 64px cells (boundary inclusive)', () => {
    expect(canSliceAtCell({ width: 128, height: 128 }, 2, 2)).toBe(true)
  })

  it('honours a custom minCellPx', () => {
    expect(canSliceAtCell({ width: 300, height: 300 }, 7, 7, 32)).toBe(true)
  })
})

describe('resolveDropdownPlacement', () => {
  it('opens downward by default', () => {
    expect(resolveDropdownPlacement(500, 300, 240)).toBe('bottom')
  })

  it('flips upward when space below is insufficient and above is larger', () => {
    expect(resolveDropdownPlacement(100, 400, 240)).toBe('top')
  })

  it('flips upward whenever above is larger, even if neither side fits', () => {
    expect(resolveDropdownPlacement(100, 120, 240)).toBe('top')
  })

  it('keeps downward when spaces are equal', () => {
    expect(resolveDropdownPlacement(120, 120, 240)).toBe('bottom')
  })
})

describe('layoutSliceChildPositions', () => {
  it('places children in row-major cols×rows grid to the right of origin', () => {
    const sizes = Array.from({ length: 4 }, () => ({ w: 100, h: 80 }))
    const positions = layoutSliceChildPositions({ x: 200, y: 50 }, sizes, 2, 24)

    expect(positions).toEqual([
      { x: 200, y: 50 },
      { x: 324, y: 50 },
      { x: 200, y: 154 },
      { x: 324, y: 154 },
    ])
  })

  it('uses a single column when cols is 1', () => {
    const sizes = [{ w: 40, h: 30 }, { w: 40, h: 30 }]
    const positions = layoutSliceChildPositions({ x: 0, y: 0 }, sizes, 1, 10)

    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ])
  })
})
