import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { StudioService } from './studio.service'

describe('StudioService.getGenerationDiagnostic', () => {
  let svc: StudioService
  let generationFindFirst: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    generationFindFirst = vi.fn()

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PointsService,
          useValue: { consume: vi.fn(), refund: vi.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            generationRecord: {
              create: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
              findFirst: generationFindFirst,
              findMany: vi.fn(async () => []),
            },
          },
        },
        {
          provide: ProviderResolverService,
          useValue: { resolveForGeneration: vi.fn() },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  it('getGenerationDiagnostic returns 404 when not failed', async () => {
    generationFindFirst.mockResolvedValue({
      id: 'g1',
      userId: 'u1',
      status: 'completed',
      model: 'seedream-5.0-pro',
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      metadata: JSON.stringify({}),
    })

    await expect(svc.getGenerationDiagnostic('u1', 'g1')).rejects.toThrow(/不存在|找不到|诊断/)
    await expect(svc.getGenerationDiagnostic('u1', 'g1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getGenerationDiagnostic redacts provider snippet', async () => {
    generationFindFirst.mockResolvedValue({
      id: 'g1',
      userId: 'u1',
      status: 'failed',
      model: 'seedream-5.0-pro',
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      metadata: JSON.stringify({
        errorCode: 'upstream_error',
        errorRaw: 'Bearer sk-secret hello',
        userMessage: '上游服务异常',
        failedAt: '2026-07-21T01:00:00.000Z',
        channelId: 'platform',
      }),
    })

    const d = await svc.getGenerationDiagnostic('u1', 'g1')
    expect(d.code).toBe('upstream_error')
    expect(d.taskKind).toBe('generation')
    expect(d.taskId).toBe('g1')
    expect(d.providerSnippet).not.toContain('sk-secret')
  })

  it('getGenerationDiagnostic allows status error', async () => {
    generationFindFirst.mockResolvedValue({
      id: 'g2',
      userId: 'u1',
      status: 'error',
      model: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      metadata: JSON.stringify({
        errorCode: 'upstream_timeout',
        errorRaw: 'timeout of 90000ms exceeded',
        failedAt: '2026-07-21T02:00:00.000Z',
      }),
    })

    const d = await svc.getGenerationDiagnostic('u1', 'g2')
    expect(d.code).toBe('upstream_timeout')
    expect(d.taskId).toBe('g2')
  })
})
