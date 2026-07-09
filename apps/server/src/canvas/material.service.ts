import { Inject, Injectable } from '@nestjs/common'
import { createImageProvider, createVideoProvider } from '@lnkpi/agent'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class MaterialService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createFromAgent(data: {
    id?: string
    shotId: string
    prompt?: string
    url?: string
    status?: string
    type?: string
  }) {
    return this.prisma.material.create({
      data: {
        id: data.id,
        shotId: data.shotId,
        type: data.type ?? 'image',
        prompt: data.prompt ?? '',
        url: data.url,
        thumbnail: data.url,
        status: data.status ?? 'completed',
      },
    })
  }

  async generateImage(shotId: string, prompt: string) {
    const material = await this.prisma.material.create({
      data: { shotId, type: 'image', prompt, status: 'generating' },
    })
    this.runImageGeneration(material.id, prompt).catch(console.error)
    return material
  }

  async generateVideo(shotId: string, prompt: string, duration = 5) {
    const material = await this.prisma.material.create({
      data: { shotId, type: 'video', prompt, status: 'generating' },
    })
    this.runVideoGeneration(material.id, prompt, duration).catch(console.error)
    return material
  }

  private async runImageGeneration(materialId: string, prompt: string) {
    try {
      const provider = createImageProvider()
      const { url } = await provider.generate(prompt)
      await this.prisma.material.update({
        where: { id: materialId },
        data: { url, thumbnail: url, status: 'completed' },
      })
    } catch (err) {
      console.error('Image generation failed:', err)
      await this.prisma.material.update({
        where: { id: materialId },
        data: { status: 'failed' },
      })
    }
  }

  private async runVideoGeneration(materialId: string, prompt: string, duration: number) {
    try {
      const { url } = await createVideoProvider().generate(prompt, { duration })
      await this.prisma.material.update({
        where: { id: materialId },
        data: { url, thumbnail: url, status: 'completed' },
      })
    } catch (err) {
      console.error('Video generation failed:', err)
      await this.prisma.material.update({
        where: { id: materialId },
        data: { status: 'failed' },
      })
    }
  }
}
