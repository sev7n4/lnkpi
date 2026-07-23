import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

@Injectable()
export class AgentInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.AGENT_RUNTIME_SERVICE_TOKEN?.trim()
    if (!expected) {
      throw new UnauthorizedException('AGENT_RUNTIME_SERVICE_TOKEN is not configured')
    }

    const request = context.switchToHttp().getRequest<Request>()
    const token = request.headers['x-lnkpi-service-token']
    const provided = Array.isArray(token) ? token[0] : token
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid service token')
    }
    return true
  }
}
