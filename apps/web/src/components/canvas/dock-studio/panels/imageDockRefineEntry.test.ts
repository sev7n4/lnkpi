import { describe, expect, it } from 'vitest'
import { isImageDockReadonly, shouldShowRefineEntry } from './imageDockRefineEntry'

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

describe('isImageDockReadonly', () => {
  it('is readonly when the parent dock already passed readonly', () => {
    expect(isImageDockReadonly({ parentReadonly: true, generating: false, status: 'completed' })).toBe(
      true,
    )
  })

  it('is readonly while locally generating', () => {
    expect(isImageDockReadonly({ parentReadonly: false, generating: true, status: 'completed' })).toBe(
      true,
    )
    expect(
      isImageDockReadonly({ parentReadonly: false, generating: false, status: 'generating' }),
    ).toBe(true)
  })

  it('is readonly while the node is uploading', () => {
    expect(
      isImageDockReadonly({ parentReadonly: false, generating: false, status: 'uploading' }),
    ).toBe(true)
  })

  it('is editable when idle with a completed image', () => {
    expect(
      isImageDockReadonly({ parentReadonly: false, generating: false, status: 'completed' }),
    ).toBe(false)
  })
})
