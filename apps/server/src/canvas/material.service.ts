import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  buildImageProviderOptions,
  buildVideoProviderOptions,
  createImageProvider,
  createVideoProvider,
  mergeRefsToPrompt,
  type MergeTextSource,
} from '@lnkpi/agent'
import { resolveImageSize, type GenerationRefPayload, type ImageResolutionTier } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { PointsService } from '../points/points.service'
import { videoCredits } from '../points/video-credits'

export type CanvasImageGenerateInput = {
  userId: string
  shotId: string
  prompt: string
  model?: string
  aspectRatio?: string
  resolution?: string
  count?: number
  skipCharge?: boolean
  refs?: GenerationRefPayload[]
  mentionedKeys?: string[]
}

export type CanvasVideoGenerateInput = {
  userId: string
  shotId: string
  prompt: string
  model?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  skipCharge?: boolean
  refs?: GenerationRefPayload[]
  mentionedKeys?: string[]
}

function assertNoBlobRefs(refs?: GenerationRefPayload[]): void {
  for (const ref of refs ?? []) {
    const url = ref.url?.trim()
    if (url?.startsWith('blob:')) {
      throw new BadRequestException('参考图尚未上传')
    }
  }
}

function extractTextSources(refs?: GenerationRefPayload[]): MergeTextSource[] {
  return (refs ?? [])
    .filter((r) => r.mediaType === 'text' && r.text?.trim())
    .map((r) => ({
      refKey: r.refKey,
      label: r.label?.trim() || r.refKey,
      text: r.text!.trim(),
    }))
}

function extractReferenceImages(refs?: GenerationRefPayload[]): string[] {
  return (refs ?? [])
    .filter((r) => r.mediaType === 'image' && r.url?.trim())
    .map((r) => r.url!.trim())
}

function buildPromptWithRefImage(prompt: string, refImageUrl: string): string {
  const trimmed = prompt.trim()
  const ref = refImageUrl.trim()
  if (!ref) return trimmed
  return `${trimmed} [ref-image:${ref}]`
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
    const {
      userId,
      shotId,
      prompt,
      model,
      aspectRatio,
      resolution,
      count,
      skipCharge,
      refs,
      mentionedKeys,
    } = input

    const shot = await this.prisma.shot.findUnique({
      where: { id: shotId },
      include: { session: true },
    })
    if (!shot || shot.session.userId !== userId) {
      throw new NotFoundException('分镜不存在')
    }

    assertNoBlobRefs(refs)

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

    if (!skipCharge) {
      await this.points.consume(userId, 10, '图像生成')
    }

    const material = await this.prisma.material.create({
      data: { shotId, type: 'image', prompt, status: 'generating' },
    })
    this.runImageGeneration(
      material.id,
      prompt,
      model,
      aspectRatio,
      resolution,
      refs,
      mentionedKeys,
    ).catch(console.error)
    return material
  }

  async generateVideo(input: CanvasVideoGenerateInput) {
    const {
      userId,
      shotId,
      prompt,
      model,
      duration = 5,
      aspectRatio = '16:9',
      resolution = '720p',
      crop = 'none',
      skipCharge,
      refs,
      mentionedKeys,
    } = input

    const shot = await this.prisma.shot.findUnique({
      where: { id: shotId },
      include: { session: true },
    })
    if (!shot || shot.session.userId !== userId) {
      throw new NotFoundException('分镜不存在')
    }

    assertNoBlobRefs(refs)

    if (!skipCharge) {
      await this.points.consume(userId, videoCredits(duration), '视频生成')
    }

    const material = await this.prisma.material.create({
      data: { shotId, type: 'video', prompt, status: 'generating' },
    })
    this.runVideoGeneration(
      material.id,
      prompt,
      model,
      duration,
      aspectRatio,
      resolution,
      crop,
      refs,
      mentionedKeys,
    ).catch(console.error)
    return material
  }

  private async resolveMergedPrompt(
    localPrompt: string,
    refs: GenerationRefPayload[] | undefined,
    downstreamType: 'image' | 'video',
    mentionedKeys?: string[],
  ) {
    const { mergedText, skippedMerge } = await mergeRefsToPrompt({
      sources: extractTextSources(refs),
      localPrompt: localPrompt.trim() || undefined,
      downstreamType,
      mentionedKeys: mentionedKeys?.length ? mentionedKeys : undefined,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    return {
      mergedText,
      skippedMerge,
      referenceImages: extractReferenceImages(refs),
    }
  }

  private async runImageGeneration(
    materialId: string,
    prompt: string,
    model?: string,
    aspectRatio?: string,
    resolution?: string,
    refs?: GenerationRefPayload[],
    mentionedKeys?: string[],
  ) {
    try {
      const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
        prompt,
        refs,
        'image',
        mentionedKeys,
      )
      this.logger.log(
        JSON.stringify({
          event: 'canvas_material_merge',
          skippedMerge,
          refsCount: refs?.length ?? 0,
          referenceImages: referenceImages.length,
        }),
      )
      const size = resolveImageSize(
        aspectRatio ?? '16:9',
        (resolution ?? '1K') as ImageResolutionTier,
      )
      const built = buildImageProviderOptions({
        modelKey: model,
        size,
        n: 1,
        referenceImages,
      })
      const primary = built.referenceImages[0]
      const base = primary ? buildPromptWithRefImage(mergedText, primary) : mergedText
      const effectivePrompt = [base, built.effectivePromptSuffix].filter(Boolean).join('\n')
      const provider = createImageProvider()
      const { url } = await provider.generate(effectivePrompt, {
        modelId: built.modelId,
        size: built.size,
        n: built.n,
      })
      await this.prisma.material.update({
        where: { id: materialId },
        data: { url, thumbnail: url, status: 'completed', prompt: effectivePrompt },
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
    model: string | undefined,
    duration: number,
    aspectRatio: string,
    resolution: string,
    crop: string,
    refs?: GenerationRefPayload[],
    mentionedKeys?: string[],
  ) {
    try {
      const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
        prompt,
        refs,
        'video',
        mentionedKeys,
      )
      this.logger.log(
        JSON.stringify({
          event: 'canvas_material_merge',
          skippedMerge,
          refsCount: refs?.length ?? 0,
          referenceImages: referenceImages.length,
        }),
      )
      const built = buildVideoProviderOptions({
        modelKey: model,
        duration,
        aspectRatio,
        resolution,
        crop,
        referenceImages,
      })
      const effectivePrompt = [mergedText, built.effectivePromptSuffix].filter(Boolean).join('\n')
      const { url } = await createVideoProvider().generate(effectivePrompt, {
        model: built.model,
        duration: built.duration,
        aspectRatio: built.aspectRatio,
        resolution: built.resolution,
        crop: built.crop,
        image: built.image,
      })
      await this.prisma.material.update({
        where: { id: materialId },
        data: { url, thumbnail: url, status: 'completed', prompt: effectivePrompt },
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
