import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { MembershipService } from './membership.service'

describe('MembershipService', () => {
  const findMany = vi.fn()
  const findFirst = vi.fn()
  const groupBy = vi.fn()
  const userUpdate = vi.fn()
  const transactionCreate = vi.fn()
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      user: { update: userUpdate },
      pointTransaction: { create: transactionCreate },
    }),
  )
  const $queryRaw = vi.fn()
  let service: MembershipService

  beforeEach(async () => {
    vi.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        MembershipService,
        {
          provide: PrismaService,
          useValue: {
            pointTransaction: { findMany, groupBy, findFirst },
            $transaction,
            $queryRaw,
          },
        },
      ],
    }).compile()
    service = moduleRef.get(MembershipService)
  })

  it('aggregates non-negative net consumption and insights for the selected range', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
    groupBy.mockResolvedValue([
      { kind: 'consume', category: 'image', _sum: { amount: -30 } },
      { kind: 'refund', category: 'image', _sum: { amount: 10 } },
      { kind: 'grant', category: 'other', _sum: { amount: 100 } },
    ])
    findMany.mockResolvedValue([
      { createdAt: new Date('2026-08-18T10:00:00.000Z'), amount: -20 },
      { createdAt: new Date('2026-08-19T10:00:00.000Z'), amount: -10 },
    ])

    const result = await service.pointsSummary('u1', 'month')
    expect(result.byCategory.image).toBe(20)
    expect(result.insights).toEqual({
      netConsumedTotal: 20,
      peakDayConsumed: 20,
      avgDailyConsumed: expect.any(Number),
      activeDays: 2,
      longestStreakDays: 2,
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', kind: 'consume' }),
        select: { createdAt: true, amount: true },
      }),
    )
    vi.useRealTimers()
  })

  it('filters transactions and returns a cursor for an extra row', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
    findMany.mockResolvedValue([
      { id: 'tx3', category: 'image' },
      { id: 'tx2', category: 'image' },
      { id: 'tx1', category: 'image' },
    ])

    await expect(
      service.listTransactions('u1', {
        range: '7d',
        kind: 'consume',
        category: 'image',
        cursor: 'tx4',
        limit: 2,
      }),
    ).resolves.toEqual({
      items: [
        { id: 'tx3', category: 'image' },
        { id: 'tx2', category: 'image' },
      ],
      nextCursor: 'tx2',
      from: '2026-08-13T12:00:00.000Z',
      to: '2026-08-20T12:00:00.000Z',
    })
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        kind: 'consume',
        category: 'image',
        createdAt: {
          gte: new Date('2026-08-13T12:00:00.000Z'),
          lte: new Date('2026-08-20T12:00:00.000Z'),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      cursor: { id: 'tx4' },
      skip: 1,
    })
    vi.useRealTimers()
  })

  it('filters transactions to a Shanghai day and ignores range', async () => {
    findMany.mockResolvedValue([{ id: 'tx1' }])
    await service.listTransactions('u1', { day: '2026-09-16', range: 'month', limit: 50 })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          createdAt: {
            gte: new Date('2026-09-15T16:00:00.000Z'),
            lt: new Date('2026-09-16T16:00:00.000Z'),
          },
        }),
      }),
    )
  })

  it('throws on invalid day', async () => {
    await expect(service.listTransactions('u1', { day: '2026-02-31' })).rejects.toThrow('无效日期')
  })

  it('writes structured grant fields when claiming daily points', async () => {
    userUpdate.mockResolvedValue({ points: 1100 })
    transactionCreate.mockResolvedValue({ id: 'tx1' })

    await expect(service.claimDaily('u1')).resolves.toEqual({ points: 1100, added: 100 })
    expect(transactionCreate).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: 100,
        reason: '每日签到',
        kind: 'grant',
        category: 'other',
        status: null,
        balanceAfter: 1100,
      },
    })
  })

  it('writes structured grant fields when upgrading a plan', async () => {
    userUpdate.mockResolvedValue({ points: 6000, membership: 'pro' })
    transactionCreate.mockResolvedValue({ id: 'tx1' })

    const result = await service.upgrade('u1', 'pro')

    expect(result.points).toBe(6000)
    expect(result.membership).toBe('pro')
    expect(transactionCreate).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: 5000,
        reason: '升级 专业版',
        kind: 'grant',
        category: 'other',
        status: null,
        balanceAfter: 6000,
      },
    })
  })

  it('returns lifetime overview and sparse heatmap days from raw daily rows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    groupBy.mockResolvedValue([
      { kind: 'consume', category: 'image', _sum: { amount: -30 } },
      { kind: 'refund', category: 'image', _sum: { amount: 10 } },
    ])
    $queryRaw
      .mockResolvedValueOnce([{ distinctGens: 2, nullGens: 1, activeDays: 4 }])
      .mockResolvedValueOnce([
        { day: '2026-09-14', kind: 'consume', category: 'image', amountSum: -20 },
      ])
      .mockResolvedValueOnce([{ day: '2026-09-14', distinctGens: 1, nullGens: 0 }])

    const result = await service.usage('u1')
    expect(result.overview).toEqual({
      netConsumedTotal: 20,
      byCategory: { text: 0, image: 20, audio: 0, video: 0 },
      otherNetConsumed: 0,
      generationCount: 3,
      activeDays: 4,
    })
    expect(result.heatmap.from).toBe('2026-03-16')
    expect(result.heatmap.to).toBe('2026-09-16')
    expect(result.heatmap.days).toEqual([{ date: '2026-09-14', netConsumed: 20, generationCount: 1 }])
    expect($queryRaw).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('fills every calendar day for usageDays 7d', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    $queryRaw
      .mockResolvedValueOnce([{ day: '2026-09-16', kind: 'consume', category: 'video', amountSum: -40 }])
      .mockResolvedValueOnce([{ day: '2026-09-16', distinctGens: 1, nullGens: 0 }])

    const result = await service.usageDays('u1', '7d')
    expect(result.range).toBe('7d')
    expect(result.from).toBe('2026-09-10')
    expect(result.to).toBe('2026-09-16')
    expect(result.days).toHaveLength(7)
    expect(result.days.at(-1)).toMatchObject({ date: '2026-09-16', netConsumed: 40, generationCount: 1 })
    expect(result.days[0]).toMatchObject({ date: '2026-09-10', netConsumed: 0, generationCount: 0 })
    vi.useRealTimers()
  })

  it('usageDays all returns sparse activity days without filling the calendar', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    $queryRaw
      .mockResolvedValueOnce([{ day: '2026-09-16', kind: 'consume', category: 'video', amountSum: -40 }])
      .mockResolvedValueOnce([{ day: '2026-09-16', distinctGens: 1, nullGens: 0 }])

    const result = await service.usageDays('u1', 'all')
    expect(result.range).toBe('all')
    expect(result.days).toHaveLength(1)
    expect(result.days[0]).toMatchObject({ date: '2026-09-16', netConsumed: 40, generationCount: 1 })
    vi.useRealTimers()
  })
})
