import { describe, expect, it } from 'vitest'
import { containRect, loupeBackground, clampLoupeZoom, refineWorkInsetRight } from './refineWorkLayout'

describe('refineWorkInsetRight', () => {
  it('matches the work viewport so expanded compare does not cover the side panel', () => {
    expect(
      refineWorkInsetRight({
        innerWidth: 1280,
        chrome: 'docked',
        collapsed: false,
        panelWidth: 400,
      }),
    ).toBe(400)
    expect(
      refineWorkInsetRight({
        innerWidth: 1280,
        chrome: 'docked',
        collapsed: true,
        panelWidth: 400,
      }),
    ).toBe(44)
    expect(
      refineWorkInsetRight({
        innerWidth: 1280,
        chrome: 'floating',
        collapsed: false,
        panelWidth: 400,
      }),
    ).toBe(0)
  })
})

describe('containRect', () => {
  it('letterboxes a landscape image inside a square box', () => {
    expect(containRect(200, 200, 400, 200)).toEqual({
      x: 0,
      y: 50,
      width: 200,
      height: 100,
    })
  })

  it('pillarboxes a portrait image inside a wide box', () => {
    expect(containRect(400, 200, 100, 200)).toEqual({
      x: 150,
      y: 0,
      width: 100,
      height: 200,
    })
  })

  it('returns an empty rect when sizes are invalid', () => {
    expect(containRect(0, 100, 10, 10)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('loupeBackground', () => {
  it('places the magnified crop so the pointer sits at the lens center', () => {
    expect(
      loupeBackground({
        displayW: 200,
        displayH: 100,
        pointerX: 50,
        pointerY: 25,
        lens: 80,
        zoom: 2,
      }),
    ).toEqual({
      backgroundSize: '400px 200px',
      backgroundPosition: '-60px -10px',
    })
  })
})

describe('clampLoupeZoom', () => {
  it('clamps magnifier zoom to 1.5–6 and defaults non-finite to 2.5', () => {
    expect(clampLoupeZoom(1)).toBe(1.5)
    expect(clampLoupeZoom(8)).toBe(6)
    expect(clampLoupeZoom(3)).toBe(3)
    expect(clampLoupeZoom(Number.NaN)).toBe(2.5)
  })
})
