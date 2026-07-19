import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { resolveImageSize } from '@lnkpi/shared'
import { createImageProvider } from '@lnkpi/agent'
import { MaterialService } from './material.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

const imageGenerate = vi.fn(async () => ({ url: 'https://example.com/a.png' }))
vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
  }
})

describe('MaterialService image', () => {
  let svc: MaterialService
  const consume = vi.fn(async () => {})
  const materialCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'm1',
    ...args.data,
  }))
  const materialUpdate = vi.fn(async () => ({}))
  const shotFindUnique = vi.fn(async () => ({
    id: 'shot-1',
    sessionId: 'sess-1',
    session: { id: 'sess-1', userId: 'u1' },
  }))

  beforeEach(async () => {
    vi.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterialService,
        { provide: PointsService, useValue: { consume } },
        {
          provide: PrismaService,
          useValue: {
            shot: { findUnique: shotFindUnique },
            material: { create: materialCreate, update: materialUpdate },
          },
        },
      ],
    }).compile()
    svc = moduleRef.get(MaterialService)
  })

  it('passes adapter modelId/size/n=1 and charges 10', async () => {
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'a cat',
      model: 'seedream-5.0-pro',
      aspectRatio: '16:9',
      resolution: '1K',
      count: 3,
    })
    await vi.waitFor(() => expect(imageGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith('u1', 10, '图像生成')
    expect(imageGenerate).toHaveBeenCalledWith('a cat', {
      modelId: 'seedream-5.0-pro',
      size: resolveImageSize('16:9', '1K'),
      n: 1,
    })
  })

  it('rejects foreign shot without charging', async () => {
    shotFindUnique.mockResolvedValueOnce({
      id: 'shot-1',
      sessionId: 'sess-1',
      session: { id: 'sess-1', userId: 'other' },
    })
    await expect(
      svc.generateImage({ userId: 'u1', shotId: 'shot-1', prompt: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(consume).not.toHaveBeenCalled()
    expect(materialCreate).not.toHaveBeenCalled()
  })
})
