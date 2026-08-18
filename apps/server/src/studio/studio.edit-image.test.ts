import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createImageEditProvider } from '@lnkpi/agent'
import { BadRequestException } from '@nestjs/common'
import { P1_IMAGE_EDIT_MODEL_KEY } from '@lnkpi/shared'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { MediaProbeService } from '../media/media-probe.service'
import { UploadService } from '../upload/upload.service'
import {
  MaskDimensionMismatchError,
  assertSameDimensions,
  compositeUnmaskedPixels,
  readImageBuffer,
} from '../media/composite-unmasked'
import { StudioService } from './studio.service'

const imageEdit = vi.fn()

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createImageEditProvider: vi.fn(() => ({ edit: imageEdit })),
  }
})
vi.mock('../media/composite-unmasked', () => ({
  MaskDimensionMismatchError: class MaskDimensionMismatchError extends Error {},
  readImageBuffer: vi.fn(),
  assertSameDimensions: vi.fn(),
  compositeUnmaskedPixels: vi.fn(),
}))
vi.mock('../media/upstream-ref-inline', () => ({
  inlineUpstreamReferenceImages: vi.fn(async (urls: string[]) => urls),
}))

const platformResolved = {
  channelId: 'platform',
  modelName: 'image2',
  apiFormat: 'openai' as const,
  credentials: { apiKey: 'plat-key', baseUrl: 'https://platform.example.com/v1' },
  source: 'platform' as const,
}

describe('StudioService.editImage', () => {
  let svc: StudioService
  let resolveForGeneration: ReturnType<typeof vi.fn>
  let generationCreate: ReturnType<typeof vi.fn>
  let generationUpdate: ReturnType<typeof vi.fn>
  let pointsConsume: ReturnType<typeof vi.fn>
  let pointsRefund: ReturnType<typeof vi.fn>
  let saveUserFile: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>

  const input = {
    prompt: '去除污渍',
    imageUrl: 'https://cdn/base.png',
    maskUrl: 'https://cdn/mask.png',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    stored = {}
    pointsConsume = vi.fn(async () => {})
    pointsRefund = vi.fn(async () => {})
    saveUserFile = vi.fn(async () => ({ url: 'https://cdn/comp.png' }))
    resolveForGeneration = vi.fn(async () => platformResolved)
    generationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
      stored = { id: 'g1', createdAt: new Date(), ...args.data }
      return stored
    })
    generationUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return stored
    })

    vi.mocked(readImageBuffer).mockResolvedValue(Buffer.from('img'))
    vi.mocked(assertSameDimensions).mockResolvedValue({ width: 64, height: 64 })
    vi.mocked(compositeUnmaskedPixels).mockResolvedValue({
      buffer: Buffer.from('comp'),
      width: 64,
      height: 64,
    })
    imageEdit.mockResolvedValue({ url: 'https://upstream/edit.png' })

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
              updateMany: vi.fn(async () => ({ count: 1 })),
              findFirst: vi.fn(async () => stored),
              findMany: vi.fn(async () => []),
            },
          },
        },
        {
          provide: ProviderResolverService,
          useValue: { resolveForGeneration },
        },
        {
          provide: MediaProbeService,
          useValue: { probeUrl: vi.fn(async (url: string) => ({ url, probeStatus: 'ok' as const })) },
        },
        {
          provide: UploadService,
          useValue: { saveUserFile },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  it('rejects mask dimension mismatch with 400 and does not consume points', async () => {
    vi.mocked(assertSameDimensions).mockRejectedValueOnce(new MaskDimensionMismatchError())

    await expect(svc.editImage('u1', input)).rejects.toBeInstanceOf(BadRequestException)
    expect(pointsConsume).toHaveBeenCalledTimes(0)
    expect(generationCreate).not.toHaveBeenCalled()
  })

  it('returns composited url on success with image_edit record', async () => {
    const record = await svc.editImage('u1', input)

    expect(resolveForGeneration).toHaveBeenCalledWith('u1', P1_IMAGE_EDIT_MODEL_KEY, 'image')
    expect(pointsConsume).toHaveBeenCalledWith('u1', 10, '图像精修')
    expect(createImageEditProvider).toHaveBeenCalled()
    expect(imageEdit).toHaveBeenCalled()
    expect(compositeUnmaskedPixels).toHaveBeenCalled()
    expect(saveUserFile).toHaveBeenCalled()
    expect(record.type).toBe('image_edit')
    expect(record.url).toBe('https://cdn/comp.png')
    expect(JSON.parse(String(record.metadata)).composited).toBe(true)
  })

  it('refunds points and marks record failed when provider throws', async () => {
    imageEdit.mockRejectedValueOnce(new Error('upstream 502'))

    await expect(svc.editImage('u1', input)).rejects.toBeInstanceOf(BadRequestException)
    expect(pointsRefund).toHaveBeenCalled()
    expect(stored.status).toBe('failed')
    expect(stored.type).toBe('image_edit')
  })
})
