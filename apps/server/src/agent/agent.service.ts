import { Inject, Injectable } from '@nestjs/common'
import { CanvasAgent, applyCanvasActions, type AgentStreamEvent } from '@lnkpi/agent'
import type { CanvasAction, CanvasData } from '@lnkpi/shared'
import { IMAGE_MODELS, TEXT_MODELS, VIDEO_MODELS } from '@lnkpi/shared'
import { MaterialService } from '../canvas/material.service'
import { ShotService } from '../canvas/shot.service'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRuntimeClient } from './agent-runtime.client'

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
    await this.prisma.agentMessage.create({
      data: { sessionId, role: 'user', content: userMessage },
    })

    const runtimeUrl = process.env.AGENT_RUNTIME_URL?.trim()
    if (runtimeUrl && userId) {
      const client = this.createRuntimeClient(runtimeUrl)
      if (await client.healthOk()) {
        yield* this.streamFromRuntime(client, sessionId, userMessage, userId)
        return
      }
    }

    yield* this.streamFromCanvasAgent(sessionId, userId)
  }

  /** Overridable in unit tests */
  createRuntimeClient(baseUrl: string): AgentRuntimeClient {
    return new AgentRuntimeClient(baseUrl)
  }

  private async *streamFromRuntime(
    client: AgentRuntimeClient,
    sessionId: string,
    userMessage: string,
    userId: string,
  ): AsyncGenerator<AgentStreamEvent> {
    let assistantText = ''
    const canvasActions: CanvasAction[] = []

    for await (const event of client.streamRun({
      sessionId,
      userId,
      message: userMessage,
      threadId: sessionId,
    })) {
      if (event.type === 'text_delta') {
        assistantText += (event.data as { text: string }).text
      }
      if (event.type === 'canvas_action') {
        canvasActions.push(event.data as CanvasAction)
      }
      yield event
    }

    await this.finalizeTurn(sessionId, userId, assistantText, canvasActions, {
      // Nest internal tools already wrote Session.canvasData; skip re-apply to avoid duplicate add_node
      rewriteCanvasData: false,
    })
  }

  private async *streamFromCanvasAgent(
    sessionId: string,
    userId?: string,
  ): AsyncGenerator<AgentStreamEvent> {
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

    await this.finalizeTurn(sessionId, userId, assistantText, canvasActions, {
      rewriteCanvasData: true,
    })
  }

  private async finalizeTurn(
    sessionId: string,
    userId: string | undefined,
    assistantText: string,
    canvasActions: CanvasAction[],
    opts: { rewriteCanvasData: boolean },
  ) {
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

    if (canvasActions.length > 0 && userId) {
      await this.persistCanvasEntities(sessionId, canvasActions)

      if (opts.rewriteCanvasData) {
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
