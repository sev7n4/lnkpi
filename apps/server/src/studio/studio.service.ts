import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  buildAudioRequest,
  buildImageProviderOptions,
  buildVideoProviderOptions,
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  generatePromptFromUserInput,
  generateTextWithImages,
  mergeRefsToPrompt,
  type MergeTextSource,
} from '@lnkpi/agent'
import {
  BYOK_FALLBACK_CONFIRM_MESSAGE,
  resolveImageSize,
  resolveModelKey,
  type ImageResolutionTier,
  type StudioModality,
} from '@lnkpi/shared'
import {
  alreadyRefunded,
  applyChargeMeta,
  applyRefundMeta,
  isCancelledException,
  isCancelledMeta,
  rethrowWithRefundedPoints,
  throwCancelledException,
} from '../points/charge-session'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { classifyByokFailure } from '../provider/byok-fallback'
import {
  ProviderResolverService,
  type ResolvedGenerationProvider,
} from '../provider/provider-resolver.service'

const AUDIO_PLACEHOLDER = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

export interface StudioRefInput {
  refKey: string
  mediaType: string
  label?: string
  text?: string
  url?: string
}

function extractTextSources(refs?: StudioRefInput[]): MergeTextSource[] {
  return (refs ?? [])
    .filter((r) => r.mediaType === 'text' && r.text?.trim())
    .map((r) => ({
      refKey: r.refKey,
      label: r.label?.trim() || r.refKey,
      text: r.text!.trim(),
    }))
}

// Provider image/video APIs currently use only referenceImages[0] (I1); full list is kept in metadata.
function extractReferenceImages(refs?: StudioRefInput[]): string[] {
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

type CancelFlag = { isCancelled(): boolean }

@Injectable()
export class StudioService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
    @Inject(ProviderResolverService) private readonly resolver: ProviderResolverService,
  ) {}

  async listGenerations(userId: string, type?: string) {
    return this.prisma.generationRecord.findMany({
      where: { userId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  private async resolveMergedPrompt(
    localPrompt: string,
    refs: StudioRefInput[] | undefined,
    downstreamType: 'text' | 'image' | 'video' | 'audio',
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

  private pendingMeta(
    resolved: ResolvedGenerationProvider,
    err: unknown,
    extra: Record<string, unknown> = {},
  ) {
    return {
      ...extra,
      channelId: resolved.channelId,
      failureClass: classifyByokFailure(err),
      confirmMessage: BYOK_FALLBACK_CONFIRM_MESSAGE,
      originalModel: extra.originalModel,
    }
  }

  private byokPendingMeta(
    resolved: ResolvedGenerationProvider,
    err: unknown,
    cost: number,
    extra: Record<string, unknown> = {},
  ) {
    return applyRefundMeta(
      applyChargeMeta(this.pendingMeta(resolved, err, extra), cost),
      cost,
      'byok_failed',
    )
  }

  private platformFallbackCost(type: string, meta: Record<string, unknown>): number {
    if (type === 'text' || type === 'prompt' || type === 'audio') return 5
    if (type === 'image') return 10 * (Number(meta.count ?? 1) || 1)
    if (type === 'video') {
      const duration = Number(meta.duration ?? 5)
      return duration >= 15 ? 70 : duration >= 10 ? 50 : 30
    }
    throw new BadRequestException('不支持的生成类型')
  }

  private videoDurationCredits(duration: number): number {
    return duration >= 15 ? 70 : duration >= 10 ? 50 : 30
  }

  /** Catalog gateway id for platform confirm — never reuse user-channel modelName. */
  private platformGatewayModelId(
    modality: StudioModality,
    meta: Record<string, unknown>,
  ): string {
    const requested =
      typeof meta.modelKey === 'string' && meta.modelKey.trim()
        ? meta.modelKey
        : undefined
    return resolveModelKey(modality, requested).entry.gatewayModelId
  }

  async generateText(
    userId: string,
    prompt: string,
    model?: string,
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    cancel?: CancelFlag,
  ) {
    const cost = 5
    const chargeReason = '文本生成'
    await this.points.consume(userId, cost, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'text')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'text',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
    )
    const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('text', resolved.modelName)
    const gatewayModelId =
      resolved.source === 'user' ? resolved.modelName : entry.gatewayModelId
    const storeModel = resolved.source === 'user' ? model ?? resolvedKey : resolvedKey
    const baseMeta = {
      modelKey: resolvedKey,
      gatewayModelId,
      channelId: resolved.channelId,
      skippedMerge,
      refsCount: refs?.length ?? 0,
      visionUsed: referenceImages.length > 0,
      referenceImages,
      ...(fallback && resolved.source === 'platform' ? { modelFallback: true } : {}),
    }

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const opts = userProviderOpts(resolved)
      const { text } =
        referenceImages.length > 0
          ? await generateTextWithImages(mergedText, referenceImages, {
              model: gatewayModelId,
              apiKey: opts?.apiKey ?? process.env.OPENAI_API_KEY,
              baseUrl: opts?.baseUrl ?? process.env.OPENAI_BASE_URL,
            })
          : await createTextProvider(opts).generate(mergedText, gatewayModelId)
      if (cancel?.isCancelled()) {
        await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
        throwCancelledException(cost)
      }
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'text',
          prompt: mergedText,
          model: storeModel,
          url: null,
          status: 'completed',
          metadata: JSON.stringify(applyChargeMeta({ ...baseMeta, text }, cost)),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        rethrowWithRefundedPoints(err, cost)
      }
      await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'text',
          prompt: mergedText,
          model: storeModel,
          url: null,
          status: 'fallback_pending',
          metadata: JSON.stringify(
            this.byokPendingMeta(resolved, err, cost, {
              originalModel: model,
              ...baseMeta,
            }),
          ),
        },
      })
    }
  }

  async generatePrompt(userId: string, prompt: string, model?: string, cancel?: CancelFlag) {
    const trimmed = prompt?.trim()
    if (!trimmed) throw new BadRequestException('prompt 不能为空')
    const cost = 5
    const chargeReason = '提示词模式生成'
    await this.points.consume(userId, cost, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'text')
    const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('text', resolved.modelName)
    const gatewayModelId =
      resolved.source === 'user' ? resolved.modelName : entry.gatewayModelId
    const storeModel = resolved.source === 'user' ? model ?? resolvedKey : resolvedKey
    const opts = userProviderOpts(resolved)
    const baseMeta = {
      modelKey: resolvedKey,
      gatewayModelId,
      channelId: resolved.channelId,
      ...(fallback && resolved.source === 'platform' ? { modelFallback: true } : {}),
    }

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { mode, content } = await generatePromptFromUserInput(trimmed, {
        model: gatewayModelId,
        apiKey: opts?.apiKey ?? process.env.OPENAI_API_KEY,
        baseUrl: opts?.baseUrl ?? process.env.OPENAI_BASE_URL,
      })
      if (cancel?.isCancelled()) {
        await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
        throwCancelledException(cost)
      }
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'prompt',
          prompt: trimmed,
          model: storeModel,
          url: null,
          status: 'completed',
          metadata: JSON.stringify(applyChargeMeta({ ...baseMeta, mode, content }, cost)),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        rethrowWithRefundedPoints(err, cost)
      }
      await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'prompt',
          prompt: trimmed,
          model: storeModel,
          url: null,
          status: 'fallback_pending',
          metadata: JSON.stringify(
            this.byokPendingMeta(resolved, err, cost, {
              originalModel: model,
              ...baseMeta,
            }),
          ),
        },
      })
    }
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

  async generateImage(
    userId: string,
    prompt: string,
    model?: string,
    aspectRatio = '16:9',
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    resolution = '1K',
    count = 1,
    cancel?: CancelFlag,
  ) {
    const n = Math.max(1, Math.min(4, Number(count) || 1))
    const cost = 10 * n
    const chargeReason = '图像生成'
    await this.points.consume(userId, cost, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'image')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'image',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
    )
    const size = resolveImageSize(aspectRatio, resolution as ImageResolutionTier)
    const built = buildImageProviderOptions({
      modelKey: resolved.modelName,
      size,
      n,
      referenceImages,
    })
    const modelId = resolved.source === 'user' ? resolved.modelName : built.modelId
    const storeModel =
      resolved.source === 'user' ? model ?? built.meta.modelKey : built.meta.modelKey
    const primaryRef = built.referenceImages[0]
    const basePrompt = primaryRef ? buildPromptWithRefImage(mergedText, primaryRef) : mergedText
    const effectivePrompt = [basePrompt, built.effectivePromptSuffix].filter(Boolean).join('\n')

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { url, urls } = await createImageProvider(userProviderOpts(resolved)).generate(
        effectivePrompt,
        {
          size: built.size,
          n: built.n,
          modelId,
        },
      )
      const imageUrls = urls?.length ? urls : [url]
      if (cancel?.isCancelled()) {
        await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
        throwCancelledException(cost)
      }
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'image',
          prompt: effectivePrompt,
          model: storeModel,
          url: imageUrls[0],
          status: 'completed',
          metadata: JSON.stringify(
            applyChargeMeta(
              {
                ...built.meta,
                modelId,
                aspectRatio,
                resolution,
                count: n,
                size: built.size,
                urls: imageUrls,
                referenceImages,
                skippedMerge,
                channelId: resolved.channelId,
              },
              cost,
            ),
          ),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        rethrowWithRefundedPoints(err, cost)
      }
      await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'image',
          prompt: effectivePrompt,
          model: storeModel,
          url: null,
          status: 'fallback_pending',
          metadata: JSON.stringify(
            this.byokPendingMeta(resolved, err, cost, {
              ...built.meta,
              modelId,
              originalModel: model,
              aspectRatio,
              resolution,
              count: n,
              size: built.size,
              referenceImages,
              skippedMerge,
            }),
          ),
        },
      })
    }
  }

  async generateImageVariation(
    userId: string,
    prompt: string,
    basePrompt?: string,
    model?: string,
    cancel?: CancelFlag,
  ) {
    const cost = 10
    const chargeReason = '图像变体'
    await this.points.consume(userId, cost, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'image')
    const combined = basePrompt ? `${basePrompt}。变体要求：${prompt}` : prompt
    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { url } = await createImageProvider(userProviderOpts(resolved)).generate(combined, {
        modelId: resolved.modelName || undefined,
      })
      if (cancel?.isCancelled()) {
        await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
        throwCancelledException(cost)
      }
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'image',
          prompt: combined,
          model: model ?? resolved.modelName,
          url,
          status: 'completed',
          metadata: JSON.stringify(
            applyChargeMeta(
              {
                variation: true,
                basePrompt,
                channelId: resolved.channelId,
              },
              cost,
            ),
          ),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        rethrowWithRefundedPoints(err, cost)
      }
      await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
      return this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'image',
          prompt: combined,
          model: model ?? resolved.modelName,
          url: null,
          status: 'fallback_pending',
          metadata: JSON.stringify(
            this.byokPendingMeta(resolved, err, cost, {
              originalModel: model,
              variation: true,
              basePrompt,
            }),
          ),
        },
      })
    }
  }

  async generateVideo(
    userId: string,
    prompt: string,
    model?: string,
    duration = 5,
    aspectRatio = '16:9',
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    resolution = '720p',
    crop = 'none',
  ) {
    const durationCredits = this.videoDurationCredits(duration)
    const chargeReason = '视频生成'
    await this.points.consume(userId, durationCredits, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'video')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'video',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
    )
    const built = buildVideoProviderOptions({
      modelKey: resolved.modelName,
      duration,
      aspectRatio,
      resolution,
      crop,
      referenceImages,
    })
    const gatewayModel =
      resolved.source === 'user' ? resolved.modelName : built.model
    const storeModel =
      resolved.source === 'user' ? model ?? built.meta.modelKey : built.meta.modelKey
    const effectivePrompt = [mergedText, built.effectivePromptSuffix].filter(Boolean).join('\n')
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'video',
        prompt: effectivePrompt,
        model: storeModel,
        status: 'generating',
        metadata: JSON.stringify(
          applyChargeMeta(
            {
              ...built.meta,
              duration,
              aspectRatio,
              resolution,
              crop,
              referenceImages,
              skippedMerge,
              mergedText,
              channelId: resolved.channelId,
              originalModel: model,
              providerSource: resolved.source,
            },
            durationCredits,
          ),
        ),
      },
    })
    this.completeVideo(
      record.id,
      userId,
      durationCredits,
      chargeReason,
      effectivePrompt,
      {
        model: gatewayModel,
        duration: built.duration,
        aspectRatio: built.aspectRatio,
        resolution: built.resolution,
        crop: built.crop,
        image: built.image,
      },
      resolved,
    ).catch(console.error)
    return record
  }

  async generateAudio(
    userId: string,
    text: string,
    options: {
      model?: string
      voice?: string
      emotion?: string
      language?: string
      speed?: number
      volume?: number
      pitch?: number
    } = {},
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    cancel?: CancelFlag,
  ) {
    const cost = 5
    const chargeReason = '音频生成'
    await this.points.consume(userId, cost, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, options.model, 'audio')
    const { mergedText, skippedMerge } = await this.resolveMergedPrompt(
      text,
      refs,
      'audio',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
    )
    const built = buildAudioRequest({
      mergedText,
      modelKey: resolved.modelName,
      voice: options.voice,
      emotion: options.emotion,
      language: options.language,
      speed: options.speed,
      volume: options.volume,
      pitch: options.pitch,
    })
    const audioOpts =
      resolved.source === 'user'
        ? { ...built.options, model: resolved.modelName }
        : built.options
    const storeModel =
      resolved.source === 'user' ? options.model ?? built.meta.modelKey : built.meta.modelKey

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { url } = await createAudioProvider(userProviderOpts(resolved)).generate(
        built.text,
        audioOpts,
      )
      const storeUrl = url.startsWith('data:') ? AUDIO_PLACEHOLDER : url
      if (cancel?.isCancelled()) {
        await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
        throwCancelledException(cost)
      }
      const record = await this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'audio',
          prompt: mergedText,
          model: storeModel,
          url: storeUrl,
          status: 'completed',
          metadata: JSON.stringify(
            applyChargeMeta(
              {
                ...built.meta,
                skippedMerge,
                voice: built.options.voice ?? options.voice ?? 'default',
                emotion: options.emotion ?? 'neutral',
                language: options.language ?? 'zh',
                speed: options.speed ?? 1,
                volume: options.volume,
                pitch: options.pitch,
                hasTtsData: url.startsWith('data:'),
                channelId: resolved.channelId,
              },
              cost,
            ),
          ),
        },
      })
      return { ...record, url }
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        rethrowWithRefundedPoints(err, cost)
      }
      await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
      const record = await this.prisma.generationRecord.create({
        data: {
          userId,
          type: 'audio',
          prompt: mergedText,
          model: storeModel,
          url: null,
          status: 'fallback_pending',
          metadata: JSON.stringify(
            this.byokPendingMeta(resolved, err, cost, {
              ...built.meta,
              originalModel: options.model,
              skippedMerge,
              voice: options.voice,
              emotion: options.emotion,
              language: options.language,
              speed: options.speed,
              volume: options.volume,
              pitch: options.pitch,
              audioOptions: audioOpts,
            }),
          ),
        },
      })
      return record
    }
  }

  async confirmPlatformFallback(userId: string, recordId: string, cancel?: CancelFlag) {
    const record = await this.getGeneration(userId, recordId)
    if (record.status !== 'fallback_pending') {
      throw new BadRequestException('当前状态不可确认平台回退')
    }
    const meta = parseMeta(record.metadata)
    const platformCost = this.platformFallbackCost(record.type, meta)
    await this.points.consume(userId, platformCost, '平台回退生成')
    const chargedMeta = { ...meta, chargedPoints: platformCost, priorByokRefunded: true }

    try {
      if (record.type === 'image') {
        const size = String(meta.size ?? '1024x1024')
        const n = Number(meta.count ?? 1) || 1
        const modelId = this.platformGatewayModelId('image', meta)
        const { url, urls } = await createImageProvider(undefined).generate(record.prompt, {
          size,
          n,
          modelId,
        })
        const imageUrls = urls?.length ? urls : [url]
        if (cancel?.isCancelled()) {
          await this.points.refund(userId, platformCost, '平台回退-取消退款')
          throwCancelledException(platformCost)
        }
        return this.prisma.generationRecord.update({
          where: { id: record.id },
          data: {
            url: imageUrls[0],
            status: 'completed',
            metadata: JSON.stringify({
              ...chargedMeta,
              urls: imageUrls,
              gatewayModelId: modelId,
              providerFallback: true,
              channelId: 'platform',
            }),
          },
        })
      }

      if (record.type === 'text' || record.type === 'prompt') {
        const gatewayModelId = this.platformGatewayModelId('text', meta)
        const referenceImages = Array.isArray(meta.referenceImages)
          ? (meta.referenceImages as string[])
          : []
        let text: string
        let promptMeta: Record<string, unknown> = {}
        if (record.type === 'prompt') {
          const { mode, content } = await generatePromptFromUserInput(record.prompt, {
            model: gatewayModelId,
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL,
          })
          text = content
          promptMeta = { mode, content }
        } else if (referenceImages.length > 0) {
          const result = await generateTextWithImages(record.prompt, referenceImages, {
            model: gatewayModelId,
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL,
          })
          text = result.text
        } else {
          const result = await createTextProvider(undefined).generate(record.prompt, gatewayModelId)
          text = result.text
        }
        if (cancel?.isCancelled()) {
          await this.points.refund(userId, platformCost, '平台回退-取消退款')
          throwCancelledException(platformCost)
        }
        return this.prisma.generationRecord.update({
          where: { id: record.id },
          data: {
            status: 'completed',
            metadata: JSON.stringify({
              ...chargedMeta,
              ...promptMeta,
              text: record.type === 'text' ? text : meta.text,
              gatewayModelId,
              providerFallback: true,
              channelId: 'platform',
            }),
          },
        })
      }

      if (record.type === 'audio') {
        const platformModel = this.platformGatewayModelId('audio', meta)
        const prevAudio = (meta.audioOptions as Record<string, unknown> | undefined) ?? {}
        const audioOptions = {
          ...prevAudio,
          model: platformModel,
          voice: prevAudio.voice ?? meta.voice,
          speed: prevAudio.speed ?? meta.speed,
          volume: prevAudio.volume ?? meta.volume,
          pitch: prevAudio.pitch ?? meta.pitch,
        }
        const { url } = await createAudioProvider(undefined).generate(
          record.prompt,
          audioOptions as { model?: string; voice?: string; speed?: number; volume?: number; pitch?: number },
        )
        const storeUrl = url.startsWith('data:') ? AUDIO_PLACEHOLDER : url
        if (cancel?.isCancelled()) {
          await this.points.refund(userId, platformCost, '平台回退-取消退款')
          throwCancelledException(platformCost)
        }
        return this.prisma.generationRecord.update({
          where: { id: record.id },
          data: {
            url: storeUrl,
            status: 'completed',
            metadata: JSON.stringify({
              ...chargedMeta,
              audioOptions,
              gatewayModelId: platformModel,
              hasTtsData: url.startsWith('data:'),
              providerFallback: true,
              channelId: 'platform',
            }),
          },
        })
      }

      if (record.type === 'video') {
        const platformModel = this.platformGatewayModelId('video', meta)
        const { url } = await createVideoProvider(undefined).generate(record.prompt, {
          model: platformModel,
          duration: Number(meta.duration ?? 5),
          aspectRatio: String(meta.aspectRatio ?? '16:9'),
          resolution: String(meta.resolution ?? '720p'),
          crop: meta.crop === undefined ? undefined : String(meta.crop),
          image: Array.isArray(meta.referenceImages)
            ? (meta.referenceImages as string[])[0]
            : undefined,
        })
        if (cancel?.isCancelled()) {
          await this.points.refund(userId, platformCost, '平台回退-取消退款')
          throwCancelledException(platformCost)
        }
        return this.prisma.generationRecord.update({
          where: { id: record.id },
          data: {
            url,
            status: 'completed',
            metadata: JSON.stringify({
              ...chargedMeta,
              gatewayModelId: platformModel,
              providerFallback: true,
              channelId: 'platform',
            }),
          },
        })
      }

      throw new BadRequestException('不支持的生成类型')
    } catch (err) {
      if (isCancelledException(err)) {
        await this.prisma.generationRecord.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            metadata: JSON.stringify(
              applyRefundMeta(chargedMeta, platformCost, 'cancelled'),
            ),
          },
        })
        throw err
      }
      if (err instanceof BadRequestException && err.message === '不支持的生成类型') {
        await this.points.refund(userId, platformCost, '平台回退失败退款')
        rethrowWithRefundedPoints(err, platformCost)
      }
      await this.points.refund(userId, platformCost, '平台回退失败退款')
      await this.prisma.generationRecord.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(
            applyRefundMeta(chargedMeta, platformCost, 'platform_fallback_failed'),
          ),
        },
      })
      rethrowWithRefundedPoints(err, platformCost)
    }
  }

  async cancelPlatformFallback(userId: string, recordId: string) {
    const record = await this.getGeneration(userId, recordId)
    if (record.status !== 'fallback_pending') {
      throw new BadRequestException('当前状态不可取消平台回退')
    }
    const meta = parseMeta(record.metadata)
    if (!alreadyRefunded(meta)) {
      const cost =
        typeof meta.chargedPoints === 'number'
          ? meta.chargedPoints
          : this.platformFallbackCost(record.type, meta)
      await this.points.refund(userId, cost, '平台回退取消退款')
    }
    return this.prisma.generationRecord.update({
      where: { id: record.id },
      data: { status: 'failed' },
    })
  }

  async cancelGeneration(userId: string, recordId: string) {
    const record = await this.getGeneration(userId, recordId)
    if (record.status !== 'generating') {
      throw new BadRequestException('当前状态不可取消')
    }
    const meta = parseMeta(record.metadata)
    const cost = typeof meta.chargedPoints === 'number' ? meta.chargedPoints : 0
    const chargeReason =
      record.type === 'video' ? '视频生成' : record.type === 'image' ? '图像生成' : '生成'
    let updatedMeta: Record<string, unknown> = { ...meta, cancelled: true }
    if (cost > 0 && !alreadyRefunded(meta)) {
      await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
      updatedMeta = applyRefundMeta(updatedMeta, cost, 'cancelled')
    }
    return this.prisma.generationRecord.update({
      where: { id: record.id },
      data: {
        status: 'failed',
        metadata: JSON.stringify(updatedMeta),
      },
    })
  }

  private async completeVideo(
    id: string,
    userId: string,
    cost: number,
    chargeReason: string,
    prompt: string,
    options: {
      model?: string
      duration?: number
      aspectRatio?: string
      resolution?: string
      crop?: string
      image?: string
    },
    resolved: ResolvedGenerationProvider,
  ) {
    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { url } = await createVideoProvider(userProviderOpts(resolved)).generate(
        prompt,
        options,
      )
      const existing = await this.prisma.generationRecord.findFirst({ where: { id } })
      if (!existing || existing.status !== 'generating') return
      const meta = parseMeta(existing.metadata)
      if (isCancelledMeta(meta) || alreadyRefunded(meta)) return
      const updated = await this.prisma.generationRecord.updateMany({
        where: { id, status: 'generating' },
        data: { url, status: 'completed' },
      })
      if (updated.count === 0) return
    } catch (err) {
      console.error('Video generation failed:', err)
      const existing = await this.prisma.generationRecord.findFirst({ where: { id } })
      if (!existing || existing.status !== 'generating') return
      const meta = parseMeta(existing.metadata)
      if (isCancelledMeta(meta) || alreadyRefunded(meta)) return
      if (resolved.source === 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
        await this.prisma.generationRecord.update({
          where: { id },
          data: {
            status: 'fallback_pending',
            metadata: JSON.stringify(this.byokPendingMeta(resolved, err, cost, meta)),
          },
        })
        return
      }
      await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
      await this.prisma.generationRecord.update({
        where: { id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(applyRefundMeta(meta, cost, 'platform_failed')),
        },
      })
    }
  }
}
