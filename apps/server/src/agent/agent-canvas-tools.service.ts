import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { applyCanvasActions } from '@lnkpi/agent'
import {
  resolveNodeRefs,
  type CanvasAction,
  type CanvasData,
  type CanvasNode,
  type LocalRefBinding,
  type NodeType,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { StudioService, type StudioRefInput } from '../studio/studio.service'

const GRID_X = 280
const GRID_Y = 220
const DEFAULT_POLL_INTERVAL_MS = 1500
const DEFAULT_POLL_TIMEOUT_MS = 180_000

let nodeSeq = 0

function nextNodeId(type: string) {
  return `${type}-${Date.now()}-${++nodeSeq}`
}

function edgeId(source: string, target: string) {
  return `e-${source}-${target}`
}

function parseCanvas(raw: string | null | undefined): CanvasData {
  if (!raw) return { nodes: [], edges: [] }
  try {
    const parsed = JSON.parse(raw) as CanvasData
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      viewport: parsed.viewport,
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

function nodeTitle(node: CanvasNode): string {
  const data = node.data ?? {}
  return String(data.title ?? data.label ?? data.name ?? '').trim()
}

function nodeStatus(node: CanvasNode): string {
  return String(node.data?.status ?? 'draft')
}

function toStudioRefs(node: CanvasNode, canvas: CanvasData): StudioRefInput[] {
  return resolveNodeRefs({
    targetNodeId: node.id,
    targetType: String(node.type),
    nodes: canvas.nodes,
    edges: canvas.edges,
    localRefs: (node.data?.localRefs as LocalRefBinding[] | undefined) ?? [],
    refOrder: (node.data?.refOrder as string[]) ?? [],
  })
    .filter((r) => !r.stale)
    .map((r) => ({
      refKey: r.refKey,
      mediaType: r.mediaType,
      label: r.label,
      text: r.payload.text,
      url: r.payload.url,
    }))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampImageGenCount(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 1
  return Math.max(1, Math.min(4, Math.round(v)))
}

type AccountGenPrefs = {
  defaultImageModel: string
  defaultVideoModel: string
  defaultTextModel: string
  defaultAudioModel: string
  canvasImageCount: number
  defaultImageAspect: string
  defaultImageResolution: string
  defaultVideoAspect: string
  defaultVideoDuration: number
  defaultVideoResolution: string
  defaultVideoCrop: string
  audioVoice: string
  audioFormat: string
  audioSpeed: number
  audioInstructions: string | null
}

const HARDCODE_PREFS: AccountGenPrefs = {
  defaultImageModel: '',
  defaultVideoModel: '',
  defaultTextModel: '',
  defaultAudioModel: '',
  canvasImageCount: 1,
  defaultImageAspect: '16:9',
  defaultImageResolution: '1K',
  defaultVideoAspect: '16:9',
  defaultVideoDuration: 5,
  defaultVideoResolution: '720p',
  defaultVideoCrop: 'none',
  audioVoice: 'female-shaonv',
  audioFormat: 'mp3',
  audioSpeed: 1,
  audioInstructions: null,
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function modalityDefaults(nodeType: NodeType | string, prefs: AccountGenPrefs): Record<string, unknown> {
  switch (nodeType) {
    case 'image':
      return {
        imageModel: prefs.defaultImageModel || undefined,
        imageAspect: prefs.defaultImageAspect || '16:9',
        imageResolution: prefs.defaultImageResolution || '1K',
        imageCount: clampImageGenCount(prefs.canvasImageCount),
      }
    case 'video':
      return {
        videoModel: prefs.defaultVideoModel || undefined,
        videoSettings: {
          aspectRatio: prefs.defaultVideoAspect || '16:9',
          duration: prefs.defaultVideoDuration || 5,
          resolution: prefs.defaultVideoResolution || '720p',
          crop: prefs.defaultVideoCrop || 'none',
        },
      }
    case 'text':
    case 'prompt':
      return {
        textModel: prefs.defaultTextModel || undefined,
      }
    case 'audio':
      return {
        audioModel: prefs.defaultAudioModel || undefined,
        audioVoice: prefs.audioVoice || 'female-shaonv',
        audioFormat: prefs.audioFormat || 'mp3',
        audioSpeed: prefs.audioSpeed ?? 1,
        ...(prefs.audioInstructions ? { audioInstructions: prefs.audioInstructions } : {}),
      }
    default:
      return {}
  }
}

@Injectable()
export class AgentCanvasToolsService {
  /** Overridable in unit tests */
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StudioService) private readonly studio: StudioService,
  ) {}

  private async loadAccountGenPrefs(userId: string): Promise<AccountGenPrefs> {
    const row = await this.prisma.userAiPreferences.findUnique({ where: { userId } })
    if (!row) return { ...HARDCODE_PREFS }
    return {
      defaultImageModel: row.defaultImageModel || '',
      defaultVideoModel: row.defaultVideoModel || '',
      defaultTextModel: row.defaultTextModel || '',
      defaultAudioModel: row.defaultAudioModel || '',
      canvasImageCount: row.canvasImageCount ?? 1,
      defaultImageAspect: row.defaultImageAspect || '16:9',
      defaultImageResolution: row.defaultImageResolution || '1K',
      defaultVideoAspect: row.defaultVideoAspect || '16:9',
      defaultVideoDuration: row.defaultVideoDuration || 5,
      defaultVideoResolution: row.defaultVideoResolution || '720p',
      defaultVideoCrop: row.defaultVideoCrop || 'none',
      audioVoice: row.audioVoice || 'female-shaonv',
      audioFormat: row.audioFormat || 'mp3',
      audioSpeed: row.audioSpeed ?? 1,
      audioInstructions: row.audioInstructions ?? null,
    }
  }

  async upsertPromptNode(input: {
    sessionId: string
    userId: string
    nodeId?: string
    prompt: string
    content: string
    position?: { x: number; y: number }
  }): Promise<{ nodeId: string; actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const existing = input.nodeId
      ? canvas.nodes.find((n) => n.id === input.nodeId)
      : undefined

    if (existing) {
      const actions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: existing.id,
            data: { prompt: input.prompt, content: input.content, title: input.prompt },
          },
        },
      ]
      await this.persist(input.sessionId, actions)
      return { nodeId: existing.id, actions }
    }

    const nodeId = input.nodeId ?? nextNodeId('prompt')
    const col = canvas.nodes.length
    const position = input.position ?? { x: 80 + col * GRID_X, y: 80 }
    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: nodeId,
          nodeType: 'prompt',
          position,
          data: {
            prompt: input.prompt,
            content: input.content,
            title: input.prompt,
            status: 'draft',
          },
        },
      },
    ]
    await this.persist(input.sessionId, actions)
      return { nodeId, actions }
  }

  async getNode(input: { sessionId: string; nodeId: string }): Promise<CanvasNode> {
    const { canvas } = await this.loadSession(input.sessionId)
    const node = canvas.nodes.find((n) => n.id === input.nodeId)
    if (!node) throw new NotFoundException('节点不存在')
    return node
  }

  async getCanvasSummary(input: { sessionId: string }): Promise<{
    nodes: Array<{ id: string; type: string; title: string; status: string }>
  }> {
    const { canvas } = await this.loadSession(input.sessionId)
    return {
      nodes: canvas.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        title: nodeTitle(n),
        status: nodeStatus(n),
      })),
    }
  }

  async addNodesBatch(input: {
    sessionId: string
    userId: string
    items: Array<{
      key: string
      title: string
      targetType: NodeType | string
      prompt?: string
      position?: { x: number; y: number }
    }>
  }): Promise<{ nodes: Array<{ key: string; nodeId: string }>; actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const prefs = await this.loadAccountGenPrefs(input.userId)
    const actions: CanvasAction[] = []
    const mapping: Array<{ key: string; nodeId: string }> = []
    const baseIndex = canvas.nodes.length

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]
      const nodeType = (item.targetType || 'image') as NodeType
      const nodeId = nextNodeId(nodeType)
      const position =
        item.position ??
        {
          x: 80 + ((baseIndex + i) % 4) * GRID_X,
          y: 80 + Math.floor((baseIndex + i) / 4) * GRID_Y,
        }
      const defaults = modalityDefaults(nodeType, prefs)
      actions.push({
        type: 'add_node',
        payload: {
          id: nodeId,
          nodeType,
          position,
          data: {
            title: item.title,
            manifestKey: item.key,
            prompt: item.prompt ?? '',
            status: 'draft',
            ...defaults,
          },
        },
      })
      mapping.push({ key: item.key, nodeId })
    }

    await this.persist(input.sessionId, actions)
    return { nodes: mapping, actions }
  }

  async connectNodes(input: {
    sessionId: string
    edges: Array<{ source: string; target: string }>
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadSession(input.sessionId)
    const actions: CanvasAction[] = []
    const existing = new Set(canvas.edges.map((e) => `${e.source}->${e.target}`))

    for (const edge of input.edges) {
      const key = `${edge.source}->${edge.target}`
      if (existing.has(key)) continue
      existing.add(key)
      actions.push({
        type: 'add_edge',
        payload: {
          id: edgeId(edge.source, edge.target),
          source: edge.source,
          target: edge.target,
        },
      })
    }

    await this.persist(input.sessionId, actions)
    return { actions }
  }

  async setNodePrompt(input: {
    sessionId: string
    nodeId: string
    prompt: string
    title?: string
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadSession(input.sessionId)
    if (!canvas.nodes.some((n) => n.id === input.nodeId)) {
      throw new NotFoundException('节点不存在')
    }
    // P0 修复：modify 模式可选同时更新标题（改节点名，如「模特定妆」→「双人模特定妆」）
    const data: Record<string, unknown> = { prompt: input.prompt }
    if (typeof input.title === 'string' && input.title.trim()) {
      data.title = input.title.trim()
    }
    const actions: CanvasAction[] = [
      {
        type: 'update_node',
        payload: { id: input.nodeId, data },
      },
    ]
    await this.persist(input.sessionId, actions)
    return { actions }
  }

  async setNodeContent(input: {
    sessionId: string
    userId: string
    nodeId: string
    content: string
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    if (!canvas.nodes.some((n) => n.id === input.nodeId)) {
      throw new NotFoundException('节点不存在')
    }
    const actions: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: input.nodeId,
          data: { content: input.content, status: 'completed' },
        },
      },
    ]
    await this.persist(input.sessionId, actions)
    return { actions }
  }

  async attachRefs(input: {
    sessionId: string
    nodeId: string
    refOrder: string[]
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadSession(input.sessionId)
    if (!canvas.nodes.some((n) => n.id === input.nodeId)) {
      throw new NotFoundException('节点不存在')
    }

    const actions: CanvasAction[] = []
    const edgeIds: string[] = []
    const existing = new Set(canvas.edges.map((e) => `${e.source}->${e.target}`))

    for (const sourceId of input.refOrder) {
      const id = edgeId(sourceId, input.nodeId)
      edgeIds.push(id)
      const key = `${sourceId}->${input.nodeId}`
      if (existing.has(key)) continue
      existing.add(key)
      actions.push({
        type: 'add_edge',
        payload: { id, source: sourceId, target: input.nodeId },
      })
    }

    actions.push({
      type: 'update_node',
      payload: { id: input.nodeId, data: { refOrder: edgeIds } },
    })

    await this.persist(input.sessionId, actions)
    return { actions }
  }

  async runImageGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ url?: string; status: string; actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const node = canvas.nodes.find((n) => n.id === input.nodeId)
    if (!node) throw new NotFoundException('节点不存在')

    const prompt = String(node.data?.prompt ?? node.data?.content ?? '').trim()
    if (!prompt) throw new NotFoundException('节点缺少 prompt')

    const started: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: input.nodeId,
          data: {
            status: 'generating',
            generationStartedAt: new Date().toISOString(),
          },
        },
      },
    ]
    let current = await this.persist(input.sessionId, started)
    const allActions = [...started]

    try {
      const prefs = await this.loadAccountGenPrefs(input.userId)
      const refs = toStudioRefs(node, current)
      const aspectRatio = pickString(node.data?.imageAspect, prefs.defaultImageAspect || '16:9')
      const resolution = pickString(
        node.data?.imageResolution,
        prefs.defaultImageResolution || '1K',
      )
      const count = clampImageGenCount(
        node.data?.imageCount ?? prefs.canvasImageCount ?? 1,
      )
      const model = pickString(node.data?.imageModel, prefs.defaultImageModel) || undefined

      const record = await this.studio.generateImage(
        input.userId,
        prompt,
        model,
        aspectRatio,
        refs,
        undefined,
        resolution,
        count,
        { sessionId: input.sessionId, nodeId: input.nodeId },
      )

      const recordId = record.id
      allActions.push({
        type: 'update_node',
        payload: { id: input.nodeId, data: { generationRecordId: recordId } },
      })
      await this.persist(input.sessionId, [
        {
          type: 'update_node',
          payload: { id: input.nodeId, data: { generationRecordId: recordId } },
        },
      ])

      const terminal = await this.pollGeneration(input.userId, recordId, record)
      const status = String(terminal.status)
      const url = typeof terminal.url === 'string' && terminal.url ? terminal.url : undefined

      const finishData: Record<string, unknown> = {
        status:
          status === 'completed'
            ? 'completed'
            : status === 'failed' || status === 'error'
              ? 'error'
              : status,
        generationRecordId: recordId,
      }
      if (url) finishData.url = url
      if (status !== 'completed') {
        finishData.errorMessage = '图像生成未完成或超时'
      }

      const finishActions: CanvasAction[] = [
        { type: 'update_node', payload: { id: input.nodeId, data: finishData } },
      ]
      await this.persist(input.sessionId, finishActions)
      allActions.push(...finishActions)

      return {
        url,
        status: String(finishData.status),
        actions: allActions,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '图像生成失败'
      const errorActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: { status: 'error', errorMessage },
          },
        },
      ]
      await this.persist(input.sessionId, errorActions)
      allActions.push(...errorActions)
      return { status: 'error', actions: allActions }
    }
  }

  async runVideoGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ url?: string; status: string; actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const node = canvas.nodes.find((n) => n.id === input.nodeId)
    if (!node) throw new NotFoundException('节点不存在')

    const prompt = String(node.data?.prompt ?? node.data?.content ?? '').trim()
    if (!prompt) throw new NotFoundException('节点缺少 prompt')

    const started: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: input.nodeId,
          data: {
            status: 'generating',
            generationStartedAt: new Date().toISOString(),
          },
        },
      },
    ]
    let current = await this.persist(input.sessionId, started)
    const allActions = [...started]

    try {
      const prefs = await this.loadAccountGenPrefs(input.userId)
      const refs = toStudioRefs(node, current)
      const settings =
        node.data?.videoSettings && typeof node.data.videoSettings === 'object'
          ? (node.data.videoSettings as Record<string, unknown>)
          : {}
      const aspectRatio = pickString(
        settings.aspectRatio,
        prefs.defaultVideoAspect || '16:9',
      )
      const resolution = pickString(
        settings.resolution,
        prefs.defaultVideoResolution || '720p',
      )
      const crop = pickString(settings.crop, prefs.defaultVideoCrop || 'none')
      const durationRaw = settings.duration ?? prefs.defaultVideoDuration ?? 5
      const duration = typeof durationRaw === 'number' ? durationRaw : Number(durationRaw) || 5
      const model = pickString(node.data?.videoModel, prefs.defaultVideoModel) || undefined

      const record = await this.studio.generateVideo(
        input.userId,
        prompt,
        model,
        duration,
        aspectRatio,
        refs,
        undefined,
        resolution,
        crop,
        { sessionId: input.sessionId, nodeId: input.nodeId },
      )

      const recordId = record.id
      allActions.push({
        type: 'update_node',
        payload: { id: input.nodeId, data: { generationRecordId: recordId } },
      })
      await this.persist(input.sessionId, [
        {
          type: 'update_node',
          payload: { id: input.nodeId, data: { generationRecordId: recordId } },
        },
      ])

      const terminal = await this.pollGeneration(input.userId, recordId, record)
      const status = String(terminal.status)
      const url = typeof terminal.url === 'string' && terminal.url ? terminal.url : undefined

      const finishData: Record<string, unknown> = {
        status:
          status === 'completed'
            ? 'completed'
            : status === 'failed' || status === 'error'
              ? 'error'
              : status,
        generationRecordId: recordId,
      }
      if (url) finishData.url = url
      if (status !== 'completed') {
        finishData.errorMessage = '视频生成未完成或超时'
      }

      const finishActions: CanvasAction[] = [
        { type: 'update_node', payload: { id: input.nodeId, data: finishData } },
      ]
      await this.persist(input.sessionId, finishActions)
      allActions.push(...finishActions)

      return {
        url,
        status: String(finishData.status),
        actions: allActions,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '视频生成失败'
      const errorActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: { status: 'error', errorMessage },
          },
        },
      ]
      await this.persist(input.sessionId, errorActions)
      allActions.push(...errorActions)
      return { status: 'error', actions: allActions }
    }
  }

  async getGenerationStatus(input: {
    sessionId: string
    nodeId: string
  }): Promise<{ status: string; url?: string }> {
    const node = await this.getNode(input)
    const status = nodeStatus(node)
    const url = typeof node.data?.url === 'string' && node.data.url ? node.data.url : undefined
    return url ? { status, url } : { status }
  }

  async getAgentMessages(input: {
    sessionId: string
  }): Promise<Array<{ id: string; role: string; content: string; toolCalls?: string; createdAt: Date }>> {
    const messages = await this.prisma.agentMessage.findMany({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: 'asc' },
    })
    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls ?? undefined,
      createdAt: msg.createdAt,
    }))
  }

  async saveAgentMessage(input: {
    sessionId: string
    userId: string
    role: string
    content: string
    toolCalls?: string
  }): Promise<{ id: string }> {
    // Verify session ownership
    await this.loadOwnedSession(input.sessionId, input.userId)

    const message = await this.prisma.agentMessage.create({
      data: {
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        toolCalls: input.toolCalls,
      },
    })
    return { id: message.id }
  }

  /**
   * Acquire a distributed lock for a thread.
   * Returns true if lock acquired, false if already locked by another holder.
   * Automatically cleans up expired locks.
   */
  async acquireThreadLock(input: {
    threadId: string
    holderId: string
    ttlSeconds: number
  }): Promise<{ acquired: boolean }> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)

    // Clean up expired locks for this thread
    await this.prisma.threadLock.deleteMany({
      where: {
        threadId: input.threadId,
        leaseExpiresAt: { lt: now },
      },
    })

    // Try to acquire the lock
    try {
      await this.prisma.threadLock.create({
        data: {
          threadId: input.threadId,
          leaseHolder: input.holderId,
          leaseExpiresAt: expiresAt,
        },
      })
      return { acquired: true }
    } catch {
      // Lock already exists - check if we hold it
      const existing = await this.prisma.threadLock.findUnique({
        where: { threadId: input.threadId },
      })
      if (existing && existing.leaseHolder === input.holderId) {
        // We already hold it - renew
        await this.prisma.threadLock.update({
          where: { threadId: input.threadId },
          data: { leaseExpiresAt: expiresAt },
        })
        return { acquired: true }
      }
      return { acquired: false }
    }
  }

  /**
   * Renew an existing lock. Returns false if lock doesn't exist or held by another holder.
   */
  async renewThreadLock(input: {
    threadId: string
    holderId: string
    ttlSeconds: number
  }): Promise<{ renewed: boolean }> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)

    const existing = await this.prisma.threadLock.findUnique({
      where: { threadId: input.threadId },
    })

    if (!existing) {
      return { renewed: false }
    }

    // Check if lock expired
    if (existing.leaseExpiresAt < now) {
      // Delete expired lock
      await this.prisma.threadLock.delete({
        where: { threadId: input.threadId },
      })
      return { renewed: false }
    }

    // Check if we hold the lock
    if (existing.leaseHolder !== input.holderId) {
      return { renewed: false }
    }

    // Renew the lock
    await this.prisma.threadLock.update({
      where: { threadId: input.threadId },
      data: { leaseExpiresAt: expiresAt },
    })
    return { renewed: true }
  }

  /**
   * Release a lock. Safe to call even if lock doesn't exist.
   */
  async releaseThreadLock(input: {
    threadId: string
    holderId: string
  }): Promise<{ released: boolean }> {
    const existing = await this.prisma.threadLock.findUnique({
      where: { threadId: input.threadId },
    })

    if (!existing) {
      return { released: false }
    }

    // Only release if we hold the lock
    if (existing.leaseHolder !== input.holderId) {
      return { released: false }
    }

    await this.prisma.threadLock.delete({
      where: { threadId: input.threadId },
    })
    return { released: true }
  }

  private async pollGeneration(
    userId: string,
    recordId: string,
    initial: { id: string; status: string; url?: string | null },
  ): Promise<{ id: string; status: string; url?: string | null }> {
    const terminal = new Set(['completed', 'failed', 'error', 'fallback_pending'])
    if (terminal.has(initial.status)) return initial

    const deadline = Date.now() + this.pollTimeoutMs
    let latest = initial
    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs)
      latest = await this.studio.getGeneration(userId, recordId)
      if (terminal.has(latest.status)) return latest
    }
    return { ...latest, status: latest.status === 'generating' ? 'timeout' : latest.status }
  }

  private async loadSession(sessionId: string): Promise<{
    id: string
    userId: string
    canvas: CanvasData
  }> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('会话不存在')
    return {
      id: session.id,
      userId: session.userId,
      canvas: parseCanvas(session.canvasData),
    }
  }

  private async loadOwnedSession(
    sessionId: string,
    userId: string,
  ): Promise<{ id: string; userId: string; canvas: CanvasData }> {
    const session = await this.loadSession(sessionId)
    if (session.userId !== userId) throw new ForbiddenException()
    return session
  }

  /**
   * Atomic canvas patch — re-reads canvasData inside a Prisma transaction so
   * concurrent calls on the same session never lose each other's updates.
   *
   * Caller MUST NOT rely on the in-memory `canvas` it loaded earlier; pass only
   * the actions. The returned `CanvasData` is the post-apply snapshot (== DB
   * state right after this call), safe to consume for downstream computations
   * such as `toStudioRefs`.
   *
   * Concurrency contract: under N concurrent `persist` calls on the same
   * session, every action lands in DB exactly once; final canvas = the
   * sequential composition of all N action lists.
   */
  private async persist(
    sessionId: string,
    actions: CanvasAction[],
  ): Promise<CanvasData> {
    if (actions.length === 0) {
      // Dedup-to-empty fast path (e.g. connectNodes with all edges already
      // present). Skip the transaction and just return the current canvas.
      const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
      if (!session) throw new NotFoundException('会话不存在')
      return parseCanvas(session.canvasData)
    }
    return this.prisma.$transaction(async (tx) => {
      // Re-read inside the TX so concurrent persist() calls compose correctly
      // rather than clobbering each other with stale in-memory snapshots.
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { canvasData: true },
      })
      if (!session) throw new NotFoundException('会话不存在')
      const current = parseCanvas(session.canvasData)
      const updated = applyCanvasActions(current, actions)
      await tx.session.update({
        where: { id: sessionId },
        data: { canvasData: JSON.stringify(updated) },
      })
      return updated
    })
  }
}
