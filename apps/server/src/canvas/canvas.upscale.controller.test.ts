import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { CanvasController } from './canvas.controller'

describe('CanvasController material/upscale-image', () => {
  it('calls UpscaleService with session fields and maps provider → providerId', async () => {
    const upscale = vi.fn(async () => ({
      url: 'https://cdn/upscaled.png',
      scale: 2 as const,
      providerId: 'fal',
      recordId: 'rec-1',
    }))
    const controller = new CanvasController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { upscale } as never,
    )

    const result = await controller.upscaleImage(
      { user: { sub: 'user-1' } },
      {
        sessionId: 's1',
        nodeId: 'img-1',
        imageUrl: 'https://cdn/src.png',
        scale: 2,
        provider: 'fal',
      },
    )

    expect(upscale).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 's1',
      nodeId: 'img-1',
      imageUrl: 'https://cdn/src.png',
      scale: 2,
      providerId: 'fal',
    })
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: {
        url: 'https://cdn/upscaled.png',
        scale: 2,
        providerId: 'fal',
        recordId: 'rec-1',
      },
    })
  })
})
