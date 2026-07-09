import { Module } from '@nestjs/common'
import { WorksController } from './works.controller'
import { WorksService } from './works.service'

@Module({
  controllers: [WorksController],
  providers: [WorksService],
})
export class WorksModule {}
