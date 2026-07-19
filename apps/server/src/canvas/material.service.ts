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
import {
  BYOK_FALLBACK_CONFIRM_MESSAGE,
  resolveImageSize,
  resolveModelKey,
  type GenerationRefPayload,
  type ImageResolutionTier,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { PointsService } from '../points/points.service'
import { videoCredits } from '../points/video-credits'
import { classifyByokFailure } from '../provider/byok-fallback'
import {
  ProviderResolverService,
  type ResolvedGenerationProvider,
} from '../provider/provider-resolver.service'

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

function userProviderOpts(resolved: ResolvedGenerationProvider) {
  if (resolved.source !== 'user') return undefined
  return {
    apiKey: resolved.credentials.apiKey,
    baseUrl: resolved.credentials.baseUrl || undefined,
  }
}

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
    @Inject(ProviderResolverService) private readonly resolver: ProviderResolverService,
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

    const resolved = await this.resolver.resolveForGeneration(userId, model, 'image')
    const material = await this.prisma.material.create({
      data: {
        shotId,
        type: 'image',
        prompt,
        status: 'generating',
        metadata: JSON.stringify({
          model,
          aspectRatio,
          resolution,
          channelId: resolved.channelId,
          providerSource: resolved.source,
        }),
      },
    })
    this.runImageGeneration(
      material.id,
      userId,
      prompt,
      model,
      aspectRatio,
      resolution,
      refs,
      mentionedKeys,
      resolved,
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

    const resolved = await this.resolver.resolveForGeneration(userId, model, 'video')
    const material = await this.prisma.material.create({
      data: {
        shotId,
        type: 'video',
        prompt,
        status: 'generating',
        metadata: JSON.stringify({
          model,
          duration,
          aspectRatio,
          resolution,
          crop,
          channelId: resolved.channelId,
          providerSource: resolved.source,
        }),
      },
    })
    this.runVideoGeneration(
      material.id,
      userId,
      prompt,
      model,
      duration,
      aspectRatio,
      resolution,
      crop,
      refs,
      mentionedKeys,
      resolved,
    ).catch(console.error)
    return material
  }

  async confirmPlatformFallback(userId: string, materialId: string) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, shot: { session: { userId } } },
      include: { shot: { include: { session: true } } },
    })
    if (!material) throw new NotFoundException('素材不存在')
    if (material.status !== 'fallback_pending') {
      throw new BadRequestException('当前状态不可确认平台回退')
    }
    const meta = parseMeta(material.metadata)
    await this.resolver.resolveForGeneration(
      userId,
      String(meta.modelKey ?? meta.gatewayModelId ?? meta.model ?? ''),
      material.type === 'video' ? 'video' : 'image',
    )

    if (material.type === 'image') {
      const size = String(meta.size ?? resolveImageSize('16:9', '1K'))
      const modelKey =
        typeof meta.modelKey === 'string' && meta.modelKey.trim()
          ? meta.modelKey
          : undefined
      const modelId = resolveModelKey('image', modelKey).entry.gatewayModelId
      const prompt = String(meta.effectivePrompt ?? material.prompt ?? '')
      const { url } = await createImageProvider(undefined).generate(prompt, {
        modelId,
        size,
        n: 1,
      })
      return this.prisma.material.update({
        where: { id: material.id },
        data: {
          url,
          thumbnail: url,
          status: 'completed',
          prompt,
          metadata: JSON.stringify({
            ...meta,
            gatewayModelId: modelId,
            providerFallback: true,
            channelId: 'platform',
          }),
        },
      })
    }

    if (material.type === 'video') {
      const prompt = String(meta.effectivePrompt ?? material.prompt ?? '')
      const modelKey =
        typeof meta.modelKey === 'string' && meta.modelKey.trim()
          ? meta.modelKey
          : undefined
      const platformModel = resolveModelKey('video', modelKey).entry.gatewayModelId
      const { url } = await createVideoProvider(undefined).generate(prompt, {
        model: platformModel,
        duration: Number(meta.duration ?? 5),
        aspectRatio: String(meta.aspectRatio ?? '16:9'),
        resolution: String(meta.resolution ?? '720p'),
        crop: meta.crop === undefined ? undefined : String(meta.crop),
        image:
          typeof meta.image === 'string'
            ? meta.image
            : Array.isArray(meta.referenceImages)
              ? (meta.referenceImages as string[])[0]
              : undefined,
      })
      return this.prisma.material.update({
        where: { id: material.id },
        data: {
          url,
          thumbnail: url,
          status: 'completed',
          prompt,
          metadata: JSON.stringify({
            ...meta,
            gatewayModelId: platformModel,
            providerFallback: true,
            channelId: 'platform',
          }),
        },
      })
    }

    throw new BadRequestException('不支持的素材类型')
  }

  async cancelPlatformFallback(userId: string, materialId: string) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, shot: { session: { userId } } },
    })
    if (!material) throw new NotFoundException('素材不存在')
    if (material.status !== 'fallback_pending') {
      throw new BadRequestException('当前状态不可取消平台回退')
    }
    return this.prisma.material.update({
      where: { id: material.id },
      data: { status: 'failed' },
    })
  }

  private async resolveMergedPrompt(
    localPrompt: string,
    refs: GenerationRefPayload[] | undefined,
    downstreamType: 'image' | 'video',
    mentionedKeys?: string[],
    credentials?: { apiKey?: string; baseUrl?: string },
  ) {
    const { mergedText, skippedMerge } = await mergeRefsToPrompt({
      sources: extractTextSources(refs),
      localPrompt: localPrompt.trim() || undefined,
      downstreamType,
      mentionedKeys: mentionedKeys?.length ? mentionedKeys : undefined,
      apiKey: credentials?.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: credentials?.baseUrl ?? process.env.OPENAI_BASE_URL,
    })
    return {
      mergedText,
      skippedMerge,
      referenceImages: extractReferenceImages(refs),
    }
  }

  private async runImageGeneration(
    materialId: string,
    userId: string,
    prompt: string,
    model: string | undefined,
    aspectRatio: string | undefined,
    resolution: string | undefined,
    refs: GenerationRefPayload[] | undefined,
    mentionedKeys: string[] | undefined,
    resolved: ResolvedGenerationProvider,
  ) {
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'image',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
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
      modelKey: resolved.modelName,
      size,
      n: 1,
      referenceImages,
    })
    const modelId = resolved.source === 'user' ? resolved.modelName : built.modelId
    const primary = built.referenceImages[0]
    const base = primary ? buildPromptWithRefImage(mergedText, primary) : mergedText
    const effectivePrompt = [base, built.effectivePromptSuffix].filter(Boolean).join('\n')

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const provider = createImageProvider(userProviderOpts(resolved))
      const { url } = await provider.generate(effectivePrompt, {
        modelId,
        size: built.size,
        n: built.n,
      })
      await this.prisma.material.update({
        where: { id: materialId },
        data: {
          url,
          thumbnail: url,
          status: 'completed',
          prompt: effectivePrompt,
          metadata: JSON.stringify({
            ...built.meta,
            modelId,
            model,
            aspectRatio,
            resolution,
            size: built.size,
            referenceImages,
            skippedMerge,
            channelId: resolved.channelId,
            effectivePrompt,
          }),
        },
      })
    } catch (err) {
      console.error('Image generation failed:', err)
      if (resolved.source === 'user') {
        const existing = await this.prisma.material.findFirst({ where: { id: materialId } })
        const prev = parseMeta(existing?.metadata)
        await this.prisma.material.update({
          where: { id: materialId },
          data: {
            status: 'fallback_pending',
            prompt: effectivePrompt,
            metadata: JSON.stringify({
              ...prev,
              ...built.meta,
              modelId,
              model,
              originalModel: model,
              aspectRatio,
              resolution,
              size: built.size,
              referenceImages,
              skippedMerge,
              effectivePrompt,
              channelId: resolved.channelId,
              failureClass: classifyByokFailure(err),
              confirmMessage: BYOK_FALLBACK_CONFIRM_MESSAGE,
              userId,
            }),
          },
        })
        return
      }
      await this.prisma.material.update({
        where: { id: materialId },
        data: { status: 'failed' },
      })
    }
  }

  private async runVideoGeneration(
    materialId: string,
    userId: string,
    prompt: string,
    model: string | undefined,
    duration: number,
    aspectRatio: string,
    resolution: string,
    crop: string,
    refs: GenerationRefPayload[] | undefined,
    mentionedKeys: string[] | undefined,
    resolved: ResolvedGenerationProvider,
  ) {
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'video',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
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
      modelKey: resolved.modelName,
      duration,
      aspectRatio,
      resolution,
      crop,
      referenceImages,
    })
    const gatewayModel = resolved.source === 'user' ? resolved.modelName : built.model
    const effectivePrompt = [mergedText, built.effectivePromptSuffix].filter(Boolean).join('\n')

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { url } = await createVideoProvider(userProviderOpts(resolved)).generate(
        effectivePrompt,
        {
          model: gatewayModel,
          duration: built.duration,
          aspectRatio: built.aspectRatio,
          resolution: built.resolution,
          crop: built.crop,
          image: built.image,
        },
      )
      await this.prisma.material.update({
        where: { id: materialId },
        data: {
          url,
          thumbnail: url,
          status: 'completed',
          prompt: effectivePrompt,
          metadata: JSON.stringify({
            ...built.meta,
            model,
            duration,
            aspectRatio,
            resolution,
            crop,
            image: built.image,
            referenceImages,
            skippedMerge,
            channelId: resolved.channelId,
            effectivePrompt,
          }),
        },
      })
    } catch (err) {
      console.error('Video generation failed:', err)
      if (resolved.source === 'user') {
        const existing = await this.prisma.material.findFirst({ where: { id: materialId } })
        const prev = parseMeta(existing?.metadata)
        await this.prisma.material.update({
          where: { id: materialId },
          data: {
            status: 'fallback_pending',
            prompt: effectivePrompt,
            metadata: JSON.stringify({
              ...prev,
              ...built.meta,
              model,
              originalModel: model,
              modelName: resolved.modelName,
              duration,
              aspectRatio,
              resolution,
              crop,
              image: built.image,
              referenceImages,
              skippedMerge,
              effectivePrompt,
              channelId: resolved.channelId,
              failureClass: classifyByokFailure(err),
              confirmMessage: BYOK_FALLBACK_CONFIRM_MESSAGE,
              userId,
            }),
          },
        })
        return
      }
      await this.prisma.material.update({
        where: { id: materialId },
        data: { status: 'failed' },
      })
    }
  }
}
