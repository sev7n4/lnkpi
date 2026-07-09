import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { SessionsModule } from './sessions/sessions.module'
import { WorksModule } from './works/works.module'
import { AgentModule } from './agent/agent.module'
import { CanvasModule } from './canvas/canvas.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [PrismaModule, AuthModule, SessionsModule, WorksModule, AgentModule, CanvasModule],
})
export class AppModule {}
