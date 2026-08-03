import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { IsIn, IsOptional, IsString } from 'class-validator'
import type { Request, Response } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { SessionsService } from '../sessions/sessions.service'
import { AgentService } from './agent.service'

const SESSION_FORBIDDEN_HINT =
  '⚠️ 此画布不属于当前账号，无法写入。请返回工作台新建画布，或使用画布所有者账号登录。'

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

  /** Dock 技能 id（UI 命名），Nest 映射后转发给 agent-runtime */
  @IsOptional()
  @IsString()
  skillId?: string

  /** 规划阶段 LLM 模型（含 channel 编码），Nest 解析凭证后转发 */
  @IsOptional()
  @IsString()
  model?: string
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
  constructor(
    @Inject(AgentService) private readonly agentService: AgentService,
    @Inject(SessionsService) private readonly sessionsService: SessionsService,
  ) {}

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

  /** Proxy agent-runtime health check for frontend heartbeat detection. */
  @Get('runtime-health')
  async runtimeHealth() {
    const data = await this.agentService.checkRuntimeHealth()
    return { code: 0, message: 'ok', data }
  }

  /** W12: LangGraph checkpoint phase for agent reconnect. */
  @Get('thread-state')
  @UseGuards(AuthGuard)
  async threadState(
    @Query('threadId') threadId: string,
  ) {
    const data = await this.agentService.getThreadState(threadId)
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
    @Req() req: Request & { user: { sub: string } },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // Idempotency key check — prevent duplicate requests from network retries
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined
    if (idempotencyKey) {
      const cached = await this.agentService.checkIdempotencyKey(idempotencyKey)
      if (cached) {
        const text =
          cached.status === 'processing'
            ? '上一轮仍在处理中，请稍候…'
            : cached.resultSummary || '已完成'
        res.write(`data: ${JSON.stringify({ type: 'text_delta', data: { text } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
    }

    try {
      await this.sessionsService.findOne(dto.sessionId, req.user.sub)
    } catch (err) {
      if (err instanceof ForbiddenException) {
        res.write(
          `data: ${JSON.stringify({ type: 'text_delta', data: { text: SESSION_FORBIDDEN_HINT } })}\n\n`,
        )
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      throw err
    }

    try {
      for await (const event of this.agentService.streamConversation(
        dto.sessionId,
        dto.message,
        req.user.sub,
        dto.threadId,
        dto.userDecision,
        idempotencyKey,
        dto.skillId,
        dto.model,
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
