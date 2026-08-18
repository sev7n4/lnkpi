import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createImageProvider } from '@lnkpi/agent'
import { MediaProbeService } from '../media/media-probe.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { UploadService } from '../upload/upload.service'
import { createMediaProbeMock, createPrismaMock, defaultPlatformResolve } from './studio.test-utils'
import { StudioService } from './studio.service'

const imageGenerate = vi.fn(async () => ({
  url: 'https://example.com/output.png',
  urls: ['https://example.com/output.png'],
}))

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
  }
})

describe('StudioService mediaInfo on generation complete', () => {
  let svc: StudioService
  let probeUrl: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>
  let generationUpdate: ReturnType<typeof vi.fn>
  let generationFindFirst: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    stored = {
      id: 'g1',
      status: 'generating',
      metadata: JSON.stringify({
        referenceImages: ['https://example.com/ref.png'],
      }),
    }
    probeUrl = vi.fn(async (url: string) => ({
      url,
      width: url.includes('output') ? 1920 : 1024,
      height: url.includes('output') ? 1080 : 768,
      bytes: 900_000,
      mimeType: 'image/png',
      probeStatus: 'ok' as const,
    }))
    generationUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return stored
    })
    generationFindFirst = vi.fn(async () => stored)

    const prisma = createPrismaMock()
    prisma.generationRecord.create = vi.fn(async (args: { data: Record<string, unknown> }) => {
      stored = { id: 'g1', createdAt: new Date(), ...args.data }
      return stored
    })
    prisma.generationRecord.update = generationUpdate
    prisma.generationRecord.updateMany = vi.fn(async (args: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return { count: 1 }
    })
    prisma.generationRecord.findFirst = generationFindFirst

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        PointsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ProviderResolverService,
          useValue: {
            resolveForGeneration: vi.fn(async (_userId: string, model?: string) =>
              defaultPlatformResolve(model ?? 'gpt-image-1'),
            ),
          },
        },
        {
          provide: MediaProbeService,
          useValue: { probeUrl },
        },
        {
          provide: UploadService,
          useValue: { saveUserFile: vi.fn(async () => ({ url: 'https://cdn/comp.png' })) },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  it('persists mediaInfo in the same write as status=completed', async () => {
    const record = await svc.generateImage(
      'u1',
      'a prompt',
      'gpt-image-1',
      '16:9',
      [{ refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref.png' }],
    )

    expect(record?.status).toBe('completed')
    const meta = JSON.parse(String(stored.metadata))
    expect(meta.mediaInfo?.output?.width).toBe(1920)
    expect(meta.mediaInfo?.references?.[0]?.width).toBe(1024)
    expect(meta.mediaInfo?.probedAt).toBeTruthy()
    expect(generationUpdate).not.toHaveBeenCalled()
  })

  it('getGeneration returns parsed mediaInfo from metadata', async () => {
    const mediaInfo = {
      output: {
        url: 'https://example.com/output.png',
        width: 1920,
        height: 1080,
        probeStatus: 'ok' as const,
      },
      probedAt: '2026-08-15T12:00:00.000Z',
    }
    stored = {
      id: 'g1',
      userId: 'u1',
      status: 'completed',
      metadata: JSON.stringify({ mediaInfo }),
    }

    const record = await svc.getGeneration('u1', 'g1')
    expect(record.mediaInfo).toEqual(mediaInfo)
  })
})
