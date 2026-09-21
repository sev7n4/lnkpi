import { describe, expect, it } from 'vitest'
import { buildSelectionTools, clampCounterScale, resolveBarPlacement } from './selectionToolModel'

describe('clampCounterScale', () => {
  it('clamps 1/zoom into [0.8, 1.2]', () => {
    expect(clampCounterScale(0.2)).toBe(1.2)
    expect(clampCounterScale(1)).toBe(1)
    expect(clampCounterScale(4)).toBe(0.8)
  })

  it('passes through mid-range zooms untouched', () => {
    expect(clampCounterScale(0.9)).toBeCloseTo(1 / 0.9)
    expect(clampCounterScale(1.1)).toBeCloseTo(1 / 1.1)
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
    expect(tools.map((t) => t.id)).toEqual(['refine', 'matting', 'crop', 'rotate', 'download', 'save-asset'])
    expect(tools.map((t) => t.group)).toEqual(['ai', 'ai', 'ai', 'ai', 'file', 'file'])
    expect(tools.find((t) => t.id === 'refine')).toMatchObject({ title: '精修', disabled: false })
  })

  it('marks matting/crop/rotate as disabled placeholders with future reasons', () => {
    const tools = buildSelectionTools({ hasUrl: true })
    for (const id of ['matting', 'crop', 'rotate']) {
      const tool = tools.find((t) => t.id === id)!
      expect(tool.disabled).toBe(true)
      expect(tool.disabledReason).toContain('后续能力包点亮')
    }
    expect(tools.find((t) => t.id === 'matting')!.disabledReason).toBe('抠图将在后续能力包点亮')
  })

  it('disables file tools without url and enables them with url', () => {
    const withoutUrl = buildSelectionTools({ hasUrl: false })
    expect(withoutUrl.filter((t) => t.group === 'file').every((t) => t.disabled)).toBe(true)
    const withUrl = buildSelectionTools({ hasUrl: true })
    expect(withUrl.filter((t) => t.group === 'file').every((t) => !t.disabled)).toBe(true)
  })
})
