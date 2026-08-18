import { Module } from '@nestjs/common'
import { MediaProbeModule } from '../media/media-probe.module'
import { PointsModule } from '../points/points.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ProviderModule } from '../provider/provider.module'
import { UploadModule } from '../upload/upload.module'
import { StudioController } from './studio.controller'
import { StudioService } from './studio.service'
import { VideoGenerationOrchestrator } from './video-generation.orchestrator'

@Module({
  imports: [MediaProbeModule, PointsModule, ProviderModule, PrismaModule, UploadModule],
  controllers: [StudioController],
  providers: [StudioService, VideoGenerationOrchestrator],
  exports: [StudioService, VideoGenerationOrchestrator],
})
export class StudioModule {}
