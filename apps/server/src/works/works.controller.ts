import { Controller, Get, Param, Query } from '@nestjs/common'
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
  constructor(private works: WorksService) {}

  @Get()
  async findAll(@Query() query: WorksQueryDto) {
    const data = await this.works.findAll(query)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.works.findOne(id)
    return { code: 0, message: 'ok', data }
  }
}
