import { Module } from '@nestjs/common'
import { MediaModule } from '../media/media.module'
import { AssetsController } from './assets.controller'
import { PersistRemoteService } from './persist-remote.service'

@Module({
  imports: [MediaModule],
  controllers: [AssetsController],
  providers: [PersistRemoteService],
  exports: [PersistRemoteService],
})
export class AssetsModule {}
