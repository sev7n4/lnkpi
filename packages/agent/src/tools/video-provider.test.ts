import { describe, expect, it } from 'vitest'
import { resolveVideoParams } from './video-provider'

describe('resolveVideoParams', () => {
  it('maps duration to 8n+1 frames at 24fps', () => {
    const five = resolveVideoParams(5, '16:9')
    expect(five.num_frames).toBe(121)
    expect(five.frame_rate).toBe(24)
  })

  it('caps frames at 441', () => {
    const long = resolveVideoParams(60, '16:9')
    expect(long.num_frames).toBe(441)
  })

  it('maps aspect ratios at 720p', () => {
    expect(resolveVideoParams(5, '9:16', '720p')).toEqual(
      expect.objectContaining({ width: 720, height: 1280 }),
    )
    expect(resolveVideoParams(5, '1:1', '720p')).toEqual(
      expect.objectContaining({ width: 720, height: 720 }),
    )
    expect(resolveVideoParams(5, '16:9', '720p')).toEqual(
      expect.objectContaining({ width: 1280, height: 720 }),
    )
  })

  it('maps 1080p long edge', () => {
    expect(resolveVideoParams(5, '16:9', '1080p')).toEqual(
      expect.objectContaining({ width: 1920, height: 1080 }),
    )
  })
})
