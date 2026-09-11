import { describe, expect, it } from 'vitest'
import {
  FUNDAMENTALS,
  formatFundamentalsBlock,
  getEditIntent,
  getGenerationScene,
  listEditIntents,
  listGenerationScenes,
} from './catalog'

describe('imagePromptingGuide catalog scaffold', () => {
  it('exposes eight fundamentals', () => {
    expect(FUNDAMENTALS).toHaveLength(8)
    expect(FUNDAMENTALS[0]?.id).toBe('define_result')
  })

  it('registers all generation scenes', () => {
    expect(listGenerationScenes().map((s) => s.id).sort()).toEqual([
      'g1_style_lighting',
      'g2_process_infographic',
      'g3_exact_text',
      'g4_reusable_logo',
      'g5_historical_context',
      'g6_comic_strip',
      'g7_interface_preview',
      'g8_scientific_visual',
      'g9_slides_charts',
    ])
  })

  it('registers all edit intents', () => {
    expect(listEditIntents().map((i) => i.id).sort()).toEqual([
      'e1_translate_layout',
      'e2_style_transfer',
      'e3_identity_clothing',
      'e4_combine_refs',
      'e5_transparent_cutout',
      'e6_drawing_to_realistic',
      'e7_remove_object',
      'e8_insert_person',
    ])
  })

  it('marks transparent-background assets', () => {
    expect(getGenerationScene('g4_reusable_logo')?.capability.requiresTransparentBackground).toBe(true)
    expect(getEditIntent('e5_transparent_cutout')?.capability.requiresTransparentBackground).toBe(true)
  })

  it('expands G6 through storyboard mode', () => {
    expect(getGenerationScene('g6_comic_strip')?.expandViaPromptMode).toBe('storyboard')
  })

  it('formats fundamentals block', () => {
    const block = formatFundamentalsBlock(['define_result', 'exact_text'])
    expect(block).toContain('Define the result')
    expect(block).toContain('Specify exact text')
  })
})
