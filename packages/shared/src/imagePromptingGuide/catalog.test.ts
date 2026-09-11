import { describe, expect, it } from 'vitest'
import {
  FUNDAMENTALS,
  formatFundamentalsBlock,
  getEditIntent,
  listEditIntents,
  listGenerationScenes,
} from './catalog'

describe('imagePromptingGuide catalog scaffold', () => {
  it('exposes eight fundamentals', () => {
    expect(FUNDAMENTALS).toHaveLength(8)
    expect(FUNDAMENTALS[0]?.id).toBe('define_result')
  })

  it('registers P0 generation scenes', () => {
    expect(listGenerationScenes().map((s) => s.id).sort()).toEqual([
      'g1_style_lighting',
      'g3_exact_text',
    ])
  })

  it('registers P0 edit intents', () => {
    expect(listEditIntents().map((i) => i.id).sort()).toEqual([
      'e3_identity_clothing',
      'e4_combine_refs',
      'e5_transparent_cutout',
    ])
  })

  it('E5 requires transparent capability', () => {
    expect(getEditIntent('e5_transparent_cutout')?.capability.requiresTransparentBackground).toBe(true)
  })

  it('formats fundamentals block', () => {
    const block = formatFundamentalsBlock(['define_result', 'exact_text'])
    expect(block).toContain('Define the result')
    expect(block).toContain('Specify exact text')
  })
})
