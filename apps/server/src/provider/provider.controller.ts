import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { AuthGuard } from '../auth/auth.guard'
import { ProviderService } from './provider.service'

class ChannelModelDto {
  @IsString()
  name!: string

  @IsIn(['text', 'image', 'video', 'audio'])
  capability!: 'text' | 'image' | 'video' | 'audio'
}

class CreateChannelDto {
  @IsString()
  name!: string

  @IsIn(['openai', 'gemini'])
  apiFormat!: 'openai' | 'gemini'

  @IsString()
  baseUrl!: string

  @IsOptional()
  @IsString()
  apiKey?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelModelDto)
  models?: ChannelModelDto[]
}

class UpdateChannelDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsIn(['openai', 'gemini'])
  apiFormat?: 'openai' | 'gemini'

  @IsOptional()
  @IsString()
  baseUrl?: string

  @IsOptional()
  @IsString()
  apiKey?: string

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelModelDto)
  models?: ChannelModelDto[]
}

class UpdatePreferencesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectableImageModels?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectableVideoModels?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectableTextModels?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectableAudioModels?: string[]

  @IsOptional()
  @IsString()
  defaultImageModel?: string

  @IsOptional()
  @IsString()
  defaultVideoModel?: string

  @IsOptional()
  @IsString()
  defaultTextModel?: string

  @IsOptional()
  @IsString()
  defaultAudioModel?: string

  @IsOptional()
  @IsNumber()
  canvasImageCount?: number

  @IsOptional()
  @IsString()
  defaultImageAspect?: string

  @IsOptional()
  @IsString()
  defaultImageResolution?: string

  @IsOptional()
  @IsString()
  defaultVideoAspect?: string

  @IsOptional()
  @IsNumber()
  defaultVideoDuration?: number

  @IsOptional()
  @IsString()
  defaultVideoResolution?: string

  @IsOptional()
  @IsString()
  defaultVideoCrop?: string

  @IsOptional()
  @IsString()
  audioVoice?: string

  @IsOptional()
  @IsString()
  audioFormat?: string

  @IsOptional()
  @IsNumber()
  audioSpeed?: number

  @IsOptional()
  @IsString()
  audioInstructions?: string | null

  @IsOptional()
  @IsString()
  systemPrompt?: string | null
}

class UpdateWebdavDto {
  @IsOptional()
  @IsString()
  url?: string

  @IsOptional()
  @IsString()
  directory?: string

  @IsOptional()
  @IsString()
  username?: string

  @IsOptional()
  @IsString()
  password?: string

  @IsOptional()
  @IsBoolean()
  clearPassword?: boolean
}

@Controller('provider')
export class ProviderController {
  constructor(@Inject(ProviderService) private readonly providerService: ProviderService) {}

  @Get('bootstrap')
  @UseGuards(AuthGuard)
  async bootstrap(@Req() req: { user: { sub: string } }) {
    const data = await this.providerService.bootstrap(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post('channels')
  @UseGuards(AuthGuard)
  async createChannel(
    @Req() req: { user: { sub: string } },
    @Body() dto: CreateChannelDto,
  ) {
    const data = await this.providerService.createChannel(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Put('channels/:id')
  @UseGuards(AuthGuard)
  async updateChannel(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    const data = await this.providerService.updateChannel(req.user.sub, id, dto)
    return { code: 0, message: 'ok', data }
  }

  @Delete('channels/:id')
  @UseGuards(AuthGuard)
  async deleteChannel(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
  ) {
    const data = await this.providerService.deleteChannel(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Post('channels/pull-all')
  @UseGuards(AuthGuard)
  async pullAll(@Req() req: { user: { sub: string } }) {
    const data = await this.providerService.pullAllModels(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post('channels/:id/pull-models')
  @UseGuards(AuthGuard)
  async pullModels(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
  ) {
    const data = await this.providerService.pullModels(req.user.sub, id)
    return { code: 0, message: 'ok', data }
  }

  @Put('preferences')
  @UseGuards(AuthGuard)
  async updatePreferences(
    @Req() req: { user: { sub: string } },
    @Body() dto: UpdatePreferencesDto,
  ) {
    const data = await this.providerService.updatePreferences(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Put('webdav')
  @UseGuards(AuthGuard)
  async updateWebdav(
    @Req() req: { user: { sub: string } },
    @Body() dto: UpdateWebdavDto,
  ) {
    const data = await this.providerService.updateWebdav(req.user.sub, dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('webdav/test')
  @UseGuards(AuthGuard)
  async testWebdav(@Req() req: { user: { sub: string } }) {
    const data = await this.providerService.testWebdav(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post('webdav/sync')
  @UseGuards(AuthGuard)
  async syncWebdav(@Req() req: { user: { sub: string } }) {
    const data = await this.providerService.syncWebdav(req.user.sub)
    return { code: 0, message: 'ok', data }
  }
}
