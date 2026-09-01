import { Inject, Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PointsRangeKey, resolvePointsRange } from '../points/points-range'

export type PointKind = 'consume' | 'refund' | 'grant'
export type PointCategory = 'text' | 'image' | 'audio' | 'video' | 'other'

export interface PointTxDto {
  id: string
  userId: string
  amount: number
  reason: string
  kind: string
  category: string
  status: string | null
  model: string | null
  generationId: string | null
  balanceAfter: number | null
  createdAt: Date
}

export interface PointsSummaryDto {
  range: PointsRangeKey
  from: string | null
  to: string
  byCategory: Record<Exclude<PointCategory, 'other'>, number>
  otherNetConsumed: number
  refundTotal: number
  grantTotal: number
}

const PLANS = [
  { id: 'free', name: '免费版', points: 1000, price: 0, features: ['每日 100 积分', '基础模型'] },
  { id: 'pro', name: '专业版', points: 5000, price: 99, features: ['每日 500 积分', '高级模型', '优先队列'] },
  { id: 'studio', name: '工作室版', points: 20000, price: 299, features: ['无限画布', '全模型', '团队协作'] },
]

@Injectable()
export class MembershipService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  getPlans() {
    return PLANS
  }

  async getPoints(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new BadRequestException('用户不存在')
    return { points: user.points, membership: user.membership }
  }

  async claimDaily(userId: string) {
    const bonus = 100
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: bonus } },
      })
      await tx.pointTransaction.create({
        data: {
          userId,
          amount: bonus,
          reason: '每日签到',
          kind: 'grant',
          category: 'other',
          status: null,
          balanceAfter: updated.points,
        },
      })
      return updated
    })
    return { points: user.points, added: bonus }
  }

  async upgrade(userId: string, plan: string) {
    const selected = PLANS.find((p) => p.id === plan)
    if (!selected || plan === 'free') throw new BadRequestException('无效套餐')

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          membership: plan,
          points: { increment: selected.points },
        },
      })
      await tx.pointTransaction.create({
        data: {
          userId,
          amount: selected.points,
          reason: `升级 ${selected.name}`,
          kind: 'grant',
          category: 'other',
          status: null,
          balanceAfter: updated.points,
        },
      })
      return updated
    })
    return { membership: user.membership, points: user.points, plan: selected }
  }

  async pointsSummary(userId: string, range: PointsRangeKey): Promise<PointsSummaryDto> {
    const { from, to } = resolvePointsRange(range)
    const rows = await this.prisma.pointTransaction.groupBy({
      by: ['kind', 'category'],
      where: {
        userId,
        createdAt: from ? { gte: from, lte: to } : { lte: to },
      },
      _sum: { amount: true },
    })

    const consumed = { text: 0, image: 0, audio: 0, video: 0, other: 0 }
    const refunded = { text: 0, image: 0, audio: 0, video: 0, other: 0 }
    let refundTotal = 0
    let grantTotal = 0

    for (const row of rows) {
      const category = row.category in consumed ? (row.category as PointCategory) : 'other'
      const amount = row._sum.amount ?? 0
      if (row.kind === 'consume') consumed[category] += amount
      if (row.kind === 'refund') {
        refunded[category] += amount
        refundTotal += amount
      }
      if (row.kind === 'grant') grantTotal += amount
    }

    const netConsumed = (category: PointCategory) =>
      Math.max(0, -consumed[category] - refunded[category])

    return {
      range,
      from: from?.toISOString() ?? null,
      to: to.toISOString(),
      byCategory: {
        text: netConsumed('text'),
        image: netConsumed('image'),
        audio: netConsumed('audio'),
        video: netConsumed('video'),
      },
      otherNetConsumed: netConsumed('other'),
      refundTotal,
      grantTotal,
    }
  }

  async listTransactions(
    userId: string,
    opts: {
      range: PointsRangeKey
      kind?: PointKind
      category?: PointCategory
      cursor?: string
      limit?: number
    },
  ): Promise<{ items: PointTxDto[]; nextCursor: string | null; from: string | null; to: string }> {
    const { from, to } = resolvePointsRange(opts.range)
    const limit = opts.limit ?? 50
    const rows = await this.prisma.pointTransaction.findMany({
      where: {
        userId,
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        createdAt: from ? { gte: from, lte: to } : { lte: to },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit)

    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      from: from?.toISOString() ?? null,
      to: to.toISOString(),
    }
  }
}
