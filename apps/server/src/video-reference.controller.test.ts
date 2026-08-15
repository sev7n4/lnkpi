import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { CanvasController } from './canvas/canvas.controller'
import { StudioController } from './studio/studio.controller'

describe('video generate controllers', () => {
  it('passes referenceImageUrl from the Studio DTO to StudioService', async () => {
    const generateVideo = vi.fn(async () => ({ id: 'generation-1' }))
    const controller = new StudioController({ generateVideo } as never)

    await controller.generateVideo(
      { user: { sub: 'user-1' } },
      {
        prompt: 'walk',
        referenceImageUrl: 'https://example.com/node-ref.png',
      } as never,
    )

    expect(generateVideo).toHaveBeenCalledWith(
      'user-1',
      'walk',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'https://example.com/node-ref.png',
      { sessionId: undefined, nodeId: undefined },
      undefined,
      undefined,
      undefined,
      undefined,
    )
  })

  it('passes referenceImageUrl from the Canvas DTO to MaterialService', async () => {
    const generateVideo = vi.fn(async () => ({ id: 'material-1' }))
    const controller = new CanvasController(
      {} as never,
      {} as never,
      { generateVideo } as never,
      {} as never,
      {} as never,
    )

    await controller.generateVideo(
      { user: { sub: 'user-1' } },
      {
        shotId: 'shot-1',
        prompt: 'walk',
        referenceImageUrl: 'https://example.com/node-ref.png',
      } as never,
    )

    expect(generateVideo).toHaveBeenCalledWith({
      userId: 'user-1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: undefined,
      duration: undefined,
      aspectRatio: undefined,
      resolution: undefined,
      crop: undefined,
      refs: undefined,
      mentionedKeys: undefined,
      referenceImageUrl: 'https://example.com/node-ref.png',
    })
  })
})
