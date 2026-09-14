import 'reflect-metadata'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createImageProvider, createVideoProvider, FAL_H3_MAX_ENDPOINTS, mergeRefsToPrompt } from '@lnkpi/agent'
import { MaterialService } from './material.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { MediaProbeService } from '../media/media-probe.service'

const mediaProbeMock = {
  probeUrl: vi.fn(async (url: string) => ({
    url,
    width: 1024,
    height: 768,
    bytes: 500_000,
    mimeType: 'image/png',
    probeStatus: 'ok' as const,
  })),
}

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
        {
          provide: MediaProbeService,
          useValue: mediaProbeMock,
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
    expect(consume).toHaveBeenCalledWith('u1', 10, '图像生成', {
      kind: 'consume',
      category: 'image',
      status: 'success',
      model: 'seedream-5.0-pro',
      generationId: null,
    })
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
        {
          provide: MediaProbeService,
          useValue: mediaProbeMock,
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
    expect(consume).toHaveBeenCalledWith('u1', 50, '视频生成', {
      kind: 'consume',
      category: 'video',
      status: 'success',
      model: 'seedance-2.0-min',
      generationId: null,
    })
    expect(videoGenerate).toHaveBeenCalledWith(
      'walk',
      expect.objectContaining({
        model: 'doubao-seedance-2.0-mini',
        duration: 10,
        aspectRatio: '16:9',
        resolution: '720p',
      }),
    )
    expect(createVideoProvider).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'seedance-2.0-min' }),
    )
    const createdMeta = JSON.parse(String(materialCreate.mock.calls[0][0].data.metadata))
    expect(createdMeta.providerId).not.toBe('fal')
  })

  it('charges H3 Max by resolution factor and records fal metadata', async () => {
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'h3-max-turbo',
      duration: 5,
      resolution: '768p',
      refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://cdn/first.png' }],
    })
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith('u1', 36, '视频生成', {
      kind: 'consume',
      category: 'video',
      status: 'success',
      model: 'h3-max-turbo',
      generationId: null,
    })
    expect(createVideoProvider).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'h3-max-turbo' }),
    )
    expect(videoGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        image: 'https://cdn/first.png',
        referenceImages: ['https://cdn/first.png'],
      }),
    )
    const createdMeta = JSON.parse(String(materialCreate.mock.calls[0][0].data.metadata))
    expect(createdMeta).toMatchObject({
      providerId: 'fal',
      credentialSource: 'platform',
      falEndpoint: FAL_H3_MAX_ENDPOINTS['h3-max-turbo'].i2v,
    })
  })

  it('charges official H3 by resolution factor and records minimax metadata', async () => {
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'minimax-h3',
      duration: 5,
      resolution: '768p',
      refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://cdn/first.png' }],
    })
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith('u1', 36, '视频生成', {
      kind: 'consume',
      category: 'video',
      status: 'success',
      model: 'minimax-h3',
      generationId: null,
    })
    expect(createVideoProvider).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'minimax-h3' }),
    )
    const createdMeta = JSON.parse(String(materialCreate.mock.calls[0][0].data.metadata))
    expect(createdMeta).toMatchObject({
      providerId: 'minimax',
      credentialSource: 'platform',
      minimaxModel: 'MiniMax-H3',
    })
    expect(createdMeta.falEndpoint).toBeUndefined()
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

  it('passes the full video reference bundle and image descriptors', async () => {
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'seedance-2.0-min',
      duration: 5,
      refs: [
        {
          refKey: 'I1',
          mediaType: 'image',
          label: '人物',
          url: 'https://example.com/ref.png',
        },
        { refKey: 'V1', mediaType: 'video', url: 'https://example.com/ref.mp4' },
        { refKey: 'A1', mediaType: 'audio', url: 'https://example.com/ref.mp3' },
      ],
    })
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    const [effectivePrompt, opts] = videoGenerate.mock.calls[0]
    expect(effectivePrompt).toContain('@Image1')
    expect(effectivePrompt).toContain('@Video1')
    expect(effectivePrompt).toContain('@Audio1')
    expect(opts).toMatchObject({
      model: 'doubao-seedance-2.0-mini',
      referenceImages: ['https://example.com/ref.png'],
      referenceVideos: ['https://example.com/ref.mp4'],
      referenceAudios: ['https://example.com/ref.mp3'],
    })
    expect(mergeRefsToPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        downstreamType: 'video',
        imageRefs: [{ refKey: 'I1', label: '人物' }],
      }),
    )
  })

  it('uses the node referenceImageUrl when refs contain no image', async () => {
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'seedance-2.0-min',
      referenceImageUrl: 'https://example.com/node-ref.png',
    })
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls[0]?.[1]).toMatchObject({
      referenceImages: ['https://example.com/node-ref.png'],
    })
  })

  it('rejects audio-only video references before charging', async () => {
    await expect(
      svc.generateVideo({
        userId: 'u1',
        shotId: 'shot-1',
        prompt: 'walk',
        model: 'seedance-2.0-min',
        refs: [
          {
            refKey: 'A1',
            mediaType: 'audio',
            url: 'https://example.com/ref.mp3',
          },
        ],
      }),
    ).rejects.toThrow('参考音频须配合参考图或视频')
    expect(consume).not.toHaveBeenCalled()
    expect(materialCreate).not.toHaveBeenCalled()
    expect(videoGenerate).not.toHaveBeenCalled()
  })
})
