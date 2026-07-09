import { Module } from '@nestjs/common'
import { CanvasModule } from '../canvas/canvas.module'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'

@Module({
  imports: [CanvasModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
