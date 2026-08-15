import { Module } from '@nestjs/common'
import { MediaProbeService } from './media-probe.service'

@Module({
  providers: [MediaProbeService],
  exports: [MediaProbeService],
})
export class MediaProbeModule {}
