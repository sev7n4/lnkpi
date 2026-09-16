/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { resolveVideoModelCapabilities } from './videoModelCapabilities'
import { SEEDANCE_20_GATEWAYS } from './videoModelProfiles'
import {
  videoAspectRatioOptionsForCapabilities,
  videoResolutionOptionsForCapabilities,
} from './videoSettingsOptions'

describe('videoAspectRatioOptionsForCapabilities', () => {
  it('seedance standard includes 21:9 and adaptive', () => {
    const c = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
    const opts = videoAspectRatioOptionsForCapabilities(c)
    expect(opts.map((o) => o.value)).toContain('21:9')
    expect(opts.map((o) => o.value)).toContain('adaptive')
    expect(opts.find((o) => o.value === '21:9')?.label).toBe('21:9 超宽')
  })

  it('legacy profile keeps base trio only', () => {
    const c = resolveVideoModelCapabilities('kling-v1', 'kling-v1')
    const opts = videoAspectRatioOptionsForCapabilities(c)
    expect(opts.map((o) => o.value)).toEqual(['16:9', '9:16', '1:1'])
  })

  it('agnes includes 4:3 and 3:4 but not adaptive', () => {
    const c = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    const opts = videoAspectRatioOptionsForCapabilities(c)
    expect(opts.map((o) => o.value)).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4'])
  })

  it('agnes 2.5 flash includes 21:9 and only 720p', () => {
    const c = resolveVideoModelCapabilities('agnes-video-2.5-flash', 'agnes-video-2.5-flash')
    expect(videoAspectRatioOptionsForCapabilities(c).map((o) => o.value)).toEqual([
      '16:9',
      '9:16',
      '1:1',
      '4:3',
      '3:4',
      '21:9',
    ])
    expect(videoResolutionOptionsForCapabilities(c).map((o) => o.value)).toEqual(['720p'])
  })
})

describe('videoResolutionOptionsForCapabilities', () => {
  it('seedance standard includes 4k', () => {
    const c = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
    const opts = videoResolutionOptionsForCapabilities(c)
    expect(opts.map((o) => o.value)).toContain('4k')
    expect(opts.find((o) => o.value === '4k')?.label).toBe('4K')
  })

  it('seedance mini excludes 4k and 1080p', () => {
    const c = resolveVideoModelCapabilities('seedance-2.0-mini', SEEDANCE_20_GATEWAYS.mini)
    const opts = videoResolutionOptionsForCapabilities(c)
    expect(opts.map((o) => o.value)).toEqual(['480p', '720p'])
  })

  it('agnes caps at 1080p', () => {
    const c = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    const opts = videoResolutionOptionsForCapabilities(c)
    expect(opts.map((o) => o.value)).toEqual(['480p', '720p', '1080p'])
  })

  it('labels official H3 2k as 2K', () => {
    const opts = videoResolutionOptionsForCapabilities(resolveVideoModelCapabilities('minimax-h3'))
    expect(opts).toEqual(
      expect.arrayContaining([
        { value: '768p', label: '768p' },
        { value: '2k', label: '2K' },
      ]),
    )
  })
})
