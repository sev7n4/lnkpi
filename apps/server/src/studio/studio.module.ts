import { Module } from '@nestjs/common'
import { PointsModule } from '../points/points.module'
import { ProviderModule } from '../provider/provider.module'
import { StudioController } from './studio.controller'
import { StudioService } from './studio.service'

@Module({
  imports: [PointsModule, ProviderModule],
  controllers: [StudioController],
  providers: [StudioService],
  exports: [StudioService],
})
export class StudioModule {}
