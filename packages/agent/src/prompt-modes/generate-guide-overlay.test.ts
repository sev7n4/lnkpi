import { describe, expect, it } from 'vitest'
import { buildGuideSystemOverlay } from './generate'

describe('guideScene overlay', () => {
  it('builds G3 overlay with fundamentals', () => {
    const overlay = buildGuideSystemOverlay('g3_exact_text')
    expect(overlay).toBeTruthy()
    expect(overlay!).toMatch(/exact|tagline|文字/i)
    expect(overlay!).toContain('-')
  })

  it('returns null for unknown id', () => {
    expect(buildGuideSystemOverlay('nope')).toBeNull()
  })
})
