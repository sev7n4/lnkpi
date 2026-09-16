import { Inject, Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PointsRangeKey, resolvePointsRange } from '../points/points-range'
import { computePointsInsights, type PointsInsights } from '../points/points-insights'
import {
  parseShanghaiDay,
  resolveHeatmapRange,
  resolveUsageDaysRange,
  type UsageDaysRangeKey,
} from '../points/points-usage-range'
import {
  fillCalendarDays,
  filterHeatmapDays,
  foldDailyUsage,
  generationCountFromParts,
  netFromKindCategorySums,
  coerceDayKey,
  type DailyAmountRow,
  type DailyGenerationRow,
  type UsageDaysResponse,
  type UsageOverviewResponse,
} from '../points/points-usage'

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
  insights: PointsInsights
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

    const netConsumedTotal =
      netConsumed('text') +
      netConsumed('image') +
      netConsumed('audio') +
      netConsumed('video') +
      netConsumed('other')

    const consumeRows = await this.prisma.pointTransaction.findMany({
      where: {
        userId,
        kind: 'consume',
        createdAt: from ? { gte: from, lte: to } : { lte: to },
      },
      select: { createdAt: true, amount: true },
    })

    const insights = computePointsInsights({
      netConsumedTotal,
      consumeRows,
      from,
      to,
    })

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
      insights,
    }
  }

  async listTransactions(
    userId: string,
    opts: {
      range?: PointsRangeKey
      day?: string
      kind?: PointKind
      category?: PointCategory
      cursor?: string
      limit?: number
    },
  ): Promise<{ items: PointTxDto[]; nextCursor: string | null; from: string | null; to: string }> {
    let from: Date | null
    let to: Date
    let createdAt: { gte?: Date; lte?: Date; lt?: Date }
    if (opts.day) {
      const parsed = parseShanghaiDay(opts.day)
      if (!parsed) throw new BadRequestException('无效日期')
      from = parsed.from
      to = parsed.next
      createdAt = { gte: parsed.from, lt: parsed.next }
    } else {
      const resolved = resolvePointsRange(opts.range ?? 'month')
      from = resolved.from
      to = resolved.to
      createdAt = from ? { gte: from, lte: to } : { lte: to }
    }
    const limit = opts.limit ?? 50
    const rows = await this.prisma.pointTransaction.findMany({
      where: {
        userId,
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        createdAt,
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

  // Prisma SQLite DateTime is unix ms; SQLite datetime(n) treats numbers as seconds.
  private async queryLifetimeStats(userId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ distinctGens: number | bigint; nullGens: number | bigint; activeDays: number | bigint }>
    >`
    SELECT
      (SELECT COUNT(DISTINCT generationId) FROM PointTransaction
        WHERE userId = ${userId} AND kind = 'consume'
          AND generationId IS NOT NULL AND generationId != '') AS distinctGens,
      (SELECT COUNT(*) FROM PointTransaction
        WHERE userId = ${userId} AND kind = 'consume'
          AND (generationId IS NULL OR generationId = '')) AS nullGens,
      (SELECT COUNT(DISTINCT date(datetime(createdAt / 1000.0, 'unixepoch', '+8 hours'))) FROM PointTransaction
        WHERE userId = ${userId} AND kind = 'consume') AS activeDays
  `
    const row = rows[0] ?? { distinctGens: 0, nullGens: 0, activeDays: 0 }
    return {
      generationCount: generationCountFromParts({
        distinctGens: Number(row.distinctGens),
        nullGens: Number(row.nullGens),
      }),
      activeDays: Number(row.activeDays),
    }
  }

  private async queryDailyAmountRows(userId: string, from: Date, to: Date): Promise<DailyAmountRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; kind: string; category: string; amountSum: number | bigint }>
    >`
    SELECT date(datetime(createdAt / 1000.0, 'unixepoch', '+8 hours')) AS day,
           kind,
           category,
           SUM(amount) AS amountSum
    FROM PointTransaction
    WHERE userId = ${userId} AND createdAt >= ${from} AND createdAt <= ${to}
    GROUP BY day, kind, category
  `
    return rows.flatMap((row) => {
      const day = coerceDayKey(row.day)
      if (!day) return []
      return [
        {
          day,
          kind: row.kind,
          category: row.category,
          amountSum: Number(row.amountSum),
        },
      ]
    })
  }

  private async queryDailyGenerationRows(userId: string, from: Date, to: Date): Promise<DailyGenerationRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; distinctGens: number | bigint; nullGens: number | bigint }>
    >`
    SELECT date(datetime(createdAt / 1000.0, 'unixepoch', '+8 hours')) AS day,
           COUNT(DISTINCT CASE WHEN generationId IS NOT NULL AND generationId != '' THEN generationId END) AS distinctGens,
           SUM(CASE WHEN generationId IS NULL OR generationId = '' THEN 1 ELSE 0 END) AS nullGens
    FROM PointTransaction
    WHERE userId = ${userId} AND kind = 'consume'
      AND createdAt >= ${from} AND createdAt <= ${to}
    GROUP BY day
  `
    return rows.flatMap((row) => {
      const day = coerceDayKey(row.day)
      if (!day) return []
      return [
        {
          day,
          distinctGens: Number(row.distinctGens),
          nullGens: Number(row.nullGens),
        },
      ]
    })
  }

  async usage(userId: string, now = new Date()): Promise<UsageOverviewResponse> {
    const heatmapRange = resolveHeatmapRange(now)
    const [grouped, lifetime, amountRows, generationRows] = await Promise.all([
      this.prisma.pointTransaction.groupBy({
        by: ['kind', 'category'],
        where: { userId },
        _sum: { amount: true },
      }),
      this.queryLifetimeStats(userId),
      this.queryDailyAmountRows(userId, heatmapRange.from, heatmapRange.to),
      this.queryDailyGenerationRows(userId, heatmapRange.from, heatmapRange.to),
    ])
    const net = netFromKindCategorySums(
      grouped.map((row) => ({
        kind: row.kind,
        category: row.category,
        amountSum: row._sum.amount ?? 0,
      })),
    )
    const folded = foldDailyUsage(amountRows, generationRows)
    const days = filterHeatmapDays(folded)
    return {
      overview: {
        netConsumedTotal: net.netConsumedTotal,
        byCategory: net.byCategory,
        otherNetConsumed: net.otherNetConsumed,
        generationCount: lifetime.generationCount,
        activeDays: lifetime.activeDays,
      },
      heatmap: {
        from: heatmapRange.fromKey,
        to: heatmapRange.toKey,
        activeDays: days.filter((day) => day.generationCount > 0).length,
        days,
      },
    }
  }

  async usageDays(
    userId: string,
    range: UsageDaysRangeKey,
    now = new Date(),
  ): Promise<UsageDaysResponse> {
    const window = resolveUsageDaysRange(range, now)
    const [amountRows, generationRows] = await Promise.all([
      this.queryDailyAmountRows(userId, window.from, window.to),
      this.queryDailyGenerationRows(userId, window.from, window.to),
    ])
    return {
      range,
      from: window.fromKey,
      to: window.toKey,
      days: fillCalendarDays(window.fromKey, window.toKey, foldDailyUsage(amountRows, generationRows)),
    }
  }
}
