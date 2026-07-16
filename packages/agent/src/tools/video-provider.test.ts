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

  it('maps aspect ratios', () => {
    expect(resolveVideoParams(5, '9:16')).toEqual(expect.objectContaining({ width: 768, height: 1152 }))
    expect(resolveVideoParams(5, '1:1')).toEqual(expect.objectContaining({ width: 768, height: 768 }))
  })
})
