import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { DirectUploadService } from './direct-upload.service'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [UploadController],
  providers: [UploadService, DirectUploadService],
  exports: [UploadService],
})
export class UploadModule {}
