import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { MembershipService } from './membership.service'

describe('MembershipService', () => {
  const findMany = vi.fn()
  const userUpdate = vi.fn()
  const transactionCreate = vi.fn()
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      user: { update: userUpdate },
      pointTransaction: { create: transactionCreate },
    }),
  )
  let service: MembershipService

  beforeEach(async () => {
    vi.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        MembershipService,
        {
          provide: PrismaService,
          useValue: {
            pointTransaction: { findMany },
            $transaction,
          },
        },
      ],
    }).compile()
    service = moduleRef.get(MembershipService)
  })

  it('aggregates non-negative net consumption and totals for the selected range', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
    findMany.mockResolvedValue([
      { amount: -10, kind: 'consume', category: 'image' },
      { amount: -20, kind: 'consume', category: 'image' },
      { amount: 10, kind: 'refund', category: 'image' },
      { amount: 100, kind: 'grant', category: 'other' },
      { amount: 7, kind: 'refund', category: 'audio' },
    ])

    await expect(service.pointsSummary('u1', 'month')).resolves.toEqual({
      range: 'month',
      from: '2026-07-31T16:00:00.000Z',
      to: '2026-08-20T12:00:00.000Z',
      byCategory: { text: 0, image: 20, audio: 0, video: 0 },
      otherNetConsumed: 0,
      refundTotal: 17,
      grantTotal: 100,
    })
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        createdAt: {
          gte: new Date('2026-07-31T16:00:00.000Z'),
          lte: new Date('2026-08-20T12:00:00.000Z'),
        },
      },
      select: { amount: true, kind: true, category: true },
    })
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
})
