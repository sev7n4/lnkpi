import { describe, it, expect } from 'vitest'
import { CHARACTER_TURNAROUND_EXAMPLES } from './character-turnaround-presets'
import { characterTurnaroundMode } from './character-turnaround'
import { shouldApplyDeai } from './character-turnaround-deai'

describe('character-turnaround-deai', () => {
  it('does not inject de-AI rules into the turnaround system', () => {
    expect(characterTurnaroundMode.system).not.toContain('去AI化')
    expect(characterTurnaroundMode.system).not.toContain('Negative Prompt')
    expect(characterTurnaroundMode.system).not.toContain('85mm')
    expect(characterTurnaroundMode.system).toContain('禁止浅景深')
    expect(characterTurnaroundMode.system).toContain('90度侧面')
  })

  it('photoreal few-shot is a character sheet, not a de-AI portrait', () => {
    const example = CHARACTER_TURNAROUND_EXAMPLES.find(
      (e) => e.presetId === 'photoreal_commercial',
    )!
    expect(example.assistant).toContain('四格布局')
    expect(example.assistant).toContain('90度侧面')
    expect(example.assistant).not.toContain('Negative Prompt')
    expect(example.assistant).not.toContain('85mm')
    expect(example.assistant).not.toContain('约45度')
  })

  it('shouldApplyDeai remains photoreal-only if the helper is kept', () => {
    expect(shouldApplyDeai('photoreal_commercial')).toBe(true)
    expect(shouldApplyDeai('fashion_editorial')).toBe(false)
  })
})
