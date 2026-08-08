import { describe, expect, it } from 'vitest'
import { buildVideoReferenceBundle, inferVideoScenario } from './video-refs'

describe('buildVideoReferenceBundle', () => {
  it('merges referenceImageUrl as I1 when refs empty', () => {
    const b = buildVideoReferenceBundle([], 'https://cdn/a.png')
    expect(b.images).toEqual([{ refKey: 'I1', url: 'https://cdn/a.png', label: '参考图' }])
    expect(inferVideoScenario(b, 'image_to_video')).toBe('S2')
  })

  it('detects S6 when video refs present', () => {
    const b = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/i.png' },
      { refKey: 'V1', mediaType: 'video', url: 'https://cdn/v.mp4' },
    ])
    expect(inferVideoScenario(b)).toBe('S6')
  })

  it('detects S5 first_last with two images and mode', () => {
    const b = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/1.png' },
      { refKey: 'I2', mediaType: 'image', url: 'https://cdn/2.png' },
    ])
    expect(inferVideoScenario(b, 'first_last_frame')).toBe('S5')
  })
})
