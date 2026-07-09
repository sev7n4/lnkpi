import { Inject, Injectable } from '@nestjs/common'
import { CanvasAgent, applyCanvasActions, type AgentStreamEvent } from '@lnkpi/agent'
import type { CanvasAction, CanvasData } from '@lnkpi/shared'
import { IMAGE_MODELS, TEXT_MODELS, VIDEO_MODELS } from '@lnkpi/shared'
import { MaterialService } from '../canvas/material.service'
import { ShotService } from '../canvas/shot.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AgentService {
  private agent: CanvasAgent

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
  ) {
    this.agent = new CanvasAgent(
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_BASE_URL,
    )
  }

  getCapabilities() {
    return {
      text: TEXT_MODELS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
    }
  }

  async getMessages(sessionId: string) {
    return this.prisma.agentMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
  }

  async optimizePrompt(prompt: string, style?: string) {
    const optimized = style
      ? `${prompt}，${style} 风格，高清细节，专业构图，电影级光影`
      : `${prompt}，高清细节，专业构图，电影级光影，8K 画质`
    return { original: prompt, optimized }
  }

  async *streamConversation(
    sessionId: string,
    userMessage: string,
    userId?: string,
  ): AsyncGenerator<AgentStreamEvent> {
    // 保存用户消息
    await this.prisma.agentMessage.create({
      data: { sessionId, role: 'user', content: userMessage },
    })

    const history = await this.prisma.agentMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })

    const messages = history.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    let assistantText = ''
    const canvasActions: CanvasAction[] = []

    const eventQueue: AgentStreamEvent[] = []
    let resolveNext: (() => void) | null = null
    let done = false

    const pushEvent = (event: AgentStreamEvent) => {
      eventQueue.push(event)
      resolveNext?.()
    }

    this.agent.run(messages, pushEvent).then(() => {
      done = true
      resolveNext?.()
    })

    while (!done || eventQueue.length > 0) {
      if (eventQueue.length === 0) {
        await new Promise<void>((r) => { resolveNext = r })
        continue
      }

      const event = eventQueue.shift()!

      if (event.type === 'text_delta') {
        assistantText += (event.data as { text: string }).text
      }
      if (event.type === 'canvas_action') {
        canvasActions.push(event.data as CanvasAction)
      }

      yield event
    }

    // 保存 assistant 消息
    if (assistantText) {
      await this.prisma.agentMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: assistantText,
          toolCalls: canvasActions.length ? JSON.stringify(canvasActions) : null,
        },
      })
    }

    // 应用 canvas actions 到 session 并持久化 Shot/Material
    if (canvasActions.length > 0 && userId) {
      await this.persistCanvasEntities(sessionId, canvasActions)

      const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
      if (session) {
        const currentData: CanvasData = session.canvasData
          ? JSON.parse(session.canvasData)
          : { nodes: [], edges: [] }
        const updated = applyCanvasActions(currentData, canvasActions)
        await this.prisma.session.update({
          where: { id: sessionId },
          data: { canvasData: JSON.stringify(updated) },
        })
      }
    }
  }

  private async persistCanvasEntities(sessionId: string, actions: CanvasAction[]) {
    for (const action of actions) {
      if (action.type !== 'add_node') continue
      const { payload } = action

      if (payload.nodeType === 'shot') {
        await this.shotService.create(sessionId, {
          id: payload.id,
          title: payload.data?.title as string | undefined,
          prompt: payload.data?.prompt as string | undefined,
          positionX: payload.position?.x,
          positionY: payload.position?.y,
          status: (payload.data?.status as string) ?? 'draft',
        })
      }

      if (payload.nodeType === 'image' && payload.parentShotId) {
        await this.materialService.createFromAgent({
          id: payload.id,
          shotId: payload.parentShotId,
          prompt: payload.data?.prompt as string | undefined,
          url: payload.data?.url as string | undefined,
          status: (payload.data?.status as string) ?? 'completed',
        })
      }
    }
  }
}
