import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common'
import { createUpscaleProviders, type UpscaleProvider } from '@lnkpi/agent'
import { applyChargeMeta, applyRefundMeta } from '../points/charge-session'
import { PointsService } from '../points/points.service'
import { consumeMeta, refundMeta } from '../points/point-tx.types'
import { PrismaService } from '../prisma/prisma.service'
import { SessionsService } from '../sessions/sessions.service'
import { inlineUpstreamReferenceImages } from '../media/upstream-ref-inline'

/** Same tier as single 图像生成 consume in StudioService. */
export const UPSCALE_POINT_COST = 10

export const UPSCALE_CHARGE_REASON = '图像放大'

export type UpscaleServiceInput = {
  userId: string
  sessionId: string
  nodeId?: string
  imageUrl?: string
  scale?: 2 | 4
  providerId?: string
}

export type UpscaleServiceResult = {
  url: string
  scale: 2 | 4
  providerId: string
  recordId: string
}

type CanvasNodeLike = {
  id: string
  data?: Record<string, unknown> | null
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
export class UpscaleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async upscale(input: UpscaleServiceInput): Promise<UpscaleServiceResult> {
    const scale: 2 | 4 = input.scale ?? 2
    if (scale !== 2 && scale !== 4) {
      throw new BadRequestException('scale 仅支持 2 或 4')
    }

    const session = await this.sessions.findOne(input.sessionId, input.userId)
    const imageUrl = this.resolveImageUrl(input, session.canvasData)

    const providers = createUpscaleProviders({
      falApiKey: process.env.FAL_KEY,
    })
    if (!providers.length) {
      throw new NotImplementedException('图像放大暂不可用')
    }

    const provider = this.pickProvider(providers, input.providerId)
    if (!provider.supportsScale(scale)) {
      throw new BadRequestException(`当前通道不支持 ${scale}× 放大`)
    }

    await this.points.consume(
      input.userId,
      UPSCALE_POINT_COST,
      UPSCALE_CHARGE_REASON,
      consumeMeta('image', { model: provider.id, generationId: null }),
    )

    const chargeMeta = applyChargeMeta(
      {
        chargeReason: UPSCALE_CHARGE_REASON,
        scale,
        providerId: provider.id,
        sourceImageUrl: imageUrl,
      },
      UPSCALE_POINT_COST,
    )

    const record = await this.prisma.generationRecord.create({
      data: {
        userId: input.userId,
        type: 'image_upscale',
        prompt: `upscale ${scale}x`,
        model: provider.id,
        status: 'generating',
        metadata: JSON.stringify(chargeMeta),
        sessionId: input.sessionId,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      },
    })

    try {
      const [inlined] = await inlineUpstreamReferenceImages([imageUrl])
      const result = await provider.upscale({
        imageUrl: inlined ?? imageUrl,
        scale,
      })

      const existing = await this.prisma.generationRecord.findFirst({ where: { id: record.id } })
      const meta = parseMeta(existing?.metadata)
      await this.prisma.generationRecord.update({
        where: { id: record.id },
        data: {
          url: result.url,
          status: 'completed',
          metadata: JSON.stringify({
            ...meta,
            scale,
            providerId: result.providerId,
            modelId: result.modelId,
            chargeReason: UPSCALE_CHARGE_REASON,
            sourceImageUrl: imageUrl,
          }),
        },
      })

      return {
        url: result.url,
        scale,
        providerId: result.providerId,
        recordId: record.id,
      }
    } catch (err) {
      await this.points.refund(
        input.userId,
        UPSCALE_POINT_COST,
        `${UPSCALE_CHARGE_REASON}-失败退款`,
        refundMeta('image', 'failed_refund', {
          model: provider.id,
          generationId: record.id,
        }),
      )
      const existing = await this.prisma.generationRecord.findFirst({ where: { id: record.id } })
      const meta = parseMeta(existing?.metadata)
      await this.prisma.generationRecord.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          metadata: JSON.stringify(
            applyRefundMeta(
              {
                ...meta,
                errorRaw: err instanceof Error ? err.message.slice(0, 8000) : String(err),
              },
              UPSCALE_POINT_COST,
              'platform_failed',
            ),
          ),
        },
      })
      const message = err instanceof Error ? err.message : '图像放大失败'
      throw new BadRequestException({
        message,
        refundedPoints: UPSCALE_POINT_COST,
        taskId: record.id,
      })
    }
  }

  private pickProvider(providers: UpscaleProvider[], providerId?: string): UpscaleProvider {
    if (!providerId?.trim()) return providers[0]!
    const found = providers.find((p) => p.id === providerId.trim())
    if (!found) {
      throw new BadRequestException(`指定 provider 不可用: ${providerId}`)
    }
    return found
  }

  /**
   * Prefer server-resolved node URL when nodeId is present (same field as
   * AgentCanvasToolsService.getGenerationStatus / getNode data.url).
   */
  private resolveImageUrl(
    input: UpscaleServiceInput,
    canvasData: unknown,
  ): string {
    if (input.nodeId) {
      const nodes = (canvasData as { nodes?: CanvasNodeLike[] } | undefined)?.nodes
      const node = Array.isArray(nodes)
        ? nodes.find((n) => n.id === input.nodeId)
        : undefined
      if (!node) throw new NotFoundException('节点不存在')
      const url =
        typeof node.data?.url === 'string' && node.data.url.trim()
          ? node.data.url.trim()
          : ''
      if (!url) {
        throw new BadRequestException('节点没有可放大的图片')
      }
      return url
    }

    const imageUrl = input.imageUrl?.trim()
    if (!imageUrl) {
      throw new BadRequestException('需要 imageUrl 或可解析的 nodeId')
    }
    return imageUrl
  }
}
