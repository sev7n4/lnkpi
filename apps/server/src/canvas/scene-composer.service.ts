import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  SceneComposerBatchGenerateRequest,
  SceneComposerBatchItem,
  SceneComposerSaveRequest,
  SceneComposerScene,
} from '@lnkpi/shared'
import { MaterialService } from './material.service'
import { ShotService } from './shot.service'
import { PointsService } from '../points/points.service'
import { videoCredits } from '../points/video-credits'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SceneComposerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
    @Inject(PointsService) private readonly points: PointsService,
  ) {}

  private async assertOwnedSession(sessionId: string, userId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    })
    if (!session) throw new NotFoundException('画布不存在')
    return session
  }

  private itemCredits(item: SceneComposerBatchItem): number {
    if (item.mediaType === 'video') {
      return videoCredits(item.duration ?? 5)
    }
    return 10
  }

  private async assertShotInSession(shotId: string, sessionId: string) {
    const shot = await this.prisma.shot.findUnique({ where: { id: shotId } })
    if (shot && shot.sessionId !== sessionId) {
      throw new NotFoundException('画布不存在')
    }
    return shot
  }

  private assertNoBlobRefsInBatch(items: SceneComposerBatchItem[]) {
    for (const item of items) {
      for (const ref of item.refs ?? []) {
        if (ref.url?.trim().startsWith('blob:')) {
          throw new BadRequestException('参考图尚未上传')
        }
      }
    }
  }

  async save(userId: string, dto: SceneComposerSaveRequest) {
    await this.assertOwnedSession(dto.sessionId, userId)
    const syncedShots: string[] = []

    for (const scene of dto.scenes) {
      await this.syncSceneShots(dto.sessionId, scene, syncedShots)
    }

    if (syncedShots.length) {
      await this.shotService.reorder(dto.sessionId, syncedShots)
    }

    return {
      composerNodeId: dto.composerNodeId,
      sceneCount: dto.scenes.length,
      shotCount: dto.scenes.reduce((sum, scene) => sum + scene.shots.length, 0),
      syncedShotIds: syncedShots,
    }
  }

  private async syncSceneShots(
    sessionId: string,
    scene: SceneComposerScene,
    syncedShots: string[],
  ) {
    for (const [index, shot] of scene.shots.entries()) {
      if (!shot.shotNodeId) continue
      syncedShots.push(shot.shotNodeId)
      const existing = await this.assertShotInSession(shot.shotNodeId, sessionId)
      if (existing) {
        await this.shotService.update(shot.shotNodeId, {
          title: shot.title || scene.title || `镜头 ${index + 1}`,
          prompt: shot.prompt,
          status: 'draft',
        })
      } else {
        await this.shotService.create(sessionId, {
          id: shot.shotNodeId,
          title: shot.title || scene.title || `镜头 ${index + 1}`,
          prompt: shot.prompt,
          order: syncedShots.length - 1,
          status: 'draft',
        })
      }
    }
  }

  async batchGenerate(userId: string, dto: SceneComposerBatchGenerateRequest) {
    await this.assertOwnedSession(dto.sessionId, userId)

    for (const item of dto.items) {
      await this.assertShotInSession(item.shotNodeId, dto.sessionId)
    }

    this.assertNoBlobRefsInBatch(dto.items)

    const total = dto.items.reduce((sum, item) => sum + this.itemCredits(item), 0)
    if (total > 0) {
      await this.points.consume(userId, total, `导演台批量生成 ×${dto.items.length}`)
    }

    const results: Array<{ shotNodeId: string; materialId?: string; mediaType: string }> = []

    for (const item of dto.items) {
      const result = await this.generateItem(dto.sessionId, userId, item)
      results.push(result)
    }

    return {
      composerNodeId: dto.composerNodeId,
      items: results,
    }
  }

  private async generateItem(
    sessionId: string,
    userId: string,
    item: SceneComposerBatchItem,
  ) {
    const existing = await this.prisma.shot.findUnique({ where: { id: item.shotNodeId } })
    if (existing) {
      await this.shotService.update(item.shotNodeId, {
        title: item.title,
        prompt: item.prompt,
        status: 'generating',
      })
    } else {
      await this.shotService.create(sessionId, {
        id: item.shotNodeId,
        title: item.title ?? '分镜',
        prompt: item.prompt,
        status: 'generating',
      })
    }

    if (item.mediaType === 'video') {
      const material = await this.materialService.generateVideo({
        userId,
        shotId: item.shotNodeId,
        prompt: item.prompt,
        model: item.model,
        duration: item.duration,
        aspectRatio: item.aspectRatio,
        resolution: item.resolution,
        crop: item.crop,
        refs: item.refs,
        mentionedKeys: item.mentionedKeys,
        skipCharge: true,
      })
      return { shotNodeId: item.shotNodeId, materialId: material.id, mediaType: 'video' }
    }

    const material = await this.materialService.generateImage({
      userId,
      shotId: item.shotNodeId,
      prompt: item.prompt,
      model: item.model,
      aspectRatio: item.aspectRatio,
      resolution: item.resolution,
      count: item.count,
      refs: item.refs,
      mentionedKeys: item.mentionedKeys,
      skipCharge: true,
    })
    return { shotNodeId: item.shotNodeId, materialId: material.id, mediaType: 'image' }
  }
}
