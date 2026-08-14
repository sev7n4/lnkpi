import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import type { CanonicalVideoGenerationRequest } from '@lnkpi/shared'
import { StudioService } from './studio.service'
import { VideoGenerationOrchestrator } from './video-generation.orchestrator'

const canonicalRequest = (): CanonicalVideoGenerationRequest => ({
  prompt: '产品展示视频',
  refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://cdn.example/ref.png', label: '图' }],
  videoSettings: {
    duration: 15,
    aspectRatio: '16:9',
    resolution: '720p',
    crop: 'none',
  },
  videoMode: 'image_to_video',
  model: 'platform::video',
  scope: { sessionId: 's1', nodeId: 'v1' },
})

describe('VideoGenerationOrchestrator', () => {
  let orchestrator: VideoGenerationOrchestrator
  const generateVideo = vi.fn()
  const getGeneration = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    generateVideo.mockResolvedValue({ id: 'rec-1', status: 'generating' })
    getGeneration.mockResolvedValue({
      id: 'rec-1',
      status: 'completed',
      url: 'https://cdn.example/out.mp4',
    })

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoGenerationOrchestrator,
        {
          provide: StudioService,
          useValue: { generateVideo, getGeneration },
        },
      ],
    }).compile()

    orchestrator = moduleRef.get(VideoGenerationOrchestrator)
  })

  it('start persists generating + startedAt then returns recordId', async () => {
    const persist = vi.fn()
    const result = await orchestrator.start('u1', canonicalRequest(), persist)

    expect(result.generationRecordId).toBe('rec-1')
    expect(result.status).toBe('generating')
    expect(result.generationStartedAt).toMatch(/^\d{4}-/)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[0][0][0]).toMatchObject({
      type: 'update_node',
      payload: {
        id: 'v1',
        data: expect.objectContaining({ status: 'generating', generationStartedAt: result.generationStartedAt }),
      },
    })
    expect(generateVideo).toHaveBeenCalledWith(
      'u1',
      '产品展示视频',
      'platform::video',
      15,
      '16:9',
      expect.any(Array),
      undefined,
      '720p',
      'none',
      undefined,
      { sessionId: 's1', nodeId: 'v1' },
      'image_to_video',
      undefined,
    )
  })

  it('start rejects empty prompt', async () => {
    await expect(
      orchestrator.start(
        'u1',
        { ...canonicalRequest(), prompt: '  ' },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('wait returns completed url', async () => {
    const persist = vi.fn()
    const result = await orchestrator.wait(
      'u1',
      { sessionId: 's1', nodeId: 'v1', generationRecordId: 'rec-1' },
      persist,
    )
    expect(result.status).toBe('completed')
    expect(result.url).toBe('https://cdn.example/out.mp4')
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
