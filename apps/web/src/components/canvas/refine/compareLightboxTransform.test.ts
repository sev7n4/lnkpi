import { describe, expect, it } from 'vitest'
import { panFromDrag, panZoomFromWheel } from './compareLightboxTransform'

describe('panZoomFromWheel', () => {
  it('zooms out toward 1 and clears pan at minimum scale', () => {
    const next = panZoomFromWheel({
      scale: 1.1,
      panX: 40,
      panY: -20,
      deltaY: 100,
    })
    expect(next.scale).toBeCloseTo(1)
    expect(next.panX).toBe(0)
    expect(next.panY).toBe(0)
  })

  it('zooms in and clamps at 8', () => {
    const next = panZoomFromWheel({
      scale: 8,
      panX: 10,
      panY: 10,
      deltaY: -100,
    })
    expect(next.scale).toBe(8)
    expect(next.panX).toBe(10)
    expect(next.panY).toBe(10)
  })
})

describe('panFromDrag', () => {
  it('adds pointer deltas to pan', () => {
    expect(panFromDrag({ panX: 4, panY: 5, dx: 2, dy: -3 })).toEqual({
      panX: 6,
      panY: 2,
    })
  })
})
