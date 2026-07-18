import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgnesVideoProvider, resolveVideoParams } from './video-provider'

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

describe('AgnesVideoProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes image in create body but not crop', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ video_id: 'vid-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', url: 'https://example.com/video.mp4' }),
      })

    const provider = new AgnesVideoProvider('test-key')
    await provider.generate('animate this', {
      model: 'agnes-video-v2.0',
      image: 'https://example.com/ref.png',
      crop: 'center',
    })

    const createCall = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(createCall[1].body)) as Record<string, unknown>
    expect(body.image).toBe('https://example.com/ref.png')
    expect(body).not.toHaveProperty('crop')
    expect(body.model).toBe('agnes-video-v2.0')
  })
})
