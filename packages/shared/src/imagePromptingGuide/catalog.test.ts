import { describe, expect, it } from 'vitest'
import {
  FUNDAMENTALS,
  formatFundamentalsBlock,
  listEditIntents,
  listGenerationScenes,
} from './catalog'

describe('imagePromptingGuide catalog scaffold', () => {
  it('exposes eight fundamentals', () => {
    expect(FUNDAMENTALS).toHaveLength(8)
    expect(FUNDAMENTALS[0]?.id).toBe('define_result')
  })

  it('lists empty P0 registries until scenes/intents land', () => {
    expect(listGenerationScenes()).toEqual([])
    expect(listEditIntents()).toEqual([])
  })

  it('formats fundamentals block', () => {
    const block = formatFundamentalsBlock(['define_result', 'exact_text'])
    expect(block).toContain('Define the result')
    expect(block).toContain('Specify exact text')
  })
})
