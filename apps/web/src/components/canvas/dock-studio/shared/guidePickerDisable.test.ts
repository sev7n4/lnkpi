import { describe, expect, it } from 'vitest'
import { guidePickerDisabledReason } from './guidePickerDisable'

const capabilities = {
  transparentBackground: false,
  qualityParam: true,
  maxRefImages: 4,
}

describe('guidePickerDisabledReason', () => {
  it('disables transparent generation scenes when unsupported', () => {
    expect(
      guidePickerDisabledReason('generation_scene', 'g4_reusable_logo', capabilities),
    ).toMatch(/透明背景/)
  })

  it('uses the edit intent capability gate for E5', () => {
    expect(
      guidePickerDisabledReason('edit_intent', 'e5_transparent_cutout', capabilities),
    ).toMatch(/透明|transparent/i)
  })
})
