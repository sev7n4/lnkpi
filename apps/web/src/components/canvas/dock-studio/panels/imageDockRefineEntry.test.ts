import { describe, expect, it } from 'vitest'
import { shouldShowRefineEntry } from './imageDockRefineEntry'

describe('shouldShowRefineEntry', () => {
  it('shows when url exists, enabled, and not readonly', () => {
    expect(
      shouldShowRefineEntry({
        url: 'https://cdn.example.com/a.png',
        readonly: false,
        enabled: true,
      }),
    ).toBe(true)
  })

  it('hides while generating (readonly)', () => {
    expect(
      shouldShowRefineEntry({
        url: 'https://cdn.example.com/a.png',
        readonly: true,
        enabled: true,
      }),
    ).toBe(false)
  })

  it('does not render without a url', () => {
    expect(
      shouldShowRefineEntry({
        url: '',
        readonly: false,
        enabled: true,
      }),
    ).toBe(false)
    expect(
      shouldShowRefineEntry({
        url: '   ',
        readonly: false,
        enabled: true,
      }),
    ).toBe(false)
    expect(
      shouldShowRefineEntry({
        readonly: false,
        enabled: true,
      }),
    ).toBe(false)
  })

  it('hides when the feature flag is off', () => {
    expect(
      shouldShowRefineEntry({
        url: 'https://cdn.example.com/a.png',
        readonly: false,
        enabled: false,
      }),
    ).toBe(false)
  })
})
