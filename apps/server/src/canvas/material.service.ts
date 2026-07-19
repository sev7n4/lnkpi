import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  buildImageProviderOptions,
  createImageProvider,
  createVideoProvider,
} from '@lnkpi/agent'
import { resolveImageSize, type ImageResolutionTier } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { PointsService } from '../points/points.service'

export type CanvasImageGenerateInput = {
  userId: string
  shotId: string
  prompt: string
  model?: string
  aspectRatio?: string
  resolution?: string
  count?: number
}

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
  ) {}

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

  async generateImage(input: CanvasImageGenerateInput) {
    const { userId, shotId, prompt, model, aspectRatio, resolution, count } = input

    const shot = await this.prisma.shot.findUnique({
      where: { id: shotId },
      include: { session: true },
    })
    if (!shot || shot.session.userId !== userId) {
      throw new NotFoundException('分镜不存在')
    }

    const requested = count ?? 1
    if (requested > 1) {
      this.logger.log(
        JSON.stringify({
          event: 'canvas_image_count_clamped',
          requested,
          effective: 1,
        }),
      )
    }

    await this.points.consume(userId, 10, '图像生成')

    const material = await this.prisma.material.create({
      data: { shotId, type: 'image', prompt, status: 'generating' },
    })
    this.runImageGeneration(material.id, prompt, model, aspectRatio, resolution).catch(
      console.error,
    )
    return material
  }

  async generateVideo(
    shotId: string,
    prompt: string,
    duration = 5,
    aspectRatio = '16:9',
    crop = 'none',
  ) {
    const material = await this.prisma.material.create({
      data: { shotId, type: 'video', prompt, status: 'generating' },
    })
    this.runVideoGeneration(material.id, prompt, duration, aspectRatio, crop).catch(console.error)
    return material
  }

  private async runImageGeneration(
    materialId: string,
    prompt: string,
    model?: string,
    aspectRatio?: string,
    resolution?: string,
  ) {
    try {
      const size = resolveImageSize(
        aspectRatio ?? '16:9',
        (resolution ?? '1K') as ImageResolutionTier,
      )
      const built = buildImageProviderOptions({
        modelKey: model,
        size,
        n: 1,
        referenceImages: [],
      })
      const effectivePrompt = [prompt, built.effectivePromptSuffix].filter(Boolean).join('\n')
      const provider = createImageProvider()
      const { url } = await provider.generate(effectivePrompt, {
        modelId: built.modelId,
        size: built.size,
        n: built.n,
      })
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

  private async runVideoGeneration(
    materialId: string,
    prompt: string,
    duration: number,
    aspectRatio: string,
    crop: string,
  ) {
    try {
      const enriched = crop !== 'none'
        ? `${prompt} [aspect:${aspectRatio}, crop:${crop}]`
        : `${prompt} [aspect:${aspectRatio}]`
      const { url } = await createVideoProvider().generate(enriched, { duration, aspectRatio })
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
