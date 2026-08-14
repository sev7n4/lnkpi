import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { applyCanvasActions, parseVisionQaJson } from '@lnkpi/agent'
import {
  resolveNodeRefs,
  resolveCanonicalVideoRequest,
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
import { PUBLIC_ASSETS } from '../assets/public-assets.data'
import { MaterialService } from '../canvas/material.service'
import { sanitizeAgentMessageContent } from './agentMessageSanitize'
import { StudioService, type StudioRefInput } from '../studio/studio.service'
import { VideoGenerationOrchestrator } from '../studio/video-generation.orchestrator'
import {
  applyLayoutOps,
  createGroupFromNodes,
  getAbsolutePosition,
  getNodeSize,
  layoutNodesInGrid,
  moveNodes,
  summarizeLayoutGroups,
  type CanvasLayoutOp,
  type CanvasLayoutOpResult,
  type LayoutNode,
  ungroupNode,
} from './canvas-layout.util'

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

function nodeToAgentAttachment(node: CanvasNode): SidebarAttachment | null {
  const data = node.data ?? {}
  const url = String(data.url ?? '').trim()
  const text = String(data.content ?? data.prompt ?? '').trim()
  if (!url && !text) return null

  const t = String(node.type ?? '')
  let mediaType: SidebarAttachment['mediaType'] = 'image'
  if (t === 'text' || t === 'prompt') mediaType = 'text'
  else if (t === 'video') mediaType = 'video'
  else if (t === 'audio') mediaType = 'audio'
  else if (t === 'image' || t === 'mediaInput') mediaType = 'image'
  else if (text && !url) mediaType = 'text'
  else if (!url) return null

  return {
    id: `agent-ref-${node.id}`,
    mediaType,
    sourceKind: 'canvasNode',
    label: nodeTitle(node) || node.id,
    url: url || undefined,
    text: text || undefined,
    sourceNodeId: node.id,
  }
}

function assetKindFromNodeType(type: string): 'image' | 'video' | 'audio' | null {
  if (type === 'image' || type === 'mediaInput') return 'image'
  if (type === 'video') return 'video'
  if (type === 'audio') return 'audio'
  return null
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

function pickVisionQaModelFromCanvas(canvas: CanvasData, fallback: string): string | undefined {
  for (const node of canvas.nodes ?? []) {
    if (node.type !== 'text' && node.type !== 'prompt') continue
    const refs = (node.data?.localRefs as LocalRefBinding[] | undefined) ?? []
    const hasImageRef = refs.some((r) => r.mediaType === 'image')
    if (!hasImageRef) continue
    const model = pickString(node.data?.textModel, '')
    if (model) return model
  }
  return fallback || undefined
}

function parseVisionQaResponse(raw: string): {
  pass: boolean
  reason: string
  productSummary?: string
  isWhiteBg?: boolean
  isSharpEnough?: boolean
  productIdentifiable?: boolean
} {
  const parsed = parseVisionQaJson(raw)
  return {
    pass: parsed.pass,
    reason: parsed.reason,
    productSummary: parsed.productSummary,
    isWhiteBg: parsed.isWhiteBg,
    isSharpEnough: parsed.isSharpEnough,
    productIdentifiable: parsed.productIdentifiable,
  }
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
    @Inject(MaterialService) private readonly material: MaterialService,
    @Inject(VideoGenerationOrchestrator) private readonly videoOrchestrator: VideoGenerationOrchestrator,
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
      videoSettings?: {
        aspectRatio?: string
        duration?: number
        resolution?: string
        crop?: string
        generateAudio?: boolean
      }
      videoMode?: string
      referenceImageUrl?: string
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
      if (item.videoSettings && typeof item.videoSettings === 'object') {
        const base =
          nodeData.videoSettings && typeof nodeData.videoSettings === 'object'
            ? (nodeData.videoSettings as Record<string, unknown>)
            : {}
        nodeData.videoSettings = { ...base, ...item.videoSettings }
      }
      if (item.videoMode) nodeData.videoMode = item.videoMode
      if (item.referenceImageUrl) nodeData.referenceImageUrl = item.referenceImageUrl
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
    mentionedKeys?: string[]
  }): Promise<{ actions: CanvasAction[]; sourceNodeIds: string[] }> {
    validateSidebarAttachments(input.attachments)
    const order = input.refOrder?.length
      ? input.refOrder
      : input.attachments.map((a) => a.id)

    if (input.mode === 'localRefs') {
      const localRefs: LocalRefBinding[] = input.attachments
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
        payload: {
          id: nodeId,
          data: {
            localRefs,
            refOrder: order,
            ...(input.mentionedKeys?.length ? { mentionedKeys: input.mentionedKeys } : {}),
          },
        },
      }))
      await this.persist(input.sessionId, actions)
      return { actions, sourceNodeIds: [] }
    }

    const { canvas } = await this.loadSession(input.sessionId)
    const actions: CanvasAction[] = []
    const sourceByAttachmentId = new Map<string, string>()
    const baseIndex = canvas.nodes.length

    for (const attachment of input.attachments) {
      if (attachment.sourceKind === 'canvasNode' && attachment.sourceNodeId?.trim()) {
        sourceByAttachmentId.set(attachment.id, attachment.sourceNodeId)
        continue
      }

      const nodeType = attachment.mediaType === 'text' ? 'text' : 'mediaInput'
      const nodeId = nextNodeId(nodeType)
      const positionIndex = baseIndex + actions.length
      const position = {
        x: 80 + (positionIndex % 4) * GRID_X,
        y: 80 + Math.floor(positionIndex / 4) * GRID_Y,
      }
      const data: Record<string, unknown> =
        attachment.mediaType === 'text'
          ? {
              title: attachment.label,
              content: attachment.text ?? '',
              prompt: attachment.text ?? '',
              status: 'completed',
            }
          : {
              title: attachment.label,
              url: attachment.url ?? '',
              mediaKind: attachment.mediaType,
              status: 'completed',
            }

      actions.push({
        type: 'add_node',
        payload: {
          id: nodeId,
          nodeType: nodeType as NodeType,
          position,
          data,
        },
      })
      sourceByAttachmentId.set(attachment.id, nodeId)
    }

    const orderedAttachmentIds = [
      ...order,
      ...input.attachments.map((attachment) => attachment.id).filter((id) => !order.includes(id)),
    ]
    const sourceNodeIds = orderedAttachmentIds
      .map((attachmentId) => sourceByAttachmentId.get(attachmentId))
      .filter((nodeId): nodeId is string => Boolean(nodeId))

    if (actions.length) {
      await this.persist(input.sessionId, actions)
    }
    return { actions, sourceNodeIds }
  }

  async updateNodesBatch(input: {
    sessionId: string
    items: Array<{ nodeId: string; patch: Record<string, unknown> }>
  }): Promise<{ actions: CanvasAction[] }> {
    const actions: CanvasAction[] = input.items.map((item) => ({
      type: 'update_node',
      payload: { id: item.nodeId, data: item.patch },
    }))
    await this.persist(input.sessionId, actions)
    return { actions }
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

    const mentionedKeys = Array.isArray(node.data?.mentionedKeys)
      ? (node.data.mentionedKeys as string[])
      : undefined
    const record = await this.studio.generateImage(
      input.userId,
      imagePrompt,
      model,
      aspectRatio,
      refs,
      mentionedKeys?.length ? mentionedKeys : undefined,
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

  async startVideoGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ generationRecordId: string; status: string; actions: CanvasAction[] }> {
    const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
    const node = canvas.nodes.find((n) => n.id === input.nodeId)
    if (!node) throw new NotFoundException('节点不存在')

    const prefs = await this.loadAccountGenPrefs(input.userId)
    const request = resolveCanonicalVideoRequest({
      node,
      canvas,
      sessionId: input.sessionId,
      accountDefaults: {
        model: prefs.defaultVideoModel || undefined,
        duration: prefs.defaultVideoDuration,
        aspectRatio: prefs.defaultVideoAspect,
        resolution: prefs.defaultVideoResolution,
        crop: prefs.defaultVideoCrop,
      },
    })
    if (!request.prompt) throw new NotFoundException('节点缺少 prompt')

    const legacyUrl = String(node.data?.referenceImageUrl ?? '').trim() || undefined
    return this.videoOrchestrator.start(
      input.userId,
      request,
      (actions) => this.persist(input.sessionId, actions),
      legacyUrl,
    )
  }

  async waitVideoGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
    generationRecordId: string
  }): Promise<{ url?: string; status: string; generationRecordId: string; actions: CanvasAction[] }> {
    return this.videoOrchestrator.wait(
      input.userId,
      {
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        generationRecordId: input.generationRecordId,
      },
      (actions) => this.persist(input.sessionId, actions),
    )
  }

  async runVideoGeneration(input: {
    sessionId: string
    userId: string
    nodeId: string
  }): Promise<{ url?: string; status: string; generationRecordId?: string; actions: CanvasAction[] }> {
    try {
      const started = await this.startVideoGeneration(input)
      const finished = await this.waitVideoGeneration({
        ...input,
        generationRecordId: started.generationRecordId,
      })
      return {
        ...finished,
        actions: [...started.actions, ...finished.actions],
      }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) throw err
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
      return { status: 'error', actions: errorActions }
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
  }): Promise<{
    status: string
    url?: string
    generationRecordId?: string
    materialId?: string
    recordKind?: 'studio' | 'material'
  }> {
    const node = await this.getNode(input)
    const status = nodeStatus(node)
    const url = typeof node.data?.url === 'string' && node.data.url ? node.data.url : undefined
    const generationRecordId = this.generationRecordIdFromNode(node)
    const materialId = this.materialIdFromNode(node)
    const recordKind = generationRecordId ? 'studio' : materialId ? 'material' : undefined
    return {
      status,
      url,
      generationRecordId,
      materialId,
      recordKind,
    }
  }

  private generationRecordIdFromNode(node: CanvasNode): string | undefined {
    const id = node.data?.generationRecordId
    return typeof id === 'string' && id.trim() ? id.trim() : undefined
  }

  private materialIdFromNode(node: CanvasNode): string | undefined {
    const id = node.data?.materialId
    return typeof id === 'string' && id.trim() ? id.trim() : undefined
  }

  private async resolveGenerationRecord(input: {
    sessionId: string
    userId: string
    generationRecordId?: string
    nodeId?: string
  }): Promise<{ recordId: string; recordKind: 'studio' | 'material'; nodeId?: string }> {
    const direct = input.generationRecordId?.trim()
    if (direct) {
      try {
        await this.studio.getGeneration(input.userId, direct)
        return { recordId: direct, recordKind: 'studio', nodeId: input.nodeId }
      } catch {
        const material = await this.prisma.material.findFirst({
          where: { id: direct, shot: { session: { userId: input.userId } } },
        })
        if (material) {
          return { recordId: direct, recordKind: 'material', nodeId: input.nodeId }
        }
        throw new NotFoundException('生成记录不存在')
      }
    }
    if (!input.nodeId) {
      throw new BadRequestException('需要提供 generationRecordId 或 nodeId')
    }
    const node = await this.getNode({ sessionId: input.sessionId, nodeId: input.nodeId })
    const studioId = this.generationRecordIdFromNode(node)
    if (studioId) {
      return { recordId: studioId, recordKind: 'studio', nodeId: input.nodeId }
    }
    const materialId = this.materialIdFromNode(node)
    if (materialId) {
      return { recordId: materialId, recordKind: 'material', nodeId: input.nodeId }
    }
    throw new NotFoundException('节点无关联的生成记录')
  }

  async getGenerationDiagnostic(input: {
    sessionId: string
    userId: string
    generationRecordId?: string
    nodeId?: string
  }) {
    const { recordId, recordKind } = await this.resolveGenerationRecord(input)
    if (recordKind === 'material') {
      return this.material.getMaterialDiagnostic(input.userId, recordId)
    }
    return this.studio.getGenerationDiagnostic(input.userId, recordId)
  }

  async cancelGeneration(input: {
    sessionId: string
    userId: string
    generationRecordId?: string
    nodeId?: string
  }): Promise<{
    status: string
    generationRecordId: string
    recordKind: 'studio' | 'material'
    actions: CanvasAction[]
  }> {
    const { recordId, recordKind, nodeId } = await this.resolveGenerationRecord(input)
    if (recordKind === 'material') {
      await this.material.cancelGeneration(input.userId, recordId)
    } else {
      await this.studio.cancelGeneration(input.userId, recordId)
    }
    const actions: CanvasAction[] = []
    if (nodeId) {
      actions.push({
        type: 'update_node',
        payload: {
          id: nodeId,
          data: { status: 'error', errorMessage: '已取消' },
        },
      })
      await this.persist(input.sessionId, actions)
    }
    return {
      status: 'cancelled',
      generationRecordId: recordId,
      recordKind,
      actions,
    }
  }

  async confirmPlatformFallback(input: {
    sessionId: string
    userId: string
    generationRecordId?: string
    nodeId?: string
  }): Promise<{
    status: string
    generationRecordId: string
    recordKind: 'studio' | 'material'
    url?: string
    actions: CanvasAction[]
  }> {
    const { recordId, recordKind, nodeId } = await this.resolveGenerationRecord(input)
    const record =
      recordKind === 'material'
        ? await this.material.confirmPlatformFallback(input.userId, recordId)
        : await this.studio.confirmPlatformFallback(input.userId, recordId)
    const actions: CanvasAction[] = []
    const url = typeof record.url === 'string' && record.url ? record.url : undefined
    if (nodeId) {
      const patch: Record<string, unknown> = {
        status: record.status === 'completed' ? 'completed' : record.status,
      }
      if (recordKind === 'studio') patch.generationRecordId = recordId
      if (recordKind === 'material') patch.materialId = recordId
      if (url) patch.url = url
      if (record.status === 'failed') {
        patch.errorMessage = '平台回退失败'
      }
      actions.push({
        type: 'update_node',
        payload: { id: nodeId, data: patch },
      })
      await this.persist(input.sessionId, actions)
    }
    return {
      status: record.status,
      generationRecordId: recordId,
      recordKind,
      url,
      actions,
    }
  }

  async cancelPlatformFallback(input: {
    sessionId: string
    userId: string
    generationRecordId?: string
    nodeId?: string
  }): Promise<{
    status: string
    generationRecordId: string
    recordKind: 'studio' | 'material'
    actions: CanvasAction[]
  }> {
    const { recordId, recordKind, nodeId } = await this.resolveGenerationRecord(input)
    if (recordKind === 'material') {
      await this.material.cancelPlatformFallback(input.userId, recordId)
    } else {
      await this.studio.cancelPlatformFallback(input.userId, recordId)
    }
    const actions: CanvasAction[] = []
    if (nodeId) {
      actions.push({
        type: 'update_node',
        payload: {
          id: nodeId,
          data: { status: 'error', errorMessage: '已拒绝平台回退' },
        },
      })
      await this.persist(input.sessionId, actions)
    }
    return { status: 'failed', generationRecordId: recordId, recordKind, actions }
  }

  async listGenerationTasks(input: {
    sessionId: string
    userId: string
    type?: string
  }): Promise<{
    tasks: Array<{
      id: string
      type: string
      status: string
      prompt: string
      url?: string | null
      nodeId?: string | null
      sessionId?: string | null
      createdAt: Date
    }>
  }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const rows = await this.studio.listGenerations(input.userId, input.type, input.sessionId)
    return {
      tasks: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        prompt: row.prompt,
        url: row.url,
        nodeId: row.nodeId,
        sessionId: row.sessionId,
        createdAt: row.createdAt,
      })),
    }
  }

  async listUserAssets(input: { userId: string }): Promise<{
    items: Array<{
      id: string
      url: string
      label: string
      kind: string
      sourceNodeId?: string | null
      createdAt: Date
    }>
  }> {
    const items = await this.prisma.userAsset.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return { items }
  }

  async listPublicAssets(input?: {
    kind?: 'image' | 'video' | 'audio'
    search?: string
  }): Promise<{ items: typeof PUBLIC_ASSETS }> {
    let items = PUBLIC_ASSETS
    if (input?.kind) {
      items = items.filter((item) => item.kind === input.kind)
    }
    if (input?.search) {
      const q = input.search.toLowerCase()
      items = items.filter((item) => item.label.toLowerCase().includes(q))
    }
    return { items }
  }

  async saveNodeToAssetLibrary(input: {
    sessionId: string
    userId: string
    nodeId: string
    label?: string
  }): Promise<{ assetId: string; url: string; kind: string }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const node = await this.getNode({ sessionId: input.sessionId, nodeId: input.nodeId })
    const kind = assetKindFromNodeType(String(node.type ?? ''))
    const url = String(node.data?.url ?? '').trim()
    if (!kind || !url) {
      throw new BadRequestException('节点缺少可保存的媒体 URL')
    }
    const item = await this.prisma.userAsset.upsert({
      where: { userId_url: { userId: input.userId, url } },
      create: {
        userId: input.userId,
        kind,
        url,
        label: input.label?.trim() || nodeTitle(node) || node.id,
        sourceNodeId: node.id,
      },
      update: {
        label: input.label?.trim() || nodeTitle(node) || node.id,
        kind,
        sourceNodeId: node.id,
      },
    })
    return { assetId: item.id, url: item.url, kind: item.kind }
  }

  async introduceNodesToAgent(input: {
    sessionId: string
    userId: string
    nodeIds: string[]
  }): Promise<{
    attachments: SidebarAttachment[]
    skipped: string[]
    canvasCommands: Array<{ type: string; attachments: SidebarAttachment[] }>
  }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const attachments: SidebarAttachment[] = []
    const skipped: string[] = []
    for (const nodeId of input.nodeIds) {
      try {
        const node = await this.getNode({ sessionId: input.sessionId, nodeId })
        const att = nodeToAgentAttachment(node)
        if (att) attachments.push(att)
        else skipped.push(nodeId)
      } catch {
        skipped.push(nodeId)
      }
    }
    const canvasCommands =
      attachments.length > 0
        ? [{ type: 'introduce_nodes', attachments }]
        : []
    return { attachments, skipped, canvasCommands }
  }

  async applyAssetToNode(input: {
    sessionId: string
    userId: string
    nodeId: string
    assetId: string
    source: 'user' | 'public'
  }): Promise<{ actions: CanvasAction[]; canvasCommands: Array<{ type: string; nodeId: string }> }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    let url = ''
    let label = ''
    let kind: 'image' | 'video' | 'audio' | null = null
    if (input.source === 'user') {
      const asset = await this.prisma.userAsset.findFirst({
        where: { id: input.assetId, userId: input.userId },
      })
      if (!asset) throw new NotFoundException('资产不存在')
      url = asset.url
      label = asset.label
      kind = asset.kind as 'image' | 'video' | 'audio'
    } else {
      const asset = PUBLIC_ASSETS.find((item) => item.id === input.assetId)
      if (!asset) throw new NotFoundException('公共资产不存在')
      url = asset.url
      label = asset.label
      kind = asset.kind
    }
    const node = await this.getNode({ sessionId: input.sessionId, nodeId: input.nodeId })
    const nodeKind = assetKindFromNodeType(String(node.type ?? ''))
    if (!nodeKind || nodeKind !== kind) {
      throw new BadRequestException('资产类型与节点类型不匹配')
    }
    const actions: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: input.nodeId,
          data: {
            url,
            status: 'completed',
            label: label || nodeTitle(node),
          },
        },
      },
    ]
    await this.persist(input.sessionId, actions)
    return {
      actions,
      canvasCommands: [{ type: 'focus_node', nodeId: input.nodeId }],
    }
  }

  async getCanvasLayout(input: { sessionId: string }): Promise<{
    nodes: Array<{
      id: string
      type: string
      title: string
      status: string
      position: { x: number; y: number }
      absolutePosition: { x: number; y: number }
      size: { w: number; h: number }
      parentNode?: string
    }>
    groups: Array<{
      id: string
      title: string
      childIds: string[]
      position: { x: number; y: number }
      size: { w: number; h: number }
    }>
  }> {
    const { canvas } = await this.loadSession(input.sessionId)
    const layoutNodes = canvas.nodes as LayoutNode[]
    const nodes = layoutNodes.map((node) => {
      const { w, h } = getNodeSize(node)
      return {
        id: node.id,
        type: String(node.type ?? ''),
        title: nodeTitle(node),
        status: nodeStatus(node),
        position: node.position,
        absolutePosition: getAbsolutePosition(node, layoutNodes),
        size: { w, h },
        ...(node.parentNode ? { parentNode: node.parentNode } : {}),
      }
    })
    return { nodes, groups: summarizeLayoutGroups(layoutNodes) }
  }

  async duplicateNode(input: {
    sessionId: string
    userId: string
    nodeId: string
    offset?: { x: number; y: number }
  }): Promise<{ nodeId: string; actions: CanvasAction[]; canvasCommands: Array<{ type: string; nodeId: string }> }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const source = await this.getNode({ sessionId: input.sessionId, nodeId: input.nodeId })
    const offset = input.offset ?? { x: 40, y: 40 }
    const nodeType = String(source.type ?? 'image') as NodeType
    const newId = nextNodeId(nodeType)
    const cloned = JSON.parse(JSON.stringify(source.data ?? {})) as Record<string, unknown>
    delete cloned.generationRecordId
    delete cloned.materialId
    cloned.status = 'draft'
    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: newId,
          nodeType,
          position: {
            x: source.position.x + offset.x,
            y: source.position.y + offset.y,
          },
          data: cloned,
        },
      },
    ]
    await this.persist(input.sessionId, actions)
    return {
      nodeId: newId,
      actions,
      canvasCommands: [{ type: 'focus_node', nodeId: newId }],
    }
  }

  async uploadMediaToCanvas(input: {
    sessionId: string
    userId: string
    url: string
    mediaType: 'image' | 'video' | 'audio'
    title?: string
    position?: { x: number; y: number }
  }): Promise<{ nodeId: string; actions: CanvasAction[] }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const nodeType = input.mediaType === 'image' ? 'mediaInput' : input.mediaType
    const nodeId = nextNodeId(nodeType)
    const position =
      input.position ?? {
        x: 80 + (canvas.nodes.length % 4) * GRID_X,
        y: 80 + Math.floor(canvas.nodes.length / 4) * GRID_Y,
      }
    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: nodeId,
          nodeType: nodeType as NodeType,
          position,
          data: {
            title: input.title?.trim() || '上传媒体',
            url: input.url.trim(),
            status: 'completed',
          },
        },
      },
    ]
    await this.persist(input.sessionId, actions)
    return { nodeId, actions }
  }

  async exportMediaPackage(input: {
    sessionId: string
    userId: string
    nodeIds: string[]
  }): Promise<{
    manifest: {
      exportedAt: string
      count: number
      items: Array<{ nodeId: string; url: string; fileName: string; downloadPath: string }>
    }
  }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const idSet = new Set(input.nodeIds)
    const items: Array<{ nodeId: string; url: string; fileName: string; downloadPath: string }> = []
    for (const node of canvas.nodes) {
      if (!idSet.has(node.id)) continue
      const url = String(node.data?.url ?? '').trim()
      if (!url) continue
      const ext = url.includes('.mp4') ? 'mp4' : url.includes('.mp3') ? 'mp3' : 'png'
      const fileName = `${nodeTitle(node) || node.id}.${ext}`.replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      const params = new URLSearchParams({
        url,
        filename: fileName,
        sessionId: input.sessionId,
      })
      items.push({
        nodeId: node.id,
        url,
        fileName,
        downloadPath: `/api/media/stream-download?${params.toString()}`,
      })
    }
    return {
      manifest: {
        exportedAt: new Date().toISOString(),
        count: items.length,
        items,
      },
    }
  }

  async groupNodes(input: {
    sessionId: string
    userId: string
    nodeIds: string[]
    title?: string
  }): Promise<{ groupId: string; actions: CanvasAction[] }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const before = canvas.nodes as LayoutNode[]
    const result = createGroupFromNodes(before, input.nodeIds, input.title)
    if (!result) throw new BadRequestException('至少需要 2 个可分组节点')
    await this.persistLayoutNodes(input.sessionId, result.nodes)
    return { groupId: result.groupId, actions: [] }
  }

  async ungroupNode(input: {
    sessionId: string
    userId: string
    groupId: string
  }): Promise<{ actions: CanvasAction[] }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const before = canvas.nodes as LayoutNode[]
    const after = ungroupNode(before, input.groupId)
    await this.persistLayoutNodes(input.sessionId, after)
    return { actions: [] }
  }

  async arrangeNodesGrid(input: {
    sessionId: string
    userId: string
    nodeIds: string[]
    gap?: number
  }): Promise<{ actions: CanvasAction[] }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const before = canvas.nodes as LayoutNode[]
    const after = layoutNodesInGrid(before, input.nodeIds, input.gap ?? 40)
    await this.persistLayoutNodes(input.sessionId, after)
    return { actions: [] }
  }

  async moveNodes(input: {
    sessionId: string
    userId: string
    items: Array<{ nodeId: string; x: number; y: number }>
  }): Promise<{ movedNodeIds: string[]; actions: CanvasAction[] }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const before = canvas.nodes as LayoutNode[]
    const { nodes: after, movedIds } = moveNodes(before, input.items)
    if (!movedIds.length) {
      throw new BadRequestException('未找到可移动的节点')
    }
    await this.persistLayoutNodes(input.sessionId, after)
    return { movedNodeIds: movedIds, actions: [] }
  }

  async applyLayoutOps(input: {
    sessionId: string
    userId: string
    ops: CanvasLayoutOp[]
  }): Promise<{
    results: CanvasLayoutOpResult[]
    layout: Awaited<ReturnType<AgentCanvasToolsService['getCanvasLayout']>>
    actions: CanvasAction[]
  }> {
    await this.loadOwnedSession(input.sessionId, input.userId)
    const { canvas } = await this.loadSession(input.sessionId)
    const before = canvas.nodes as LayoutNode[]
    let after: LayoutNode[]
    let results: CanvasLayoutOpResult[]
    try {
      ;({ nodes: after, results } = applyLayoutOps(before, input.ops))
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : '布局操作失败')
    }
    await this.persistLayoutNodes(input.sessionId, after)
    const layout = await this.getCanvasLayout({ sessionId: input.sessionId })
    return { results, layout, actions: [] }
  }

  async getImageEditCapabilities(input: {
    sessionId: string
    nodeId: string
  }): Promise<{
    canEdit: boolean
    nodeType: string
    hasUrl: boolean
    supportedModes: string[]
  }> {
    const node = await this.getNode({ sessionId: input.sessionId, nodeId: input.nodeId })
    const nodeType = String(node.type ?? '')
    const url = String(node.data?.url ?? '').trim()
    const isImageLike = nodeType === 'image' || nodeType === 'mediaInput'
    const canEdit = isImageLike && Boolean(url)
    return {
      canEdit,
      nodeType,
      hasUrl: Boolean(url),
      supportedModes: canEdit ? ['crop', 'inpaint', 'outpaint', 'remove_bg'] : [],
    }
  }

  async getAgentMessages(input: {
    sessionId: string
    threadId: string
  }): Promise<Array<{ id: string; role: string; content: string; toolCalls?: string; createdAt: Date }>> {
    const messages = await this.prisma.agentMessage.findMany({
      where: { sessionId: input.sessionId, threadId: input.threadId },
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
    threadId: string
    userId: string
    role: string
    content: string
    toolCalls?: string
  }): Promise<{ id: string }> {
    // Verify session ownership
    await this.loadOwnedSession(input.sessionId, input.userId)

    const content = sanitizeAgentMessageContent(input.role, input.content)
    if (!content) {
      return { id: '' }
    }

    const message = await this.prisma.agentMessage.create({
      data: {
        sessionId: input.sessionId,
        threadId: input.threadId,
        role: input.role,
        content,
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
    timeoutMs = this.pollTimeoutMs,
  ): Promise<{ id: string; status: string; url?: string | null }> {
    const terminal = new Set(['completed', 'failed', 'error', 'fallback_pending'])
    if (terminal.has(initial.status)) return initial

    const deadline = Date.now() + timeoutMs
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

  async runVisionQa(input: {
    sessionId: string
    userId: string
    imageUrls: string[]
    userText?: string
    sceneKind?: string
    systemPrompt: string
    userContent: string
    model?: string
  }): Promise<{
    pass: boolean
    reason: string
    visionUsed: boolean
    productSummary?: string
    isWhiteBg?: boolean
    isSharpEnough?: boolean
    productIdentifiable?: boolean
  }> {
    const session = await this.loadOwnedSession(input.sessionId, input.userId)
    const prefs = await this.loadAccountGenPrefs(input.userId)
    const canvasTextModel = pickVisionQaModelFromCanvas(session.canvas, prefs.defaultTextModel)
    const textModel =
      pickString(input.model, pickString(canvasTextModel, prefs.defaultTextModel)) || undefined
    const { text, visionUsed } = await this.studio.runVisionQaInternal(input.userId, {
      systemPrompt: input.systemPrompt,
      userContent: input.userContent,
      imageUrls: input.imageUrls,
      model: textModel,
    })
    const parsed = parseVisionQaResponse(text)
    return { ...parsed, visionUsed }
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
   * Replace canvas nodes for layout operations (group/ungroup/grid) that need
   * parentNode/style fields not supported by applyCanvasActions.
   */
  private async persistLayoutNodes(sessionId: string, nodes: LayoutNode[]): Promise<CanvasData> {
    await this.expireStaleStage(sessionId)
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
      const updated: CanvasData = { ...current, nodes: nodes as CanvasNode[] }
      await tx.session.update({
        where: { id: sessionId },
        data: { canvasData: JSON.stringify(updated) },
      })
      return updated
    })
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
