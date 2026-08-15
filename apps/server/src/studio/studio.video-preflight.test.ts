import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createVideoProvider, mergeRefsToPrompt } from '@lnkpi/agent'
import { MediaProbeService } from '../media/media-probe.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { createPrismaMock, defaultPlatformResolve } from './studio.test-utils'
import { StudioService } from './studio.service'

const videoGenerate = vi.fn(async () => ({ url: 'https://example.com/v.mp4' }))

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    mergeRefsToPrompt: vi.fn(async (input: { localPrompt?: string }) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    })),
    createVideoProvider: vi.fn(() => ({ generate: videoGenerate })),
  }
})

describe('StudioService video reference preflight', () => {
  let svc: StudioService
  let probeUrl: ReturnType<typeof vi.fn>
  let pointsRefund: ReturnType<typeof vi.fn>
  let generationCreate: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    pointsRefund = vi.fn(async () => {})
    generationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'g1',
      createdAt: new Date(),
      ...args.data,
    }))
    probeUrl = vi.fn(async (url: string) => {
      if (url.includes('ref3')) {
        return {
          url,
          width: 3072,
          height: 4096,
          bytes: 13 * 1024 * 1024,
          mimeType: 'image/png',
          probeStatus: 'ok' as const,
        }
      }
      return {
        url,
        width: 1024,
        height: 1024,
        bytes: 900_000,
        mimeType: 'image/png',
        probeStatus: 'ok' as const,
      }
    })

    const prisma = createPrismaMock()
    prisma.generationRecord.create = generationCreate

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PointsService,
          useValue: {
            consume: vi.fn(async () => {}),
            refund: pointsRefund,
          },
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ProviderResolverService,
          useValue: {
            resolveForGeneration: vi.fn(async (_userId: string, model?: string) =>
              defaultPlatformResolve(model ?? 'agnes-video-v2.0'),
            ),
          },
        },
        {
          provide: MediaProbeService,
          useValue: { probeUrl },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
    vi.mocked(mergeRefsToPrompt).mockImplementation(async (input) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    }))
  })

  it('blocks agnes_keyframes when ref exceeds error threshold', async () => {
    await expect(
      svc.generateVideo(
        'u1',
        'a prompt',
        'agnes-video-v2.0',
        5,
        '16:9',
        [
          { refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref1.png' },
          { refKey: 'I2', mediaType: 'image', url: 'https://example.com/ref2.png' },
          { refKey: 'I3', mediaType: 'image', url: 'https://example.com/ref3.png' },
        ],
      ),
    ).rejects.toThrow(/I3|过大/)

    await expect(
      svc.generateVideo(
        'u1',
        'a prompt',
        'agnes-video-v2.0',
        5,
        '16:9',
        [
          { refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref1.png' },
          { refKey: 'I2', mediaType: 'image', url: 'https://example.com/ref2.png' },
          { refKey: 'I3', mediaType: 'image', url: 'https://example.com/ref3.png' },
        ],
      ),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(videoGenerate).not.toHaveBeenCalled()
    expect(generationCreate).not.toHaveBeenCalled()
    expect(pointsRefund).toHaveBeenCalled()
  })
})
