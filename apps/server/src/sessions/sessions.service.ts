import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, title?: string, prompt?: string) {
    const canvasData = prompt
      ? JSON.stringify({
          nodes: [
            {
              id: 'prompt-1',
              type: 'prompt',
              position: { x: 250, y: 100 },
              data: { prompt },
            },
          ],
          edges: [],
        })
      : null

    const session = await this.prisma.session.create({
      data: {
        userId,
        title: title || '未命名画布',
        canvasData,
      },
    })

    return this.formatSession(session)
  }

  async findAll(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
    return sessions.map((s) => this.formatSession(s))
  }

  async findOne(id: string, userId?: string) {
    const session = await this.prisma.session.findUnique({ where: { id } })
    if (!session) throw new NotFoundException('会话不存在')
    if (userId && session.userId !== userId) throw new ForbiddenException()
    return this.formatSession(session)
  }

  async update(id: string, userId: string, data: { title?: string; canvasData?: unknown }) {
    const session = await this.prisma.session.findUnique({ where: { id } })
    if (!session) throw new NotFoundException('会话不存在')
    if (session.userId !== userId) throw new ForbiddenException()

    const updated = await this.prisma.session.update({
      where: { id },
      data: {
        title: data.title,
        canvasData: data.canvasData ? JSON.stringify(data.canvasData) : undefined,
      },
    })
    return this.formatSession(updated)
  }

  async remove(id: string, userId: string) {
    const session = await this.prisma.session.findUnique({ where: { id } })
    if (!session) throw new NotFoundException('会话不存在')
    if (session.userId !== userId) throw new ForbiddenException()
    await this.prisma.session.delete({ where: { id } })
    return { message: '已删除' }
  }

  private formatSession(session: {
    id: string
    title: string
    userId: string
    canvasData: string | null
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      id: session.id,
      title: session.title,
      userId: session.userId,
      canvasData: session.canvasData ? JSON.parse(session.canvasData) : undefined,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    }
  }
}
