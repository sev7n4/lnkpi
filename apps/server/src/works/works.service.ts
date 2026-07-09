import { Inject, Injectable, NotFoundException } from '@nestjs/common'
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

  async publish(userId: string, data: { sessionId: string; title: string; category?: string }) {
    const session = await this.prisma.session.findFirst({
      where: { id: data.sessionId, userId },
      include: { shots: { include: { materials: true }, orderBy: { order: 'asc' } } },
    })
    if (!session) throw new NotFoundException('会话不存在')

    const coverUrl = this.resolveCoverUrl(session)
    const work = await this.prisma.work.create({
      data: {
        title: data.title,
        coverUrl,
        authorId: userId,
        sessionId: data.sessionId,
        category: data.category ?? '精选作品',
        type: 'canvas',
      },
      include: { author: true },
    })
    return this.formatWork(work)
  }

  private resolveCoverUrl(session: {
    canvasData: string | null
    shots: Array<{ materials: Array<{ url: string | null; thumbnail: string | null }> }>
  }) {
    const fallback = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80'
    if (session.canvasData) {
      try {
        const canvas = JSON.parse(session.canvasData) as {
          nodes?: Array<{ type?: string; data?: { url?: string; coverUrl?: string } }>
        }
        for (const node of canvas.nodes ?? []) {
          if (node.data?.coverUrl) return node.data.coverUrl
          if (node.type === 'image' && node.data?.url) return node.data.url
        }
      } catch {
        // ignore parse errors
      }
    }
    for (const shot of session.shots) {
      for (const material of shot.materials) {
        if (material.url) return material.url
        if (material.thumbnail) return material.thumbnail
      }
    }
    return fallback
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
