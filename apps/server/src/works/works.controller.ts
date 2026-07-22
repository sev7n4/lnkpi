import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { WorksService } from './works.service'

class WorksQueryDto {
  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  search?: string
}

class PublishWorkDto {
  @IsString()
  sessionId!: string

  @IsString()
  title!: string

  @IsString()
  primaryNodeId!: string

  @IsOptional()
  @IsString()
  category?: string
}

@Controller('works')
export class WorksController {
  constructor(@Inject(WorksService) private readonly worksService: WorksService) {}

  @Get()
  async findAll(@Query() query: WorksQueryDto) {
    const data = await this.worksService.findAll(query)
    return { code: 0, message: 'ok', data }
  }

  @Post('publish')
  @UseGuards(AuthGuard)
  async publish(@Req() req: { user: { sub: string } }, @Body() dto: PublishWorkDto) {
    const data = await this.worksService.publish(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id/canvas')
  async getCanvas(@Param('id') id: string) {
    const data = await this.worksService.getCanvas(id)
    return { code: 0, message: 'ok', data }
  }

  @Post(':id/like')
  @UseGuards(AuthGuard)
  async like(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const data = await this.worksService.like(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Post(':id/fork-canvas')
  @UseGuards(AuthGuard)
  async forkCanvas(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const data = await this.worksService.forkCanvas(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.worksService.findOne(id)
    return { code: 0, message: 'ok', data }
  }
}
