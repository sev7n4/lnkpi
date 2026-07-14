import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  SceneComposerBatchGenerateRequest,
  SceneComposerBatchItem,
  SceneComposerSaveRequest,
  SceneComposerScene,
} from '@lnkpi/shared'
import { MaterialService } from './material.service'
import { ShotService } from './shot.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SceneComposerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
  ) {}

  private async assertSession(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('画布不存在')
    return session
  }

  async save(dto: SceneComposerSaveRequest) {
    await this.assertSession(dto.sessionId)
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
      const existing = await this.prisma.shot.findUnique({ where: { id: shot.shotNodeId } })
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

  async batchGenerate(dto: SceneComposerBatchGenerateRequest) {
    await this.assertSession(dto.sessionId)
    const results: Array<{ shotNodeId: string; materialId?: string; mediaType: string }> = []

    for (const item of dto.items) {
      const result = await this.generateItem(dto.sessionId, item)
      results.push(result)
    }

    return {
      composerNodeId: dto.composerNodeId,
      items: results,
    }
  }

  private async generateItem(sessionId: string, item: SceneComposerBatchItem) {
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
      const material = await this.materialService.generateVideo(item.shotNodeId, item.prompt)
      return { shotNodeId: item.shotNodeId, materialId: material.id, mediaType: 'video' }
    }

    const material = await this.materialService.generateImage(item.shotNodeId, item.prompt)
    return { shotNodeId: item.shotNodeId, materialId: material.id, mediaType: 'image' }
  }
}
