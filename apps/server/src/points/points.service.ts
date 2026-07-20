import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PointsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async consume(userId: string, cost: number, reason: string): Promise<void> {
    if (cost <= 0) return
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, points: { gte: cost } },
        data: { points: { decrement: cost } },
      })
      if (updated.count === 0) {
        throw new BadRequestException('积分不足')
      }
      await tx.pointTransaction.create({
        data: { userId, amount: -cost, reason },
      })
    })
  }

  async refund(userId: string, amount: number, reason: string): Promise<void> {
    if (amount <= 0) return
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id: userId },
        data: { points: { increment: amount } },
      })
      await tx.pointTransaction.create({
        data: { userId, amount, reason },
      })
    })
  }
}
