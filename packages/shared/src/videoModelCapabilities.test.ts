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

  it('seedance standard: firstLast, V/A, audio, 4K', () => {
    const c = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
    expect(c.supportsFirstLastFrame).toBe(true)
    expect(c.supportsVideoRef).toBe(true)
    expect(c.supportsGenerateAudio).toBe(true)
    expect(c.allowedResolutions).toContain('4k')
    expect(c.firstLastFrameLabel).toBe('严格首尾帧')
  })
})
