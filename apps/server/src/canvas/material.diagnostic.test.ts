import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { MaterialService } from './material.service'

describe('MaterialService.getMaterialDiagnostic', () => {
  let svc: MaterialService
  let materialFindFirst: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    materialFindFirst = vi.fn()

    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterialService,
        {
          provide: PointsService,
          useValue: { consume: vi.fn(), refund: vi.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            shot: { findUnique: vi.fn() },
            material: {
              create: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
              findFirst: materialFindFirst,
            },
          },
        },
        {
          provide: ProviderResolverService,
          useValue: { resolveForGeneration: vi.fn() },
        },
      ],
    }).compile()

    svc = moduleRef.get(MaterialService)
  })

  it('getMaterialDiagnostic returns 404 when not failed', async () => {
    materialFindFirst.mockResolvedValue({
      id: 'm1',
      type: 'image',
      status: 'completed',
      prompt: 'a cat',
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      metadata: JSON.stringify({}),
      shot: { session: { userId: 'u1', id: 'sess-1' } },
    })

    await expect(svc.getMaterialDiagnostic('u1', 'm1')).rejects.toThrow(/不存在|找不到|诊断/)
    await expect(svc.getMaterialDiagnostic('u1', 'm1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getMaterialDiagnostic redacts provider snippet', async () => {
    materialFindFirst.mockResolvedValue({
      id: 'm1',
      type: 'image',
      status: 'failed',
      prompt: 'a cat',
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      metadata: JSON.stringify({
        errorCode: 'upstream_error',
        errorRaw: 'Bearer sk-secret hello',
        userMessage: '上游服务异常',
        failedAt: '2026-07-21T01:00:00.000Z',
        channelId: 'platform',
        model: 'seedream-5.0-pro',
      }),
      shot: { session: { userId: 'u1', id: 'sess-1' } },
    })

    const d = await svc.getMaterialDiagnostic('u1', 'm1')
    expect(d.code).toBe('upstream_error')
    expect(d.taskKind).toBe('material')
    expect(d.taskId).toBe('m1')
    expect(d.providerSnippet).not.toContain('sk-secret')
  })

  it('getMaterialDiagnostic allows status error', async () => {
    materialFindFirst.mockResolvedValue({
      id: 'm2',
      type: 'video',
      status: 'error',
      prompt: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      metadata: JSON.stringify({
        errorCode: 'upstream_timeout',
        errorRaw: 'timeout of 90000ms exceeded',
        failedAt: '2026-07-21T02:00:00.000Z',
      }),
      shot: { session: { userId: 'u1', id: 'sess-1' } },
    })

    const d = await svc.getMaterialDiagnostic('u1', 'm2')
    expect(d.code).toBe('upstream_timeout')
    expect(d.taskId).toBe('m2')
    expect(d.taskKind).toBe('material')
  })
})
