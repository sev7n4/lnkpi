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
import { BadRequestException } from '@nestjs/common'
import { BYOK_FALLBACK_CONFIRM_MESSAGE } from '@lnkpi/shared'
import { createCancelFlag } from '../points/charge-session'
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
  let generationUpdateMany: ReturnType<typeof vi.fn>
  let generationFindFirst: ReturnType<typeof vi.fn>
  let pointsConsume: ReturnType<typeof vi.fn>
  let pointsRefund: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    stored = {}
    pointsConsume = vi.fn(async () => {})
    pointsRefund = vi.fn(async () => {})
    resolveForGeneration = vi.fn(async () => userResolved)
    generationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
      stored = { id: 'g1', createdAt: new Date(), ...args.data }
      return stored
    })
    generationUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return stored
    })
    generationUpdateMany = vi.fn(async (args: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
      if (stored.status !== args.where.status) return { count: 0 }
      stored = { ...stored, ...args.data }
      return { count: 1 }
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
            consume: pointsConsume,
            refund: pointsRefund,
          },
        },
        {
          provide: PrismaService,
          useValue: {
            generationRecord: {
              create: generationCreate,
              update: generationUpdate,
              updateMany: generationUpdateMany,
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
      cost: 10,
      refundReason: '图像生成-BYOK失败退款',
      failOnce: () => imageGenerate.mockRejectedValueOnce(new Error('upstream 502')),
      run: () => svc.generateImage('u1', 'a cat', 'ch_user::custom-model'),
      createProvider: createImageProvider,
      generate: imageGenerate,
      platformModel: 'seedream-5.0-pro',
    },
    {
      name: 'text',
      cost: 5,
      refundReason: '文本生成-BYOK失败退款',
      failOnce: () => textGenerate.mockRejectedValueOnce(new Error('unauthorized api key')),
      run: () => svc.generateText('u1', 'hello', 'ch_user::custom-model'),
      createProvider: createTextProvider,
      generate: textGenerate,
      platformModel: 'gemini-3.1-flash',
    },
    {
      name: 'audio',
      cost: 5,
      refundReason: '音频生成-BYOK失败退款',
      failOnce: () => audioGenerate.mockRejectedValueOnce(new Error('network timeout')),
      run: () => svc.generateAudio('u1', 'hi', { model: 'ch_user::custom-model' }),
      createProvider: createAudioProvider,
      generate: audioGenerate,
      platformModel: 'minimax-speech-2.8-hd',
    },
  ] as const)(
    '$name: user channel failure → fallback_pending without platform provider',
    async ({ failOnce, run, createProvider, generate, cost, refundReason }) => {
      failOnce()
      const record = await run()

      expect(record.status).toBe('fallback_pending')
      const meta = JSON.parse(String(record.metadata))
      expect(meta.channelId).toBe('ch_user')
      expect(meta.failureClass).toBeTruthy()
      expect(meta.confirmMessage).toBe(BYOK_FALLBACK_CONFIRM_MESSAGE)
      expect(meta.chargedPoints).toBe(cost)
      expect(meta.refundedPoints).toBe(cost)
      expect(meta.refundReason).toBe('byok_failed')
      expect(pointsRefund).toHaveBeenCalledWith('u1', cost, refundReason)
      expect(createProvider).toHaveBeenCalledTimes(1)
      expect(createProvider).toHaveBeenCalledWith({
        apiKey: 'user-key',
        baseUrl: 'https://user.example.com/v1',
      })
      expect(generate).toHaveBeenCalledTimes(1)

      resolveForGeneration.mockClear()
      vi.mocked(createProvider).mockClear()
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
    expect(meta.refundedPoints).toBe(30)
    expect(pointsRefund).toHaveBeenCalledWith('u1', 30, '视频生成-BYOK失败退款')

    expect(createVideoProvider).toHaveBeenCalledTimes(1)
    expect(createVideoProvider).toHaveBeenCalledWith({
      apiKey: 'user-key',
      baseUrl: 'https://user.example.com/v1',
    })
  })

  it.each([
    {
      name: 'image',
      platformCost: 10,
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
      platformCost: 5,
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
      platformCost: 5,
      setupPending: async () => {
        audioGenerate.mockRejectedValueOnce(new Error('network'))
        await svc.generateAudio('u1', 'hi', { model: 'ch_user::custom-model' })
        audioGenerate.mockResolvedValueOnce({ url: 'https://example.com/a.mp3' })
      },
      createProvider: createAudioProvider,
      generate: audioGenerate,
    },
  ] as const)('$name: confirm → platform generate called', async ({ setupPending, createProvider, generate, platformCost }) => {
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
    expect(meta.chargedPoints).toBe(platformCost)
    expect(meta.priorByokRefunded).toBe(true)
    expect(pointsConsume).toHaveBeenCalledWith('u1', platformCost, '平台回退生成')

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
    const [[, videoOpts]] = videoGenerate.mock.calls
    expect((videoOpts as { model?: string }).model).not.toBe('custom-model')
    const meta = JSON.parse(String(result.metadata))
    expect(meta.providerFallback).toBe(true)
  })

  it('image confirm → platform uses catalog gateway model, not user custom', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateImage('u1', 'a cat', 'ch_user::custom-model')
    // Force pending meta to look like a user gateway id was persisted.
    stored = {
      ...stored,
      status: 'fallback_pending',
      metadata: JSON.stringify({
        ...JSON.parse(String(stored.metadata ?? '{}')),
        gatewayModelId: 'custom-model',
        modelId: 'custom-model',
        channelId: 'ch_user',
      }),
    }
    vi.clearAllMocks()
    imageGenerate.mockResolvedValueOnce({ url: 'https://example.com/i.png', urls: ['https://example.com/i.png'] })

    const result = await svc.confirmPlatformFallback('u1', 'g1')
    expect(result.status).toBe('completed')
    expect(createImageProvider).toHaveBeenCalledWith(undefined)
    const [[, opts]] = imageGenerate.mock.calls
    expect((opts as { modelId?: string }).modelId).not.toBe('custom-model')
    expect((opts as { modelId?: string }).modelId).toBeTruthy()
  })

  it.each([
    {
      name: 'image',
      cost: 10,
      refundReason: '图像生成-失败退款',
      run: () => svc.generateImage('u1', 'a cat', undefined),
      failOnce: () => imageGenerate.mockRejectedValueOnce(new Error('platform upstream 502')),
    },
    {
      name: 'text',
      cost: 5,
      refundReason: '文本生成-失败退款',
      run: () => svc.generateText('u1', 'hello'),
      failOnce: () => textGenerate.mockRejectedValueOnce(new Error('platform upstream 502')),
    },
  ] as const)(
    '$name: platform source failure → refund after consume',
    async ({ run, failOnce, cost, refundReason }) => {
      resolveForGeneration.mockResolvedValue(platformResolved)
      failOnce()
      await expect(run()).rejects.toThrow('platform upstream 502')
      expect(pointsConsume).toHaveBeenCalledWith('u1', cost, expect.any(String))
      expect(pointsRefund).toHaveBeenCalledWith('u1', cost, refundReason)
    },
  )

  it('confirmPlatformFallback: platform generate failure → refund, failed, refundedPoints', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateImage('u1', 'a cat', 'ch_user::custom-model')
    vi.clearAllMocks()
    resolveForGeneration.mockImplementation(async (_uid: string, model?: string) => ({
      ...platformResolved,
      modelName: model?.includes('::') ? model.split('::')[1]! : (model ?? platformResolved.modelName),
    }))
    imageGenerate.mockRejectedValueOnce(new Error('platform confirm failed'))
    pointsConsume.mockResolvedValue(undefined)

    await expect(svc.confirmPlatformFallback('u1', 'g1')).rejects.toThrow('platform confirm failed')

    expect(pointsConsume).toHaveBeenCalledWith('u1', 10, '平台回退生成')
    expect(pointsRefund).toHaveBeenCalledWith('u1', 10, '平台回退失败退款')
    const failedUpdate = generationUpdate.mock.calls.find((c) => c[0].data.status === 'failed')
    expect(failedUpdate).toBeTruthy()
    const meta = JSON.parse(String(failedUpdate![0].data.metadata))
    expect(meta.refundedPoints).toBe(10)
    expect(meta.refundReason).toBe('platform_fallback_failed')
    expect(meta.chargedPoints).toBe(10)
    expect(meta.priorByokRefunded).toBe(true)
  })

  it('video: platform source failure → refund and failed metadata', async () => {
    resolveForGeneration.mockResolvedValue(platformResolved)
    videoGenerate.mockRejectedValueOnce(new Error('platform upstream 502'))
    const record = await svc.generateVideo('u1', 'walk')
    expect(record.status).toBe('generating')

    await vi.waitFor(() =>
      expect(generationUpdate.mock.calls.some((c) => c[0].data.status === 'failed')).toBe(true),
    )
    const failedUpdate = generationUpdate.mock.calls.find((c) => c[0].data.status === 'failed')!
    const meta = JSON.parse(String(failedUpdate[0].data.metadata))
    expect(meta.refundedPoints).toBe(30)
    expect(meta.refundReason).toBe('platform_failed')
    expect(pointsRefund).toHaveBeenCalledWith('u1', 30, '视频生成-失败退款')
  })

  it('cancel-platform-fallback → failed without double refund', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('fail'))
    await svc.generateImage('u1', 'a cat', 'ch_user::custom-model')
    expect(pointsRefund).toHaveBeenCalledTimes(1)
    pointsRefund.mockClear()
    const result = await svc.cancelPlatformFallback('u1', 'g1')
    expect(result.status).toBe('failed')
    expect(pointsRefund).not.toHaveBeenCalled()
  })

  it('cancelGeneration on generating video → refund once and failed metadata', async () => {
    stored = {
      id: 'g-vid',
      type: 'video',
      status: 'generating',
      metadata: JSON.stringify({ chargedPoints: 30, duration: 5 }),
    }
    generationFindFirst.mockResolvedValue(stored)
    const result = await svc.cancelGeneration('u1', 'g-vid')
    expect(result.status).toBe('failed')
    expect(pointsRefund).toHaveBeenCalledWith('u1', 30, '视频生成-取消退款')
    const meta = JSON.parse(String(generationUpdate.mock.calls.at(-1)?.[0].data.metadata))
    expect(meta.cancelled).toBe(true)
    expect(meta.refundedPoints).toBe(30)
  })

  it('video: cancel before completeVideo success → ignore late completed write', async () => {
    resolveForGeneration.mockResolvedValue(platformResolved)
    let resolveVideo!: (v: { url: string }) => void
    videoGenerate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveVideo = r
        }),
    )
    await svc.generateVideo('u1', 'walk')
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    stored = {
      ...stored,
      status: 'failed',
      metadata: JSON.stringify({ chargedPoints: 30, cancelled: true, refundedPoints: 30 }),
    }
    resolveVideo({ url: 'https://example.com/v.mp4' })
    await new Promise((r) => setTimeout(r, 30))
    expect(generationUpdateMany).not.toHaveBeenCalled()
    expect(stored.status).toBe('failed')
  })

  it('text: client abort after generate → refund once and throw 已取消', async () => {
    resolveForGeneration.mockResolvedValue(platformResolved)
    textGenerate.mockReset()
    textGenerate.mockResolvedValue({ text: 'done' })
    const listeners: Record<string, (() => void)[]> = {}
    const req = {
      aborted: false,
      on(event: string, cb: () => void) {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
      },
    }
    const cancel = createCancelFlag(req)
    const promise = svc.generateText('u1', 'hello', undefined, undefined, undefined, cancel)
    listeners.close?.forEach((cb) => cb())
    await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    await expect(promise).rejects.toMatchObject({
      response: { message: '已取消', refundedPoints: 5 },
    })
    expect(pointsRefund).toHaveBeenCalledTimes(1)
    expect(pointsRefund).toHaveBeenCalledWith('u1', 5, '文本生成-取消退款')
    expect(generationCreate).not.toHaveBeenCalled()
  })

  it('image: BYOK client abort after generate → refund once, no fallback_pending', async () => {
    imageGenerate.mockResolvedValueOnce({
      url: 'https://example.com/i.png',
      urls: ['https://example.com/i.png'],
    })
    const listeners: Record<string, (() => void)[]> = {}
    const cancel = createCancelFlag({
      aborted: false,
      on(event: string, cb: () => void) {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
      },
    })
    const promise = svc.generateImage(
      'u1',
      'a cat',
      'ch_user::custom-model',
      '16:9',
      [],
      [],
      '1K',
      1,
      cancel,
    )
    listeners.close?.forEach((cb) => cb())
    await expect(promise).rejects.toMatchObject({
      response: { message: '已取消', refundedPoints: 10 },
    })
    expect(pointsRefund).toHaveBeenCalledTimes(1)
    expect(pointsRefund).toHaveBeenCalledWith('u1', 10, '图像生成-取消退款')
    expect(generationCreate).not.toHaveBeenCalled()
  })

  it('confirmPlatformFallback: client abort after generate → refund once, failed', async () => {
    imageGenerate.mockRejectedValueOnce(new Error('upstream 502'))
    await svc.generateImage('u1', 'a cat', 'ch_user::custom-model')
    vi.clearAllMocks()
    imageGenerate.mockResolvedValueOnce({
      url: 'https://example.com/plat.png',
      urls: ['https://example.com/plat.png'],
    })
    const listeners: Record<string, (() => void)[]> = {}
    const cancel = createCancelFlag({
      aborted: false,
      on(event: string, cb: () => void) {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
      },
    })
    const promise = svc.confirmPlatformFallback('u1', 'g1', cancel)
    listeners.close?.forEach((cb) => cb())
    await expect(promise).rejects.toMatchObject({
      response: { message: '已取消', refundedPoints: 10 },
    })
    expect(pointsConsume).toHaveBeenCalledWith('u1', 10, '平台回退生成')
    expect(pointsRefund).toHaveBeenCalledTimes(1)
    expect(pointsRefund).toHaveBeenCalledWith('u1', 10, '平台回退-取消退款')
    const failedUpdate = generationUpdate.mock.calls.find((c) => c[0].data.status === 'failed')
    expect(failedUpdate).toBeTruthy()
    const meta = JSON.parse(String(failedUpdate![0].data.metadata))
    expect(meta.refundReason).toBe('cancelled')
    expect(meta.refundedPoints).toBe(10)
  })
})
