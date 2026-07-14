import { Body, Controller, Get, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type {
  SceneComposerBatchGenerateRequest,
  SceneComposerSaveRequest,
} from '@lnkpi/shared'
import { AuthGuard } from '../auth/auth.guard'
import { CanvasService } from './canvas.service'
import { MaterialService } from './material.service'
import { SceneComposerService } from './scene-composer.service'
import { ShotService } from './shot.service'

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

class GenerateImageDto {
  @IsString()
  shotId!: string

  @IsString()
  prompt!: string
}

class GenerateVideoDto {
  @IsString()
  shotId!: string

  @IsString()
  prompt!: string

  @IsOptional()
  duration?: number

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  @IsString()
  crop?: string
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

@Controller('agent/canvas')
export class CanvasController {
  constructor(
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
    @Inject(SceneComposerService) private readonly sceneComposerService: SceneComposerService,
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
  async generateImage(@Body() dto: GenerateImageDto) {
    const data = await this.materialService.generateImage(dto.shotId, dto.prompt)
    return { code: 0, message: 'ok', data }
  }

  @Post('material/generate-video')
  @UseGuards(AuthGuard)
  async generateVideo(@Body() dto: GenerateVideoDto) {
    const data = await this.materialService.generateVideo(
      dto.shotId,
      dto.prompt,
      dto.duration,
      dto.aspectRatio,
      dto.crop,
    )
    return { code: 0, message: 'ok', data }
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
  async saveSceneComposer(@Body() dto: SaveSceneComposerDto) {
    const data = await this.sceneComposerService.save(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('scene-composer/batch-generate')
  @UseGuards(AuthGuard)
  async batchGenerateSceneComposer(@Body() dto: BatchGenerateSceneComposerDto) {
    const data = await this.sceneComposerService.batchGenerate(dto)
    return { code: 0, message: 'ok', data }
  }
}
