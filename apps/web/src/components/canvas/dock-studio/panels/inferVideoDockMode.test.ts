import { describe, expect, it } from 'vitest'
import { inferVideoDockMode } from './inferVideoDockMode'

const base = {
  current: 'text_to_video' as const,
  imageCount: 0,
  hasFallbackImage: false,
  hasVideoOrAudioRef: false,
  supportsFirstLastFrame: false,
  supportsReferenceToVideo: false,
}

describe('inferVideoDockMode', () => {
  it('uses text_to_video when there are no images', () => {
    expect(inferVideoDockMode(base)).toBe('text_to_video')
  })

  it('uses image_to_video when chips or fallback image exist', () => {
    expect(inferVideoDockMode({ ...base, imageCount: 1 })).toBe('image_to_video')
    expect(inferVideoDockMode({ ...base, hasFallbackImage: true })).toBe('image_to_video')
  })

  it('does not auto-enter first_last_frame for two images', () => {
    expect(
      inferVideoDockMode({
        ...base,
        current: 'image_to_video',
        imageCount: 2,
        supportsFirstLastFrame: true,
      }),
    ).toBe('image_to_video')
  })

  it('keeps first_last_frame only with exactly two images', () => {
    expect(
      inferVideoDockMode({
        ...base,
        current: 'first_last_frame',
        imageCount: 2,
        supportsFirstLastFrame: true,
      }),
    ).toBe('first_last_frame')
    expect(
      inferVideoDockMode({
        ...base,
        current: 'first_last_frame',
        imageCount: 1,
        supportsFirstLastFrame: true,
      }),
    ).toBe('image_to_video')
  })

  it('auto-selects reference_to_video when H3 has video or audio refs', () => {
    expect(
      inferVideoDockMode({
        ...base,
        supportsReferenceToVideo: true,
        hasVideoOrAudioRef: true,
        imageCount: 1,
      }),
    ).toBe('reference_to_video')
  })

  it('keeps H3 reference_to_video for image-only refs', () => {
    expect(
      inferVideoDockMode({
        ...base,
        current: 'reference_to_video',
        supportsReferenceToVideo: true,
        imageCount: 2,
      }),
    ).toBe('reference_to_video')
  })

  it('does not use reference_to_video on Seedance', () => {
    expect(
      inferVideoDockMode({
        ...base,
        current: 'image_to_video',
        imageCount: 1,
        hasVideoOrAudioRef: true,
        supportsFirstLastFrame: true,
        supportsReferenceToVideo: false,
      }),
    ).toBe('image_to_video')
  })
})
