import { describe, expect, it } from 'vitest'
import { baseCanvasFromMetadata, shouldRenderWipe, wipeAfterSrc, wipeHoldRatio } from './compareViewModel'

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

describe('baseCanvasFromMetadata', () => {
  it('扩图版本：以 outpaintTo 为基准画布，Before 居中偏移', () => {
    expect(
      baseCanvasFromMetadata({
        editMode: 'outpaint',
        outpaintFrom: { width: 400, height: 300 },
        outpaintTo: { width: 800, height: 600 },
      }),
    ).toEqual({
      width: 800,
      height: 600,
      beforeOffset: { x: 200, y: 150 },
    })
  })

  it('居中偏移取整（奇数差值）', () => {
    const canvas = baseCanvasFromMetadata({
      editMode: 'outpaint',
      outpaintFrom: { width: 401, height: 300 },
      outpaintTo: { width: 800, height: 601 },
    })
    expect(canvas?.beforeOffset).toEqual({ x: Math.round((800 - 401) / 2), y: Math.round((601 - 300) / 2) })
  })

  it('非扩图版本 / 缺几何字段 / 空 metadata → undefined', () => {
    expect(baseCanvasFromMetadata({ editMode: 'edit' })).toBeUndefined()
    expect(baseCanvasFromMetadata({ editMode: 'outpaint' })).toBeUndefined()
    expect(baseCanvasFromMetadata(null)).toBeUndefined()
    expect(baseCanvasFromMetadata(undefined)).toBeUndefined()
  })
})
