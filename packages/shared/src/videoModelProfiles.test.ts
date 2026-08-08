import { describe, expect, it } from 'vitest'
import {
  clampVideoGenerationInput,
  isSeedance1x,
  resolveSeedance20Gateway,
  resolveVideoGatewayModelId,
  resolveVideoModelProfile,
} from './videoModelProfiles'

describe('resolveVideoModelProfile', () => {
  it('maps seedance-2.0-min to doubao-seedance-2.0-mini async multimodal', () => {
    const p = resolveVideoModelProfile('seedance-2.0-min', 'seedance-2.0-min')
    expect(p.gatewayModelId).toBe('doubao-seedance-2.0-mini')
    expect(p.responseMode).toBe('async_task')
    expect(p.maxImageRefs).toBe(9)
    expect(p.maxVideoRefs).toBe(3)
    expect(p.maxAudioRefs).toBe(3)
    expect(p.variantTag).toBe('mini')
  })

  it('maps agnes-video to agnes_poll pixel_frames', () => {
    const p = resolveVideoModelProfile('agnes-video-v2.0', 'agnes-video-v2.0')
    expect(p.responseMode).toBe('agnes_poll')
    expect(p.sizeWire).toBe('pixel_frames')
    expect(p.maxImageRefs).toBe(8)
  })
})

describe('clampVideoGenerationInput', () => {
  it('downgrades seedance mini 1080p to 720p', () => {
    const profile = resolveVideoModelProfile('seedance-2.0-min', 'doubao-seedance-2.0-mini')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('720p')
    expect(r.droppedFields.some((d) => d.field === 'resolution')).toBe(true)
  })

  it('keeps seedance standard 1080p without downgrade', () => {
    const profile = resolveVideoModelProfile('seedance-2.0', 'doubao-seedance-2.0')
    expect(profile.variantTag).toBe('standard')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('1080p')
    expect(r.droppedFields.some((d) => d.field === 'resolution')).toBe(false)
  })

  it('downgrades seedance fast 1080p to 720p with droppedFields', () => {
    const profile = resolveVideoModelProfile('seedance-2.0-fast', 'doubao-seedance-2.0-fast')
    expect(profile.variantTag).toBe('fast')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('720p')
    expect(r.droppedFields).toEqual([
      { field: 'resolution', reason: '1080p not on fast; use 720p' },
    ])
  })

  it('keeps seedance face 1080p without downgrade', () => {
    const profile = resolveVideoModelProfile('seedance-2.0-face', 'doubao-seedance-2.0-face')
    expect(profile.variantTag).toBe('face')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('1080p')
    expect(r.droppedFields.some((d) => d.field === 'resolution')).toBe(false)
  })
})

describe('resolveVideoGatewayModelId', () => {
  it('rewrites seedance catalog id', () => {
    expect(resolveVideoGatewayModelId('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })
})

describe('resolveSeedance20Gateway', () => {
  it('maps catalog modelKey seedance-2.0-min to mini gateway', () => {
    expect(resolveSeedance20Gateway('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })

  it('maps BYOK gateway id doubao-seedance-2.0-fast without catalog entry', () => {
    expect(resolveSeedance20Gateway('doubao-seedance-2.0-fast', 'doubao-seedance-2.0-fast')).toBe(
      'doubao-seedance-2.0-fast',
    )
  })

  it('returns null for non-seedance models', () => {
    expect(resolveSeedance20Gateway('agnes-video-v2.0', 'agnes-video-v2.0')).toBeNull()
  })
})

describe('isSeedance1x', () => {
  it('detects legacy 1.0 gateway ids', () => {
    expect(isSeedance1x('doubao-seedance-1-0-lite-i2v-250428')).toBe(true)
    expect(isSeedance1x('doubao-seedance-2.0-fast')).toBe(false)
  })
})

describe('resolveVideoGatewayModelId (extended)', () => {
  it('preserves fast gateway instead of rewriting to mini', () => {
    expect(
      resolveVideoGatewayModelId('seedance-2.0-fast', 'doubao-seedance-2.0-fast'),
    ).toBe('doubao-seedance-2.0-fast')
  })

  it('still maps seedance-2.0-min catalog key to mini', () => {
    expect(resolveVideoGatewayModelId('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })
})

describe('resolveVideoModelProfile BYOK fast hint', () => {
  it('uses apimart_multimodal for BYOK fast gateway hint', () => {
    const p = resolveVideoModelProfile(
      'doubao-seedance-2.0-fast',
      'doubao-seedance-2.0-fast',
      { channelBaseUrl: 'https://api.apimart.ai/v1' },
    )
    expect(p.refWire).toBe('apimart_multimodal')
    expect(p.gatewayModelId).toBe('doubao-seedance-2.0-fast')
    expect(p.variantTag).toBe('fast')
  })
})
