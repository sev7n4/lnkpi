import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'
import { memoryStorage } from 'multer'
import { AuthGuard } from '../auth/auth.guard'
import { UploadService } from './upload.service'

class InitChunkDto {
  @IsString()
  fileName!: string

  @IsOptional()
  @IsString()
  mimeType?: string

  @IsInt()
  @Min(1)
  size!: number

  @IsInt()
  @Min(1)
  totalChunks!: number
}

class ChunkDto {
  @IsString()
  uploadId!: string

  @IsInt()
  @Min(0)
  index!: number

  @IsString()
  data!: string
}

class CompleteChunkDto {
  @IsString()
  uploadId!: string
}

@Controller('upload')
export class UploadController {
  constructor(@Inject(UploadService) private readonly uploadService: UploadService) {}

  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async upload(
    @Req() req: { user: { sub: string } },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      return { code: 1, message: '未收到文件', data: null }
    }
    const data = await this.uploadService.saveUserFile(
      req.user.sub,
      file.buffer,
      file.originalname,
      file.mimetype,
    )
    return { code: 0, message: 'ok', data }
  }

  /** 经 Vercel JSON 代理的大文件分片上传 — 绕过 ~4.5MB multipart 限制 */
  @Post('init')
  @UseGuards(AuthGuard)
  async initChunk(@Req() req: { user: { sub: string } }, @Body() dto: InitChunkDto) {
    const data = await this.uploadService.initChunkedUpload(req.user.sub, {
      fileName: dto.fileName,
      mimeType: dto.mimeType ?? 'application/octet-stream',
      size: dto.size,
      totalChunks: dto.totalChunks,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('chunk')
  @UseGuards(AuthGuard)
  async saveChunk(@Req() req: { user: { sub: string } }, @Body() dto: ChunkDto) {
    const data = await this.uploadService.saveChunk(req.user.sub, dto.uploadId, dto.index, dto.data)
    return { code: 0, message: 'ok', data }
  }

  @Post('complete')
  @UseGuards(AuthGuard)
  async completeChunk(@Req() req: { user: { sub: string } }, @Body() dto: CompleteChunkDto) {
    const data = await this.uploadService.completeChunkedUpload(req.user.sub, dto.uploadId)
    return { code: 0, message: 'ok', data }
  }
}
