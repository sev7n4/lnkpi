import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  mergeRefsToPrompt,
} from '@lnkpi/agent'
import { BYOK_FALLBACK_CONFIRM_MESSAGE } from '@lnkpi/shared'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { StudioService } from './studio.service'

const imageGenerate = vi.fn()
const videoGenerate = vi.fn()
const audioGenerate = vi.fn()
const textGenerate = vi.fn()

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    mergeRefsToPrompt: vi.fn(async (input: { localPrompt?: string }) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    })),
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
    createVideoProvider: vi.fn(() => ({ generate: videoGenerate })),
    createAudioProvider: vi.fn(() => ({ generate: audioGenerate })),
    createTextProvider: vi.fn(() => ({ generate: textGenerate })),
    generateTextWithImages: vi.fn(),
  }
})

const userResolved = {
  channelId: 'ch_user',
  modelName: 'custom-model',
  apiFormat: 'openai' as const,
  credentials: { apiKey: 'user-key', baseUrl: 'https://user.example.com/v1' },
  source: 'user' as const,
}

const platformResolved = {
  channelId: 'platform',
  modelName: 'seedream-5.0-pro',
  apiFormat: 'openai' as const,
  credentials: { apiKey: 'plat-key', baseUrl: 'https://platform.example.com/v1' },
  source: 'platform' as const,
}

describe('StudioService BYOK fallback_pending', () => {
  let svc: StudioService
  let resolveForGeneration: ReturnType<typeof vi.fn>
  let generationCreate: ReturnType<typeof vi.fn>
  let generationUpdate: ReturnType<typeof vi.fn>
  let generationFindFirst: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    stored = {}
    resolveForGeneration = vi.fn(async () => userResolved)
    generationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
      stored = { id: 'g1', createdAt: new Date(), ...args.data }
      return stored
    })
    generationUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return stored
    })
    generationFindFirst = vi.fn(async () => stored)

    vi.mocked(mergeRefsToPrompt).mockImplementation(async (input) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    }))

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PointsService,
          useValue: {
            consume: vi.fn(async () => {}),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            generationRecord: {
              create: generationCreate,
              update: generationUpdate,
              findFirst: generationFindFirst,
              findMany: vi.fn(async () => []),
            },
          },
        },
        {
          provide: ProviderResolverService,
          useValue: { resolveForGeneration },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  it.each([
    {
      name: 'image',
      failOnce: () => imageGenerate.mockRejectedValueOnce(new Error('upstream 502')),
      run: () => svc.generateImage('u1', 'a cat', 'ch_user::custom-model'),
      createProvider: createImageProvider,
      generate: imageGenerate,
      platformModel: 'seedream-5.0-pro',
    },
    {
      name: 'text',
      failOnce: () => textGenerate.mockRejectedValueOnce(new Error('unauthorized api key')),
      run: () => svc.generateText('u1', 'hello', 'ch_user::custom-model'),
      createProvider: createTextProvider,
      generate: textGenerate,
      platformModel: 'gemini-3.1-flash',
    },
    {
      name: 'audio',
      failOnce: () => audioGenerate.mockRejectedValueOnce(new Error('network timeout')),
      run: () => svc.generateAudio('u1', 'hi', { model: 'ch_user::custom-model' }),
      createProvider: createAudioProvider,
      generate: audioGenerate,
      platformModel: 'minimax-speech-2.8-hd',
    },
  ] as const)(
    '$name: user channel failure → fallback_pending without platform provider',
    async ({ failOnce, run, createProvider, generate }) => {
      failOnce()
      const record = await run()

      expect(record.status).toBe('fallback_pending')
      const meta = JSON.parse(String(record.metadata))
      expect(meta.channelId).toBe('ch_user')
      expect(meta.failureClass).toBeTruthy()
      expect(meta.confirmMessage).toBe(BYOK_FALLBACK_CONFIRM_MESSAGE)
      expect(createProvider).toHaveBeenCalledTimes(1)
      expect(createProvider).toHaveBeenCalledWith({
        apiKey: 'user-key',
        baseUrl: 'https://user.example.com/v1',
      })
      expect(generate).toHaveBeenCalledTimes(1)

      resolveForGeneration.mockClear()
      createProvider.mockClear()
      generate.mockClear()
    },
  )

  it('video: user channel failure → fallback_pending without platform provider', async () => {
    videoGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    const record = await svc.generateVideo('u1', 'walk', 'ch_user::custom-model')
    expect(record.status).toBe('generating')

    await vi.waitFor(() => expect(generationUpdate).toHaveBeenCalled())
    const updateData = generationUpdate.mock.calls[0][0].data
    expect(updateData.status).toBe('fallback_pending')
    const meta = JSON.parse(String(updateData.metadata))
    expect(meta.channelId).toBe('ch_user')
    expect(meta.failureClass).toBeTruthy()

    expect(createVideoProvider).toHaveBeenCalledTimes(1)
    expect(createVideoProvider).toHaveBeenCalledWith({
      apiKey: 'user-key',
      baseUrl: 'https://user.example.com/v1',
    })
  })

  it.each([
    {
      name: 'image',
      setupPending: async () => {
        imageGenerate.mockRejectedValueOnce(new Error('upstream 502'))
        await svc.generateImage('u1', 'a cat', 'ch_user::custom-model', '16:9', [], [], '1K', 1)
        imageGenerate.mockResolvedValueOnce({
          url: 'https://example.com/plat.png',
          urls: ['https://example.com/plat.png'],
        })
      },
      createProvider: createImageProvider,
      generate: imageGenerate,
    },
    {
      name: 'text',
      setupPending: async () => {
        textGenerate.mockRejectedValueOnce(new Error('unauthorized'))
        await svc.generateText('u1', 'hello', 'ch_user::custom-model')
        textGenerate.mockResolvedValueOnce({ text: 'platform ok' })
      },
      createProvider: createTextProvider,
      generate: textGenerate,
    },
    {
      name: 'audio',
      setupPending: async () => {
        audioGenerate.mockRejectedValueOnce(new Error('network'))
        await svc.generateAudio('u1', 'hi', { model: 'ch_user::custom-model' })
        audioGenerate.mockResolvedValueOnce({ url: 'https://example.com/a.mp3' })
      },
      createProvider: createAudioProvider,
      generate: audioGenerate,
    },
  ] as const)('$name: confirm → platform generate called', async ({ setupPending, createProvider, generate }) => {
    await setupPending()
    vi.clearAllMocks()
    resolveForGeneration.mockImplementation(async (_uid: string, model?: string) => ({
      ...platformResolved,
      modelName: model?.includes('::') ? model.split('::')[1]! : (model ?? platformResolved.modelName),
    }))

    const result = await svc.confirmPlatformFallback('u1', 'g1')
    expect(result.status).toBe('completed')
    const meta = JSON.parse(String(result.metadata))
    expect(meta.providerFallback).toBe(true)

    expect(createProvider).toHaveBeenCalled()
    const credCall = vi.mocked(createProvider).mock.calls.find((c) => c[0] == null || c.length === 0 || !c[0]?.apiKey)
    // platform path: no user credentials (undefined / omitted)
    expect(
      vi.mocked(createProvider).mock.calls.some((c) => c[0] === undefined || c.length === 0),
    ).toBe(true)
    expect(generate).toHaveBeenCalled()
    void credCall
  })

  it('text confirm → platform uses catalog gateway model, not user custom', async () => {
    textGenerate.mockRejectedValueOnce(new Error('unauthorized'))
    await svc.generateText('u1', 'hello', 'ch_user::custom-model')
    vi.clearAllMocks()
    textGenerate.mockResolvedValueOnce({ text: 'platform ok' })

    const result = await svc.confirmPlatformFallback('u1', 'g1')
    expect(result.status).toBe('completed')
    expect(createTextProvider).toHaveBeenCalledWith(undefined)
    expect(textGenerate).toHaveBeenCalledWith('hello', 'gemini-3.1-flash')
    const [[, modelArg]] = textGenerate.mock.calls
    expect(modelArg).not.toBe('custom-model')
  })

  it('audio confirm → platform uses catalog gateway model, not user custom', async () => {
    audioGenerate.mockRejectedValueOnce(new Error('network'))
    await svc.generateAudio('u1', 'hi', { model: 'ch_user::custom-model' })
    vi.clearAllMocks()
    audioGenerate.mockResolvedValueOnce({ url: 'https://example.com/a.mp3' })

    const result = await svc.confirmPlatformFallback('u1', 'g1')
    expect(result.status).toBe('completed')
    expect(createAudioProvider).toHaveBeenCalledWith(undefined)
    expect(audioGenerate).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ model: 'speech-2.8-hd' }),
    )
    const opts = audioGenerate.mock.calls[0][1] as { model?: string }
    expect(opts.model).not.toBe('custom-model')
  })

  it('video confirm → platform generate called', async () => {
    videoGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateVideo('u1', 'walk', 'ch_user::custom-model')
    await vi.waitFor(() =>
      expect(generationUpdate.mock.calls.some((c) => c[0].data.status === 'fallback_pending')).toBe(
        true,
      ),
    )
    stored = {
      ...stored,
      status: 'fallback_pending',
      metadata: generationUpdate.mock.calls.find((c) => c[0].data.status === 'fallback_pending')![0]
        .data.metadata,
    }

    vi.clearAllMocks()
    videoGenerate.mockResolvedValueOnce({ url: 'https://example.com/v.mp4' })
    resolveForGeneration.mockResolvedValue({
      ...platformResolved,
      modelName: 'seedance-2.0-min',
    })

    const result = await svc.confirmPlatformFallback('u1', 'g1')
    expect(result.status).toBe('completed')
    expect(createVideoProvider).toHaveBeenCalledWith(undefined)
    expect(videoGenerate).toHaveBeenCalled()
    const meta = JSON.parse(String(result.metadata))
    expect(meta.providerFallback).toBe(true)
  })

  it('cancel-platform-fallback → failed', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('fail'))
    await svc.generateImage('u1', 'a cat', 'ch_user::custom-model')
    const result = await svc.cancelPlatformFallback('u1', 'g1')
    expect(result.status).toBe('failed')
  })
})
