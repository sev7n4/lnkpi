import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { PointTxMeta } from './point-tx.types'
import { mapReasonToPointFields } from './reason-map'

@Injectable()
export class PointsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async consume(userId: string, cost: number, reason: string, meta?: PointTxMeta): Promise<void> {
    if (cost <= 0) return
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, points: { gte: cost } },
        data: { points: { decrement: cost } },
      })
      if (updated.count === 0) {
        throw new BadRequestException('积分不足')
      }
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true },
      })
      const fields = meta ?? mapReasonToPointFields(reason, -cost)
      await tx.pointTransaction.create({
        data: {
          userId,
          amount: -cost,
          reason,
          kind: fields.kind,
          category: fields.category,
          status: fields.status !== undefined ? fields.status : 'success',
          model: meta?.model ?? null,
          generationId: meta?.generationId ?? null,
          balanceAfter: user?.points ?? null,
        },
      })
    })
  }

  async refund(userId: string, amount: number, reason: string, meta?: PointTxMeta): Promise<void> {
    if (amount <= 0) return
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id: userId },
        data: { points: { increment: amount } },
      })
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true },
      })
      const fields = meta ?? mapReasonToPointFields(reason, amount)
      await tx.pointTransaction.create({
        data: {
          userId,
          amount,
          reason,
          kind: fields.kind,
          category: fields.category,
          status: fields.status !== undefined ? fields.status : 'success',
          model: meta?.model ?? null,
          generationId: meta?.generationId ?? null,
          balanceAfter: user?.points ?? null,
        },
      })
    })
  }
}
