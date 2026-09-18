import { Module } from '@nestjs/common'
import { AssetsModule } from '../assets/assets.module'
import { CanvasModule } from '../canvas/canvas.module'
import { ProviderModule } from '../provider/provider.module'
import { SessionsModule } from '../sessions/sessions.module'
import { StudioModule } from '../studio/studio.module'
import { AgentCanvasToolsController, AgentCanvasToolsDebugController } from './agent-canvas-tools.controller'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'
import { AgentController } from './agent.controller'
import { AgentInternalGuard } from './agent-internal.guard'
import { AgentService } from './agent.service'
import { CompositionService } from './composition.service'
import { WorkflowRecipeService } from './workflow-recipe.service'

@Module({
  imports: [CanvasModule, ProviderModule, SessionsModule, StudioModule, AssetsModule],
  controllers: [AgentController, AgentCanvasToolsController, AgentCanvasToolsDebugController],
  providers: [
    AgentService,
    AgentCanvasToolsService,
    AgentInternalGuard,
    WorkflowRecipeService,
    CompositionService,
  ],
  exports: [AgentService, AgentCanvasToolsService],
})
export class AgentModule {}
