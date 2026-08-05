import { describe, it, expect } from 'vitest'
import {
  formatDeaiRulesForSystem,
  TURNAROUND_NEGATIVE_PROMPT,
  shouldApplyDeai,
} from './character-turnaround-deai'
import { CHARACTER_TURNAROUND_EXAMPLES } from './character-turnaround-presets'
import { characterTurnaroundMode } from './character-turnaround'

describe('character-turnaround-deai', () => {
  it('formatDeaiRulesForSystem includes four de-AI dimensions and negative prompt', () => {
    const text = formatDeaiRulesForSystem()
    expect(text).toContain('摄影镜头物理')
    expect(text).toContain('皮肤生物学')
    expect(text).toContain('光线物理')
    expect(text).toContain('人体微动态')
    expect(text).toContain('85mm')
    expect(text).toContain('Negative Prompt')
    expect(text).toContain('plastic skin')
  })

  it('applies de-AI only to photoreal_commercial', () => {
    expect(shouldApplyDeai('photoreal_commercial')).toBe(true)
    expect(shouldApplyDeai('fashion_editorial')).toBe(false)
    expect(shouldApplyDeai('cyberpunk_character')).toBe(false)
    expect(shouldApplyDeai('anime_character_sheet')).toBe(false)
    expect(shouldApplyDeai('beauty_cosmetic')).toBe(false)
  })

  it('formatDeaiRulesForSystem states photoreal-only scope', () => {
    expect(formatDeaiRulesForSystem()).toContain('仅限写实')
    expect(formatDeaiRulesForSystem()).toContain('fashion_editorial')
  })

  it('photoreal few-shot includes de-AI content and negative prompt', () => {
    const example = CHARACTER_TURNAROUND_EXAMPLES.find(
      (e) => e.presetId === 'photoreal_commercial',
    )!
    expect(example.assistant).toContain('85mm')
    expect(example.assistant).toContain('毛孔')
    expect(example.assistant).toContain('Negative Prompt')
    expect(example.assistant).toContain(TURNAROUND_NEGATIVE_PROMPT.split(',')[0])
    expect(example.assistant).toContain('四格布局')
    expect(example.assistant).not.toContain('三格布局')
  })

  it('characterTurnaroundMode system includes de-AI rules', () => {
    expect(characterTurnaroundMode.system).toContain('去AI化')
    expect(characterTurnaroundMode.system).toContain('Negative Prompt')
  })
})
