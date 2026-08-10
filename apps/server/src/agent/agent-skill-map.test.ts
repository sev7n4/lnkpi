import { describe, expect, it } from 'vitest'
import { mapUiSkillId } from './agent-skill-map'

describe('mapUiSkillId', () => {
  it('returns undefined for missing input', () => {
    expect(mapUiSkillId()).toBeUndefined()
    expect(mapUiSkillId('')).toBeUndefined()
  })

  it('maps canvas to enterprise-marketing-campaign', () => {
    expect(mapUiSkillId('canvas')).toBe('enterprise-marketing-campaign')
  })

  it('maps product-visual to ecommerce-product-visual', () => {
    expect(mapUiSkillId('product-visual')).toBe('ecommerce-product-visual')
    expect(mapUiSkillId('ecommerce-product-visual')).toBe('ecommerce-product-visual')
  })

  it('returns undefined for unmapped dock skills', () => {
    expect(mapUiSkillId('storyboard')).toBeUndefined()
    expect(mapUiSkillId('polish')).toBeUndefined()
    expect(mapUiSkillId('organize')).toBeUndefined()
  })

  it('returns undefined for unknown skill ids', () => {
    expect(mapUiSkillId('unknown-skill')).toBeUndefined()
  })
})
