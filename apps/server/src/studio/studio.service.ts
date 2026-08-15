import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  buildAudioRequest,
  buildEffectiveImagePrompt,
  buildEffectiveVideoPrompt,
  buildImageProviderGenerateOptions,
  buildImageProviderOptions,
  buildVideoProviderGenerateOptions,
  buildVideoProviderOptions,
  buildVideoReferenceBundle,
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  generatePromptFromUserInput,
  generateTextForRefs,
  generateVisionQaJson,
  imageRefDescriptorsFromRefs,
  mergeRefsToPrompt,
  Seedance1xUnsupportedError,
  stripRefImagePromptTags,
  type MergeTextSource,
} from '@lnkpi/agent'
import {
  BYOK_FALLBACK_CONFIRM_MESSAGE,
  mapMessageToErrorCode,
  redactProviderSnippet,
  resolveImageSize,
  resolveModelKey,
  resolvePlatformImageProviderOpts,
  resolvePublicMediaUrls,
  type ErrorCode,
  type GenerationRefPayload,
  type GenerationDiagnostic,
  type ImageRefWire,
  type ImageResolutionTier,
  type MediaInfo,
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
import { mergeChatModel } from '../provider/merge-chat-model'
import {
  ProviderResolverService,
  type ResolvedGenerationProvider,
} from '../provider/provider-resolver.service'
import { MediaProbeService } from '../media/media-probe.service'
import { inlineUpstreamReferenceImages } from '../media/upstream-ref-inline'

const AUDIO_PLACEHOLDER = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

// Grace window before returning the async `generating` record: fast image
// providers usually finish within this, sparing the client a polling round.
const IMAGE_FAST_PATH_MS = 3000

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

// Full referenceImages[] is kept in metadata; agnes-image-* uses native extra_body.image for all refs.
function extractReferenceImages(refs?: StudioRefInput[]): string[] {
  return resolvePublicMediaUrls(
    (refs ?? [])
      .filter((r) => r.mediaType === 'image' && r.url?.trim())
      .map((r) => r.url!.trim()),
  )
}

function resolveStudioVideoMode(
  explicit: string | undefined,
  referenceBundle: ReturnType<typeof buildVideoReferenceBundle>,
): 'text_to_video' | 'image_to_video' | 'first_last_frame' {
  if (
    explicit === 'first_last_frame'
    || explicit === 'image_to_video'
    || explicit === 'text_to_video'
  ) {
    return explicit
  }
  return referenceBundle.images.length ? 'image_to_video' : 'text_to_video'
}

function providerOpts(resolved: ResolvedGenerationProvider) {
  const { apiKey, baseUrl } = resolved.credentials
  if (resolved.source === 'user' && !apiKey) return undefined
  return {
    apiKey,
    baseUrl: baseUrl || undefined,
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

function hintForCode(code: ErrorCode): string | undefined {
  switch (code) {
    case 'upstream_timeout':
      return '请稍后重试'
    case 'insufficient_points':
      return '请充值后再试'
    case 'cancelled':
      return '可重新发起生成'
    case 'upload_required':
      return '请先上传参考图'
    case 'model_unavailable':
      return '请更换可用模型'
    case 'upstream_error':
      return '请稍后重试或更换模型'
    case 'fallback_pending':
      return '可确认使用平台通道或取消'
    case 'invalid_input':
      return '请检查输入后重试'
    default:
      return undefined
  }
}

function userMessageForCode(code: ErrorCode, fallback: string): string {
  switch (code) {
    case 'insufficient_points':
      return '积分不足'
    case 'upstream_timeout':
      return '上游超时，请稍后重试'
    case 'cancelled':
      return '已取消'
    case 'upload_required':
      return '参考图尚未上传'
    case 'model_unavailable':
      return '模型不可用'
    case 'upstream_error':
      return '上游服务异常'
    case 'fallback_pending':
      return '需要确认是否使用平台回退'
    case 'invalid_input':
      return '输入无效'
    default:
      return fallback.trim() || '生成失败'
  }
}

function errMessage(err: unknown): string {
  if (err instanceof BadRequestException) {
    const response = err.getResponse()
    if (typeof response === 'string') return response
    if (response && typeof response === 'object') {
      const message = (response as { message?: unknown }).message
      if (typeof message === 'string') return message
      if (Array.isArray(message)) return message.map(String).join('; ')
    }
  }
  if (err instanceof Error) return err.message
  return '生成失败'
}

function applyFailureDiagnosticMeta(
  existingMeta: Record<string, unknown>,
  err: unknown,
  overrides: { userMessage?: string; errorCode?: ErrorCode } = {},
): Record<string, unknown> {
  const errMsg = errMessage(err)
  const errorCode = overrides.errorCode ?? mapMessageToErrorCode(errMsg)
  const userMessage = overrides.userMessage ?? userMessageForCode(errorCode, errMsg)
  return {
    ...existingMeta,
    errorCode,
    errorRaw: errMsg.slice(0, 8000),
    userMessage,
    failedAt: new Date().toISOString(),
  }
}

function throwGenerationFailure(opts: {
  userMessage: string
  errorCode: ErrorCode
  taskId: string
  refundedPoints?: number
}): never {
  throw new BadRequestException({
    message: opts.userMessage,
    errorCode: opts.errorCode,
    taskKind: 'generation',
    taskId: opts.taskId,
    ...(opts.refundedPoints != null ? { refundedPoints: opts.refundedPoints } : {}),
  })
}

type CancelFlag = { isCancelled(): boolean }

export type CanvasGenerationScope = {
  sessionId?: string
  nodeId?: string
}

function withCanvasScope(scope?: CanvasGenerationScope) {
  if (!scope?.sessionId && !scope?.nodeId) return {}
  return {
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    ...(scope.nodeId ? { nodeId: scope.nodeId } : {}),
  }
}

@Injectable()
export class StudioService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
    @Inject(ProviderResolverService) private readonly resolver: ProviderResolverService,
    @Inject(MediaProbeService) private readonly mediaProbe: MediaProbeService,
  ) {}

  async listGenerations(userId: string, type?: string, sessionId?: string) {
    return this.prisma.generationRecord.findMany({
      where: {
        userId,
        ...(type ? { type } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
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
    model?: string,
    videoImageRefs?: Array<{ refKey: string; label: string }>,
  ) {
    const { mergedText, skippedMerge } = await mergeRefsToPrompt({
      sources: extractTextSources(refs),
      localPrompt: localPrompt.trim() || undefined,
      downstreamType,
      mentionedKeys: mentionedKeys?.length ? mentionedKeys : undefined,
      imageRefs:
        downstreamType === 'video'
          ? videoImageRefs
          : downstreamType === 'image'
            ? imageRefDescriptorsFromRefs(refs)
            : undefined,
      apiKey: credentials?.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: credentials?.baseUrl ?? process.env.OPENAI_BASE_URL,
      model: mergeChatModel(downstreamType, model),
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
    const raw = errMessage(err).slice(0, 8000)
    const failureClass = classifyByokFailure(err)
    return {
      ...extra,
      channelId: resolved.channelId,
      failureClass,
      confirmMessage: BYOK_FALLBACK_CONFIRM_MESSAGE,
      originalModel: extra.originalModel,
      byokErrorRaw: raw,
      errorRaw: raw,
      errorCode: 'fallback_pending' as ErrorCode,
      userMessage: raw
        ? `BYOK 上游失败（${failureClass}）：${raw.slice(0, 240)}`
        : 'BYOK 上游失败，可改用平台模型继续',
      failedAt: new Date().toISOString(),
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

  /** Internal agent path: vision QA for product_visual — no points charge. */
  async runVisionQaInternal(
    userId: string,
    params: {
      systemPrompt: string
      userContent: string
      imageUrls: string[]
      model?: string
    },
  ): Promise<{ text: string; visionUsed: boolean }> {
    const resolved = await this.resolver.resolveForGeneration(userId, params.model, 'text')
    const { entry } = resolveModelKey('text', resolved.modelName)
    const gatewayModelId =
      resolved.source === 'user' ? resolved.modelName : entry.gatewayModelId
    if (resolved.source === 'user' && !resolved.credentials.apiKey) {
      throw new Error('missing api key')
    }
    const opts = providerOpts(resolved)
    const urls = params.imageUrls.map((u) => u.trim()).filter(Boolean)
    if (!urls.length) {
      throw new BadRequestException('imageUrls 不能为空')
    }
    const providerRefs = await inlineUpstreamReferenceImages(urls)
    return generateVisionQaJson(params.systemPrompt, params.userContent, providerRefs, {
      model: gatewayModelId,
      apiKey: opts?.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: opts?.baseUrl ?? process.env.OPENAI_BASE_URL,
      maxRetries: 2,
    })
  }

  async generateText(
    userId: string,
    prompt: string,
    model?: string,
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    cancel?: CancelFlag,
    thinking?: boolean,
    thinkingEffort?: 'high' | 'max',
    scope?: CanvasGenerationScope,
  ) {
    const cost = 5
    const chargeReason = '文本生成'
    await this.points.consume(userId, cost, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'text')
    const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('text', resolved.modelName)
    const gatewayModelId =
      resolved.source === 'user' ? resolved.modelName : entry.gatewayModelId
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'text',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
      gatewayModelId,
    )
    const storeModel = resolved.source === 'user' ? model ?? resolvedKey : resolvedKey
    const textOpts = {
      thinking: !!thinking,
      thinkingEffort: thinkingEffort === 'max' ? ('max' as const) : ('high' as const),
    }
    const baseMeta = {
      modelKey: resolvedKey,
      gatewayModelId,
      channelId: resolved.channelId,
      skippedMerge,
      refsCount: refs?.length ?? 0,
      visionUsed: false,
      referenceImages,
      thinking: textOpts.thinking,
      thinkingEffort: textOpts.thinking ? textOpts.thinkingEffort : undefined,
      ...(fallback && resolved.source === 'platform' ? { modelFallback: true } : {}),
    }

    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const opts = providerOpts(resolved)
      const providerRefs = referenceImages.length
        ? await inlineUpstreamReferenceImages(referenceImages)
        : referenceImages
      const { text, visionUsed } = await generateTextForRefs(mergedText, providerRefs, {
        model: gatewayModelId,
        apiKey: opts?.apiKey ?? process.env.OPENAI_API_KEY,
        baseUrl: opts?.baseUrl ?? process.env.OPENAI_BASE_URL,
        textOpts,
      })
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
          metadata: JSON.stringify(applyChargeMeta({ ...baseMeta, text, visionUsed }, cost)),
          ...withCanvasScope(scope),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        const failedMeta = applyFailureDiagnosticMeta(
          applyRefundMeta(applyChargeMeta({ ...baseMeta }, cost), cost, 'platform_failed'),
          err,
        )
        const failed = await this.prisma.generationRecord.create({
          data: {
            userId,
            type: 'text',
            prompt: mergedText,
            model: storeModel,
            url: null,
            status: 'failed',
            metadata: JSON.stringify(failedMeta),
            ...withCanvasScope(scope),
          },
        })
        throwGenerationFailure({
          userMessage: String(failedMeta.userMessage ?? '生成失败'),
          errorCode: failedMeta.errorCode as ErrorCode,
          taskId: failed.id,
          refundedPoints: cost,
        })
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
          ...withCanvasScope(scope),
        },
      })
    }
  }

  async generatePrompt(
    userId: string,
    prompt: string,
    model?: string,
    cancel?: CancelFlag,
    scope?: CanvasGenerationScope,
  ) {
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
    const opts = providerOpts(resolved)
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
          ...withCanvasScope(scope),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        const failedMeta = applyFailureDiagnosticMeta(
          applyRefundMeta(applyChargeMeta({ ...baseMeta }, cost), cost, 'platform_failed'),
          err,
        )
        const failed = await this.prisma.generationRecord.create({
          data: {
            userId,
            type: 'prompt',
            prompt: trimmed,
            model: storeModel,
            url: null,
            status: 'failed',
            metadata: JSON.stringify(failedMeta),
            ...withCanvasScope(scope),
          },
        })
        throwGenerationFailure({
          userMessage: String(failedMeta.userMessage ?? '生成失败'),
          errorCode: failedMeta.errorCode as ErrorCode,
          taskId: failed.id,
          refundedPoints: cost,
        })
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
          ...withCanvasScope(scope),
        },
      })
    }
  }

  /** Expand user prompt via prompt-modes (no separate charge; used by turnaround image pipeline). */
  async expandPromptContent(
    userId: string,
    prompt: string,
    model?: string,
  ): Promise<{ mode: string; content: string }> {
    const trimmed = prompt?.trim()
    if (!trimmed) throw new BadRequestException('prompt 不能为空')
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'text')
    const { modelKey: resolvedKey, entry } = resolveModelKey('text', resolved.modelName)
    const gatewayModelId =
      resolved.source === 'user' ? resolved.modelName : entry.gatewayModelId
    const opts = providerOpts(resolved)
    if (resolved.source === 'user' && !resolved.credentials.apiKey) {
      throw new Error('missing api key')
    }
    const { mode, content } = await generatePromptFromUserInput(trimmed, {
      model: gatewayModelId,
      apiKey: opts?.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: opts?.baseUrl ?? process.env.OPENAI_BASE_URL,
    })
    return { mode, content }
  }

  async getGeneration(userId: string, id: string) {
    const record = await this.prisma.generationRecord.findFirst({
      where: { id, userId },
    })
    if (!record) {
      throw new BadRequestException('生成记录不存在')
    }
    const meta = parseMeta(record.metadata)
    const mediaInfo = meta.mediaInfo as MediaInfo | undefined
    return {
      ...record,
      ...(mediaInfo ? { mediaInfo } : {}),
    }
  }

  private async attachMediaInfoToRecord(
    recordId: string,
    outputUrl: string | null,
    referenceUrls: string[],
  ): Promise<void> {
    const output = outputUrl ? await this.mediaProbe.probeUrl(outputUrl) : undefined
    const references = await Promise.all(
      referenceUrls
        .filter((url) => typeof url === 'string' && url.trim())
        .map(async (url) => this.mediaProbe.probeUrl(url.trim())),
    )
    const mediaInfo: MediaInfo = {
      ...(output ? { output } : {}),
      ...(references.length ? { references } : {}),
      probedAt: new Date().toISOString(),
    }
    const existing = await this.prisma.generationRecord.findFirst({ where: { id: recordId } })
    if (!existing) return
    const meta = parseMeta(existing.metadata)
    await this.prisma.generationRecord.update({
      where: { id: recordId },
      data: {
        metadata: JSON.stringify({ ...meta, mediaInfo }),
      },
    })
  }

  async getGenerationDiagnostic(userId: string, id: string): Promise<GenerationDiagnostic> {
    const record = await this.getGeneration(userId, id)
    if (
      record.status !== 'failed'
      && record.status !== 'error'
      && record.status !== 'fallback_pending'
    ) {
      throw new NotFoundException('诊断不可用')
    }
    const meta = parseMeta(record.metadata)
    const errRaw =
      (typeof meta.byokErrorRaw === 'string' && meta.byokErrorRaw.trim()
        ? meta.byokErrorRaw
        : '')
      || (meta.errorRaw != null ? String(meta.errorRaw) : '')
    const code =
      (typeof meta.errorCode === 'string' ? (meta.errorCode as ErrorCode) : undefined) ??
      mapMessageToErrorCode(errRaw)
    const defaultMessage =
      record.status === 'fallback_pending' ? '平台回退待确认' : '生成失败'
    const userMessage =
      (typeof meta.userMessage === 'string' && meta.userMessage.trim()
        ? meta.userMessage
        : undefined) ?? defaultMessage
    const occurredAt =
      typeof meta.failedAt === 'string' && meta.failedAt
        ? meta.failedAt
        : record.createdAt.toISOString()

    return {
      userMessage,
      code,
      taskKind: 'generation',
      taskId: record.id,
      model: record.model ?? (typeof meta.model === 'string' ? meta.model : null) ?? null,
      channelId: typeof meta.channelId === 'string' ? meta.channelId : null,
      apiFormat: typeof meta.apiFormat === 'string' ? meta.apiFormat : null,
      httpStatus: typeof meta.httpStatus === 'number' ? meta.httpStatus : null,
      occurredAt,
      providerSnippet: errRaw ? redactProviderSnippet(errRaw) : null,
      hint:
        record.status === 'fallback_pending'
          ? '请确认是否使用平台回退继续，或取消本次生成。'
          : hintForCode(code),
    }
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
    scope?: CanvasGenerationScope,
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
      resolved.modelName,
    )
    const pixelSize = resolveImageSize(aspectRatio, resolution as ImageResolutionTier)
    const built = buildImageProviderOptions({
      modelKey: resolved.modelName,
      aspectRatio,
      resolution: resolution as ImageResolutionTier,
      pixelSize,
      n,
      referenceImages,
      byok: resolved.source === 'user',
      channelBaseUrl: resolved.credentials.baseUrl,
    })
    const modelId = resolved.source === 'user' ? resolved.modelName : built.modelId
    const storeModel =
      resolved.source === 'user' ? model ?? built.meta.modelKey : built.meta.modelKey
    const effectivePrompt = buildEffectiveImagePrompt(
      mergedText,
      built,
      imageRefDescriptorsFromRefs(refs),
    )
    const providerOptions = buildImageProviderGenerateOptions(built)
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'image',
        prompt: effectivePrompt,
        model: storeModel,
        status: 'generating',
        metadata: JSON.stringify(
          applyChargeMeta(
            {
              ...built.meta,
              modelId,
              aspectRatio,
              resolution,
              count: n,
              size: built.size,
              pixelSize,
              referenceImages,
              skippedMerge,
              channelId: resolved.channelId,
              originalModel: model,
              providerSource: resolved.source,
              responseMode: built.meta.responseMode,
              refWire: built.meta.refWire,
            },
            cost,
          ),
        ),
        ...withCanvasScope(scope),
      },
    })
    const completion = this.completeImage(
      record.id,
      userId,
      cost,
      chargeReason,
      effectivePrompt,
      providerOptions,
      resolved,
    ).catch((err) => {
      console.error('Image generation failed:', err)
      return null
    })
    // Fast path: quick providers finish within the grace window, so the client
    // gets the terminal record directly instead of one extra polling round-trip.
    if (built.meta.responseMode === 'async_task') {
      void completion
      return record
    }
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const fast = await Promise.race([
      completion,
      new Promise<null>((resolve) => {
        graceTimer = setTimeout(() => resolve(null), IMAGE_FAST_PATH_MS)
      }),
    ])
    if (graceTimer) clearTimeout(graceTimer)
    return fast ?? record
  }

  private async completeImage(
    id: string,
    userId: string,
    cost: number,
    chargeReason: string,
    prompt: string,
    options: import('@lnkpi/agent').ImageProviderGenerateOptions,
    resolved: ResolvedGenerationProvider,
  ) {
    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const genOptions =
        options.referenceImages?.length
          ? {
              ...options,
              referenceImages: await inlineUpstreamReferenceImages(options.referenceImages),
            }
          : options
      const { url, urls } = await createImageProvider(providerOpts(resolved)).generate(
        prompt,
        genOptions,
      )
      const imageUrls = urls?.length ? urls : [url]
      const existing = await this.prisma.generationRecord.findFirst({ where: { id } })
      if (!existing || existing.status !== 'generating') return null
      const meta = parseMeta(existing.metadata)
      if (isCancelledMeta(meta) || alreadyRefunded(meta)) return null
      const updated = await this.prisma.generationRecord.updateMany({
        where: { id, status: 'generating' },
        data: {
          url: imageUrls[0],
          status: 'completed',
          metadata: JSON.stringify({ ...meta, urls: imageUrls }),
        },
      })
      if (updated.count === 0) return null
      const referenceUrls = Array.isArray(meta.referenceImages)
        ? (meta.referenceImages as string[]).filter((url) => typeof url === 'string' && url.trim())
        : []
      await this.attachMediaInfoToRecord(id, imageUrls[0] ?? null, referenceUrls)
      return this.prisma.generationRecord.findFirst({ where: { id } })
    } catch (err) {
      console.error('Image generation failed:', err)
      const existing = await this.prisma.generationRecord.findFirst({ where: { id } })
      if (!existing || existing.status !== 'generating') return null
      const meta = parseMeta(existing.metadata)
      if (isCancelledMeta(meta) || alreadyRefunded(meta)) return null
      if (resolved.source === 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
        return this.prisma.generationRecord.update({
          where: { id },
          data: {
            status: 'fallback_pending',
            metadata: JSON.stringify(this.byokPendingMeta(resolved, err, cost, meta)),
          },
        })
      }
      await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
      const failedMeta = applyFailureDiagnosticMeta(
        applyRefundMeta(meta, cost, 'platform_failed'),
        err,
      )
      return this.prisma.generationRecord.update({
        where: { id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(failedMeta),
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
    scope?: CanvasGenerationScope,
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
      const { url } = await createImageProvider(providerOpts(resolved)).generate(combined, {
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
          ...withCanvasScope(scope),
        },
      })
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        const failedMeta = applyFailureDiagnosticMeta(
          applyRefundMeta(
            applyChargeMeta(
              {
                variation: true,
                basePrompt,
                channelId: resolved.channelId,
              },
              cost,
            ),
            cost,
            'platform_failed',
          ),
          err,
        )
        const failed = await this.prisma.generationRecord.create({
          data: {
            userId,
            type: 'image',
            prompt: combined,
            model: model ?? resolved.modelName,
            url: null,
            status: 'failed',
            metadata: JSON.stringify(failedMeta),
            ...withCanvasScope(scope),
          },
        })
        throwGenerationFailure({
          userMessage: String(failedMeta.userMessage ?? '生成失败'),
          errorCode: failedMeta.errorCode as ErrorCode,
          taskId: failed.id,
          refundedPoints: cost,
        })
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
          ...withCanvasScope(scope),
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
    referenceImageUrl?: string,
    scope?: CanvasGenerationScope,
    videoMode?: string,
    generateAudio?: boolean,
    seed?: number,
    negativePrompt?: string,
  ) {
    const videoRefs: GenerationRefPayload[] = (refs ?? []).map((ref) => ({
      ...ref,
      mediaType: ref.mediaType as GenerationRefPayload['mediaType'],
    }))
    const referenceBundle = buildVideoReferenceBundle(videoRefs, referenceImageUrl)
    for (const group of [
      referenceBundle.images,
      referenceBundle.videos,
      referenceBundle.audios,
    ]) {
      for (const ref of group) {
        ref.url = resolvePublicMediaUrls([ref.url])[0] ?? ref.url
      }
    }
    if (
      referenceBundle.audios.length
      && !referenceBundle.images.length
      && !referenceBundle.videos.length
    ) {
      throw new BadRequestException('参考音频须配合参考图或视频')
    }
    const durationCredits = this.videoDurationCredits(duration)
    const chargeReason = '视频生成'
    await this.points.consume(userId, durationCredits, chargeReason)
    const resolved = await this.resolver.resolveForGeneration(userId, model, 'video')
    const { mergedText, skippedMerge } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'video',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
      resolved.modelName,
      referenceBundle.images.map(({ refKey, label }) => ({ refKey, label })),
    )
    const built = (() => {
      try {
        return buildVideoProviderOptions({
          modelKey: resolved.modelName,
          duration,
          aspectRatio,
          resolution,
          crop,
          referenceBundle,
          videoMode: resolveStudioVideoMode(videoMode, referenceBundle),
          gatewayModelHint: resolved.source === 'user' ? resolved.modelName : undefined,
          channelBaseUrl: resolved.credentials.baseUrl,
          generateAudio,
          seed,
          negativePrompt,
        })
      } catch (err) {
        if (err instanceof Seedance1xUnsupportedError) {
          throw new BadRequestException(err.message)
        }
        throw err
      }
    })()
    const storeModel =
      resolved.source === 'user' ? model ?? built.meta.modelKey : built.meta.modelKey
    const effectivePrompt = buildEffectiveVideoPrompt(mergedText, built)
    const providerOptions = buildVideoProviderGenerateOptions(built)
    if (resolved.source === 'user') {
      providerOptions.model = resolved.modelName
    }
    const effectiveBundle = built.effectiveReferenceBundle
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
              referenceImages: effectiveBundle.images.map(({ url }) => url),
              referenceVideos: effectiveBundle.videos.map(({ url }) => url),
              referenceAudios: effectiveBundle.audios.map(({ url }) => url),
              skippedMerge,
              mergedText,
              channelId: resolved.channelId,
              originalModel: model,
              providerSource: resolved.source,
            },
            durationCredits,
          ),
        ),
        ...withCanvasScope(scope),
      },
    })
    this.completeVideo(
      record.id,
      userId,
      durationCredits,
      chargeReason,
      effectivePrompt,
      providerOptions,
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
    scope?: CanvasGenerationScope,
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
      resolved.modelName,
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
      const { url } = await createAudioProvider(providerOpts(resolved)).generate(
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
          ...withCanvasScope(scope),
        },
      })
      return { ...record, url }
    } catch (err) {
      if (isCancelledException(err)) throw err
      if (resolved.source !== 'user') {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
        const failedMeta = applyFailureDiagnosticMeta(
          applyRefundMeta(
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
                channelId: resolved.channelId,
              },
              cost,
            ),
            cost,
            'platform_failed',
          ),
          err,
        )
        const failed = await this.prisma.generationRecord.create({
          data: {
            userId,
            type: 'audio',
            prompt: mergedText,
            model: storeModel,
            url: null,
            status: 'failed',
            metadata: JSON.stringify(failedMeta),
            ...withCanvasScope(scope),
          },
        })
        throwGenerationFailure({
          userMessage: String(failedMeta.userMessage ?? '生成失败'),
          errorCode: failedMeta.errorCode as ErrorCode,
          taskId: failed.id,
          refundedPoints: cost,
        })
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
          ...withCanvasScope(scope),
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
        const resolution = typeof meta.nativeParams === 'object' && meta.nativeParams
          ? (meta.nativeParams as Record<string, unknown>).resolution
          : undefined
        const n = Number(meta.count ?? 1) || 1
        const modelId = this.platformGatewayModelId('image', meta)
        const refs = Array.isArray(meta.referenceImages)
          ? (meta.referenceImages as string[]).filter((url) => typeof url === 'string' && url.trim())
          : []
        const useNativeRefs = refs.length > 0 && meta.refImageMode === 'native'
        const prompt = useNativeRefs ? stripRefImagePromptTags(record.prompt) : record.prompt
        const modelKey =
          typeof meta.modelKey === 'string' && meta.modelKey.trim()
            ? meta.modelKey
            : undefined
        const providerRefs = useNativeRefs ? await inlineUpstreamReferenceImages(refs) : undefined
        const { url, urls } = await createImageProvider(
          resolvePlatformImageProviderOpts(modelKey ?? modelId),
        ).generate(prompt, {
          size,
          resolution: typeof resolution === 'string' ? resolution : undefined,
          n,
          modelId,
          referenceImages: providerRefs,
          refWire:
            meta.refWire === 'agnes_extra_body' ||
            meta.refWire === 'apimart_image_urls' ||
            meta.refWire === 'legacy_prompt_tags' ||
            meta.refWire === 'none'
              ? (meta.refWire as ImageRefWire)
              : undefined,
          responseMode:
            meta.responseMode === 'async_task' || meta.responseMode === 'sync_url'
              ? meta.responseMode
              : undefined,
          quality:
            typeof meta.nativeParams === 'object' &&
            meta.nativeParams &&
            typeof (meta.nativeParams as Record<string, unknown>).quality === 'string'
              ? ((meta.nativeParams as Record<string, unknown>).quality as string)
              : undefined,
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
          const providerRefs = await inlineUpstreamReferenceImages(referenceImages)
          const result = await generateTextForRefs(record.prompt, providerRefs, {
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
        const cancelledMeta = applyFailureDiagnosticMeta(
          applyRefundMeta(chargedMeta, platformCost, 'cancelled'),
          err,
          { errorCode: 'cancelled', userMessage: '已取消' },
        )
        await this.prisma.generationRecord.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            metadata: JSON.stringify(cancelledMeta),
          },
        })
        throw err
      }
      if (err instanceof BadRequestException && err.message === '不支持的生成类型') {
        await this.points.refund(userId, platformCost, '平台回退失败退款')
        rethrowWithRefundedPoints(err, platformCost)
      }
      await this.points.refund(userId, platformCost, '平台回退失败退款')
      const failedMeta = applyFailureDiagnosticMeta(
        applyRefundMeta(chargedMeta, platformCost, 'platform_fallback_failed'),
        err,
      )
      await this.prisma.generationRecord.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(failedMeta),
        },
      })
      throwGenerationFailure({
        userMessage: String(failedMeta.userMessage ?? '生成失败'),
        errorCode: failedMeta.errorCode as ErrorCode,
        taskId: record.id,
        refundedPoints: platformCost,
      })
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
    const byokErrorRaw =
      (typeof meta.byokErrorRaw === 'string' && meta.byokErrorRaw.trim()
        ? meta.byokErrorRaw
        : undefined)
      ?? (typeof meta.errorRaw === 'string' && meta.errorRaw.trim() && meta.errorRaw !== '已取消'
        ? meta.errorRaw
        : undefined)
    const cancelledMeta: Record<string, unknown> = {
      ...meta,
      cancelled: true,
      ...(byokErrorRaw ? { byokErrorRaw, errorRaw: byokErrorRaw } : {}),
      errorCode: 'cancelled',
      userMessage: byokErrorRaw
        ? `已取消平台回退。原 BYOK 错误：${byokErrorRaw.slice(0, 500)}`
        : '已取消',
      failedAt: new Date().toISOString(),
    }
    return this.prisma.generationRecord.update({
      where: { id: record.id },
      data: {
        status: 'failed',
        metadata: JSON.stringify(cancelledMeta),
      },
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
    updatedMeta = applyFailureDiagnosticMeta(updatedMeta, new Error('已取消'), {
      errorCode: 'cancelled',
      userMessage: '已取消',
    })
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
    options: import('@lnkpi/agent').VideoProviderGenerateOptions,
    resolved: ResolvedGenerationProvider,
  ) {
    try {
      if (resolved.source === 'user' && !resolved.credentials.apiKey) {
        throw new Error('missing api key')
      }
      const { url, lastFrameUrl } = await createVideoProvider(providerOpts(resolved)).generate(
        prompt,
        options,
      )
      const existing = await this.prisma.generationRecord.findFirst({ where: { id } })
      if (!existing || existing.status !== 'generating') return
      const meta = parseMeta(existing.metadata)
      if (isCancelledMeta(meta) || alreadyRefunded(meta)) return
      const updated = await this.prisma.generationRecord.updateMany({
        where: { id, status: 'generating' },
        data: {
          url,
          status: 'completed',
          ...(lastFrameUrl
            ? { metadata: JSON.stringify({ ...meta, lastFrameUrl }) }
            : {}),
        },
      })
      if (updated.count === 0) return
      const referenceUrls = [
        ...(Array.isArray(meta.referenceImages) ? (meta.referenceImages as string[]) : []),
        ...(Array.isArray(meta.referenceVideos) ? (meta.referenceVideos as string[]) : []),
        ...(Array.isArray(meta.referenceAudios) ? (meta.referenceAudios as string[]) : []),
      ].filter((u): u is string => typeof u === 'string' && u.trim())
      await this.attachMediaInfoToRecord(id, url, referenceUrls)
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
      const failedMeta = applyFailureDiagnosticMeta(
        applyRefundMeta(meta, cost, 'platform_failed'),
        err,
      )
      await this.prisma.generationRecord.update({
        where: { id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(failedMeta),
        },
      })
    }
  }
}
