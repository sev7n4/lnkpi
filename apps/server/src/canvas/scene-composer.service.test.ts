import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { SceneComposerService } from './scene-composer.service'
import { MaterialService } from './material.service'
import { ShotService } from './shot.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

describe('SceneComposerService batchGenerate', () => {
  let svc: SceneComposerService
  const consume = vi.fn(async () => {})
  const generateImage = vi.fn(async () => ({ id: 'm-img' }))
  const generateVideo = vi.fn(async () => ({ id: 'm-vid' }))
  const sessionFindFirst = vi.fn(async () => ({
    id: 'sess-1',
    userId: 'u1',
  }))
  const shotFindUnique = vi.fn(async (args: { where: { id: string } }) => {
    if (args.where.id === 'shot-img') {
      return { id: 'shot-img', sessionId: 'sess-1' }
    }
    if (args.where.id === 'shot-vid') {
      return { id: 'shot-vid', sessionId: 'sess-1' }
    }
    return null
  })
  const shotUpdate = vi.fn(async () => ({}))
  const shotCreate = vi.fn(async () => ({}))

  beforeEach(async () => {
    vi.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        SceneComposerService,
        { provide: PointsService, useValue: { consume } },
        {
          provide: MaterialService,
          useValue: { generateImage, generateVideo },
        },
        {
          provide: ShotService,
          useValue: { update: shotUpdate, create: shotCreate, reorder: vi.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            session: { findFirst: sessionFindFirst },
            shot: { findUnique: shotFindUnique },
          },
        },
      ],
    }).compile()
    svc = moduleRef.get(SceneComposerService)
  })

  it('precomputes total cost and consumes once before starting materials', async () => {
    await svc.batchGenerate('u1', {
      sessionId: 'sess-1',
      composerNodeId: 'composer-1',
      items: [
        {
          shotNodeId: 'shot-img',
          prompt: 'a cat',
          mediaType: 'image',
          model: 'seedream-5.0-pro',
          aspectRatio: '16:9',
          resolution: '1K',
        },
        {
          shotNodeId: 'shot-vid',
          prompt: 'walk',
          mediaType: 'video',
          model: 'seedance-2.0-min',
          duration: 10,
          aspectRatio: '16:9',
          resolution: '720p',
          crop: 'none',
        },
      ],
    })

    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith('u1', 60, '导演台批量生成 ×2')
    expect(generateImage).toHaveBeenCalledWith({
      userId: 'u1',
      shotId: 'shot-img',
      prompt: 'a cat',
      model: 'seedream-5.0-pro',
      aspectRatio: '16:9',
      resolution: '1K',
      skipCharge: true,
    })
    expect(generateVideo).toHaveBeenCalledWith({
      userId: 'u1',
      shotId: 'shot-vid',
      prompt: 'walk',
      model: 'seedance-2.0-min',
      duration: 10,
      aspectRatio: '16:9',
      resolution: '720p',
      crop: 'none',
      skipCharge: true,
    })
  })

  it('rejects foreign session with zero side effects', async () => {
    sessionFindFirst.mockResolvedValueOnce(null)

    await expect(
      svc.batchGenerate('u1', {
        sessionId: 'sess-other',
        composerNodeId: 'composer-1',
        items: [
          {
            shotNodeId: 'shot-img',
            prompt: 'a cat',
            mediaType: 'image',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect(consume).not.toHaveBeenCalled()
    expect(generateImage).not.toHaveBeenCalled()
    expect(generateVideo).not.toHaveBeenCalled()
    expect(shotUpdate).not.toHaveBeenCalled()
    expect(shotCreate).not.toHaveBeenCalled()
  })
})
