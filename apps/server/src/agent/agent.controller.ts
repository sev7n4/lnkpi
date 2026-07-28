import { Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { IsIn, IsOptional, IsString } from 'class-validator'
import type { Response } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { AgentService } from './agent.service'

class ConversationDto {
  @IsString()
  sessionId!: string

  @IsString()
  message!: string

  /** LangGraph thread；新建对话时前端换新 id，与画布 sessionId 解耦 */
  @IsOptional()
  @IsString()
  threadId?: string

  /** W5 修复：用户结构化决策（确认/修改/换方向），用于触发 Command(resume=...) 精确恢复 interrupt。
   *  文本消息（"1"/"2"/"确认方案"等）也能走兼容分支，但显式传值更可靠。 */
  @IsOptional()
  @IsIn(['confirm', 'revise', 'replan', 'confirm_gen', 'topo_revise', 'node_revise'])
  userDecision?: 'confirm' | 'revise' | 'replan' | 'confirm_gen' | 'topo_revise' | 'node_revise'
}

class OptimizePromptDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  style?: string
}

@Controller('agent')
export class AgentController {
  constructor(@Inject(AgentService) private readonly agentService: AgentService) {}

  @Get('capabilities/list')
  getCapabilities() {
    const data = this.agentService.getCapabilities()
    return { code: 0, message: 'ok', data }
  }

  @Get('chat/user/messages')
  async getMessages(@Query('sessionId') sessionId: string) {
    const data = await this.agentService.getMessages(sessionId)
    return { code: 0, message: 'ok', data }
  }

  @Post('chat/optimize-prompt')
  async optimizePrompt(@Body() dto: OptimizePromptDto) {
    const data = await this.agentService.optimizePrompt(dto.prompt, dto.style)
    return { code: 0, message: 'ok', data }
  }

  @Post('chat/conversation')
  @UseGuards(AuthGuard)
  async conversation(
    @Body() dto: ConversationDto,
    @Req() req: { user: { sub: string } },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      for await (const event of this.agentService.streamConversation(
        dto.sessionId,
        dto.message,
        req.user.sub,
        dto.threadId,
        dto.userDecision,
      )) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      res.write('data: [DONE]\n\n')
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: String(err) } })}\n\n`)
    }

    res.end()
  }
}
