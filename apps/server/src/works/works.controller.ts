import { Controller, Get, Param, Query, Inject } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { WorksService } from './works.service'

class WorksQueryDto {
  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  search?: string
}

@Controller('works')
export class WorksController {
  constructor(@Inject(WorksService) private readonly worksService: WorksService) {}

  @Get()
  async findAll(@Query() query: WorksQueryDto) {
    const data = await this.worksService.findAll(query)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.worksService.findOne(id)
    return { code: 0, message: 'ok', data }
  }
}
