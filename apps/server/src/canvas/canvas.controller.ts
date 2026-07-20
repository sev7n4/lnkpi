import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type {
  RefMediaType,
  SceneComposerBatchGenerateRequest,
  SceneComposerSaveRequest,
  VideoCompositionExportRequest,
} from '@lnkpi/shared'
import { AuthGuard } from '../auth/auth.guard'
import { createCancelFlag } from '../points/charge-session'
import { CanvasService } from './canvas.service'
import { MaterialService } from './material.service'
import { SceneComposerService } from './scene-composer.service'
import { ShotService } from './shot.service'
import { VideoCompositionService } from './video-composition.service'

class CreateCanvasDto {
  @IsOptional()
  @IsString()
  title?: string
}

class UpdateCanvasDto {
  @IsString()
  id!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  canvasData?: unknown
}

class CreateShotDto {
  @IsString()
  sessionId!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  prompt?: string
}

class CanvasRefDto {
  @IsString()
  refKey!: string

  @IsIn(['text', 'image', 'video', 'audio'])
  mediaType!: RefMediaType

  @IsOptional()
  @IsString()
  label?: string

  @IsOptional()
  @IsString()
  text?: string

  @IsOptional()
  @IsString()
  url?: string
}

class GenerateImageDto {
  @IsString()
  shotId!: string

  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  @IsString()
  resolution?: string

  @IsOptional()
  @IsNumber()
  count?: number

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CanvasRefDto)
  refs?: CanvasRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class GenerateVideoDto {
  @IsString()
  shotId!: string

  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string

  @IsOptional()
  @IsNumber()
  @IsIn([5, 10, 15])
  duration?: 5 | 10 | 15

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  @IsString()
  resolution?: string

  @IsOptional()
  @IsString()
  crop?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CanvasRefDto)
  refs?: CanvasRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class EditShotDto {
  @IsString()
  shotId!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  prompt?: string

  @IsOptional()
  @IsString()
  status?: string
}

class ShotOrderDto {
  @IsString()
  sessionId!: string

  @IsArray()
  @IsString({ each: true })
  shotIds!: string[]
}

class SceneComposerShotDto {
  @IsString()
  id!: string

  @IsString()
  title!: string

  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  previewUrl?: string

  @IsIn(['image', 'video', 'none'])
  mediaType!: 'image' | 'video' | 'none'

  @IsOptional()
  @IsString()
  shotNodeId?: string

  @IsOptional()
  @IsString()
  imageNodeId?: string

  @IsOptional()
  @IsString()
  videoNodeId?: string
}

class SceneComposerSceneDto {
  @IsString()
  id!: string

  @IsString()
  title!: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  previewUrl?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SceneComposerShotDto)
  shots!: SceneComposerShotDto[]
}

class SaveSceneComposerDto implements SceneComposerSaveRequest {
  @IsString()
  sessionId!: string

  @IsString()
  composerNodeId!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  prompt?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SceneComposerSceneDto)
  scenes!: SceneComposerSceneDto[]
}

class SceneComposerBatchItemDto {
  @IsString()
  shotNodeId!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsString()
  prompt!: string

  @IsIn(['image', 'video'])
  mediaType!: 'image' | 'video'

  @IsOptional()
  @IsString()
  model?: string

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  @IsString()
  resolution?: string

  @IsOptional()
  @IsIn([5, 10, 15])
  duration?: 5 | 10 | 15

  @IsOptional()
  @IsString()
  crop?: string

  @IsOptional()
  @IsNumber()
  count?: number

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CanvasRefDto)
  refs?: CanvasRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class BatchGenerateSceneComposerDto implements SceneComposerBatchGenerateRequest {
  @IsString()
  sessionId!: string

  @IsString()
  composerNodeId!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SceneComposerBatchItemDto)
  items!: SceneComposerBatchItemDto[]
}

class VideoCompositionExportTrackDto {
  @IsString()
  nodeId!: string

  @IsIn(['video', 'audio'])
  type!: 'video' | 'audio'

  @IsString()
  title!: string

  @IsString()
  url!: string

  @IsNumber()
  durationSec!: number

  @IsOptional()
  startSec?: number
}

class ExportVideoCompositionDto implements VideoCompositionExportRequest {
  @IsString()
  sessionId!: string

  @IsString()
  compositionNodeId!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VideoCompositionExportTrackDto)
  tracks!: VideoCompositionExportTrackDto[]
}

@Controller('agent/canvas')
export class CanvasController {
  constructor(
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
    @Inject(SceneComposerService) private readonly sceneComposerService: SceneComposerService,
    @Inject(VideoCompositionService) private readonly videoCompositionService: VideoCompositionService,
  ) {}

  @Get('list')
  @UseGuards(AuthGuard)
  async list(@Req() req: { user: { sub: string } }) {
    const data = await this.canvasService.list(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post('create')
  @UseGuards(AuthGuard)
  async create(@Req() req: { user: { sub: string } }, @Body() dto: CreateCanvasDto) {
    const data = await this.canvasService.create(req.user.sub, dto.title)
    return { code: 0, message: 'ok', data }
  }

  @Put('update')
  @UseGuards(AuthGuard)
  async update(@Req() req: { user: { sub: string } }, @Body() dto: UpdateCanvasDto) {
    const canvasData = dto.canvasData !== undefined
      ? JSON.stringify(dto.canvasData)
      : undefined
    const data = await this.canvasService.update(dto.id, req.user.sub, {
      title: dto.title,
      canvasData,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('shot/create')
  @UseGuards(AuthGuard)
  async createShot(@Body() dto: CreateShotDto) {
    const data = await this.shotService.create(dto.sessionId, {
      title: dto.title,
      prompt: dto.prompt,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('shot/edit')
  @UseGuards(AuthGuard)
  async editShot(@Body() dto: EditShotDto) {
    const data = await this.shotService.update(dto.shotId, {
      title: dto.title,
      prompt: dto.prompt,
      status: dto.status,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('shot-order')
  @UseGuards(AuthGuard)
  async reorderShots(@Body() dto: ShotOrderDto) {
    const data = await this.shotService.reorder(dto.sessionId, dto.shotIds)
    return { code: 0, message: 'ok', data }
  }

  @Post('material/generate-image')
  @UseGuards(AuthGuard)
  async generateImage(@Req() req: { user: { sub: string } }, @Body() dto: GenerateImageDto) {
    const data = await this.materialService.generateImage({
      userId: req.user.sub,
      shotId: dto.shotId,
      prompt: dto.prompt,
      model: dto.model,
      aspectRatio: dto.aspectRatio,
      resolution: dto.resolution,
      count: dto.count,
      refs: dto.refs,
      mentionedKeys: dto.mentionedKeys,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('material/generate-video')
  @UseGuards(AuthGuard)
  async generateVideo(@Req() req: { user: { sub: string } }, @Body() dto: GenerateVideoDto) {
    const data = await this.materialService.generateVideo({
      userId: req.user.sub,
      shotId: dto.shotId,
      prompt: dto.prompt,
      model: dto.model,
      duration: dto.duration,
      aspectRatio: dto.aspectRatio,
      resolution: dto.resolution,
      crop: dto.crop,
      refs: dto.refs,
      mentionedKeys: dto.mentionedKeys,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('material/:id/confirm-platform-fallback')
  @UseGuards(AuthGuard)
  async confirmMaterialPlatformFallback(
    @Req() req: { user: { sub: string }; on(event: string, cb: () => void): void; aborted?: boolean },
    @Param('id') id: string,
  ) {
    const cancel = createCancelFlag(req)
    const data = await this.materialService.confirmPlatformFallback(req.user.sub, id, cancel)
    return { code: 0, message: 'ok', data }
  }

  @Post('material/:id/cancel-platform-fallback')
  @UseGuards(AuthGuard)
  async cancelMaterialPlatformFallback(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
  ) {
    const data = await this.materialService.cancelPlatformFallback(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Post('material/:id/cancel')
  @UseGuards(AuthGuard)
  async cancelMaterialGeneration(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
  ) {
    const data = await this.materialService.cancelGeneration(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Get('material/:id/diagnostic')
  @UseGuards(AuthGuard)
  async materialDiagnostic(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    const data = await this.materialService.getMaterialDiagnostic(req.user.sub, id)
    return { data }
  }

  @Get('shot/status/batch')
  @UseGuards(AuthGuard)
  async statusBatch(@Query('ids') ids: string) {
    const idList = ids.split(',').filter(Boolean)
    const data = await this.shotService.statusBatch(idList)
    return { code: 0, message: 'ok', data }
  }

  @Post('scene-composer/save')
  @UseGuards(AuthGuard)
  async saveSceneComposer(
    @Req() req: { user: { sub: string } },
    @Body() dto: SaveSceneComposerDto,
  ) {
    const data = await this.sceneComposerService.save(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('scene-composer/batch-generate')
  @UseGuards(AuthGuard)
  async batchGenerateSceneComposer(
    @Req() req: { user: { sub: string } },
    @Body() dto: BatchGenerateSceneComposerDto,
  ) {
    const data = await this.sceneComposerService.batchGenerate(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('video-composition/export')
  @UseGuards(AuthGuard)
  async exportVideoComposition(
    @Req() req: { user: { sub: string } },
    @Body() dto: ExportVideoCompositionDto,
  ) {
    const data = await this.videoCompositionService.exportComposition(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }
}
