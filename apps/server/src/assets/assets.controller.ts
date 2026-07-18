import { Controller, Get, Query } from '@nestjs/common'
import { IsIn, IsOptional, IsString } from 'class-validator'
import { PUBLIC_ASSETS } from './public-assets.data'

class PublicAssetsQueryDto {
  @IsOptional()
  @IsIn(['image', 'video', 'audio'])
  kind?: 'image' | 'video' | 'audio'

  @IsOptional()
  @IsString()
  search?: string
}

@Controller('assets')
export class AssetsController {
  @Get('public')
  findPublic(@Query() query: PublicAssetsQueryDto) {
    let items = PUBLIC_ASSETS
    if (query.kind) {
      items = items.filter((item) => item.kind === query.kind)
    }
    if (query.search) {
      const q = query.search.toLowerCase()
      items = items.filter((item) => item.label.toLowerCase().includes(q))
    }
    return { code: 0, message: 'ok', data: { items } }
  }
}
