import { Module } from '@nestjs/common'
import { MediaProbeModule } from '../media/media-probe.module'
import { PointsModule } from '../points/points.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ProviderModule } from '../provider/provider.module'
import { SessionsModule } from '../sessions/sessions.module'
import { UploadModule } from '../upload/upload.module'
import { StudioController } from './studio.controller'
import { StudioService } from './studio.service'
import { UpscaleService } from './upscale.service'
import { VideoGenerationOrchestrator } from './video-generation.orchestrator'

@Module({
  imports: [
    MediaProbeModule,
    PointsModule,
    ProviderModule,
    PrismaModule,
    SessionsModule,
    UploadModule,
  ],
  controllers: [StudioController],
  providers: [StudioService, UpscaleService, VideoGenerationOrchestrator],
  exports: [StudioService, UpscaleService, VideoGenerationOrchestrator],
})
export class StudioModule {}
