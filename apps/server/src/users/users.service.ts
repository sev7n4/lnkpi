import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findCreator(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        works: {
          orderBy: { createdAt: 'desc' },
          take: 48,
        },
        _count: { select: { works: true } },
      },
    })
    if (!user) throw new NotFoundException('创作者不存在')

    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar ?? undefined,
        points: user.points,
        membership: user.membership,
        workCount: user._count.works,
        createdAt: user.createdAt.toISOString(),
      },
      works: user.works.map((w) => ({
        id: w.id,
        title: w.title,
        coverUrl: w.coverUrl,
        type: w.type,
        sessionId: w.sessionId ?? undefined,
        likes: w.likes,
        views: w.views,
        category: w.category ?? undefined,
        createdAt: w.createdAt.toISOString(),
      })),
    }
  }
}
