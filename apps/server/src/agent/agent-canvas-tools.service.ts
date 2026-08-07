import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { applyCanvasActions } from '@lnkpi/agent'
import {
  resolveNodeRefs,
  summarizePromptCompletion,
  type CanvasAction,
  type CanvasData,
  type CanvasNode,
  type LocalRefBinding,
  type NodeType,
  type SidebarAttachment,
  validateSidebarAttachments,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { StudioService, type StudioRefInput } from '../studio/studio.service'

const GRID_X = 280
const GRID_Y = 220
const DEFAULT_POLL_INTERVAL_MS = 1500
const DEFAULT_POLL_TIMEOUT_MS = 180_000
const STAGE_TTL_MS = 30 * 60 * 1000

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

function parseStagedActions(raw: string | null | undefined): CanvasAction[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CanvasAction[]) : []
  } catch {
    return []
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

function parseRecordText(metadata: string | null | undefined, prompt: string): string {
  if (!metadata) return prompt
  try {
    const meta = JSON.parse(metadata) as { text?: string }
    return meta.text ?? prompt
  } catch {
    return prompt
  }
}

function parseRecordPromptContent(
  metadata: string | null | undefined,
  prompt: string,
): { content: string; mode: string | null } {
  if (!metadata) return { content: prompt, mode: null }
  try {
    const meta = JSON.parse(metadata) as { content?: string; mode?: string; text?: string }
    return {
      content: meta.content ?? meta.text ?? prompt,
      mode: meta.mode ?? null,
    }
  } catch {
    return { content: prompt, mode: null }
  }
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
    stage?: boolean
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
      await this.applyOrStage(input.sessionId, actions, input.stage)
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
    await this.applyOrStage(input.sessionId, actions, input.stage)
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
      pipeline?: string
      imageAspect?: string
    }>
    stage?: boolean
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
      const nodeData: Record<string, unknown> = {
        title: item.title,
        manifestKey: item.key,
        prompt: item.prompt ?? '',
        status: 'draft',
        ...defaults,
      }
      if (item.pipeline) nodeData.pipeline = item.pipeline
      if (item.imageAspect) nodeData.imageAspect = item.imageAspect
      actions.push({
        type: 'add_node',
        payload: {
          id: nodeId,
          nodeType,
          position,
          data: nodeData,
        },
      })
      mapping.push({ key: item.key, nodeId })
    }

    await this.applyOrStage(input.sessionId, actions, input.stage)
    return { nodes: mapping, actions }
  }

  async connectNodes(input: {
    sessionId: string
    edges: Array<{ source: string; target: string }>
    stage?: boolean
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

    await this.applyOrStage(input.sessionId, actions, input.stage)
    return { actions }
  }

  /**
   * W31: Remove nodes and their associated edges from canvas.
   */
  async removeNodes(input: {
    sessionId: string
    nodeIds: string[]
    stage?: boolean
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadSession(input.sessionId)
    const actions: CanvasAction[] = []

    // Remove edges connected to deleted nodes
    for (const nodeId of input.nodeIds) {
      for (const edge of canvas.edges) {
        if (edge.source === nodeId || edge.target === nodeId) {
          actions.push({
            type: 'remove_edge',
            payload: { id: edge.id },
          })
        }
      }
      // Remove the node
      actions.push({
        type: 'remove_node',
        payload: { id: nodeId },
      })
    }

    await this.applyOrStage(input.sessionId, actions, input.stage)
    return { actions }
  }

  /**
   * W32: Remove edges from canvas.
   */
  async removeEdges(input: {
    sessionId: string
    edgeIds: string[]
    stage?: boolean
  }): Promise<{ actions: CanvasAction[] }> {
    const { canvas } = await this.loadSession(input.sessionId)
    const actions: CanvasAction[] = []

    for (const edgeId of input.edgeIds) {
      // Verify edge exists
      if (!canvas.edges.some((e) => e.id === edgeId)) {
        continue // Skip non-existent edges
      }
      actions.push({
        type: 'remove_edge',
        payload: { id: edgeId },
      })
    }

    await this.applyOrStage(input.sessionId, actions, input.stage)
    return { actions }
  }

  async setNodePrompt(input: {
    sessionId: string
    nodeId: string
    prompt: string
    title?: string
    stage?: boolean
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
    await this.applyOrStage(input.sessionId, actions, input.stage)
    return { actions }
  }

  async setNodeContent(input: {
    sessionId: string
    userId: string
    nodeId: string
    content: string
    stage?: boolean
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
    await this.applyOrStage(input.sessionId, actions, input.stage)
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

  async applySidebarAttachments(input: {
    sessionId: string
    nodeIds: string[]
    attachments: SidebarAttachment[]
    refOrder?: string[]
    mode: 'localRefs' | 'attach_edges'
  }): Promise<{ actions: CanvasAction[]; sourceNodeIds: string[] }> {
    validateSidebarAttachments(input.attachments)
    const order = input.refOrder?.length
      ? input.refOrder
      : input.attachments.map((a) => a.id)

    if (input.mode === 'localRefs') {
      const localRefs: LocalRefBinding[] = input.attachments
        .filter((a) => a.sourceKind !== 'canvasNode')
        .map((a) => ({
          id: a.id,
          mediaType: a.mediaType,
          sourceKind: a.sourceKind === 'asset' ? 'asset' : 'upload',
          label: a.label,
          url: a.url,
          text: a.text,
        }))
      const actions: CanvasAction[] = input.nodeIds.map((nodeId) => ({
        type: 'update_node',
        payload: { id: nodeId, data: { localRefs, refOrder: order } },
      }))
      await this.persist(input.sessionId, actions)
      return { actions, sourceNodeIds: [] }
    }

    // attach_edges mode — stub for Task 11; return empty for now
    return { actions: [], sourceNodeIds: [] }
  }

  async startImageGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ generationRecordId: string; status: string; actions: CanvasAction[] }> {
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

    const prefs = await this.loadAccountGenPrefs(input.userId)
    const refs = toStudioRefs(node, current)
    const pipeline = String(node.data?.pipeline ?? '').trim()
    let imagePrompt = prompt
    let aspectRatio = pickString(node.data?.imageAspect, prefs.defaultImageAspect || '16:9')
    let resolution = pickString(
      node.data?.imageResolution,
      prefs.defaultImageResolution || '1K',
    )
    const count = clampImageGenCount(
      node.data?.imageCount ?? prefs.canvasImageCount ?? 1,
    )
    const model = pickString(node.data?.imageModel, prefs.defaultImageModel) || undefined

    if (pipeline === 'turnaround_image') {
      const textModel = pickString(node.data?.textModel, prefs.defaultTextModel) || undefined
      const expanded = await this.studio.expandPromptContent(input.userId, prompt, textModel)
      imagePrompt = expanded.content
      aspectRatio = '2:1'
      const userResolution = pickString(
        node.data?.imageResolution,
        prefs.defaultImageResolution || '1K',
      )
      const bumpedResolution = userResolution === '1K' ? '2K' : userResolution
      if (bumpedResolution !== userResolution) {
        resolution = bumpedResolution
      }
      const expandActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: {
              expandedPrompt: expanded.content,
              content: expanded.content,
              promptMode: expanded.mode,
              pipeline,
              imageAspect: aspectRatio,
              imageResolution: resolution,
              ...(bumpedResolution !== userResolution ? { resolutionBump: true } : {}),
            },
          },
        },
      ]
      await this.persist(input.sessionId, expandActions)
      allActions.push(...expandActions)
    }

    const record = await this.studio.generateImage(
      input.userId,
      imagePrompt,
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

    return {
      generationRecordId: recordId,
      status: 'generating',
      actions: allActions,
    }
  }

  async waitImageGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
    generationRecordId: string
  }): Promise<{ url?: string; status: string; generationRecordId: string; actions: CanvasAction[] }> {
    const recordId = input.generationRecordId
    const allActions: CanvasAction[] = []

    try {
      const initial = await this.studio.getGeneration(input.userId, recordId)
      const terminal = await this.pollGeneration(input.userId, recordId, initial)
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
        generationRecordId: recordId,
        actions: allActions,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '图像生成失败'
      const errorActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: { status: 'error', errorMessage, generationRecordId: recordId },
          },
        },
      ]
      await this.persist(input.sessionId, errorActions)
      allActions.push(...errorActions)
      return { status: 'error', generationRecordId: recordId, actions: allActions }
    }
  }

  async runImageGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ url?: string; status: string; generationRecordId?: string; actions: CanvasAction[] }> {
    try {
      const started = await this.startImageGeneration(input)
      const finished = await this.waitImageGeneration({
        ...input,
        generationRecordId: started.generationRecordId,
      })
      return {
        ...finished,
        actions: [...started.actions, ...finished.actions],
      }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) throw err
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
      return { status: 'error', actions: errorActions }
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

  async runTextGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ status: string; generationRecordId?: string; actions: CanvasAction[] }> {
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
            prompt,
          },
        },
      },
    ]
    await this.persist(input.sessionId, started)
    const allActions = [...started]

    try {
      const prefs = await this.loadAccountGenPrefs(input.userId)
      const refs = toStudioRefs(node, canvas)
      const model = pickString(node.data?.textModel, prefs.defaultTextModel) || undefined
      const record = await this.studio.generateText(
        input.userId,
        prompt,
        model,
        refs,
        undefined,
        undefined,
        node.data?.textThinking === true,
        node.data?.textThinkingEffort === 'max' ? 'max' : 'high',
        { sessionId: input.sessionId, nodeId: input.nodeId },
      )
      const recordId = record.id
      const content = parseRecordText(record.metadata, prompt)
      const finishActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: {
              status: 'completed',
              content,
              generationRecordId: recordId,
              errorMessage: null,
            },
          },
        },
      ]
      await this.persist(input.sessionId, finishActions)
      allActions.push(...finishActions)
      return { status: 'completed', generationRecordId: recordId, actions: allActions }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) throw err
      const errorMessage = err instanceof Error ? err.message : '文本生成失败'
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

  async runPromptGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{
    status: string
    generationRecordId?: string
    actions: CanvasAction[]
    promptMode?: string | null
    completionSummary?: string
  }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const node = canvas.nodes.find((n) => n.id === input.nodeId)
    if (!node) throw new NotFoundException('节点不存在')

    const prompt = String(node.data?.prompt ?? '').trim()
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
    await this.persist(input.sessionId, started)
    const allActions = [...started]

    try {
      const prefs = await this.loadAccountGenPrefs(input.userId)
      const model = pickString(node.data?.textModel, prefs.defaultTextModel) || undefined
      const record = await this.studio.generatePrompt(
        input.userId,
        prompt,
        model,
        undefined,
        { sessionId: input.sessionId, nodeId: input.nodeId },
      )
      const recordId = record.id
      const parsed = parseRecordPromptContent(record.metadata, prompt)
      const finishData: Record<string, unknown> = {
        status: 'completed',
        content: parsed.content,
        generationRecordId: recordId,
        errorMessage: null,
      }
      if (parsed.mode) finishData.promptMode = parsed.mode
      const finishActions: CanvasAction[] = [
        { type: 'update_node', payload: { id: input.nodeId, data: finishData } },
      ]
      await this.persist(input.sessionId, finishActions)
      allActions.push(...finishActions)
      const completionSummary = summarizePromptCompletion(parsed.mode, parsed.content)
      return {
        status: 'completed',
        generationRecordId: recordId,
        actions: allActions,
        promptMode: parsed.mode,
        completionSummary: completionSummary ?? undefined,
      }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) throw err
      const errorMessage = err instanceof Error ? err.message : '提示词生成失败'
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

  async runAudioGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ url?: string; status: string; generationRecordId?: string; actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const node = canvas.nodes.find((n) => n.id === input.nodeId)
    if (!node) throw new NotFoundException('节点不存在')

    const text = String(node.data?.prompt ?? node.data?.content ?? '').trim()
    if (!text) throw new NotFoundException('节点缺少文本')

    const started: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: input.nodeId,
          data: {
            status: 'generating',
            generationStartedAt: new Date().toISOString(),
            prompt: text,
          },
        },
      },
    ]
    await this.persist(input.sessionId, started)
    const allActions = [...started]

    try {
      const prefs = await this.loadAccountGenPrefs(input.userId)
      const refs = toStudioRefs(node, canvas)
      const record = await this.studio.generateAudio(
        input.userId,
        text,
        {
          model: pickString(node.data?.audioModel, prefs.defaultAudioModel) || undefined,
          voice: pickString(node.data?.audioVoice, prefs.audioVoice || 'female-shaonv'),
          emotion: pickString(node.data?.audioEmotion, 'neutral'),
          language: pickString(node.data?.audioLanguage, 'zh'),
          speed: typeof node.data?.audioSpeed === 'number' ? node.data.audioSpeed : prefs.audioSpeed ?? 1,
          volume: typeof node.data?.audioVolume === 'number' ? node.data.audioVolume : 1,
          pitch: typeof node.data?.audioPitch === 'number' ? node.data.audioPitch : 0,
        },
        refs,
        undefined,
        undefined,
        { sessionId: input.sessionId, nodeId: input.nodeId },
      )
      const recordId = record.id
      const url = typeof record.url === 'string' && record.url ? record.url : undefined
      const finishActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: {
              status: 'completed',
              url,
              generationRecordId: recordId,
              errorMessage: null,
            },
          },
        },
      ]
      await this.persist(input.sessionId, finishActions)
      allActions.push(...finishActions)
      return { url, status: 'completed', generationRecordId: recordId, actions: allActions }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) throw err
      const errorMessage = err instanceof Error ? err.message : '音频生成失败'
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

  /**
   * W15: Get generation progress from GenProgress table
   */
  async getGenProgress(input: { threadId: string }): Promise<{
    id: string
    lines: string
    summary: string | null
  } | null> {
    const record = await this.prisma.genProgress.findFirst({
      where: { threadId: input.threadId },
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      return null
    }

    return {
      id: record.id,
      lines: record.lines,
      summary: record.summary,
    }
  }

  /**
   * W15: Save generation progress to GenProgress table
   */
  async saveGenProgress(input: {
    threadId: string
    sessionId: string
    lines: string
    summary?: string | null
  }): Promise<{ id: string }> {
    const record = await this.prisma.genProgress.create({
      data: {
        threadId: input.threadId,
        sessionId: input.sessionId,
        lines: input.lines,
        summary: input.summary ?? null,
      },
    })
    return { id: record.id }
  }

  /**
   * W18: Get latest context snapshot for a thread
   */
  async getContextSnapshot(input: {
    threadId: string
    stage?: string
  }): Promise<{
    id: string
    stage: string
    brief: string | null
    planSummary: string | null
    manifestJson: string | null
    messageCount: number | null
  } | null> {
    const where: { threadId: string; stage?: string } = { threadId: input.threadId }
    if (input.stage) {
      where.stage = input.stage
    }

    const record = await this.prisma.contextSnapshot.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      return null
    }

    return {
      id: record.id,
      stage: record.stage,
      brief: record.brief,
      planSummary: record.planSummary,
      manifestJson: record.manifestJson,
      messageCount: record.messageCount,
    }
  }

  /**
   * W18: Save context snapshot (brief/plan/manifest summaries)
   */
  async saveContextSnapshot(input: {
    threadId: string
    sessionId: string
    stage: string
    brief?: string | null
    planSummary?: string | null
    manifestJson?: string | null
    messageCount?: number | null
  }): Promise<{ id: string }> {
    const record = await this.prisma.contextSnapshot.create({
      data: {
        threadId: input.threadId,
        sessionId: input.sessionId,
        stage: input.stage,
        brief: input.brief ?? null,
        planSummary: input.planSummary ?? null,
        manifestJson: input.manifestJson ?? null,
        messageCount: input.messageCount ?? null,
      },
    })
    return { id: record.id }
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
   * W8: Accumulate canvas actions in stagedActions without applying to canvasData.
   */
  async stageCanvasActions(input: {
    sessionId: string
    actions: CanvasAction[]
  }): Promise<{ stagedCount: number }> {
    if (input.actions.length === 0) {
      const session = await this.prisma.session.findUnique({ where: { id: input.sessionId } })
      if (!session) throw new NotFoundException('会话不存在')
      const staged = parseStagedActions(session.stagedActions)
      return { stagedCount: staged.length }
    }
    await this.expireStaleStage(input.sessionId)
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { stagedActions: true },
      })
      if (!session) throw new NotFoundException('会话不存在')
      const merged = [...parseStagedActions(session.stagedActions), ...input.actions]
      await tx.session.update({
        where: { id: input.sessionId },
        data: { stagedActions: JSON.stringify(merged), stagedAt: now },
      })
    })
    return { stagedCount: input.actions.length }
  }

  /** W8: Apply staged actions atomically and clear the stage. */
  async commitStage(input: { sessionId: string }): Promise<{ actions: CanvasAction[] }> {
    await this.expireStaleStage(input.sessionId)
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { canvasData: true, stagedActions: true },
      })
      if (!session) throw new NotFoundException('会话不存在')
      const staged = parseStagedActions(session.stagedActions)
      if (staged.length === 0) return { actions: [] }
      const current = parseCanvas(session.canvasData)
      const updated = applyCanvasActions(current, staged)
      await tx.session.update({
        where: { id: input.sessionId },
        data: {
          canvasData: JSON.stringify(updated),
          stagedActions: null,
          stagedAt: null,
        },
      })
      return { actions: staged }
    })
  }

  /** W8: Discard staged actions without touching canvasData. */
  async rollbackStage(input: { sessionId: string }): Promise<{ cleared: boolean }> {
    const session = await this.prisma.session.findUnique({
      where: { id: input.sessionId },
      select: { stagedActions: true },
    })
    if (!session) throw new NotFoundException('会话不存在')
    if (!session.stagedActions) return { cleared: false }
    await this.prisma.session.update({
      where: { id: input.sessionId },
      data: { stagedActions: null, stagedAt: null },
    })
    return { cleared: true }
  }

  private async expireStaleStage(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { stagedActions: true, stagedAt: true },
    })
    if (!session?.stagedActions || !session.stagedAt) return
    if (Date.now() - session.stagedAt.getTime() <= STAGE_TTL_MS) return
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { stagedActions: null, stagedAt: null },
    })
  }

  private async applyOrStage(
    sessionId: string,
    actions: CanvasAction[],
    stage?: boolean,
  ): Promise<void> {
    if (actions.length === 0) return
    if (stage) {
      await this.stageCanvasActions({ sessionId, actions })
      return
    }
    await this.persist(sessionId, actions)
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
    await this.expireStaleStage(sessionId)
    if (actions.length === 0) {
      // Dedup-to-empty fast path (e.g. connectNodes with all edges already
      // present). Skip the transaction and just return the current canvas.
      const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
      if (!session) throw new NotFoundException('会话不存在')
      return parseCanvas(session.canvasData)
    }
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { canvasData: true, stagedActions: true },
      })
      if (!session) throw new NotFoundException('会话不存在')
      if (session.stagedActions) {
        throw new ConflictException(
          'Canvas has staged actions pending commit; call commitStage or rollbackStage first',
        )
      }
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
