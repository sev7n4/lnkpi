import { Module } from '@nestjs/common'
import { StoriesController } from './stories.controller'
import { StoriesService } from './stories.service'

@Module({
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}
