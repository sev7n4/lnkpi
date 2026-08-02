import { Module } from '@nestjs/common'
import { CanvasModule } from '../canvas/canvas.module'
import { SessionsModule } from '../sessions/sessions.module'
import { StudioModule } from '../studio/studio.module'
import { AgentCanvasToolsController } from './agent-canvas-tools.controller'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'
import { AgentController } from './agent.controller'
import { AgentInternalGuard } from './agent-internal.guard'
import { AgentService } from './agent.service'

@Module({
  imports: [CanvasModule, SessionsModule, StudioModule],
  controllers: [AgentController, AgentCanvasToolsController],
  providers: [AgentService, AgentCanvasToolsService, AgentInternalGuard],
  exports: [AgentService, AgentCanvasToolsService],
})
export class AgentModule {}
