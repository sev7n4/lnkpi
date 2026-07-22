import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { SessionsService } from './sessions.service'

class CreateSessionDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  prompt?: string
}

class UpdateSessionDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  canvasData?: unknown
}

@Controller('sessions')
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessionsService: SessionsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(@Req() req: { user: { sub: string } }, @Body() dto: CreateSessionDto) {
    const data = await this.sessionsService.create(req.user.sub, dto.title, dto.prompt)
    return { code: 0, message: 'ok', data }
  }

  @Get()
  @UseGuards(AuthGuard)
  async findAll(@Req() req: { user: { sub: string } }) {
    const data = await this.sessionsService.findAll(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.sessionsService.findOne(id)
    return { code: 0, message: 'ok', data }
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  async update(
    @Param('id') id: string,
    @Req() req: { user: { sub: string } },
    @Body() dto: UpdateSessionDto,
  ) {
    const data = await this.sessionsService.update(id, req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const data = await this.sessionsService.remove(id, req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post(':id/duplicate')
  @UseGuards(AuthGuard)
  async duplicate(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const data = await this.sessionsService.duplicate(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }
}
