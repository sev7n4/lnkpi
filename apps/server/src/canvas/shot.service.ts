import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ShotService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(sessionId: string, data: {
    id?: string
    title?: string
    prompt?: string
    order?: number
    positionX?: number
    positionY?: number
    status?: string
  }) {
    const count = await this.prisma.shot.count({ where: { sessionId } })
    return this.prisma.shot.create({
      data: {
        id: data.id,
        sessionId,
        title: data.title ?? `分镜 ${count + 1}`,
        prompt: data.prompt ?? '',
        order: data.order ?? count,
        positionX: data.positionX ?? 200 + count * 320,
        positionY: data.positionY ?? 150,
        status: data.status ?? 'draft',
      },
    })
  }

  async update(shotId: string, data: { title?: string; prompt?: string; status?: string }) {
    const shot = await this.prisma.shot.findUnique({ where: { id: shotId } })
    if (!shot) throw new NotFoundException('分镜不存在')
    return this.prisma.shot.update({
      where: { id: shotId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    })
  }

  async reorder(sessionId: string, shotIds: string[]) {
    const existing = await this.prisma.shot.findMany({ where: { sessionId } })
    const idSet = new Set(shotIds)
    const ordered = [
      ...shotIds,
      ...existing.map((s) => s.id).filter((id) => !idSet.has(id)),
    ]
    await this.prisma.$transaction(
      ordered.map((id, index) =>
        this.prisma.shot.updateMany({
          where: { id, sessionId },
          data: { order: index },
        }),
      ),
    )
    return this.prisma.shot.findMany({
      where: { sessionId },
      orderBy: { order: 'asc' },
    })
  }

  async statusBatch(ids: string[]) {
    if (!ids.length) return []
    return this.prisma.shot.findMany({
      where: { id: { in: ids } },
      include: { materials: true },
    })
  }
}
