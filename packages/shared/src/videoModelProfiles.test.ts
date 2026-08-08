import { describe, expect, it } from 'vitest'
import { clampVideoGenerationInput, resolveVideoGatewayModelId, resolveVideoModelProfile } from './videoModelProfiles'

describe('resolveVideoModelProfile', () => {
  it('maps seedance-2.0-min to doubao-seedance-2.0-mini async multimodal', () => {
    const p = resolveVideoModelProfile('seedance-2.0-min', 'seedance-2.0-min')
    expect(p.gatewayModelId).toBe('doubao-seedance-2.0-mini')
    expect(p.responseMode).toBe('async_task')
    expect(p.maxImageRefs).toBe(9)
    expect(p.maxVideoRefs).toBe(3)
    expect(p.maxAudioRefs).toBe(3)
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
})

describe('resolveVideoGatewayModelId', () => {
  it('rewrites seedance catalog id', () => {
    expect(resolveVideoGatewayModelId('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })
})
