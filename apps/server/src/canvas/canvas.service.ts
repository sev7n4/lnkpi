import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class CanvasService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async create(userId: string, title?: string) {
    return this.prisma.session.create({
      data: { userId, title: title ?? '未命名画布' },
    })
  }

  async update(id: string, userId: string, data: { title?: string; canvasData?: string }) {
    const session = await this.prisma.session.findFirst({ where: { id, userId } })
    if (!session) throw new NotFoundException('Session not found')
    return this.prisma.session.update({ where: { id }, data })
  }
}
