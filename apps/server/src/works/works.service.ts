import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class WorksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll(params: { category?: string; search?: string; page?: number; pageSize?: number }) {
    const page = params.page || 1
    const pageSize = params.pageSize || 24
    const where: Record<string, unknown> = {}

    if (params.category && params.category !== '全部') {
      where.category = params.category
    }
    if (params.search) {
      where.title = { contains: params.search }
    }

    const [items, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { author: true },
      }),
      this.prisma.work.count({ where }),
    ])

    return {
      items: items.map((w) => this.formatWork(w)),
      total,
      page,
      pageSize,
    }
  }

  async findOne(id: string) {
    const work = await this.prisma.work.findUnique({
      where: { id },
      include: { author: true },
    })
    if (!work) return null
    return this.formatWork(work)
  }

  private formatWork(work: {
    id: string
    title: string
    coverUrl: string
    type: string
    authorId: string
    sessionId: string | null
    likes: number
    views: number
    category: string | null
    createdAt: Date
    author: { nickname: string; avatar: string | null }
  }) {
    return {
      id: work.id,
      title: work.title,
      coverUrl: work.coverUrl,
      type: work.type,
      authorId: work.authorId,
      authorName: work.author.nickname,
      authorAvatar: work.author.avatar ?? undefined,
      sessionId: work.sessionId ?? undefined,
      likes: work.likes,
      views: work.views,
      category: work.category ?? undefined,
      createdAt: work.createdAt.toISOString(),
    }
  }
}
