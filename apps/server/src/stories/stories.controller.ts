import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common'
import { IsNumber, IsOptional, IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { StoriesService } from './stories.service'

class CreateStoryDto {
  @IsString()
  title!: string

  @IsOptional()
  @IsString()
  synopsis?: string

  @IsOptional()
  @IsNumber()
  episodeCount?: number
}

@Controller('stories')
export class StoriesController {
  constructor(@Inject(StoriesService) private readonly storiesService: StoriesService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() req: { user: { sub: string } }) {
    const data = await this.storiesService.list(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@Req() req: { user: { sub: string } }, @Body() dto: CreateStoryDto) {
    const data = await this.storiesService.create(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async findOne(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const data = await this.storiesService.findOne(id, req.user.sub)
    return { code: 0, message: 'ok', data }
  }
}
