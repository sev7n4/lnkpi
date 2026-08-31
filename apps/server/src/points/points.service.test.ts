import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { PointsService } from './points.service'
import { PrismaService } from '../prisma/prisma.service'

describe('PointsService', () => {
  it('decrements points and writes negative transaction when balance is enough', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findUnique = vi.fn(async () => ({ points: 90 }))
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'pt1', ...args.data }))
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { updateMany, findUnique },
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

    await svc.consume('u1', 10, '图像生成', {
      kind: 'consume',
      category: 'image',
      status: 'success',
      model: 'seedream',
    })

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', points: { gte: 10 } },
      data: { points: { decrement: 10 } },
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: -10,
        reason: '图像生成',
        kind: 'consume',
        category: 'image',
        status: 'success',
        model: 'seedream',
        generationId: null,
        balanceAfter: 90,
      },
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

  it('increments points and writes positive transaction on refund', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findUnique = vi.fn(async () => ({ points: 95 }))
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'pt2', ...args.data }))
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ user: { updateMany, findUnique }, pointTransaction: { create } }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()

    await moduleRef.get(PointsService).refund('u1', 5, '文本生成退款', {
      kind: 'refund',
      category: 'text',
      status: 'failed_refund',
      generationId: 'gen-1',
    })

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { points: { increment: 5 } },
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: 5,
        reason: '文本生成退款',
        kind: 'refund',
        category: 'text',
        status: 'failed_refund',
        model: null,
        generationId: 'gen-1',
        balanceAfter: 95,
      },
    })
  })

  it('derives structured fields from reason when consume meta is omitted', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findUnique = vi.fn(async () => ({ points: 90 }))
    const create = vi.fn()
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ user: { updateMany, findUnique }, pointTransaction: { create } }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()

    await moduleRef.get(PointsService).consume('u1', 10, '图像生成')

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: -10,
        reason: '图像生成',
        kind: 'consume',
        category: 'image',
        status: 'success',
        model: null,
        generationId: null,
        balanceAfter: 90,
      },
    })
  })

  it('derives refund status from reason when meta is omitted', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findUnique = vi.fn(async () => ({ points: 95 }))
    const create = vi.fn()
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ user: { updateMany, findUnique }, pointTransaction: { create } }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()

    await moduleRef.get(PointsService).refund('u1', 5, '文本生成-失败退款')

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: 5,
        reason: '文本生成-失败退款',
        kind: 'refund',
        category: 'text',
        status: 'failed_refund',
        model: null,
        generationId: null,
        balanceAfter: 95,
      },
    })
  })

  it('no-ops when refund amount <= 0', async () => {
    const $transaction = vi.fn()
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()
    await moduleRef.get(PointsService).refund('u1', 0, 'x')
    expect($transaction).not.toHaveBeenCalled()
  })
})
