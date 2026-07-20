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
  mapMessageToErrorCode,
  redactProviderSnippet,
  resolveImageSize,
  resolveModelKey,
  type ErrorCode,
  type GenerationDiagnostic,
  type GenerationRefPayload,
  type ImageResolutionTier,
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

function throwMaterialFailure(opts: {
  userMessage: string
  errorCode: ErrorCode
  taskId: string
  refundedPoints?: number
}): never {
  throw new BadRequestException({
    message: opts.userMessage,
    errorCode: opts.errorCode,
    taskKind: 'material',
    taskId: opts.taskId,
    ...(opts.refundedPoints != null ? { refundedPoints: opts.refundedPoints } : {}),
  })
}

type CancelFlag = { isCancelled(): boolean }

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
    if (type === 'image') return 10
    if (type === 'video') {
      const duration = Number(meta.duration ?? 5)
      return videoCredits(duration)
    }
    throw new BadRequestException('不支持的素材类型')
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

    const cost = 10
    const chargeReason = '图像生成'
    if (!skipCharge) {
      await this.points.consume(userId, cost, chargeReason)
    }

    const resolved = await this.resolver.resolveForGeneration(userId, model, 'image')
    const material = await this.prisma.material.create({
      data: {
        shotId,
        type: 'image',
        prompt,
        status: 'generating',
        metadata: JSON.stringify(
          applyChargeMeta(
            {
              model,
              aspectRatio,
              resolution,
              channelId: resolved.channelId,
              providerSource: resolved.source,
            },
            skipCharge ? 0 : cost,
          ),
        ),
      },
    })
    this.runImageGeneration(
      material.id,
      userId,
      cost,
      chargeReason,
      prompt,
      model,
      aspectRatio,
      resolution,
      refs,
      mentionedKeys,
      resolved,
      skipCharge,
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

    const cost = videoCredits(duration)
    const chargeReason = '视频生成'
    if (!skipCharge) {
      await this.points.consume(userId, cost, chargeReason)
    }

    const resolved = await this.resolver.resolveForGeneration(userId, model, 'video')
    const material = await this.prisma.material.create({
      data: {
        shotId,
        type: 'video',
        prompt,
        status: 'generating',
        metadata: JSON.stringify(
          applyChargeMeta(
            {
              model,
              duration,
              aspectRatio,
              resolution,
              crop,
              channelId: resolved.channelId,
              providerSource: resolved.source,
            },
            skipCharge ? 0 : cost,
          ),
        ),
      },
    })
    this.runVideoGeneration(
      material.id,
      userId,
      cost,
      chargeReason,
      prompt,
      model,
      duration,
      aspectRatio,
      resolution,
      crop,
      refs,
      mentionedKeys,
      resolved,
      skipCharge,
    ).catch(console.error)
    return material
  }

  async confirmPlatformFallback(userId: string, materialId: string, cancel?: CancelFlag) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, shot: { session: { userId } } },
      include: { shot: { include: { session: true } } },
    })
    if (!material) throw new NotFoundException('素材不存在')
    if (material.status !== 'fallback_pending') {
      throw new BadRequestException('当前状态不可确认平台回退')
    }
    const meta = parseMeta(material.metadata)
    const platformCost = this.platformFallbackCost(material.type, meta)
    await this.points.consume(userId, platformCost, '平台回退生成')
    const chargedMeta = { ...meta, chargedPoints: platformCost, priorByokRefunded: true }

    try {
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
        if (cancel?.isCancelled()) {
          await this.points.refund(userId, platformCost, '平台回退-取消退款')
          throwCancelledException(platformCost)
        }
        return this.prisma.material.update({
          where: { id: material.id },
          data: {
            url,
            thumbnail: url,
            status: 'completed',
            prompt,
            metadata: JSON.stringify({
              ...chargedMeta,
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
        if (cancel?.isCancelled()) {
          await this.points.refund(userId, platformCost, '平台回退-取消退款')
          throwCancelledException(platformCost)
        }
        return this.prisma.material.update({
          where: { id: material.id },
          data: {
            url,
            thumbnail: url,
            status: 'completed',
            prompt,
            metadata: JSON.stringify({
              ...chargedMeta,
              gatewayModelId: platformModel,
              providerFallback: true,
              channelId: 'platform',
            }),
          },
        })
      }

      throw new BadRequestException('不支持的素材类型')
    } catch (err) {
      if (isCancelledException(err)) {
        const cancelledMeta = applyFailureDiagnosticMeta(
          applyRefundMeta(chargedMeta, platformCost, 'cancelled'),
          err,
          { errorCode: 'cancelled', userMessage: '已取消' },
        )
        await this.prisma.material.update({
          where: { id: material.id },
          data: {
            status: 'failed',
            metadata: JSON.stringify(cancelledMeta),
          },
        })
        throw err
      }
      if (err instanceof BadRequestException && err.message === '不支持的素材类型') {
        await this.points.refund(userId, platformCost, '平台回退失败退款')
        rethrowWithRefundedPoints(err, platformCost)
      }
      await this.points.refund(userId, platformCost, '平台回退失败退款')
      const failedMeta = applyFailureDiagnosticMeta(
        applyRefundMeta(chargedMeta, platformCost, 'platform_fallback_failed'),
        err,
      )
      await this.prisma.material.update({
        where: { id: material.id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(failedMeta),
        },
      })
      throwMaterialFailure({
        userMessage: String(failedMeta.userMessage ?? '生成失败'),
        errorCode: failedMeta.errorCode as ErrorCode,
        taskId: material.id,
        refundedPoints: platformCost,
      })
    }
  }

  async cancelPlatformFallback(userId: string, materialId: string) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, shot: { session: { userId } } },
    })
    if (!material) throw new NotFoundException('素材不存在')
    if (material.status !== 'fallback_pending') {
      throw new BadRequestException('当前状态不可取消平台回退')
    }
    const meta = parseMeta(material.metadata)
    if (!alreadyRefunded(meta)) {
      const cost =
        typeof meta.chargedPoints === 'number'
          ? meta.chargedPoints
          : this.platformFallbackCost(material.type, meta)
      await this.points.refund(userId, cost, '平台回退取消退款')
    }
    const cancelledMeta = applyFailureDiagnosticMeta(
      { ...meta, cancelled: true },
      new Error('已取消'),
      { errorCode: 'cancelled', userMessage: '已取消' },
    )
    return this.prisma.material.update({
      where: { id: material.id },
      data: {
        status: 'failed',
        metadata: JSON.stringify(cancelledMeta),
      },
    })
  }

  async cancelGeneration(userId: string, materialId: string) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, shot: { session: { userId } } },
    })
    if (!material) throw new NotFoundException('素材不存在')
    if (material.status !== 'generating') {
      throw new BadRequestException('当前状态不可取消')
    }
    const meta = parseMeta(material.metadata)
    const cost = typeof meta.chargedPoints === 'number' ? meta.chargedPoints : 0
    const chargeReason = material.type === 'video' ? '视频生成' : '图像生成'
    let updatedMeta: Record<string, unknown> = { ...meta, cancelled: true }
    if (cost > 0 && !alreadyRefunded(meta)) {
      await this.points.refund(userId, cost, `${chargeReason}-取消退款`)
      updatedMeta = applyRefundMeta(updatedMeta, cost, 'cancelled')
    }
    updatedMeta = applyFailureDiagnosticMeta(updatedMeta, new Error('已取消'), {
      errorCode: 'cancelled',
      userMessage: '已取消',
    })
    return this.prisma.material.update({
      where: { id: material.id },
      data: {
        status: 'failed',
        metadata: JSON.stringify(updatedMeta),
      },
    })
  }

  async getMaterialDiagnostic(userId: string, id: string): Promise<GenerationDiagnostic> {
    const material = await this.prisma.material.findFirst({
      where: { id, shot: { session: { userId } } },
      include: { shot: { include: { session: true } } },
    })
    if (!material) throw new NotFoundException('素材不存在')
    if (material.status !== 'failed' && material.status !== 'error') {
      throw new NotFoundException('诊断不可用')
    }
    const meta = parseMeta(material.metadata)
    const errRaw = meta.errorRaw != null ? String(meta.errorRaw) : ''
    const code =
      (typeof meta.errorCode === 'string' ? (meta.errorCode as ErrorCode) : undefined) ??
      mapMessageToErrorCode(errRaw)
    const defaultMessage = '生成失败'
    const userMessage =
      (typeof meta.userMessage === 'string' && meta.userMessage.trim()
        ? meta.userMessage
        : undefined) ?? defaultMessage
    const occurredAt =
      typeof meta.failedAt === 'string' && meta.failedAt
        ? meta.failedAt
        : material.createdAt.toISOString()
    const sessionId = material.shot?.session?.id

    return {
      userMessage,
      code,
      taskKind: 'material',
      taskId: material.id,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      model:
        (typeof meta.model === 'string' ? meta.model : undefined) ??
        (typeof meta.modelKey === 'string' ? meta.modelKey : undefined) ??
        null,
      channelId: typeof meta.channelId === 'string' ? meta.channelId : null,
      apiFormat: typeof meta.apiFormat === 'string' ? meta.apiFormat : null,
      httpStatus: typeof meta.httpStatus === 'number' ? meta.httpStatus : null,
      occurredAt,
      providerSnippet: errRaw ? redactProviderSnippet(errRaw) : null,
      hint: hintForCode(code),
    }
  }

  private async resolveMergedPrompt(
    localPrompt: string,
    refs: GenerationRefPayload[] | undefined,
    downstreamType: 'image' | 'video',
    mentionedKeys?: string[],
    credentials?: { apiKey?: string; baseUrl?: string },
    model?: string,
  ) {
    const { mergedText, skippedMerge } = await mergeRefsToPrompt({
      sources: extractTextSources(refs),
      localPrompt: localPrompt.trim() || undefined,
      downstreamType,
      mentionedKeys: mentionedKeys?.length ? mentionedKeys : undefined,
      apiKey: credentials?.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: credentials?.baseUrl ?? process.env.OPENAI_BASE_URL,
      model,
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
    cost: number,
    chargeReason: string,
    prompt: string,
    model: string | undefined,
    aspectRatio: string | undefined,
    resolution: string | undefined,
    refs: GenerationRefPayload[] | undefined,
    mentionedKeys: string[] | undefined,
    resolved: ResolvedGenerationProvider,
    skipCharge?: boolean,
  ) {
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'image',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
      resolved.modelName,
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
      const existing = await this.prisma.material.findFirst({ where: { id: materialId } })
      if (!existing || existing.status !== 'generating') return
      const prev = parseMeta(existing.metadata)
      if (isCancelledMeta(prev) || alreadyRefunded(prev)) return
      const updated = await this.prisma.material.updateMany({
        where: { id: materialId, status: 'generating' },
        data: {
          url,
          thumbnail: url,
          status: 'completed',
          prompt: effectivePrompt,
          metadata: JSON.stringify(
            applyChargeMeta(
              {
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
              },
              skipCharge ? 0 : cost,
            ),
          ),
        },
      })
      if (updated.count === 0) return
    } catch (err) {
      console.error('Image generation failed:', err)
      if (resolved.source === 'user') {
        if (!skipCharge) {
          await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
        }
        const existing = await this.prisma.material.findFirst({ where: { id: materialId } })
        if (!existing || existing.status !== 'generating') return
        const prev = parseMeta(existing.metadata)
        if (isCancelledMeta(prev) || alreadyRefunded(prev)) return
        await this.prisma.material.update({
          where: { id: materialId },
          data: {
            status: 'fallback_pending',
            prompt: effectivePrompt,
            metadata: JSON.stringify(
              this.byokPendingMeta(resolved, err, skipCharge ? 0 : cost, {
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
                userId,
              }),
            ),
          },
        })
        return
      }
      if (!skipCharge) {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
      }
      const existingFailed = await this.prisma.material.findFirst({ where: { id: materialId } })
      if (!existingFailed || existingFailed.status !== 'generating') return
      const prevFailed = parseMeta(existingFailed.metadata)
      if (isCancelledMeta(prevFailed) || alreadyRefunded(prevFailed)) return
      const failedMeta = applyFailureDiagnosticMeta(
        applyRefundMeta(prevFailed, skipCharge ? 0 : cost, 'platform_failed'),
        err,
      )
      await this.prisma.material.update({
        where: { id: materialId },
        data: {
          status: 'failed',
          metadata: JSON.stringify(failedMeta),
        },
      })
    }
  }

  private async runVideoGeneration(
    materialId: string,
    userId: string,
    cost: number,
    chargeReason: string,
    prompt: string,
    model: string | undefined,
    duration: number,
    aspectRatio: string,
    resolution: string,
    crop: string,
    refs: GenerationRefPayload[] | undefined,
    mentionedKeys: string[] | undefined,
    resolved: ResolvedGenerationProvider,
    skipCharge?: boolean,
  ) {
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'video',
      mentionedKeys,
      resolved.source === 'user' ? resolved.credentials : undefined,
      resolved.modelName,
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
      const existing = await this.prisma.material.findFirst({ where: { id: materialId } })
      if (!existing || existing.status !== 'generating') return
      const prev = parseMeta(existing.metadata)
      if (isCancelledMeta(prev) || alreadyRefunded(prev)) return
      const updated = await this.prisma.material.updateMany({
        where: { id: materialId, status: 'generating' },
        data: {
          url,
          thumbnail: url,
          status: 'completed',
          prompt: effectivePrompt,
          metadata: JSON.stringify(
            applyChargeMeta(
              {
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
              },
              skipCharge ? 0 : cost,
            ),
          ),
        },
      })
      if (updated.count === 0) return
    } catch (err) {
      console.error('Video generation failed:', err)
      if (resolved.source === 'user') {
        if (!skipCharge) {
          await this.points.refund(userId, cost, `${chargeReason}-BYOK失败退款`)
        }
        const existing = await this.prisma.material.findFirst({ where: { id: materialId } })
        if (!existing || existing.status !== 'generating') return
        const prev = parseMeta(existing.metadata)
        if (isCancelledMeta(prev) || alreadyRefunded(prev)) return
        await this.prisma.material.update({
          where: { id: materialId },
          data: {
            status: 'fallback_pending',
            prompt: effectivePrompt,
            metadata: JSON.stringify(
              this.byokPendingMeta(resolved, err, skipCharge ? 0 : cost, {
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
                userId,
              }),
            ),
          },
        })
        return
      }
      if (!skipCharge) {
        await this.points.refund(userId, cost, `${chargeReason}-失败退款`)
      }
      const existingFailed = await this.prisma.material.findFirst({ where: { id: materialId } })
      if (!existingFailed || existingFailed.status !== 'generating') return
      const prevFailed = parseMeta(existingFailed.metadata)
      if (isCancelledMeta(prevFailed) || alreadyRefunded(prevFailed)) return
      const failedMeta = applyFailureDiagnosticMeta(
        applyRefundMeta(prevFailed, skipCharge ? 0 : cost, 'platform_failed'),
        err,
      )
      await this.prisma.material.update({
        where: { id: materialId },
        data: {
          status: 'failed',
          metadata: JSON.stringify(failedMeta),
        },
      })
    }
  }
}
