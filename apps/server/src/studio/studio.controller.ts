import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { createCancelFlag } from '../points/charge-session'
import { StudioService } from './studio.service'

class StudioRefDto {
  @IsString()
  refKey!: string

  @IsString()
  mediaType!: string

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
  @Type(() => StudioRefDto)
  refs?: StudioRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class GenerateVideoDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string

  @IsOptional()
  @IsNumber()
  duration?: number

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
  @Type(() => StudioRefDto)
  refs?: StudioRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class GenerateAudioDto {
  @IsString()
  text!: string

  @IsOptional()
  @IsString()
  model?: string

  @IsOptional()
  @IsString()
  voice?: string

  @IsOptional()
  @IsString()
  emotion?: string

  @IsOptional()
  @IsString()
  language?: string

  @IsOptional()
  @IsNumber()
  speed?: number

  @IsOptional()
  @IsNumber()
  volume?: number

  @IsOptional()
  @IsNumber()
  pitch?: number

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudioRefDto)
  refs?: StudioRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class GenerateTextDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudioRefDto)
  refs?: StudioRefDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class GeneratePromptDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string
}

class ImageVariationDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  basePrompt?: string

  @IsOptional()
  @IsString()
  model?: string
}

@Controller('studio')
export class StudioController {
  constructor(@Inject(StudioService) private readonly studioService: StudioService) {}

  @Get('generations')
  @UseGuards(AuthGuard)
  async list(@Req() req: { user: { sub: string } }, @Query('type') type?: string) {
    const data = await this.studioService.listGenerations(req.user.sub, type)
    return { code: 0, message: 'ok', data }
  }

  @Post('text/generate')
  @UseGuards(AuthGuard)
  async generateText(
    @Req() req: { user: { sub: string }; on(event: string, cb: () => void): void; aborted?: boolean },
    @Body() dto: GenerateTextDto,
  ) {
    const cancel = createCancelFlag(req)
    const data = await this.studioService.generateText(
      req.user.sub,
      dto.prompt,
      dto.model,
      dto.refs,
      dto.mentionedKeys,
      cancel,
    )
    return { code: 0, message: 'ok', data }
  }

  @Post('prompt/generate')
  @UseGuards(AuthGuard)
  async generatePrompt(
    @Req() req: { user: { sub: string }; on(event: string, cb: () => void): void; aborted?: boolean },
    @Body() dto: GeneratePromptDto,
  ) {
    const cancel = createCancelFlag(req)
    const data = await this.studioService.generatePrompt(req.user.sub, dto.prompt, dto.model, cancel)
    return { code: 0, message: 'ok', data }
  }

  @Post('image/variation')
  @UseGuards(AuthGuard)
  async imageVariation(
    @Req() req: { user: { sub: string }; on(event: string, cb: () => void): void; aborted?: boolean },
    @Body() dto: ImageVariationDto,
  ) {
    const cancel = createCancelFlag(req)
    const data = await this.studioService.generateImageVariation(
      req.user.sub,
      dto.prompt,
      dto.basePrompt,
      dto.model,
      cancel,
    )
    return { code: 0, message: 'ok', data }
  }

  @Get('generations/:id')
  @UseGuards(AuthGuard)
  async getGeneration(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    const data = await this.studioService.getGeneration(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Post('image/generate')
  @UseGuards(AuthGuard)
  async generateImage(
    @Req() req: { user: { sub: string }; on(event: string, cb: () => void): void; aborted?: boolean },
    @Body() dto: GenerateImageDto,
  ) {
    const cancel = createCancelFlag(req)
    const data = await this.studioService.generateImage(
      req.user.sub,
      dto.prompt,
      dto.model,
      dto.aspectRatio,
      dto.refs,
      dto.mentionedKeys,
      dto.resolution,
      dto.count,
      cancel,
    )
    return { code: 0, message: 'ok', data }
  }

  @Post('video/generate')
  @UseGuards(AuthGuard)
  async generateVideo(@Req() req: { user: { sub: string } }, @Body() dto: GenerateVideoDto) {
    const data = await this.studioService.generateVideo(
      req.user.sub,
      dto.prompt,
      dto.model,
      dto.duration,
      dto.aspectRatio,
      dto.refs,
      dto.mentionedKeys,
      dto.resolution,
      dto.crop,
    )
    return { code: 0, message: 'ok', data }
  }

  @Post('audio/generate')
  @UseGuards(AuthGuard)
  async generateAudio(
    @Req() req: { user: { sub: string }; on(event: string, cb: () => void): void; aborted?: boolean },
    @Body() dto: GenerateAudioDto,
  ) {
    const cancel = createCancelFlag(req)
    const data = await this.studioService.generateAudio(
      req.user.sub,
      dto.text,
      {
        model: dto.model,
        voice: dto.voice,
        emotion: dto.emotion,
        language: dto.language,
        speed: dto.speed,
        volume: dto.volume,
        pitch: dto.pitch,
      },
      dto.refs,
      dto.mentionedKeys,
      cancel,
    )
    return { code: 0, message: 'ok', data }
  }

  @Post('generations/:id/confirm-platform-fallback')
  @UseGuards(AuthGuard)
  async confirmPlatformFallback(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
  ) {
    const data = await this.studioService.confirmPlatformFallback(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Post('generations/:id/cancel-platform-fallback')
  @UseGuards(AuthGuard)
  async cancelPlatformFallback(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
  ) {
    const data = await this.studioService.cancelPlatformFallback(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }
}
