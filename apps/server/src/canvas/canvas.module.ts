import { Module } from '@nestjs/common'
import { CanvasController } from './canvas.controller'
import { CanvasService } from './canvas.service'
import { MaterialService } from './material.service'
import { SceneComposerService } from './scene-composer.service'
import { ShotService } from './shot.service'

@Module({
  controllers: [CanvasController],
  providers: [CanvasService, ShotService, MaterialService, SceneComposerService],
  exports: [CanvasService, ShotService, MaterialService, SceneComposerService],
})
export class CanvasModule {}
