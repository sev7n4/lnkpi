import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
} from '@lnkpi/agent'
import { PrismaService } from '../prisma/prisma.service'

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

  async generateText(userId: string, prompt: string, model?: string) {
    await this.consumePoints(userId, 5, '文本生成')
    const { text } = await createTextProvider().generate(prompt, model)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'text',
        prompt,
        model,
        url: null,
        status: 'completed',
        metadata: JSON.stringify({ text }),
      },
    })
  }

  async getGeneration(userId: string, id: string) {
    const record = await this.prisma.generationRecord.findFirst({
      where: { id, userId },
    })
    if (!record) {
      throw new BadRequestException('生成记录不存在')
    }
    return record
  }

  async generateImage(userId: string, prompt: string, model?: string, aspectRatio = '16:9') {
    await this.consumePoints(userId, 10, '图像生成')
    const { url } = await createImageProvider().generate(prompt)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'image',
        prompt,
        model,
        url,
        status: 'completed',
        metadata: JSON.stringify({ aspectRatio }),
      },
    })
  }

  async generateImageVariation(userId: string, prompt: string, basePrompt?: string, model?: string) {
    await this.consumePoints(userId, 10, '图像变体')
    const combined = basePrompt ? `${basePrompt}。变体要求：${prompt}` : prompt
    const { url } = await createImageProvider().generate(combined)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'image',
        prompt: combined,
        model,
        url,
        status: 'completed',
        metadata: JSON.stringify({ variation: true, basePrompt }),
      },
    })
  }

  async generateVideo(userId: string, prompt: string, model?: string, duration = 5, aspectRatio = '16:9') {
    await this.consumePoints(userId, 30, '视频生成')
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'video',
        prompt,
        model,
        status: 'generating',
        metadata: JSON.stringify({ duration, aspectRatio }),
      },
    })
    this.completeVideo(record.id, prompt, model, duration, aspectRatio).catch(console.error)
    return record
  }

  async generateAudio(
    userId: string,
    text: string,
    options: { voice?: string; emotion?: string; language?: string; speed?: number } = {},
  ) {
    const voice = options.voice
    await this.consumePoints(userId, 5, '音频生成')
    const { url } = await createAudioProvider().generate(text, voice)
    const storeUrl = url.startsWith('data:') ? AUDIO_PLACEHOLDER : url
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'audio',
        prompt: text,
        model: voice,
        url: storeUrl,
        status: 'completed',
        metadata: JSON.stringify({
          voice: voice ?? 'default',
          emotion: options.emotion ?? 'neutral',
          language: options.language ?? 'zh',
          speed: options.speed ?? 1,
          hasTtsData: url.startsWith('data:'),
        }),
      },
    })
    return { ...record, url }
  }

  private async completeVideo(id: string, prompt: string, model?: string, duration?: number, aspectRatio?: string) {
    try {
      const { url } = await createVideoProvider().generate(prompt, { model, duration, aspectRatio })
      await this.prisma.generationRecord.update({
        where: { id },
        data: { url, status: 'completed' },
      })
    } catch (err) {
      console.error('Video generation failed:', err)
      await this.prisma.generationRecord.update({ where: { id }, data: { status: 'failed' } })
    }
  }

  private async consumePoints(userId: string, cost: number, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.points < cost) {
      throw new BadRequestException('积分不足')
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { points: { decrement: cost } },
      }),
      this.prisma.pointTransaction.create({
        data: { userId, amount: -cost, reason },
      }),
    ])
  }
}
