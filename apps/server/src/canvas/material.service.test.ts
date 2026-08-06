import 'reflect-metadata'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createImageProvider, createVideoProvider, mergeRefsToPrompt } from '@lnkpi/agent'
import { MaterialService } from './material.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'

function platformResolve(model?: string) {
  const modelName = model?.includes('::') ? model.split('::')[1]! : (model ?? '')
  return {
    channelId: 'platform',
    modelName,
    apiFormat: 'openai' as const,
    credentials: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? '',
    },
    source: 'platform' as const,
  }
}

const imageGenerate = vi.fn(
  async (_prompt: string, _opts?: Record<string, unknown>) => ({ url: 'https://example.com/a.png' }),
)
const videoGenerate = vi.fn(
  async (_prompt: string, _opts?: Record<string, unknown>) => ({ url: 'https://example.com/v.mp4' }),
)
vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    mergeRefsToPrompt: vi.fn(async (input: { localPrompt?: string }) => ({
      mergedText: input.localPrompt ?? 'merged',
      skippedMerge: true,
    })),
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
    createVideoProvider: vi.fn(() => ({ generate: videoGenerate })),
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
        {
          provide: ProviderResolverService,
          useValue: {
            resolveForGeneration: vi.fn(async (_u: string, model?: string) => platformResolve(model)),
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
      modelId: 'doubao-seedream-5-0-pro',
      size: '16:9',
      resolution: '1K',
      n: 1,
      refWire: 'none',
      responseMode: 'async_task',
      pollIntervalMs: 8000,
      maxPollMs: 300000,
      referenceImages: undefined,
      quality: undefined,
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

  it('does not charge when skipCharge is true', async () => {
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'a cat',
      skipCharge: true,
    })
    expect(consume).not.toHaveBeenCalled()
    expect(materialCreate).toHaveBeenCalled()
  })

  it('rejects blob refs before charging', async () => {
    await expect(
      svc.generateImage({
        userId: 'u1',
        shotId: 'shot-1',
        prompt: 'x',
        refs: [{ refKey: 'I1', mediaType: 'image', url: 'blob:http://localhost/x' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(consume).not.toHaveBeenCalled()
    expect(materialCreate).not.toHaveBeenCalled()
  })

  it('passes I* into image adapter and merges T*', async () => {
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'local',
      model: 'seedream-5.0-pro',
      refs: [
        { refKey: 'T1', mediaType: 'text', text: 'style soft' },
        { refKey: 'I1', mediaType: 'image', url: 'https://example.com/a.png' },
      ],
      mentionedKeys: ['T1'],
    })
    await vi.waitFor(() => expect(imageGenerate).toHaveBeenCalled())
    expect(mergeRefsToPrompt).toHaveBeenCalled()
    const [prompt, opts] = imageGenerate.mock.calls[0]
    expect(String(prompt)).toContain('local')
    expect(String(prompt)).toContain('【参考图一致性】')
    expect(String(prompt)).not.toContain('[ref-image:')
    expect(opts).toMatchObject({
      n: 1,
      modelId: 'doubao-seedream-5-0-pro',
      refWire: 'apimart_image_urls',
      responseMode: 'async_task',
      referenceImages: ['https://example.com/a.png'],
    })
  })
})

describe('MaterialService video', () => {
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
        {
          provide: ProviderResolverService,
          useValue: {
            resolveForGeneration: vi.fn(async (_u: string, model?: string) => platformResolve(model)),
          },
        },
      ],
    }).compile()
    svc = moduleRef.get(MaterialService)
  })

  it('passes video adapter options and charges by duration', async () => {
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'seedance-2.0-min',
      duration: 10,
      aspectRatio: '16:9',
      resolution: '720p',
      crop: 'none',
    })
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith('u1', 50, '视频生成')
    expect(videoGenerate).toHaveBeenCalledWith(
      'walk',
      expect.objectContaining({
        model: 'seedance-2.0-min',
        duration: 10,
        aspectRatio: '16:9',
        resolution: '720p',
      }),
    )
  })

  it('rejects foreign shot without charging', async () => {
    shotFindUnique.mockResolvedValueOnce({
      id: 'shot-1',
      sessionId: 'sess-1',
      session: { id: 'sess-1', userId: 'other' },
    })
    await expect(
      svc.generateVideo({ userId: 'u1', shotId: 'shot-1', prompt: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(consume).not.toHaveBeenCalled()
    expect(materialCreate).not.toHaveBeenCalled()
  })

  it('passes I1 as video options.image', async () => {
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'seedance-2.0-min',
      duration: 5,
      refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref.png' }],
    })
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    const [, opts] = videoGenerate.mock.calls[0]
    expect(opts).toMatchObject({ image: 'https://example.com/ref.png' })
  })
})
