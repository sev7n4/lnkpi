import { Module } from '@nestjs/common'
import { PointsModule } from '../points/points.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ProviderModule } from '../provider/provider.module'
import { StudioController } from './studio.controller'
import { StudioService } from './studio.service'
import { VideoGenerationOrchestrator } from './video-generation.orchestrator'

@Module({
  imports: [PointsModule, ProviderModule, PrismaModule],
  controllers: [StudioController],
  providers: [StudioService, VideoGenerationOrchestrator],
  exports: [StudioService, VideoGenerationOrchestrator],
})
export class StudioModule {}
