import {
  Controller,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { AuthGuard } from '../auth/auth.guard'
import { UploadService } from './upload.service'

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
}
