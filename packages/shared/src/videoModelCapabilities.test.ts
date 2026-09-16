/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { resolveVideoModelCapabilities } from './videoModelCapabilities'
import { SEEDANCE_20_GATEWAYS } from './videoModelProfiles'

describe('resolveVideoModelCapabilities', () => {
  it('agnes-video: keyframes yes, firstLast strict no, no V/A/audio', () => {
    const c = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    expect(c.supportsKeyframes).toBe(true)
    expect(c.supportsFirstLastFrame).toBe(false)
    expect(c.supportsVideoRef).toBe(false)
    expect(c.supportsAudioRef).toBe(false)
    expect(c.supportsGenerateAudio).toBe(false)
    expect(c.firstLastFrameLabel).toBe('关键帧过渡')
  })

  it('agnes-video-2.5-flash: 4–12s, 720p only, keyframes yes, no V/A', () => {
    const c = resolveVideoModelCapabilities('agnes-video-2.5-flash', 'agnes-video-2.5-flash')
    expect(c.supportsKeyframes).toBe(true)
    expect(c.supportsFirstLastFrame).toBe(false)
    expect(c.supportsVideoRef).toBe(false)
    expect(c.supportsAudioRef).toBe(false)
    expect(c.minDuration).toBe(4)
    expect(c.maxDuration).toBe(12)
    expect(c.maxImageRefs).toBe(5)
    expect(c.allowedResolutions).toEqual(['720p'])
    expect(c.allowedAspectRatios).toContain('21:9')
  })

  it('seedance standard: firstLast, V/A, audio, 4K', () => {
    const c = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
    expect(c.supportsFirstLastFrame).toBe(true)
    expect(c.supportsVideoRef).toBe(true)
    expect(c.supportsGenerateAudio).toBe(true)
    expect(c.allowedResolutions).toContain('4k')
    expect(c.firstLastFrameLabel).toBe('严格首尾帧')
  })

  it('official H3 P1 exposes reference-to-video and Seedance does not', () => {
    const h3 = resolveVideoModelCapabilities('minimax-h3')
    expect(h3.supportsVideoRef).toBe(true)
    expect(h3.supportsAudioRef).toBe(true)
    expect(h3.supportsReferenceToVideo).toBe(true)
    expect(h3.maxImageRefs).toBe(9)
    expect(h3.maxVideoRefs).toBe(3)
    expect(h3.maxAudioRefs).toBe(3)

    const seedance = resolveVideoModelCapabilities('seedance-2.0-min')
    expect(seedance.supportsVideoRef).toBe(true)
    expect(seedance.supportsReferenceToVideo).toBe(false)

    const fal = resolveVideoModelCapabilities('h3-max-turbo')
    expect(fal.supportsReferenceToVideo).toBe(false)
    expect(fal.supportsVideoRef).toBe(false)
  })

  it('capabilities hide video/audio refs for fal h3 max', () => {
    const c = resolveVideoModelCapabilities('h3-max-turbo')
    expect(c.supportsVideoRef).toBe(false)
    expect(c.supportsAudioRef).toBe(false)
    expect(c.supportsFirstLastFrame).toBe(true)
    expect(c.supportsKeyframes).toBe(false)
    expect(c.supportsGenerateAudio).toBe(true)
    expect(c.supports4K).toBe(false)
    expect(c.allowedResolutions).toEqual(['480p', '768p'])
    expect(c.minDuration).toBe(5)
    expect(c.firstLastFrameLabel).toBe('严格首尾帧')
    expect(c.keyframesLabel).not.toBe('关键帧过渡')
  })
})
