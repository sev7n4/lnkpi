import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common'
import { createUpscaleProviders } from '@lnkpi/agent'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { SessionsService } from '../sessions/sessions.service'
import { UPSCALE_POINT_COST, UpscaleService } from './upscale.service'

const upscaleFn = vi.fn()
const supportsScale = vi.fn((scale: 2 | 4) => scale === 2 || scale === 4)

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createUpscaleProviders: vi.fn(() => [
      {
        id: 'fal',
        supportsScale,
        upscale: upscaleFn,
      },
    ]),
  }
})

vi.mock('../media/upstream-ref-inline', () => ({
  inlineUpstreamReferenceImages: vi.fn(async (urls: string[]) => urls),
}))

describe('UpscaleService', () => {
  let svc: UpscaleService
  let pointsConsume: ReturnType<typeof vi.fn>
  let pointsRefund: ReturnType<typeof vi.fn>
  let generationCreate: ReturnType<typeof vi.fn>
  let generationUpdate: ReturnType<typeof vi.fn>
  let findOne: ReturnType<typeof vi.fn>
  let stored: Record<string, unknown>

  const baseInput = {
    userId: 'u1',
    sessionId: 's1',
    imageUrl: 'https://cdn/base.png',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    stored = {}
    pointsConsume = vi.fn(async () => {})
    pointsRefund = vi.fn(async () => {})
    supportsScale.mockImplementation((scale: 2 | 4) => scale === 2 || scale === 4)
    upscaleFn.mockResolvedValue({
      url: 'https://cdn/upscaled.png',
      providerId: 'fal',
      modelId: 'fal-ai/esrgan',
    })
    vi.mocked(createUpscaleProviders).mockReturnValue([
      {
        id: 'fal',
        supportsScale,
        upscale: upscaleFn,
      },
    ])
    findOne = vi.fn(async () => ({
      id: 's1',
      userId: 'u1',
      canvasData: {
        nodes: [
          {
            id: 'n1',
            type: 'image',
            data: { url: 'https://cdn/from-node.png' },
          },
        ],
        edges: [],
      },
    }))
    generationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
      stored = { id: 'g-up', createdAt: new Date(), ...args.data }
      return stored
    })
    generationUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      stored = { ...stored, ...args.data, id: args.where.id }
      return stored
    })

    const moduleRef = await Test.createTestingModule({
      providers: [
        UpscaleService,
        {
          provide: PointsService,
          useValue: { consume: pointsConsume, refund: pointsRefund },
        },
        {
          provide: PrismaService,
          useValue: {
            generationRecord: {
              create: generationCreate,
              update: generationUpdate,
              findFirst: vi.fn(async () => stored),
            },
          },
        },
        {
          provide: SessionsService,
          useValue: { findOne },
        },
      ],
    }).compile()

    svc = moduleRef.get(UpscaleService)
  })

  it('throws NotImplemented when no providers registered', async () => {
    vi.mocked(createUpscaleProviders).mockReturnValueOnce([])

    await expect(svc.upscale(baseInput)).rejects.toBeInstanceOf(NotImplementedException)
    expect(pointsConsume).not.toHaveBeenCalled()
    expect(generationCreate).not.toHaveBeenCalled()
  })

  it('throws BadRequest when provider does not support scale=4', async () => {
    supportsScale.mockReturnValue(false)

    await expect(svc.upscale({ ...baseInput, scale: 4 })).rejects.toBeInstanceOf(BadRequestException)
    expect(pointsConsume).not.toHaveBeenCalled()
  })

  it('propagates 积分不足 from consume and does not create record', async () => {
    pointsConsume.mockRejectedValueOnce(new BadRequestException('积分不足'))

    await expect(svc.upscale(baseInput)).rejects.toMatchObject({
      message: expect.stringContaining('积分不足'),
    })
    expect(generationCreate).not.toHaveBeenCalled()
    expect(upscaleFn).not.toHaveBeenCalled()
  })

  it('resolves imageUrl from nodeId via session canvasData', async () => {
    const out = await svc.upscale({
      userId: 'u1',
      sessionId: 's1',
      nodeId: 'n1',
    })

    expect(findOne).toHaveBeenCalledWith('s1', 'u1')
    expect(upscaleFn).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: 'https://cdn/from-node.png', scale: 2 }),
    )
    expect(out.url).toBe('https://cdn/upscaled.png')
  })

  it('throws when nodeId missing from canvas', async () => {
    await expect(
      svc.upscale({ userId: 'u1', sessionId: 's1', nodeId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(pointsConsume).not.toHaveBeenCalled()
  })

  it('consumes points, writes image_upscale record, returns result on success', async () => {
    const out = await svc.upscale({ ...baseInput, scale: 2 })

    expect(createUpscaleProviders).toHaveBeenCalledWith(
      expect.objectContaining({ falApiKey: process.env.FAL_KEY }),
    )
    expect(pointsConsume).toHaveBeenCalledWith(
      'u1',
      UPSCALE_POINT_COST,
      '图像放大',
      expect.objectContaining({ kind: 'consume', category: 'image', status: 'success' }),
    )
    expect(generationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'image_upscale',
          status: 'generating',
          sessionId: 's1',
        }),
      }),
    )
    expect(stored.status).toBe('completed')
    expect(stored.url).toBe('https://cdn/upscaled.png')
    expect(out).toEqual({
      url: 'https://cdn/upscaled.png',
      scale: 2,
      providerId: 'fal',
      recordId: 'g-up',
    })
  })

  it('refunds points and marks record failed when provider throws', async () => {
    upscaleFn.mockRejectedValueOnce(new Error('upstream 502'))

    await expect(svc.upscale(baseInput)).rejects.toBeInstanceOf(BadRequestException)
    expect(pointsRefund).toHaveBeenCalledWith(
      'u1',
      UPSCALE_POINT_COST,
      '图像放大-失败退款',
      expect.objectContaining({ kind: 'refund', category: 'image', status: 'failed_refund' }),
    )
    expect(stored.status).toBe('failed')
    expect(stored.type).toBe('image_upscale')
  })
})
