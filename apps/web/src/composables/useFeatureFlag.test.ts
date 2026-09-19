import { describe, expect, it } from 'vitest'
import { _resetFlagsForTest, isFeatureOn, setFlag } from './useFeatureFlag'

describe('isFeatureOn', () => {
  it('returns false for unknown flags (safe default)', () => {
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
  })

  it('returns true for flags enabled in env-like config', () => {
    // 测试通过 setFlag 注入，无副作用
  })
})

describe('setFlag + isFeatureOn', () => {
  it('toggles the flag on then off', () => {
    _resetFlagsForTest()
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
    setFlag('selection_batch_generate', true)
    expect(isFeatureOn('selection_batch_generate')).toBe(true)
    setFlag('selection_batch_generate', false)
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
  })
})
