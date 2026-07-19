import { Module } from '@nestjs/common'
import { PointsModule } from '../points/points.module'
import { ProviderModule } from '../provider/provider.module'
import { UploadModule } from '../upload/upload.module'
import { CanvasController } from './canvas.controller'
import { CanvasService } from './canvas.service'
import { MaterialService } from './material.service'
import { SceneComposerService } from './scene-composer.service'
import { ShotService } from './shot.service'
import { VideoCompositionService } from './video-composition.service'

@Module({
  imports: [UploadModule, PointsModule, ProviderModule],
  controllers: [CanvasController],
  providers: [
    CanvasService,
    ShotService,
    MaterialService,
    SceneComposerService,
    VideoCompositionService,
  ],
  exports: [
    CanvasService,
    ShotService,
    MaterialService,
    SceneComposerService,
    VideoCompositionService,
  ],
})
export class CanvasModule {}
