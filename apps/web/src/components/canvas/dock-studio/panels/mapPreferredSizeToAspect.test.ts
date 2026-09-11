import { describe, expect, it } from 'vitest'
import { mapPreferredSizeToAspect } from './mapPreferredSizeToAspect'

describe('mapPreferredSizeToAspect', () => {
  it('maps 1024x1536 to 2:3', () => {
    expect(mapPreferredSizeToAspect('1024x1536')).toBe('2:3')
  })

  it('maps 1536x1024 to 3:2', () => {
    expect(mapPreferredSizeToAspect('1536x1024')).toBe('3:2')
  })

  it('returns null for unknown / ambiguous sizes', () => {
    expect(mapPreferredSizeToAspect('1000x700')).toBeNull()
    expect(mapPreferredSizeToAspect(undefined)).toBeNull()
    expect(mapPreferredSizeToAspect('')).toBeNull()
  })
})
