import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { SessionsModule } from './sessions/sessions.module'
import { WorksModule } from './works/works.module'
import { AgentModule } from './agent/agent.module'
import { CanvasModule } from './canvas/canvas.module'
import { MembershipModule } from './membership/membership.module'
import { PrismaModule } from './prisma/prisma.module'
import { StoriesModule } from './stories/stories.module'
import { StudioModule } from './studio/studio.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [PrismaModule, AuthModule, SessionsModule, WorksModule, AgentModule, CanvasModule, UsersModule, MembershipModule, StudioModule, StoriesModule],
})
export class AppModule {}
