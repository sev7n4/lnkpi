import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { applyCanvasActions, type AgentStreamEvent } from '@lnkpi/agent'
import type {
  AgentMessageMetadata,
  CanvasAction,
  CanvasData,
  JourneyTraceSnapshot,
  LinkedCanvasOutput,
  SidebarAttachment,
} from '@lnkpi/shared'
import {
  IMAGE_MODELS,
  TEXT_MODELS,
  VIDEO_MODELS,
  normalizeMentionedKeys,
  validateSidebarAttachments,
} from '@lnkpi/shared'
import { MaterialService } from '../canvas/material.service'
import { ShotService } from '../canvas/shot.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { AgentRuntimeClient } from './agent-runtime.client'
import { mapUiSkillId } from './agent-skill-map'
import { sanitizeAgentMessageContent } from './agentMessageSanitize'

const TRACE_PERSIST_EVENT_TYPES = new Set([
  'step',
  'text_replace',
  'phase_hint',
  'tool_call',
  'tool_result',
  'canvas_action',
  'node_status',
  'task_update',
  'thinking',
  'explore',
  'error',
])

export function buildTurnMetadata(input: {
  journeyTrace?: JourneyTraceSnapshot
  presentation?: Record<string, unknown>
  executionEvents?: Array<{ type: string; data: unknown }>
}): AgentMessageMetadata | undefined {
  const metadata: AgentMessageMetadata = {}
  if (input.journeyTrace) metadata.journeyTrace = input.journeyTrace
  if (input.presentation) metadata.presentation = input.presentation
  if (input.executionEvents?.length) metadata.executionEvents = input.executionEvents
  return Object.keys(metadata).length ? metadata : undefined
}

export function deriveLinkedOutputs(actions: CanvasAction[]): LinkedCanvasOutput[] {
  return actions
    .filter((a) => a.type === 'add_node' && a.payload?.id)
    .map((a) => ({
      nodeId: a.payload.id!,
      title: String(a.payload.data?.title || a.payload.data?.prompt || '未命名').slice(0, 20),
      nodeType: String(a.payload.nodeType || 'image'),
      status: 'done' as const,
    }))
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShotService) private readonly shotService: ShotService,
    @Inject(MaterialService) private readonly materialService: MaterialService,
    @Inject(ProviderResolverService) private readonly providerResolver: ProviderResolverService,
  ) {}

  getCapabilities() {
    return {
      text: TEXT_MODELS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
    }
  }

  async getMessages(sessionId: string, threadId: string, limit = 100) {
    if (!sessionId?.trim() || !threadId?.trim()) {
      throw new BadRequestException('sessionId and threadId are required')
    }
    const rows = await this.prisma.agentMessage.findMany({
      where: { sessionId, threadId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows.reverse()
  }

  async listThreads(sessionId: string) {
    if (!sessionId?.trim()) {
      throw new BadRequestException('sessionId is required')
    }
    return this.prisma.agentThread.findMany({
      where: { sessionId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
  }

  async upsertAgentThread(input: { id: string; sessionId: string; title?: string }) {
    const title = (input.title?.trim() || '新对话').slice(0, 40)
    return this.prisma.agentThread.upsert({
      where: { id: input.id },
      create: { id: input.id, sessionId: input.sessionId, title },
      update: { title, updatedAt: new Date() },
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
    threadId?: string,
    userDecision?: 'confirm' | 'revise' | 'replan' | 'confirm_gen' | 'topo_revise' | 'node_revise',
    idempotencyKey?: string,
    skillId?: string,
    model?: string,
    focusNodeId?: string,
    attachments?: SidebarAttachment[],
    refOrder?: string[],
    mentionedKeys?: string[],
  ): AsyncGenerator<AgentStreamEvent> {
    // Register idempotency key (if provided) before starting
    if (idempotencyKey) {
      await this.registerIdempotencyKey(idempotencyKey, sessionId, threadId || sessionId)
    }

    const validatedAttachments =
      attachments?.length ? validateSidebarAttachments(attachments) : undefined
    const validatedMentionedKeys =
      mentionedKeys?.length ? normalizeMentionedKeys(mentionedKeys) : undefined

    const effectiveThreadId = threadId?.trim() || sessionId
    const threadExists = await this.prisma.agentThread.findUnique({
      where: { id: effectiveThreadId },
      select: { id: true },
    })
    if (!threadExists) {
      await this.upsertAgentThread({
        id: effectiveThreadId,
        sessionId,
        title: userMessage,
      })
    } else {
      await this.prisma.agentThread.update({
        where: { id: effectiveThreadId },
        data: { updatedAt: new Date() },
      })
    }

    const persistedUserContent = sanitizeAgentMessageContent('user', userMessage)
    if (persistedUserContent) {
      await this.prisma.agentMessage.create({
        data: {
          sessionId,
          threadId: effectiveThreadId,
          role: 'user',
          content: persistedUserContent,
          ...(validatedAttachments ? { attachments: JSON.stringify(validatedAttachments) } : {}),
        },
      })
    }

    let assistantText = ''

    const runtimeUrl = process.env.AGENT_RUNTIME_URL?.trim()
    if (runtimeUrl && userId) {
      const client = this.createRuntimeClient(runtimeUrl)
      if (await client.healthOk()) {
        for await (const event of this.streamFromRuntime(
          client,
          sessionId,
          userMessage,
          userId,
          threadId,
          userDecision,
          skillId,
          model,
          focusNodeId,
          validatedAttachments,
          refOrder,
          validatedMentionedKeys,
        )) {
          if (event.type === 'text_delta') {
            assistantText += (event.data as { text: string }).text
          }
          yield event
        }
        // Complete idempotency key after successful runtime stream
        if (idempotencyKey) {
          await this.completeIdempotencyKey(idempotencyKey, assistantText)
        }
        return
      }
    }

    for await (const event of this.streamRuntimeUnavailable()) {
      yield event
    }
    if (idempotencyKey) {
      await this.completeIdempotencyKey(idempotencyKey, '')
    }
  }

  private async *streamRuntimeUnavailable(): AsyncGenerator<AgentStreamEvent> {
    yield {
      type: 'error',
      data: {
        message: 'Agent 服务暂不可用，请稍后重试。',
        error_type: 'runtime_unavailable',
      },
    }
    yield { type: 'done', data: {} }
  }

  // ── Idempotency ──────────────────────────────────────────────

  /** Check if an idempotency key already exists (lazy-clean expired records first). */
  async checkIdempotencyKey(
    key: string,
  ): Promise<{ status: string; resultSummary?: string } | null> {
    // Lazy-clean expired records
    await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey: key },
    })
    if (!record) return null
    return { status: record.status, resultSummary: record.resultSummary ?? undefined }
  }

  /** Register a new idempotency key with 5-min TTL. */
  async registerIdempotencyKey(
    key: string,
    sessionId: string,
    threadId: string,
  ): Promise<void> {
    const now = new Date()
    await this.prisma.idempotencyRecord
      .create({
        data: {
          idempotencyKey: key,
          sessionId,
          threadId,
          status: 'processing',
          expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        },
      })
      .catch(() => {
        // Unique constraint conflict = concurrent registration, ignore
      })
  }

  /** Mark idempotency key as completed with optional result summary. */
  async completeIdempotencyKey(key: string, resultSummary?: string): Promise<void> {
    await this.prisma.idempotencyRecord
      .updateMany({
        where: { idempotencyKey: key, status: 'processing' },
        data: { status: 'completed', resultSummary: resultSummary?.slice(0, 500) || null },
      })
      .catch(() => {})
  }

  // ── Runtime Health ───────────────────────────────────────────

  /** Proxy agent-runtime health check for frontend heartbeat detection. */
  async checkRuntimeHealth(): Promise<{ ok: boolean; latencyMs?: number }> {
    const runtimeUrl = process.env.AGENT_RUNTIME_URL?.trim()
    if (!runtimeUrl) return { ok: false }
    const client = this.createRuntimeClient(runtimeUrl)
    const start = Date.now()
    const ok = await client.healthOk(5000)
    return { ok, latencyMs: ok ? Date.now() - start : undefined }
  }

  /** W12: Read LangGraph checkpoint phase for reconnect UI. */
  async getThreadState(threadId: string): Promise<{
    threadId: string
    phase: string | null
    nextNodes: string[]
    interrupted: boolean
    finished: boolean
    hasAtomicCheckpoint?: boolean
    atomicNodeId?: string | null
    atomicTargetType?: string | null
    atomicTitle?: string | null
    flowMode?: string | null
  } | null> {
    const runtimeUrl = process.env.AGENT_RUNTIME_URL?.trim()
    if (!runtimeUrl || !threadId.trim()) return null
    const client = this.createRuntimeClient(runtimeUrl)
    return client.getThreadState(threadId.trim())
  }

  /** W27: Graph control-flow phase timeline (checkpoint history). */
  async getThreadTimeline(threadId: string): Promise<{
    threadId: string
    entries: Array<{
      step: number | null
      source: string | null
      phase: string | null
      nextNodes: string[]
      skillId: string | null
      promptVersion: string | null
      interrupted: boolean
    }>
    checkpointCount: number
  } | null> {
    const runtimeUrl = process.env.AGENT_RUNTIME_URL?.trim()
    if (!runtimeUrl || !threadId.trim()) return null
    const client = this.createRuntimeClient(runtimeUrl)
    return client.getThreadTimeline(threadId.trim())
  }

  /** Overridable in unit tests */
  createRuntimeClient(baseUrl: string): AgentRuntimeClient {
    return new AgentRuntimeClient(
      baseUrl,
      process.env.AGENT_RUNTIME_SERVICE_TOKEN?.trim(),
    )
  }

  private async *streamFromRuntime(
    client: AgentRuntimeClient,
    sessionId: string,
    userMessage: string,
    userId: string,
    threadId?: string,
    userDecision?: 'confirm' | 'revise' | 'replan' | 'confirm_gen' | 'topo_revise' | 'node_revise',
    skillId?: string,
    model?: string,
    focusNodeId?: string,
    attachments?: SidebarAttachment[],
    refOrder?: string[],
    mentionedKeys?: string[],
  ): AsyncGenerator<AgentStreamEvent> {
    let assistantText = ''
    const canvasActions: CanvasAction[] = []
    let journeyTrace: JourneyTraceSnapshot | undefined
    const executionEvents: Array<{ type: string; data: unknown }> = []
    let turnPresentation: Record<string, unknown> | undefined

    const runtimeSkillId = mapUiSkillId(skillId)
    let llmModel: string | undefined
    let llmApiKey: string | undefined
    let llmBaseUrl: string | undefined
    if (model && userId) {
      const resolved = await this.providerResolver.resolveForGeneration(userId, model, 'text')
      llmModel = resolved.modelName
      llmApiKey = resolved.credentials.apiKey
      llmBaseUrl = resolved.credentials.baseUrl
    }

    for await (const event of client.streamRun({
      sessionId,
      userId,
      message: userMessage,
      // 新建对话应换 thread，避免 MemorySaver 把旧 await_confirm 状态续上
      threadId: threadId?.trim() || sessionId,
      // W5 修复：把前端结构化决策（按钮点击）传给 agent-runtime
      // interrupt_before 恢复：注入 user_decision 后 astream(None)，不再重跑 intake
      userDecision,
      skillId: runtimeSkillId,
      llmModel,
      llmApiKey,
      llmBaseUrl,
      focusNodeId,
      attachments,
      refOrder,
      mentionedKeys,
    })) {
      if (TRACE_PERSIST_EVENT_TYPES.has(event.type)) {
        executionEvents.push({ type: event.type, data: event.data })
      }
      if (event.type === 'interrupt' || event.type === 'done') {
        const pres = (event.data as { presentation?: unknown })?.presentation
        if (pres && typeof pres === 'object' && !Array.isArray(pres)) {
          turnPresentation = pres as Record<string, unknown>
        }
      }
      if (event.type === 'text_delta') {
        assistantText += (event.data as { text: string }).text
      }
      if (event.type === 'text_replace') {
        assistantText = (event.data as { text: string }).text
      }
      if (event.type === 'canvas_action') {
        canvasActions.push(event.data as CanvasAction)
      }
      if (event.type === 'journey_update') {
        const snap = (event.data as { snapshot?: JourneyTraceSnapshot }).snapshot
        if (snap) {
          journeyTrace = snap
        }
      }
      yield event
    }

    const metadata = buildTurnMetadata({
      journeyTrace,
      presentation: turnPresentation,
      executionEvents,
    })

    const effectiveThreadId = threadId?.trim() || sessionId
    await this.finalizeTurn(sessionId, effectiveThreadId, userId, assistantText, canvasActions, {
      // Nest internal tools already wrote Session.canvasData; skip re-apply to avoid duplicate add_node
      rewriteCanvasData: false,
      linkedOutputs: deriveLinkedOutputs(canvasActions),
      metadata,
    })
  }

  private async finalizeTurn(
    sessionId: string,
    threadId: string,
    userId: string | undefined,
    assistantText: string,
    canvasActions: CanvasAction[],
    opts: { rewriteCanvasData: boolean; linkedOutputs?: LinkedCanvasOutput[]; metadata?: AgentMessageMetadata },
  ) {
    const shouldPersistAssistant = Boolean(
      assistantText || opts.metadata?.journeyTrace || opts.metadata?.presentation || opts.metadata?.executionEvents?.length,
    )
    if (shouldPersistAssistant) {
      await this.prisma.agentMessage.create({
        data: {
          sessionId,
          threadId,
          role: 'assistant',
          content: assistantText || ' ',
          toolCalls: canvasActions.length ? JSON.stringify(canvasActions) : null,
          linkedOutputs: opts.linkedOutputs?.length ? JSON.stringify(opts.linkedOutputs) : null,
          metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        },
      })
      await this.prisma.agentThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
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
