import { describe, expect, it } from 'vitest'
import { estimateVideoCredits } from './credits'
import { clampVideoDuration } from '@lnkpi/shared'

describe('estimateVideoCredits tiers', () => {
  it('matches server tiers for intermediate seconds', () => {
    expect(estimateVideoCredits(5)).toBe(30)
    expect(estimateVideoCredits(7)).toBe(30)
    expect(estimateVideoCredits(10)).toBe(50)
    expect(estimateVideoCredits(12)).toBe(50)
    expect(estimateVideoCredits(15)).toBe(70)
  })
})

describe('clampVideoDuration', () => {
  it('clamps and rounds', () => {
    expect(clampVideoDuration(7.4)).toBe(7)
    expect(clampVideoDuration(3)).toBe(5)
    expect(clampVideoDuration(99)).toBe(15)
    expect(clampVideoDuration('x')).toBe(5)
  })
})
