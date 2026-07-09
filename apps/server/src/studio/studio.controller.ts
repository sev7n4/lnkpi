import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common'
import { IsNumber, IsOptional, IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { StudioService } from './studio.service'

class GenerateImageDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string
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
}

class GenerateAudioDto {
  @IsString()
  text!: string

  @IsOptional()
  @IsString()
  voice?: string
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

  @Post('image/generate')
  @UseGuards(AuthGuard)
  async generateImage(@Req() req: { user: { sub: string } }, @Body() dto: GenerateImageDto) {
    const data = await this.studioService.generateImage(req.user.sub, dto.prompt, dto.model)
    return { code: 0, message: 'ok', data }
  }

  @Post('video/generate')
  @UseGuards(AuthGuard)
  async generateVideo(@Req() req: { user: { sub: string } }, @Body() dto: GenerateVideoDto) {
    const data = await this.studioService.generateVideo(req.user.sub, dto.prompt, dto.model, dto.duration)
    return { code: 0, message: 'ok', data }
  }

  @Post('audio/generate')
  @UseGuards(AuthGuard)
  async generateAudio(@Req() req: { user: { sub: string } }, @Body() dto: GenerateAudioDto) {
    const data = await this.studioService.generateAudio(req.user.sub, dto.text, dto.voice)
    return { code: 0, message: 'ok', data }
  }
}
