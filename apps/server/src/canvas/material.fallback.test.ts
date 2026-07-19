import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createImageProvider, createVideoProvider, mergeRefsToPrompt } from '@lnkpi/agent'
import { BYOK_FALLBACK_CONFIRM_MESSAGE } from '@lnkpi/shared'
import { MaterialService } from './material.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'

const imageGenerate = vi.fn()
const videoGenerate = vi.fn()

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

const userResolved = {
  channelId: 'ch_user',
  modelName: 'custom-model',
  apiFormat: 'openai' as const,
  credentials: { apiKey: 'user-key', baseUrl: 'https://user.example.com/v1' },
  source: 'user' as const,
}

describe('MaterialService BYOK fallback_pending', () => {
  let svc: MaterialService
  let resolveForGeneration: ReturnType<typeof vi.fn>
  let materialUpdate: ReturnType<typeof vi.fn>
  let materialFindFirst: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    stored = { id: 'm1', shotId: 'shot-1', type: 'image', prompt: 'a cat', status: 'generating' }
    resolveForGeneration = vi.fn(async () => userResolved)
    materialUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return stored
    })
    materialFindFirst = vi.fn(async () => ({
      ...stored,
      shot: { session: { userId: 'u1' } },
    }))

    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterialService,
        { provide: PointsService, useValue: { consume: vi.fn(async () => {}) } },
        {
          provide: PrismaService,
          useValue: {
            shot: {
              findUnique: vi.fn(async () => ({
                id: 'shot-1',
                sessionId: 'sess-1',
                session: { id: 'sess-1', userId: 'u1' },
              })),
            },
            material: {
              create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                stored = { id: 'm1', ...args.data }
                return stored
              }),
              update: materialUpdate,
              findFirst: materialFindFirst,
            },
          },
        },
        {
          provide: ProviderResolverService,
          useValue: { resolveForGeneration },
        },
      ],
    }).compile()
    svc = moduleRef.get(MaterialService)
  })

  it('image: user fail → fallback_pending retains effectivePrompt/refs', async () => {
    vi.mocked(mergeRefsToPrompt).mockResolvedValueOnce({
      mergedText: 'merged cat prompt',
      skippedMerge: false,
    })
    imageGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'a cat',
      model: 'ch_user::custom-model',
      refs: [
        {
          refKey: 'r1',
          mediaType: 'image',
          url: 'https://cdn.example.com/ref.png',
        },
      ],
    })
    await vi.waitFor(() =>
      expect(materialUpdate.mock.calls.some((c) => c[0].data.status === 'fallback_pending')).toBe(
        true,
      ),
    )
    const call = materialUpdate.mock.calls.find((c) => c[0].data.status === 'fallback_pending')![0]
    const meta = JSON.parse(String(call.data.metadata))
    expect(meta.channelId).toBe('ch_user')
    expect(meta.failureClass).toBeTruthy()
    expect(meta.confirmMessage).toBe(BYOK_FALLBACK_CONFIRM_MESSAGE)
    expect(meta.effectivePrompt).toContain('merged cat prompt')
    expect(meta.effectivePrompt).toContain('https://cdn.example.com/ref.png')
    expect(meta.referenceImages).toEqual(['https://cdn.example.com/ref.png'])
    expect(call.data.prompt).toBe(meta.effectivePrompt)
    expect(createImageProvider).toHaveBeenCalledTimes(1)
    expect(createImageProvider).toHaveBeenCalledWith({
      apiKey: 'user-key',
      baseUrl: 'https://user.example.com/v1',
    })
  })

  it('video: user fail → fallback_pending retains effectivePrompt/refs', async () => {
    vi.mocked(mergeRefsToPrompt).mockResolvedValueOnce({
      mergedText: 'merged walk prompt',
      skippedMerge: false,
    })
    videoGenerate.mockRejectedValueOnce(new Error('unauthorized'))
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'ch_user::custom-model',
      duration: 5,
      refs: [
        {
          refKey: 'r1',
          mediaType: 'image',
          url: 'https://cdn.example.com/frame.png',
        },
      ],
    })
    await vi.waitFor(() =>
      expect(materialUpdate.mock.calls.some((c) => c[0].data.status === 'fallback_pending')).toBe(
        true,
      ),
    )
    const call = materialUpdate.mock.calls.find((c) => c[0].data.status === 'fallback_pending')![0]
    const meta = JSON.parse(String(call.data.metadata))
    expect(meta.effectivePrompt).toBe('merged walk prompt')
    expect(meta.referenceImages).toEqual(['https://cdn.example.com/frame.png'])
    expect(meta.image).toBe('https://cdn.example.com/frame.png')
    expect(call.data.prompt).toBe('merged walk prompt')
    expect(createVideoProvider).toHaveBeenCalledTimes(1)
    expect(createVideoProvider).toHaveBeenCalledWith({
      apiKey: 'user-key',
      baseUrl: 'https://user.example.com/v1',
    })
  })

  it('image confirm → platform generate called', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'a cat',
      model: 'ch_user::custom-model',
      aspectRatio: '16:9',
      resolution: '1K',
    })
    await vi.waitFor(() => expect(stored.status).toBe('fallback_pending'))

    vi.clearAllMocks()
    imageGenerate.mockResolvedValueOnce({ url: 'https://example.com/plat.png' })
    resolveForGeneration.mockResolvedValue({
      channelId: 'platform',
      modelName: 'seedream-5.0-pro',
      apiFormat: 'openai',
      credentials: { apiKey: 'plat', baseUrl: 'https://p.example.com/v1' },
      source: 'platform',
    })

    const result = await svc.confirmPlatformFallback('u1', 'm1')
    expect(result.status).toBe('completed')
    expect(createImageProvider).toHaveBeenCalledWith(undefined)
    expect(imageGenerate).toHaveBeenCalled()
    const meta = JSON.parse(String(result.metadata))
    expect(meta.providerFallback).toBe(true)
  })

  it('video confirm → platform generate called with catalog model', async () => {
    videoGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateVideo({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'walk',
      model: 'ch_user::custom-model',
      duration: 5,
      refs: [
        {
          refKey: 'r1',
          mediaType: 'image',
          url: 'https://cdn.example.com/frame.png',
        },
      ],
    })
    await vi.waitFor(() => expect(stored.status).toBe('fallback_pending'))

    vi.clearAllMocks()
    videoGenerate.mockResolvedValueOnce({ url: 'https://example.com/plat.mp4' })
    resolveForGeneration.mockResolvedValue({
      channelId: 'platform',
      modelName: 'seedance-2.0-min',
      apiFormat: 'openai',
      credentials: { apiKey: 'plat', baseUrl: 'https://p.example.com/v1' },
      source: 'platform',
    })

    const result = await svc.confirmPlatformFallback('u1', 'm1')
    expect(result.status).toBe('completed')
    expect(createVideoProvider).toHaveBeenCalledWith(undefined)
    expect(videoGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        model: 'seedance-2.0-min',
        image: 'https://cdn.example.com/frame.png',
      }),
    )
    const meta = JSON.parse(String(result.metadata))
    expect(meta.providerFallback).toBe(true)
  })

  it('cancel → failed', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('fail'))
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'a cat',
      model: 'ch_user::custom-model',
    })
    await vi.waitFor(() => expect(stored.status).toBe('fallback_pending'))
    const result = await svc.cancelPlatformFallback('u1', 'm1')
    expect(result.status).toBe('failed')
  })
})
