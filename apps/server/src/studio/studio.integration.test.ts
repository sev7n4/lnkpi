import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  generateTextWithImages,
  mergeRefsToPrompt,
} from '@lnkpi/agent'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { createStudioService } from './studio.test-utils'
import type { StudioService } from './studio.service'

const imageGenerate = vi.fn(async () => ({
  url: 'https://example.com/a.png',
  urls: ['https://example.com/a.png'],
}))
const videoGenerate = vi.fn(async (_prompt: string, _opts?: Record<string, unknown>) => ({
  url: 'https://example.com/v.mp4',
}))
const audioGenerate = vi.fn(async () => ({ url: 'https://example.com/a.mp3' }))
const textGenerate = vi.fn(async (prompt: string) => ({ text: `ok:${prompt}` }))
const visionGenerate = vi.fn(async (prompt: string) => ({ text: `vision:${prompt}` }))

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
    generateTextWithImages: vi.fn(async (prompt: string) => visionGenerate(prompt)),
  }
})

describe('StudioService integration (provider params)', () => {
  let svc: StudioService

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(mergeRefsToPrompt).mockImplementation(async (input) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    }))
    svc = await createStudioService()
  })

  it('passes modelId, size, and n to image provider', async () => {
    await svc.generateImage('u1', 'a prompt', 'seedream-5.0-pro', '16:9', [], [], '1K', 2)

    expect(createImageProvider).toHaveBeenCalled()
    expect(imageGenerate).toHaveBeenCalledWith('a prompt', {
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

  it('passes the full video reference bundle and image descriptors to the provider', async () => {
    const imageUrl = 'https://example.com/ref.png'
    const videoUrl = 'https://example.com/ref.mp4'
    const audioUrl = 'https://example.com/ref.mp3'
    await svc.generateVideo(
      'u1',
      'a prompt',
      'seedance-2.0-min',
      10,
      '16:9',
      [
        { refKey: 'I1', mediaType: 'image', label: '人物', url: imageUrl },
        { refKey: 'V1', mediaType: 'video', label: '运镜', url: videoUrl },
        { refKey: 'A1', mediaType: 'audio', label: '节奏', url: audioUrl },
      ],
      [],
      '720p',
      'none',
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    const [prompt, opts] = videoGenerate.mock.calls[0]
    expect(prompt).toContain('a prompt')
    expect(prompt).toContain('@Image1')
    expect(prompt).toContain('@Video1')
    expect(prompt).toContain('@Audio1')
    expect(prompt).toContain('【参考图一致性】')
    expect(opts).toMatchObject({
      model: 'doubao-seedance-2.0-mini',
      duration: 10,
      aspectRatio: '16:9',
      resolution: '720p',
      referenceImages: [imageUrl],
      referenceVideos: [videoUrl],
      referenceAudios: [audioUrl],
    })
    expect(mergeRefsToPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        downstreamType: 'video',
        imageRefs: [{ refKey: 'I1', label: '人物' }],
      }),
    )
  })

  it('uses referenceImageUrl when refs contain no image', async () => {
    const imageUrl = 'https://example.com/node-ref.png'
    await svc.generateVideo(
      'u1',
      'a prompt',
      'seedance-2.0-min',
      5,
      '16:9',
      [],
      [],
      '720p',
      'none',
      imageUrl,
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls[0]?.[1]).toMatchObject({
      referenceImages: [imageUrl],
    })
  })

  it('persists the returned video last frame URL in metadata', async () => {
    const prisma = (
      svc as unknown as {
        prisma: {
          generationRecord: {
            create: ReturnType<typeof vi.fn>
            findFirst: ReturnType<typeof vi.fn>
            updateMany: ReturnType<typeof vi.fn>
          }
        }
      }
    ).prisma
    let stored: Record<string, unknown> = {}
    prisma.generationRecord.create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = { id: 'g1', ...data }
      return stored
    })
    prisma.generationRecord.findFirst = vi.fn(async () => stored)
    prisma.generationRecord.updateMany = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        stored = { ...stored, ...data }
        return { count: 1 }
      },
    )
    videoGenerate.mockResolvedValueOnce({
      url: 'https://example.com/v.mp4',
      lastFrameUrl: 'https://example.com/v-last.png',
    })

    await svc.generateVideo(
      'u1',
      'a prompt',
      'seedance-2.0-min',
      5,
      '16:9',
      [{ refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref.png' }],
    )

    await vi.waitFor(() => expect(prisma.generationRecord.updateMany).toHaveBeenCalled())
    expect(JSON.parse(String(stored.metadata))).toMatchObject({
      lastFrameUrl: 'https://example.com/v-last.png',
    })
  })

  it('keeps seedance standard 1080p in provider options and metadata variantTag', async () => {
    const prisma = (
      svc as unknown as {
        prisma: {
          generationRecord: {
            create: ReturnType<typeof vi.fn>
          }
        }
      }
    ).prisma
    let stored: Record<string, unknown> = {}
    prisma.generationRecord.create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = { id: 'g-standard', ...data }
      return stored
    })

    await svc.generateVideo('u1', 'a prompt', 'seedance-2.0', 5, '16:9', [], [], '1080p')

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls.at(-1)?.[1]).toMatchObject({
      model: 'doubao-seedance-2.0',
      resolution: '1080p',
    })
    expect(JSON.parse(String(stored.metadata))).toMatchObject({
      variantTag: 'standard',
      gatewayModelId: 'doubao-seedance-2.0',
    })
    expect(
      JSON.parse(String(stored.metadata)).droppedFields?.some(
        (d: { field: string }) => d.field === 'resolution',
      ),
    ).toBeFalsy()
  })

  it('clamps seedance fast 1080p to 720p and records variantTag in metadata', async () => {
    const prisma = (
      svc as unknown as {
        prisma: {
          generationRecord: {
            create: ReturnType<typeof vi.fn>
          }
        }
      }
    ).prisma
    let stored: Record<string, unknown> = {}
    prisma.generationRecord.create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = { id: 'g-fast', ...data }
      return stored
    })

    await svc.generateVideo('u1', 'a prompt', 'seedance-2.0-fast', 5, '16:9', [], [], '1080p')

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls.at(-1)?.[1]).toMatchObject({
      model: 'doubao-seedance-2.0-fast',
      resolution: '720p',
    })
    const meta = JSON.parse(String(stored.metadata))
    expect(meta).toMatchObject({
      variantTag: 'fast',
      gatewayModelId: 'doubao-seedance-2.0-fast',
    })
    expect(meta.droppedFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'resolution' })]),
    )
  })

  it('rejects 1.x BYOK seedance with BadRequestException', async () => {
    const resolver = (svc as unknown as { resolver: ProviderResolverService }).resolver
    vi.spyOn(resolver, 'resolveForGeneration').mockResolvedValueOnce({
      channelId: 'ch_user',
      modelName: 'doubao-seedance-1-0-lite-i2v-250428',
      apiFormat: 'openai',
      credentials: { apiKey: 'user-key', baseUrl: 'https://api.apimart.ai/v1' },
      source: 'user',
    })

    const promise = svc.generateVideo(
      'u1',
      'a prompt',
      'ch_user::doubao-seedance-1-0-lite-i2v-250428',
      5,
      '16:9',
    )
    await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    await expect(promise).rejects.toThrow(/不支持.*Seedance 1\.x/)
    expect(videoGenerate).not.toHaveBeenCalled()
  })

  it('rejects audio-only video references', async () => {
    await expect(
      svc.generateVideo(
        'u1',
        'a prompt',
        'seedance-2.0-min',
        5,
        '16:9',
        [{ refKey: 'A1', mediaType: 'audio', url: 'https://example.com/ref.mp3' }],
      ),
    ).rejects.toThrow('参考音频须配合参考图或视频')
    expect(videoGenerate).not.toHaveBeenCalled()
  })

  it('passes built audio options (model, voice, speed) to audio provider', async () => {
    await svc.generateAudio('u1', 'say hello', {
      model: 'minimax-speech-2.8-hd',
      voice: 'female-shaonv',
      speed: 1.2,
      volume: 0.8,
      pitch: 2,
    })

    expect(createAudioProvider).toHaveBeenCalled()
    expect(audioGenerate).toHaveBeenCalledWith('say hello', {
      model: 'speech-2.8-hd',
      voice: 'female-shaonv',
      speed: 1.2,
      volume: 0.8,
      pitch: 2,
    })
  })

  it('resolves text model via catalog gateway id when no image refs', async () => {
    await svc.generateText('u1', 'hello world', 'gemini-3.1-flash')

    expect(createTextProvider).toHaveBeenCalled()
    expect(textGenerate).toHaveBeenCalledWith('hello world', 'gemini-3.1-flash', {
      thinking: false,
      thinkingEffort: 'high',
    })
    expect(generateTextWithImages).not.toHaveBeenCalled()
  })

  it('passes catalog gateway model to generateTextWithImages when image refs present', async () => {
    const refUrl = 'https://example.com/dress.jpg'
    await svc.generateText('u1', 'describe dress', 'gemini-3.1-flash', [
      { refKey: 'i1', mediaType: 'image', url: refUrl },
    ])

    expect(generateTextWithImages).toHaveBeenCalledWith('describe dress', [refUrl], {
      model: 'gemini-3.1-flash',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    expect(createTextProvider).not.toHaveBeenCalled()
  })
})
