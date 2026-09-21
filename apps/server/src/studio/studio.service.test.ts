import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { createImageEditProvider } from '@lnkpi/agent'
import { BadRequestException } from '@nestjs/common'
import { P1_IMAGE_EDIT_MODEL_KEY, IMAGE_EDIT_MODEL_PRICING } from '@lnkpi/shared'
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

describe('editImage 参数化与定价', () => {
  let svc: StudioService
  let resolveForGeneration: ReturnType<typeof vi.fn>
  let generationCreate: ReturnType<typeof vi.fn>
  let generationUpdate: ReturnType<typeof vi.fn>
  let generationUpdateMany: ReturnType<typeof vi.fn>
  let pointsConsume: ReturnType<typeof vi.fn>
  let pointsRefund: ReturnType<typeof vi.fn>
  let saveUserFile: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>

  const baseInput = {
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
    generationUpdateMany = vi.fn(async (args: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
      if (args.where.status && stored.status !== args.where.status) return { count: 0 }
      stored = { ...stored, ...args.data, id: args.where.id }
      return { count: 1 }
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
              updateMany: generationUpdateMany,
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

  it('缺省字段：走 image2、扣 10 分（与旧行为一致）', async () => {
    const record = await svc.editImage('u1', { ...baseInput })

    expect(resolveForGeneration).toHaveBeenCalledWith('u1', P1_IMAGE_EDIT_MODEL_KEY, 'image')
    expect(pointsConsume).toHaveBeenCalledWith(
      'u1',
      IMAGE_EDIT_MODEL_PRICING[P1_IMAGE_EDIT_MODEL_KEY],
      '图像精修',
      expect.objectContaining({ kind: 'consume', category: 'image', status: 'success' }),
    )
    const meta = JSON.parse(String(record.metadata))
    expect(meta.gatewayModelId).toBe('gpt-image-2-official')
    expect(meta.editModelKey).toBe(P1_IMAGE_EDIT_MODEL_KEY)
    expect(meta.editMode).toBe('inpaint')
    expect(meta.editSize).toBe('auto')
  })

  it('白名单外 model → BadRequestException，且 points.consume 未被调', async () => {
    await expect(
      svc.editImage('u1', { ...baseInput, model: 'seedream-5.0-pro' }),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(pointsConsume).toHaveBeenCalledTimes(0)
    expect(generationCreate).not.toHaveBeenCalled()
  })

  it('mode=outpaint 时 metadata 记录 outpaintFrom/outpaintTo', async () => {
    const record = await svc.editImage('u1', { ...baseInput, mode: 'outpaint' })

    const meta = JSON.parse(String(record.metadata))
    expect(meta.editMode).toBe('outpaint')
    expect(meta.outpaintFrom).toEqual({ width: 64, height: 64 })
    expect(meta.outpaintTo).toEqual({ width: 64, height: 64 })
  })

  it('mode=outpaint 且携带 outpaintFrom/outpaintTo 时透传进 metadata', async () => {
    const record = await svc.editImage('u1', {
      ...baseInput,
      mode: 'outpaint',
      outpaintFrom: { width: 512, height: 512 },
      outpaintTo: { width: 1024, height: 768 },
    })

    const meta = JSON.parse(String(record.metadata))
    expect(meta.outpaintFrom).toEqual({ width: 512, height: 512 })
    expect(meta.outpaintTo).toEqual({ width: 1024, height: 768 })
  })
})
