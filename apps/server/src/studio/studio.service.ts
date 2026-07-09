import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { createImageProvider } from '@lnkpi/agent'
import { PrismaService } from '../prisma/prisma.service'

const VIDEO_PLACEHOLDER = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1024&q=80'
const AUDIO_PLACEHOLDER = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

@Injectable()
export class StudioService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listGenerations(userId: string, type?: string) {
    return this.prisma.generationRecord.findMany({
      where: { userId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async generateImage(userId: string, prompt: string, model?: string) {
    await this.consumePoints(userId, 10)
    const { url } = await createImageProvider().generate(prompt)
    return this.prisma.generationRecord.create({
      data: { userId, type: 'image', prompt, model, url, status: 'completed' },
    })
  }

  async generateVideo(userId: string, prompt: string, model?: string, duration = 5) {
    await this.consumePoints(userId, 30)
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'video',
        prompt,
        model,
        status: 'generating',
        metadata: JSON.stringify({ duration }),
      },
    })
    this.completeVideo(record.id).catch(console.error)
    return record
  }

  async generateAudio(userId: string, text: string, voice?: string) {
    await this.consumePoints(userId, 5)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'audio',
        prompt: text,
        model: voice,
        url: AUDIO_PLACEHOLDER,
        status: 'completed',
        metadata: JSON.stringify({ voice: voice ?? 'default', duration: Math.ceil(text.length / 5) }),
      },
    })
  }

  private async completeVideo(id: string) {
    await new Promise((r) => setTimeout(r, 2000))
    await this.prisma.generationRecord.update({
      where: { id },
      data: { url: VIDEO_PLACEHOLDER, status: 'completed' },
    })
  }

  private async consumePoints(userId: string, cost: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.points < cost) {
      throw new BadRequestException('积分不足')
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { points: { decrement: cost } },
    })
  }
}
