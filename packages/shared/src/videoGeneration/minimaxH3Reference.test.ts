/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { assertMiniMaxH3ReferenceLimits } from './minimaxH3Reference'

describe('assertMiniMaxH3ReferenceLimits', () => {
  it('accepts 1 video + 2 images', () => {
    expect(() =>
      assertMiniMaxH3ReferenceLimits({
        imageCount: 2,
        videoCount: 1,
        audioCount: 0,
        promptLength: 10,
      }),
    ).not.toThrow()
  })

  it('rejects over image/video/audio/file/prompt limits and zero files', () => {
    expect(() =>
      assertMiniMaxH3ReferenceLimits({ imageCount: 10, videoCount: 0, audioCount: 0, promptLength: 1 }),
    ).toThrow(/9/)
    expect(() =>
      assertMiniMaxH3ReferenceLimits({ imageCount: 0, videoCount: 4, audioCount: 0, promptLength: 1 }),
    ).toThrow(/3/)
    expect(() =>
      assertMiniMaxH3ReferenceLimits({ imageCount: 9, videoCount: 3, audioCount: 1, promptLength: 1 }),
    ).toThrow(/12/)
    expect(() =>
      assertMiniMaxH3ReferenceLimits({ imageCount: 0, videoCount: 0, audioCount: 0, promptLength: 1 }),
    ).toThrow(/至少/)
    expect(() =>
      assertMiniMaxH3ReferenceLimits({
        imageCount: 1,
        videoCount: 0,
        audioCount: 0,
        promptLength: 7001,
      }),
    ).toThrow(/7000/)
  })
})
