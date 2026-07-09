import { Module } from '@nestjs/common'
import { StudioController } from './studio.controller'
import { StudioService } from './studio.service'

@Module({
  controllers: [StudioController],
  providers: [StudioService],
})
export class StudioModule {}
