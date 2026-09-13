import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useImageUpscale } from './useImageUpscale'

vi.mock('@/services/canvas-api', () => ({
  canvasApi: {
    upscaleImage: vi.fn(),
  },
}))

import { canvasApi } from '@/services/canvas-api'

describe('useImageUpscale', () => {
  beforeEach(() => {
    vi.mocked(canvasApi.upscaleImage).mockReset()
  })

  it('POSTs upscale-image and toggles loading around the request', async () => {
    let resolveRequest!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(canvasApi.upscaleImage).mockReturnValue(pending as never)

    const onSuccess = vi.fn()
    const { loading, error, runUpscale } = useImageUpscale()

    expect(loading.value).toBe(false)

    const runPromise = runUpscale({
      sessionId: 's1',
      nodeId: 'img-1',
      imageUrl: 'https://cdn/src.png',
      onSuccess,
    })

    expect(loading.value).toBe(true)
    expect(canvasApi.upscaleImage).toHaveBeenCalledWith({
      sessionId: 's1',
      nodeId: 'img-1',
      imageUrl: 'https://cdn/src.png',
      scale: 2,
    })

    resolveRequest({
      data: {
        data: {
          url: 'https://cdn/up.png',
          scale: 2,
          providerId: 'fal',
        },
      },
    })
    const result = await runPromise

    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result).toEqual({
      url: 'https://cdn/up.png',
      scale: 2,
      providerId: 'fal',
    })
    expect(onSuccess).toHaveBeenCalledWith({ url: 'https://cdn/up.png' })
  })

  it('sets error and clears loading when API fails', async () => {
    vi.mocked(canvasApi.upscaleImage).mockRejectedValue({
      response: { data: { message: '积分不足' } },
    })

    const { loading, error, runUpscale } = useImageUpscale()

    await expect(
      runUpscale({
        sessionId: 's1',
        nodeId: 'img-1',
        imageUrl: 'https://cdn/src.png',
      }),
    ).rejects.toBeTruthy()

    expect(loading.value).toBe(false)
    expect(error.value).toBe('积分不足')
  })
})
