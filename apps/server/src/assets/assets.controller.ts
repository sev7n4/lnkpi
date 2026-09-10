import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { PrismaService } from '../prisma/prisma.service'
import { PUBLIC_ASSETS } from './public-assets.data'
import {
  buildUserAssetMetadataFromGeneration,
  serializeUserAssetMetadata,
} from './build-user-asset-metadata'
import { PersistRemoteService } from './persist-remote.service'

type AuthedRequest = Request & { user: { sub: string; phone: string } }

class PublicAssetsQueryDto {
  @IsOptional()
  @IsIn(['image', 'video', 'audio'])
  kind?: 'image' | 'video' | 'audio'

  @IsOptional()
  @IsString()
  search?: string
}

class PersistRemoteDto {
  @IsString()
  @MaxLength(4096)
  url!: string

  @IsIn(['image', 'video', 'audio'])
  kind!: 'image' | 'video' | 'audio'

  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceNodeId?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nodeId?: string

  @IsOptional()
  @IsBoolean()
  replaceNodeUrl?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(64)
  generationRecordId?: string
}

class SaveUserAssetDto {
  @IsIn(['image', 'video', 'audio'])
  kind!: 'image' | 'video' | 'audio'

  @IsString()
  @MaxLength(2048)
  url!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceNodeId?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  generationRecordId?: string
}

@Controller('assets')
export class AssetsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PersistRemoteService) private readonly persistRemoteService: PersistRemoteService,
  ) {}

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

  @Get('mine')
  @UseGuards(AuthGuard)
  async findMine(@Req() req: AuthedRequest) {
    const items = await this.prisma.userAsset.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return { code: 0, message: 'ok', data: { items } }
  }

  @Post('persist-remote')
  @UseGuards(AuthGuard)
  async persistRemote(@Req() req: AuthedRequest, @Body() dto: PersistRemoteDto) {
    const data = await this.persistRemoteService.persistRemote({
      userId: req.user.sub,
      url: dto.url,
      kind: dto.kind,
      label: dto.label,
      sessionId: dto.sessionId,
      sourceNodeId: dto.sourceNodeId ?? dto.nodeId,
      replaceNodeUrl: dto.replaceNodeUrl ?? false,
      generationRecordId: dto.generationRecordId,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('mine')
  @UseGuards(AuthGuard)
  async saveMine(@Req() req: AuthedRequest, @Body() dto: SaveUserAssetDto) {
    let metadata: string | undefined
    if (dto.generationRecordId) {
      const record = await this.prisma.generationRecord.findFirst({
        where: { id: dto.generationRecordId, userId: req.user.sub },
      })
      if (record) {
        metadata = serializeUserAssetMetadata(buildUserAssetMetadataFromGeneration(record))
      }
    }

    const item = await this.prisma.userAsset.upsert({
      where: { userId_url: { userId: req.user.sub, url: dto.url } },
      create: {
        userId: req.user.sub,
        kind: dto.kind,
        url: dto.url,
        label: dto.label ?? '',
        sourceNodeId: dto.sourceNodeId,
        metadata,
      },
      update: {
        label: dto.label ?? '',
        kind: dto.kind,
        ...(metadata ? { metadata } : {}),
      },
    })
    return { code: 0, message: 'ok', data: item }
  }

  @Delete('mine/:id')
  @UseGuards(AuthGuard)
  async removeMine(@Req() req: AuthedRequest, @Param('id') id: string) {
    const existing = await this.prisma.userAsset.findFirst({
      where: { id, userId: req.user.sub },
    })
    if (!existing) {
      throw new NotFoundException('资产不存在')
    }
    await this.prisma.userAsset.delete({ where: { id } })
    return { code: 0, message: 'ok', data: { id } }
  }
}
