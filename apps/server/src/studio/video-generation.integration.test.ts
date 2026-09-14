/** @vitest-environment node */
import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  buildVideoProviderOptions,
  buildVideoReferenceBundle,
} from '@lnkpi/agent'
import type { GenerationRefPayload, VideoGenerationMode } from '@lnkpi/shared'
import { MediaProbeService } from '../media/media-probe.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { UploadService } from '../upload/upload.service'
import { buildCanonicalVideoRequestFromBody } from './video-generation-request.util'
import { createMediaProbeMock, createPrismaMock, defaultPlatformResolve } from './studio.test-utils'
import { StudioService } from './studio.service'

const IMAGE_A = 'https://cdn.example/a.png'
const IMAGE_B = 'https://cdn.example/b.png'
const VIDEO_REF = 'https://cdn.example/camera.mp4'

function buildProviderOptionsForStartBody(input: {
  videoMode: VideoGenerationMode
  refs: GenerationRefPayload[]
  model?: string
}) {
  const canonical = buildCanonicalVideoRequestFromBody({
    prompt: 'test prompt',
    model: input.model ?? 'seedance-2.0-min',
    videoMode: input.videoMode,
    refs: input.refs,
    sessionId: 'sess_test',
    nodeId: 'node_test',
  })
  const referenceBundle = buildVideoReferenceBundle(canonical.refs)
  return buildVideoProviderOptions({
    modelKey: canonical.model,
    duration: canonical.videoSettings.duration,
    aspectRatio: canonical.videoSettings.aspectRatio,
    resolution: canonical.videoSettings.resolution,
    crop: canonical.videoSettings.crop,
    videoMode: canonical.videoMode,
    referenceBundle,
    generateAudio: canonical.videoSettings.generateAudio,
    seed: canonical.seed,
    negativePrompt: canonical.negativePrompt,
  })
}

describe('POST /studio/video/start refs × videoMode matrix (G-12)', () => {
  it('image_to_video + 1×I → S2', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'image_to_video',
      refs: [{ refKey: 'I1', mediaType: 'image', url: IMAGE_A }],
    })

    expect(built.meta.scenario).toBe('S2')
    expect(built.meta.refWire).toBe('apimart_multimodal')
    expect(built.providerOptions.returnLastFrame).toBe(true)
    expect(built.providerOptions.referenceImages).toEqual([IMAGE_A])
  })

  it('first_last_frame + 2×I → S5 (Seedance)', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'first_last_frame',
      refs: [
        { refKey: 'I1', mediaType: 'image', url: IMAGE_A },
        { refKey: 'I2', mediaType: 'image', url: IMAGE_B },
      ],
      model: 'seedance-2.0-min',
    })

    expect(built.meta.scenario).toBe('S5')
    expect(built.meta.refWire).toBe('apimart_first_last')
    expect(built.providerOptions.returnLastFrame).toBeUndefined()
    expect(built.providerOptions.imageWithRoles).toEqual([
      { url: IMAGE_A, role: 'first_frame' },
      { url: IMAGE_B, role: 'last_frame' },
    ])
  })

  it('image_to_video + 2×I → S4', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'image_to_video',
      refs: [
        { refKey: 'I1', mediaType: 'image', url: IMAGE_A },
        { refKey: 'I2', mediaType: 'image', url: IMAGE_B },
      ],
    })

    expect(built.meta.scenario).toBe('S4')
    expect(built.meta.refWire).toBe('apimart_multimodal')
    expect(built.providerOptions.referenceImages).toEqual([IMAGE_A, IMAGE_B])
  })

  it('text_to_video + 1×V → S6', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'text_to_video',
      refs: [{ refKey: 'V1', mediaType: 'video', url: VIDEO_REF }],
    })

    expect(built.meta.scenario).toBe('S6')
    expect(built.meta.refWire).toBe('apimart_multimodal')
    expect(built.meta.refVideoMode).toBe('native')
    expect(built.providerOptions.referenceVideos).toEqual([VIDEO_REF])
  })

  it('keeps explicit reference_to_video through canonical start body', () => {
    const canonical = buildCanonicalVideoRequestFromBody({
      prompt: 'test prompt',
      model: 'minimax-h3',
      videoMode: 'reference_to_video',
      refs: [
        { refKey: 'I1', mediaType: 'image', url: IMAGE_A },
        { refKey: 'V1', mediaType: 'video', url: VIDEO_REF },
      ],
    })
    expect(canonical.videoMode).toBe('reference_to_video')
  })

  it('reference_to_video + I + V on H3 maps to native reference roles', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'reference_to_video',
      refs: [
        { refKey: 'I1', mediaType: 'image', url: IMAGE_A },
        { refKey: 'V1', mediaType: 'video', url: VIDEO_REF },
      ],
      model: 'minimax-h3',
    })

    expect(built.providerOptions.videoMode).toBe('reference_to_video')
    expect(built.providerOptions.referenceImages).toEqual([IMAGE_A])
    expect(built.providerOptions.referenceVideos).toEqual([VIDEO_REF])
    expect(built.providerOptions.imageWithRoles).toBeUndefined()
  })
})

describe('StudioService MiniMax H3 reference_to_video limits', () => {
  let svc: StudioService
  let consume: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    consume = vi.fn(async () => {})
    const prisma = createPrismaMock()
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        { provide: PointsService, useValue: { consume, refund: vi.fn(async () => {}) } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ProviderResolverService,
          useValue: {
            resolveForGeneration: vi.fn(async (_userId: string, model?: string) =>
              defaultPlatformResolve(model ?? 'minimax-h3'),
            ),
          },
        },
        { provide: MediaProbeService, useValue: createMediaProbeMock() },
        {
          provide: UploadService,
          useValue: { saveUserFile: vi.fn(async () => ({ url: 'https://cdn/comp.png' })) },
        },
      ],
    }).compile()
    svc = moduleRef.get(StudioService)
  })

  it('rejects over-limit MiniMax H3 reference payloads with 400 before charging', async () => {
    await expect(
      svc.generateVideo(
        'u1',
        'test prompt',
        'minimax-h3',
        5,
        '16:9',
        Array.from({ length: 10 }, (_, i) => ({
          refKey: `I${i + 1}`,
          mediaType: 'image',
          url: `https://cdn.example/i${i + 1}.png`,
        })),
        [],
        '768p',
        'none',
        undefined,
        undefined,
        'reference_to_video',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)

    await expect(
      svc.generateVideo(
        'u1',
        'test prompt',
        'minimax-h3',
        5,
        '16:9',
        Array.from({ length: 10 }, (_, i) => ({
          refKey: `I${i + 1}`,
          mediaType: 'image',
          url: `https://cdn.example/i${i + 1}.png`,
        })),
        [],
        '768p',
        'none',
        undefined,
        undefined,
        'reference_to_video',
      ),
    ).rejects.toThrow(/图最多 9 张/)

    expect(consume).not.toHaveBeenCalled()
  })
})
