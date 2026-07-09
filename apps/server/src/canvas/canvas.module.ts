import { Module } from '@nestjs/common'
import { CanvasController } from './canvas.controller'
import { CanvasService } from './canvas.service'
import { MaterialService } from './material.service'
import { ShotService } from './shot.service'

@Module({
  controllers: [CanvasController],
  providers: [CanvasService, ShotService, MaterialService],
  exports: [CanvasService, ShotService, MaterialService],
})
export class CanvasModule {}
