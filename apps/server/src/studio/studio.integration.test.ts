import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  FAL_H3_MAX_ENDPOINTS,
  generateTextForRefs,
  generatePromptFromUserInput,
  mergeRefsToPrompt,
} from '@lnkpi/agent'
import { inlineUpstreamReferenceImages } from '../media/upstream-ref-inline'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { createStudioService } from './studio.test-utils'
import type { StudioService } from './studio.service'

vi.mock('../media/upstream-ref-inline', () => ({
  inlineUpstreamReferenceImages: vi.fn(async (urls: string[]) => urls),
}))

const imageGenerate = vi.fn(async () => ({
  url: 'https://example.com/a.png',
  urls: ['https://example.com/a.png'],
}))
const videoGenerate = vi.fn(async (_prompt: string, _opts?: Record<string, unknown>) => ({
  url: 'https://example.com/v.mp4',
}))
const audioGenerate = vi.fn(async () => ({ url: 'https://example.com/a.mp3' }))
const textGenerate = vi.fn(async (prompt: string) => ({ text: `ok:${prompt}` }))

function stubSessionCanvas(svc: StudioService, canvas: unknown) {
  const prisma = (
    svc as unknown as { prisma: { session: { findUnique: (args?: unknown) => Promise<unknown> } } }
  ).prisma
  prisma.session.findUnique = async () => ({
    id: 's1',
    canvasData: JSON.stringify(canvas),
  })
}

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
    generateTextForRefs: vi.fn(async (prompt: string, refs: string[]) => {
      if (refs.length > 0) {
        return { text: `vision:${prompt}`, visionUsed: true }
      }
      return { text: `ok:${prompt}`, visionUsed: false }
    }),
    generatePromptFromUserInput: vi.fn(async (prompt: string, opts?: { referenceImages?: string[] }) => ({
      mode: 'generic',
      content: `expanded:${prompt}`,
      visionUsed: Boolean(opts?.referenceImages?.length),
    })),
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
    expect(JSON.parse(String(stored.metadata)).providerId).not.toBe('fal')
  })

  it('charges H3 Max by resolution factor and records fal metadata', async () => {
    const prisma = (
      svc as unknown as {
        prisma: {
          generationRecord: {
            create: ReturnType<typeof vi.fn>
          }
        }
        points: { consume: ReturnType<typeof vi.fn> }
      }
    )
    let stored: Record<string, unknown> = {}
    prisma.prisma.generationRecord.create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        stored = { id: 'g-h3', ...data }
        return stored
      },
    )
    const consume = vi.spyOn(prisma.points, 'consume')

    await svc.generateVideo(
      'u1',
      'a prompt',
      'h3-max',
      5,
      '16:9',
      [{ refKey: 'I1', mediaType: 'image', url: 'https://cdn/first.png' }],
      [],
      '768p',
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith(
      'u1',
      45,
      '视频生成',
      expect.objectContaining({ category: 'video' }),
    )
    expect(createVideoProvider).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'h3-max' }),
    )
    expect(JSON.parse(String(stored.metadata))).toMatchObject({
      chargedPoints: 45,
      providerId: 'fal',
      credentialSource: 'platform',
      falEndpoint: FAL_H3_MAX_ENDPOINTS['h3-max'].i2v,
    })
  })

  it('charges official H3 by resolution factor and records minimax metadata', async () => {
    const prisma = (
      svc as unknown as {
        prisma: {
          generationRecord: {
            create: ReturnType<typeof vi.fn>
          }
        }
        points: { consume: ReturnType<typeof vi.fn> }
      }
    )
    let stored: Record<string, unknown> = {}
    prisma.prisma.generationRecord.create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        stored = { id: 'g-official-h3', ...data }
        return stored
      },
    )
    const consume = vi.spyOn(prisma.points, 'consume')

    await svc.generateVideo(
      'u1',
      'a prompt',
      'minimax-h3',
      5,
      '16:9',
      [{ refKey: 'I1', mediaType: 'image', url: 'https://cdn/first.png' }],
      [],
      '768p',
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith(
      'u1',
      36,
      '视频生成',
      expect.objectContaining({ category: 'video' }),
    )
    expect(createVideoProvider).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'minimax-h3' }),
    )
    expect(JSON.parse(String(stored.metadata))).toMatchObject({
      chargedPoints: 36,
      providerId: 'minimax',
      credentialSource: 'platform',
      minimaxModel: 'MiniMax-H3',
    })
    expect(JSON.parse(String(stored.metadata)).falEndpoint).toBeUndefined()
  })

  it('forwards seed and negativePrompt to Agnes video provider', async () => {
    await svc.generateVideo(
      'u1',
      'a prompt',
      'agnes-video-v2.0',
      5,
      '16:9',
      [],
      [],
      '720p',
      'none',
      undefined,
      undefined,
      undefined,
      undefined,
      42,
      'watermark, blur',
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls.at(-1)?.[1]).toMatchObject({
      model: 'agnes-video-v2.0',
      seed: 42,
      negativePrompt: 'watermark, blur',
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

  it('allows MiniMax H3 audio-only reference_to_video', async () => {
    await svc.generateVideo(
      'u1',
      'a prompt',
      'minimax-h3',
      5,
      '16:9',
      [{ refKey: 'A1', mediaType: 'audio', url: 'https://example.com/ref.mp3' }],
      [],
      '768p',
      'none',
      undefined,
      undefined,
      'reference_to_video',
    )
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls.at(-1)?.[1]).toMatchObject({
      videoMode: 'reference_to_video',
      referenceAudios: ['https://example.com/ref.mp3'],
    })
  })

  it('keeps incoming prompt when session canvas has neither text-p nor the video node', async () => {
    stubSessionCanvas(svc, {
      nodes: [{ id: 'image-i0', type: 'image', position: { x: 0, y: 0 }, data: { prompt: 'I0' } }],
      edges: [],
    })

    const record = await svc.generateVideo(
      'u1',
      'body prompt',
      'seedance-2.0-min',
      5,
      '16:9',
      [],
      [],
      '720p',
      'none',
      undefined,
      { sessionId: 's1', nodeId: 'video-v' },
    )

    expect(record.prompt).toContain('body prompt')
    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    expect(videoGenerate.mock.calls[0]?.[0]).toContain('body prompt')
  })

  it('throws when composition text-p is empty', async () => {
    stubSessionCanvas(svc, {
      nodes: [
        { id: 'text-p', type: 'text', position: { x: 0, y: 0 }, data: { prompt: '' } },
        { id: 'video-v', type: 'video', position: { x: 0, y: 0 }, data: { prompt: 'OLD' } },
      ],
      edges: [],
    })

    await expect(
      svc.generateVideo(
        'u1',
        'body prompt',
        'seedance-2.0-min',
        5,
        '16:9',
        [],
        [],
        '720p',
        'none',
        undefined,
        { sessionId: 's1', nodeId: 'video-v' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      svc.generateVideo(
        'u1',
        'body prompt',
        'seedance-2.0-min',
        5,
        '16:9',
        [],
        [],
        '720p',
        'none',
        undefined,
        { sessionId: 's1', nodeId: 'video-v' },
      ),
    ).rejects.toThrow('分镜还是空的，写好后再生成视频。')
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

    expect(generateTextForRefs).toHaveBeenCalledWith(
      'hello world',
      [],
      expect.objectContaining({
        model: 'gemini-3.1-flash',
        textOpts: { thinking: false, thinkingEffort: 'high' },
      }),
    )
  })

  it('passes catalog gateway model to generateTextForRefs when image refs present', async () => {
    const refUrl = 'https://example.com/dress.jpg'
    await svc.generateText('u1', 'describe dress', 'gemini-3.1-flash', [
      { refKey: 'i1', mediaType: 'image', url: refUrl },
    ])

    expect(inlineUpstreamReferenceImages).toHaveBeenCalledWith([refUrl])
    expect(generateTextForRefs).toHaveBeenCalledWith(
      'describe dress',
      [refUrl],
      expect.objectContaining({
        model: 'gemini-3.1-flash',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL,
      }),
    )
  })

  it('inlines non-fetchable ref URLs before text vision upstream call', async () => {
    const refUrl = 'http://119.29.173.89:8888/api/uploads/u1/ref.png'
    const inlined = 'data:image/png;base64,abc'
    vi.mocked(inlineUpstreamReferenceImages).mockResolvedValueOnce([inlined])

    await svc.generateText('u1', 'describe packaging', 'gemini-3.1-flash', [
      { refKey: 'I1', mediaType: 'image', url: refUrl },
    ])

    expect(inlineUpstreamReferenceImages).toHaveBeenCalledWith([refUrl])
    expect(generateTextForRefs).toHaveBeenCalledWith(
      'describe packaging',
      [inlined],
      expect.objectContaining({ model: 'gemini-3.1-flash' }),
    )
  })

  it('passes inlined image refs to generatePromptFromUserInput', async () => {
    const refUrl = 'https://example.com/bottle.jpg'
    const record = await svc.generatePrompt(
      'u1',
      '写主图提示词',
      'gemini-3.1-flash',
      undefined,
      undefined,
      undefined,
      [{ refKey: 'I1', mediaType: 'image', url: refUrl }],
      ['I1'],
    )
    expect(inlineUpstreamReferenceImages).toHaveBeenCalledWith([refUrl])
    expect(generatePromptFromUserInput).toHaveBeenCalledWith(
      '写主图提示词',
      expect.objectContaining({
        model: 'gemini-3.1-flash',
        referenceImages: [refUrl],
        mentionedKeys: ['I1'],
      }),
    )
    const meta = JSON.parse(String(record.metadata))
    expect(meta.visionUsed).toBe(true)
    expect(meta.referenceImages).toEqual([refUrl])
  })

  it('allows empty prompt when prompt node has image refs', async () => {
    await svc.generatePrompt(
      'u1',
      '  ',
      'gemini-3.1-flash',
      undefined,
      undefined,
      undefined,
      [{ refKey: 'I1', mediaType: 'image', url: 'https://example.com/bottle.jpg' }],
    )
    expect(generatePromptFromUserInput).toHaveBeenCalledWith(
      '请基于参考图生成结构化提示词',
      expect.objectContaining({
        referenceImages: ['https://example.com/bottle.jpg'],
      }),
    )
  })

  it('still rejects empty prompt without image refs', async () => {
    await expect(svc.generatePrompt('u1', '')).rejects.toBeInstanceOf(BadRequestException)
  })
})
