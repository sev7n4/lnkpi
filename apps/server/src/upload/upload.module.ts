import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

@Module({
  imports: [AuthModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
