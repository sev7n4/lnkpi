import { Inject, Injectable } from '@nestjs/common'
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

  async statusBatch(ids: string[]) {
    if (!ids.length) return []
    return this.prisma.shot.findMany({
      where: { id: { in: ids } },
      include: { materials: true },
    })
  }
}
