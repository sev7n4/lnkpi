import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class StoriesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.story.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async create(userId: string, data: { title: string; synopsis?: string; episodeCount?: number }) {
    const session = await this.prisma.session.create({
      data: {
        userId,
        title: data.title,
        canvasData: JSON.stringify({
          nodes: [{
            id: 'prompt-1',
            type: 'prompt',
            position: { x: 250, y: 100 },
            data: { prompt: data.synopsis ?? data.title },
          }],
          edges: [],
        }),
      },
    })

    return this.prisma.story.create({
      data: {
        userId,
        title: data.title,
        synopsis: data.synopsis ?? '',
        sessionId: session.id,
        episodeCount: data.episodeCount ?? 1,
        coverUrl: 'https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?w=800&q=80',
      },
    })
  }

  async findOne(id: string, userId?: string) {
    const story = await this.prisma.story.findUnique({ where: { id } })
    if (!story) throw new NotFoundException('故事不存在')
    if (userId && story.userId !== userId) throw new NotFoundException('故事不存在')
    return story
  }
}
