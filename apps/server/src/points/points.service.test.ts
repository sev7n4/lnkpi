import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { PointsService } from './points.service'
import { PrismaService } from '../prisma/prisma.service'

describe('PointsService', () => {
  it('decrements points and writes negative transaction when balance is enough', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'pt1', ...args.data }))
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { updateMany },
        pointTransaction: { create },
      }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()
    const svc = moduleRef.get(PointsService)

    await svc.consume('u1', 10, '图像生成')

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', points: { gte: 10 } },
      data: { points: { decrement: 10 } },
    })
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: -10, reason: '图像生成' },
    })
  })

  it('throws 积分不足 when conditional update matches zero rows', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }))
    const create = vi.fn()
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { updateMany },
        pointTransaction: { create },
      }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()

    await expect(moduleRef.get(PointsService).consume('u1', 10, '图像生成')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(create).not.toHaveBeenCalled()
  })
})
