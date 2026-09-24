import { describe, expect, it } from 'vitest'
import { buildSelectionTools, exactCounterScale, resolveBarPlacement } from './selectionToolModel'

describe('exactCounterScale', () => {
  it('returns the exact inverse of zoom（2026-09-22 修订：不再 clamp，屏幕尺寸恒定）', () => {
    expect(exactCounterScale(0.2)).toBeCloseTo(5)
    expect(exactCounterScale(1)).toBe(1)
    expect(exactCounterScale(4)).toBeCloseTo(0.25)
  })

  it('mid-range zooms pass through as 1/zoom', () => {
    expect(exactCounterScale(0.9)).toBeCloseTo(1 / 0.9)
    expect(exactCounterScale(1.1)).toBeCloseTo(1 / 1.1)
  })
})

describe('resolveBarPlacement', () => {
  const viewport = { x: 0, y: 0, w: 1200, h: 800 }

  it('returns top when bar fits inside the viewport', () => {
    expect(resolveBarPlacement({ x: 500, y: 100, w: 200, h: 32 }, viewport)).toBe('top')
  })

  it('returns bottom when bar would cross the viewport top edge', () => {
    expect(resolveBarPlacement({ x: 500, y: -10, w: 200, h: 32 }, viewport)).toBe('bottom')
    expect(resolveBarPlacement({ x: 500, y: 0, w: 200, h: 32 }, viewport)).toBe('bottom')
  })
})

describe('buildSelectionTools', () => {
  it('orders ai tools before file tools with 精修 enabled', () => {
    const tools = buildSelectionTools({ hasUrl: true })
    expect(tools.map((t) => t.id)).toEqual([
      'refine', 'matting', 'outpaint', 'crop', 'inpaint', 'rotate', 'download', 'save-asset',
    ])
    expect(tools.map((t) => t.group)).toEqual([
      'ai', 'ai', 'ai', 'ai', 'ai', 'ai', 'file', 'file',
    ])
    expect(tools.find((t) => t.id === 'refine')).toMatchObject({ title: '精修', disabled: false })
  })

  it('crop/outpaint/inpaint 已点亮；rotate 仍为禁用占位', () => {
    const tools = buildSelectionTools({ hasUrl: true })
    expect(tools.find((t) => t.id === 'crop')?.disabled).toBe(false)
    expect(tools.find((t) => t.id === 'outpaint')?.disabled).toBe(false)
    expect(tools.find((t) => t.id === 'inpaint')?.disabled).toBe(false)
    const rotate = tools.find((t) => t.id === 'rotate')!
    expect(rotate.disabled).toBe(true)
    expect(rotate.disabledReason).toContain('后续能力包点亮')
  })

  it('matting 工具已点亮（非 disabled）', () => {
    const tools = buildSelectionTools({ hasUrl: true })
    expect(tools.find((t) => t.id === 'matting')?.disabled).toBe(false)
  })

  it('disables file tools without url and enables them with url', () => {
    const withoutUrl = buildSelectionTools({ hasUrl: false })
    expect(withoutUrl.filter((t) => t.group === 'file').every((t) => t.disabled)).toBe(true)
    const withUrl = buildSelectionTools({ hasUrl: true })
    expect(withUrl.filter((t) => t.group === 'file').every((t) => !t.disabled)).toBe(true)
  })
})
