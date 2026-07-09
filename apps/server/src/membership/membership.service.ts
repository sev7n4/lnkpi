import { Inject, Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { points: { increment: bonus } },
    })
    return { points: user.points, added: bonus }
  }

  async upgrade(userId: string, plan: string) {
    const selected = PLANS.find((p) => p.id === plan)
    if (!selected || plan === 'free') throw new BadRequestException('无效套餐')

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        membership: plan,
        points: { increment: selected.points },
      },
    })
    return { membership: user.membership, points: user.points, plan: selected }
  }
}
