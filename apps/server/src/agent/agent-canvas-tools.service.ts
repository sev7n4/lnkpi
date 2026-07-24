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

@Injectable()
export class AgentCanvasToolsService {
  /** Overridable in unit tests */
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StudioService) private readonly studio: StudioService,
  ) {}

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
      await this.persist(input.sessionId, canvas, actions)
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
    await this.persist(input.sessionId, canvas, actions)
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
          },
        },
      })
      mapping.push({ key: item.key, nodeId })
    }

    await this.persist(input.sessionId, canvas, actions)
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

    await this.persist(input.sessionId, canvas, actions)
    return { actions }
  }

  async setNodePrompt(input: {
    sessionId: string
    nodeId: string
    prompt: string
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadSession(input.sessionId)
    if (!canvas.nodes.some((n) => n.id === input.nodeId)) {
      throw new NotFoundException('节点不存在')
    }
    const actions: CanvasAction[] = [
      {
        type: 'update_node',
        payload: { id: input.nodeId, data: { prompt: input.prompt } },
      },
    ]
    await this.persist(input.sessionId, canvas, actions)
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

    await this.persist(input.sessionId, canvas, actions)
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
    let current = await this.persist(input.sessionId, canvas, started)
    const allActions = [...started]

    try {
      const refs = toStudioRefs(node, current)
      const aspectRatio = String(node.data?.imageAspect ?? '16:9')
      const resolution = String(node.data?.imageResolution ?? '1K')
      const count = Number(node.data?.imageCount ?? 1)
      const model =
        typeof node.data?.imageModel === 'string' ? (node.data.imageModel as string) : undefined

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
      current = await this.persist(input.sessionId, current, [
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
      await this.persist(input.sessionId, current, finishActions)
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
      await this.persist(input.sessionId, current, errorActions)
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

  private async persist(
    sessionId: string,
    canvas: CanvasData,
    actions: CanvasAction[],
  ): Promise<CanvasData> {
    if (actions.length === 0) return canvas
    const updated = applyCanvasActions(canvas, actions)
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { canvasData: JSON.stringify(updated) },
    })
    return updated
  }
}
