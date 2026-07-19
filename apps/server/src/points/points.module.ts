import { Module } from '@nestjs/common'
import { PointsService } from './points.service'

@Module({
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
