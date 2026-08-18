import { describe, expect, it } from 'vitest'
import { isMaskDrawReady, isRealBitmapSize } from './maskCanvasReady'

describe('isRealBitmapSize', () => {
  it('rejects missing or dummy fallback sizes so drawing waits for a real bitmap', () => {
    expect(isRealBitmapSize(undefined, undefined)).toBe(false)
    expect(isRealBitmapSize(0, 0)).toBe(false)
    expect(isRealBitmapSize(1, 1)).toBe(false)
  })

  it('accepts probed or loaded image dimensions including 300×150', () => {
    expect(isRealBitmapSize(64, 64)).toBe(true)
    expect(isRealBitmapSize(300, 150)).toBe(true)
    expect(isRealBitmapSize(1024, 768)).toBe(true)
  })
})

describe('isMaskDrawReady', () => {
  it('blocks drawing until size is ready even when not disabled', () => {
    expect(isMaskDrawReady({ disabled: false, sizeReady: false })).toBe(false)
  })

  it('blocks drawing when the disabled prop is set', () => {
    expect(isMaskDrawReady({ disabled: true, sizeReady: true })).toBe(false)
  })

  it('allows drawing only after a real resize and when not disabled', () => {
    expect(isMaskDrawReady({ disabled: false, sizeReady: true })).toBe(true)
  })
})
