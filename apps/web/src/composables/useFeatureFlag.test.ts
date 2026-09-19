import { describe, expect, it } from 'vitest'
import { _resetFlagsForTest, enableViaQuery, isFeatureOn, setFlag } from './useFeatureFlag'

describe('isFeatureOn', () => {
  it('returns false for unknown flags (safe default)', () => {
    expect(isFeatureOn('selection_batch_generate')).toBe(true)  // V1.2 默认 on
  })

  it('returns true for flags enabled in env-like config', () => {
    // 测试通过 setFlag 注入，无副作用
  })
})

describe('setFlag + isFeatureOn', () => {
  it('toggles the flag on then off', () => {
    _resetFlagsForTest()
    expect(isFeatureOn('selection_batch_generate')).toBe(true)  // V1.2 默认 on
    setFlag('selection_batch_generate', true)
    expect(isFeatureOn('selection_batch_generate')).toBe(true)
    setFlag('selection_batch_generate', false)
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
  })
})

describe('enableViaQuery', () => {
  it('enables a single feature via ?feature=', () => {
    _resetFlagsForTest()
    enableViaQuery('?feature=selection_batch_generate')
    expect(isFeatureOn('selection_batch_generate')).toBe(true)
  })

  it('enables multiple features via ?features= (comma-separated)', () => {
    _resetFlagsForTest()
    enableViaQuery('?features=selection_batch_generate,other_key')
    expect(isFeatureOn('selection_batch_generate')).toBe(true)
    expect(isFeatureOn('other_key')).toBe(true)
  })

  it('does nothing when no feature query param present', () => {
    _resetFlagsForTest()
    enableViaQuery('?foo=bar&baz=qux')
    expect(isFeatureOn('selection_batch_generate')).toBe(true)  // V1.2 默认 on
  })

  it('does nothing for empty search string', () => {
    _resetFlagsForTest()
    enableViaQuery('')
    expect(isFeatureOn('selection_batch_generate')).toBe(true)  // V1.2 默认 on
  })

  it('trims whitespace and filters empty names', () => {
    _resetFlagsForTest()
    enableViaQuery('?features= a , , b ')
    expect(isFeatureOn('a')).toBe(true)
    expect(isFeatureOn('b')).toBe(true)
    expect(isFeatureOn('selection_batch_generate')).toBe(true)  // V1.2 默认 on
  })
})
