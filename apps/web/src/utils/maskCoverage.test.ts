import { describe, expect, it } from 'vitest'
import {
  FULL_MASK_HINT_COVERAGE,
  MIN_MASK_COVERAGE,
  maskCoverageMessage,
  maskCoverageRatio,
} from './maskCoverage'

function luma(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values)
}

describe('mask coverage constants', () => {
  it('uses 0.3% min coverage and 97% full-mask hint', () => {
    expect(MIN_MASK_COVERAGE).toBe(0.003)
    expect(FULL_MASK_HINT_COVERAGE).toBe(0.97)
  })
})

describe('maskCoverageRatio', () => {
  it('counts pixels with value > 127 as selected', () => {
    const data = luma([0, 127, 128, 255])
    expect(maskCoverageRatio(data, 4)).toBe(0.5)
  })

  it('returns 0 when none of 10 pixels are selected', () => {
    const data = luma(Array(10).fill(0))
    expect(maskCoverageRatio(data, 10)).toBe(0)
  })

  it('returns 0.1 when 1 of 10 pixels is selected', () => {
    const data = luma([255, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(maskCoverageRatio(data, 10)).toBe(0.1)
  })

  it('returns 1 when all 10 pixels are selected', () => {
    const data = luma(Array(10).fill(255))
    expect(maskCoverageRatio(data, 10)).toBe(1)
  })

  it('accepts Uint8Array as well as Uint8ClampedArray', () => {
    const data = new Uint8Array([0, 200])
    expect(maskCoverageRatio(data, 2)).toBe(0.5)
  })
})

describe('maskCoverageMessage', () => {
  it('returns empty when 0 of 10 pixels are selected', () => {
    expect(maskCoverageMessage(0)).toBe('empty')
  })

  it('returns ok when 1 of 10 pixels is selected (0.1 > 0.003)', () => {
    expect(maskCoverageMessage(0.1)).toBe('ok')
  })

  it('returns full when all 10 pixels are selected', () => {
    expect(maskCoverageMessage(1)).toBe('full')
  })

  it('treats coverage below MIN_MASK_COVERAGE as empty', () => {
    expect(maskCoverageMessage(0.002)).toBe('empty')
    expect(maskCoverageMessage(MIN_MASK_COVERAGE)).toBe('ok')
  })

  it('treats coverage at FULL_MASK_HINT_COVERAGE as full', () => {
    expect(maskCoverageMessage(0.969)).toBe('ok')
    expect(maskCoverageMessage(FULL_MASK_HINT_COVERAGE)).toBe('full')
  })
})
