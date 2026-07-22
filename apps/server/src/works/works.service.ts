import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

type CanvasNode = {
  id?: string
  type?: string
  data?: { url?: string; coverUrl?: string }
}

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
    const existing = await this.prisma.work.findUnique({ where: { id } })
    if (!existing) return null
    const work = await this.prisma.work.update({
      where: { id },
      data: { views: { increment: 1 } },
      include: { author: true },
    })
    return this.formatWork(work)
  }

  async publish(
    userId: string,
    data: { sessionId: string; title: string; category?: string; primaryNodeId: string },
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: data.sessionId, userId },
    })
    if (!session) throw new NotFoundException('会话不存在')

    const primary = this.resolvePrimaryNode(session.canvasData, data.primaryNodeId)
    if (!primary) throw new BadRequestException('请选择主成片节点')

    const work = await this.prisma.work.create({
      data: {
        title: data.title,
        coverUrl: primary.coverUrl,
        playbackUrl: primary.playbackUrl,
        playbackKind: primary.playbackKind,
        authorId: userId,
        sessionId: data.sessionId,
        category: data.category ?? '精选作品',
        type: 'canvas',
      },
      include: { author: true },
    })
    return this.formatWork(work)
  }

  async like(_userId: string, workId: string) {
    const existing = await this.prisma.work.findUnique({ where: { id: workId } })
    if (!existing) throw new NotFoundException('作品不存在')
    const work = await this.prisma.work.update({
      where: { id: workId },
      data: { likes: { increment: 1 } },
      include: { author: true },
    })
    return this.formatWork(work)
  }

  async getCanvas(workId: string) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      include: { session: true },
    })
    if (!work?.session?.canvasData) throw new NotFoundException('画布不存在')
    try {
      return JSON.parse(work.session.canvasData)
    } catch {
      throw new NotFoundException('画布数据无效')
    }
  }

  async forkCanvas(userId: string, workId: string) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      include: { session: true },
    })
    if (!work?.session?.canvasData) throw new NotFoundException('作品不存在')

    const session = await this.prisma.session.create({
      data: {
        userId,
        title: `${work.title} 副本`,
        canvasData: work.session.canvasData,
      },
    })

    return {
      id: session.id,
      title: session.title,
      userId: session.userId,
      canvasData: session.canvasData ? JSON.parse(session.canvasData) : undefined,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    }
  }

  private resolvePrimaryNode(canvasData: string | null, primaryNodeId: string) {
    if (!primaryNodeId || !canvasData) return null
    try {
      const canvas = JSON.parse(canvasData) as { nodes?: CanvasNode[] }
      const node = canvas.nodes?.find((n) => n.id === primaryNodeId)
      if (!node) return null
      if (node.type !== 'image' && node.type !== 'video') return null
      const url = node.data?.url
      if (!url) return null
      return {
        playbackUrl: url,
        playbackKind: node.type as 'image' | 'video',
        coverUrl: node.data?.coverUrl || url,
      }
    } catch {
      return null
    }
  }

  private formatWork(work: {
    id: string
    title: string
    coverUrl: string
    playbackUrl?: string | null
    playbackKind?: string | null
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
      playbackUrl: work.playbackUrl ?? undefined,
      playbackKind: (work.playbackKind as 'image' | 'video' | null) ?? undefined,
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
