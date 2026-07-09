import { Body, Controller, Get, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { CanvasService } from './canvas.service'
import { MaterialService } from './material.service'
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
}

@Controller('agent/canvas')
export class CanvasController {
  constructor(
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
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

  @Post('material/generate-image')
  @UseGuards(AuthGuard)
  async generateImage(@Body() dto: GenerateImageDto) {
    const data = await this.materialService.generateImage(dto.shotId, dto.prompt)
    return { code: 0, message: 'ok', data }
  }

  @Post('material/generate-video')
  @UseGuards(AuthGuard)
  async generateVideo(@Body() dto: GenerateVideoDto) {
    const data = await this.materialService.generateVideo(dto.shotId, dto.prompt, dto.duration)
    return { code: 0, message: 'ok', data }
  }

  @Get('shot/status/batch')
  @UseGuards(AuthGuard)
  async statusBatch(@Query('ids') ids: string) {
    const idList = ids.split(',').filter(Boolean)
    const data = await this.shotService.statusBatch(idList)
    return { code: 0, message: 'ok', data }
  }
}
