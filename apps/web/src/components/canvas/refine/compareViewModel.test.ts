import { describe, expect, it } from 'vitest'
import { shouldRenderWipe, wipeAfterSrc, wipeHoldRatio } from './compareViewModel'

describe('wipeHoldRatio', () => {
  it('snaps to full Before while holding original', () => {
    expect(wipeHoldRatio(true, 0.7)).toBe(0)
  })

  it('keeps the current wipe ratio when not holding', () => {
    expect(wipeHoldRatio(false, 0.7)).toBe(0.7)
  })
})

describe('shouldRenderWipe', () => {
  it('renders wipe without waiting for a distinct After', () => {
    expect(shouldRenderWipe('wipe')).toBe(true)
    expect(shouldRenderWipe('split')).toBe(false)
  })
})

describe('wipeAfterSrc', () => {
  it('falls back to Before when After is missing', () => {
    expect(wipeAfterSrc(undefined, 'https://cdn/before.png')).toBe('https://cdn/before.png')
    expect(wipeAfterSrc('https://cdn/after.png', 'https://cdn/before.png')).toBe('https://cdn/after.png')
  })
})
