import { describe, it, expect } from 'vitest'
import {
  CHARACTER_TURNAROUND_STYLE_PRESETS,
  CHARACTER_TURNAROUND_EXAMPLES,
  formatStylePresetsForSystem,
} from './character-turnaround-presets'
import { characterTurnaroundMode } from './character-turnaround'

describe('character-turnaround-presets', () => {
  it('has 20 industry style presets', () => {
    expect(CHARACTER_TURNAROUND_STYLE_PRESETS).toHaveLength(20)
    const ids = CHARACTER_TURNAROUND_STYLE_PRESETS.map((p) => p.id)
    expect(ids).toContain('photoreal_commercial')
    expect(ids).toContain('fashion_editorial')
    expect(ids).toContain('cyberpunk_character')
    expect(ids).toContain('anime_character_sheet')
    expect(ids).toContain('xianxia_fantasy')
    expect(ids).toContain('cg_digital_human')
    expect(ids).toContain('beauty_cosmetic')
    expect(ids).toContain('kpop_idol')
    expect(ids).toContain('streetwear_urban')
    expect(ids).toContain('sportswear_athletic')
    expect(ids).toContain('steampunk_vintage')
    expect(ids).toContain('gothic_dark')
    expect(ids).toContain('post_apocalyptic')
    expect(ids).toContain('lolita_sweet')
    expect(ids).toContain('military_tactical')
    expect(ids).toContain('bridal_formal')
    expect(ids).toContain('western_cowboy')
    expect(ids).toContain('stylized_3d_cartoon')
    expect(ids).toContain('illustration_watercolor')
    expect(ids).toContain('chibi_kawaii')
  })

  it('has a full example for each preset', () => {
    expect(CHARACTER_TURNAROUND_EXAMPLES).toHaveLength(20)
    for (const preset of CHARACTER_TURNAROUND_STYLE_PRESETS) {
      const example = CHARACTER_TURNAROUND_EXAMPLES.find((e) => e.presetId === preset.id)
      expect(example, `missing example for ${preset.id}`).toBeDefined()
      expect(example!.assistant).toContain('四格布局')
      expect(example!.assistant).toContain('第一格')
      expect(example!.assistant).toContain('第四格')
    }
  })

  it('formatStylePresetsForSystem includes all labels', () => {
    const text = formatStylePresetsForSystem()
    for (const preset of CHARACTER_TURNAROUND_STYLE_PRESETS) {
      expect(text).toContain(preset.label)
      expect(text).toContain(preset.id)
    }
  })

  it('characterTurnaroundMode system includes preset library', () => {
    expect(characterTurnaroundMode.system).toContain('风格预设库')
    expect(characterTurnaroundMode.system).toContain('高定时尚大片')
    expect(characterTurnaroundMode.system).toContain('K-pop偶像定妆')
    expect(characterTurnaroundMode.system).toContain('Q版/Q萌/chibi')
    expect(characterTurnaroundMode.system).toContain('Q版萌系')
  })
})
