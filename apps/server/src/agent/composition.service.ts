import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  COMPOSITION_BIND_MISSING,
  compositionSlotKey,
  compositionSourcesBound,
  expandComposition,
  extractCompositionPrimitives,
  hashCompositionDump,
  isCompositionStructureUtterance,
  lintCompositionDump,
  localRefsByRefFromSidebarAttachments,
  renderCompositionCopy,
  requiredCompositionRefKeys,
  summarizeCompositionDump,
  type CanvasData,
  type CompositionIR,
  type SidebarAttachment,
  type WorkflowDocument,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'

const EXTRACT_INCOMPLETE = '请指明哪张是模特、哪张是服装。'
const COMPILE_FAILED = '这版构图还不能放到画布，请稍后再试或简化步骤。'
const PERSIST_MISSING = '请先确认构图，再落到画布。'
const SOURCE_PREFIX = 'image-src-'
const PENDING_TTL_MS = 15 * 60 * 1000

type CompositionCopy = NonNullable<CompositionIR['copy']>

type CanvasCommand = { type: 'focus_nodes'; nodeIds: string[] }

type LandedMeta = {
  lastImportedHash?: string
  lastAddedNodeIds?: string[]
  lastImportedSlotKey?: string
  lastCanvasCommands?: CanvasCommand[]
}

type StoredPreview = LandedMeta & {
  dump: WorkflowDocument
  hash: string
  primitives: CompositionIR['primitives']
  slotKey?: string
  ts: string
}

export type PreviewCompositionInput = {
  sessionId: string
  userId: string
  utterance: string
  copy?: object
  existingNodeCount?: number
  attachments?: Array<Partial<SidebarAttachment> & { media_type?: string }>
}

type StoredPending = {
  utterance?: string
  primitivesPartial?: Record<string, unknown>
  ts?: string
}

export type ConfirmCompositionInput = {
  sessionId: string
  userId: string
  dumpHash: string
}

@Injectable()
export class CompositionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentCanvasToolsService) private readonly canvasTools: AgentCanvasToolsService,
  ) {}

  async preview(input: PreviewCompositionInput): Promise<{
    userMessage: string
    dumpHash: string
    nodeTitles: string[]
  }> {
    const session = await this.loadOwnedSession(input.sessionId, input.userId)
    const existingNodeCount =
      input.existingNodeCount ?? countCanvasNodes(session.canvasData)
    const utterance = resolvePreviewUtterance(input.utterance, session.compositionPending)
    const extracted = extractCompositionPrimitives(utterance)
    const ts = new Date().toISOString()

    if (!extracted.ok) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          compositionPending: JSON.stringify({
            utterance,
            primitivesPartial: {},
            ts,
          }),
        },
      })
      throw new BadRequestException({ userMessage: EXTRACT_INCOMPLETE })
    }

    const byRef = localRefsByRefFromSidebarAttachments(utterance, input.attachments)
    const required = requiredCompositionRefKeys(extracted.primitives)
    const previous = parseLandedMeta(session.compositionPreview)
    if (!compositionSourcesBound(required, byRef)) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          compositionPreview: JSON.stringify({
            lastImportedHash: previous?.lastImportedHash,
            lastAddedNodeIds: previous?.lastAddedNodeIds,
            lastImportedSlotKey: previous?.lastImportedSlotKey,
            ts,
          }),
          compositionPending: JSON.stringify({ utterance, primitivesPartial: {}, ts }),
        },
      })
      throw new BadRequestException({ userMessage: COMPOSITION_BIND_MISSING })
    }

    const rendered = renderCompositionCopy({
      version: '1',
      primitives: extracted.primitives,
      copy: asCopy(input.copy),
    })
    const dump = expandComposition(rendered, byRef)
    const lint = lintCompositionDump(dump)
    if (!lint.ok) {
      throw new BadRequestException({ userMessage: lint.message || COMPILE_FAILED })
    }

    const hash = hashCompositionDump(dump)
    const preview: StoredPreview = {
      dump,
      hash,
      primitives: extracted.primitives,
      slotKey: compositionSlotKey(extracted.primitives),
      ts,
    }
    if (previous?.lastImportedHash) preview.lastImportedHash = previous.lastImportedHash
    if (previous?.lastAddedNodeIds) preview.lastAddedNodeIds = previous.lastAddedNodeIds
    if (previous?.lastImportedSlotKey) preview.lastImportedSlotKey = previous.lastImportedSlotKey
    if (previous?.lastCanvasCommands) preview.lastCanvasCommands = previous.lastCanvasCommands

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        compositionPreview: JSON.stringify(preview),
        compositionPending: null,
      },
    })

    return {
      userMessage: summarizeCompositionDump(dump, { existingNodeCount }),
      dumpHash: hash,
      nodeTitles: dump.graph.nodes
        .map((node) => (typeof node.data?.title === 'string' ? node.data.title : ''))
        .filter((title) => title.length > 0),
    }
  }

  async confirm(input: ConfirmCompositionInput): Promise<{
    addedNodeIds: string[]
    canvasCommands: CanvasCommand[]
    dumpHash: string
    idempotent?: boolean
  }> {
    const session = await this.loadOwnedSession(input.sessionId, input.userId)
    const preview = parseConfirmablePreview(session.compositionPreview)
    if (!preview || preview.hash !== input.dumpHash) {
      throw new BadRequestException({ userMessage: PERSIST_MISSING })
    }

    if (preview.lastImportedHash === input.dumpHash) {
      return {
        addedNodeIds: preview.lastAddedNodeIds ?? [],
        canvasCommands: preview.lastCanvasCommands ?? [],
        dumpHash: input.dumpHash,
        idempotent: true,
      }
    }

    const slotKey = preview.slotKey ?? compositionSlotKey(preview.primitives)
    if (
      preview.lastImportedSlotKey === slotKey &&
      (preview.lastAddedNodeIds?.length ?? 0) > 0 &&
      preview.lastImportedHash !== input.dumpHash
    ) {
      await this.canvasTools.removeNodes({
        sessionId: input.sessionId,
        nodeIds: preview.lastAddedNodeIds!,
      })
    }

    const imported = await this.canvasTools.importWorkflow({
      sessionId: input.sessionId,
      userId: input.userId,
      workflow: preview.dump,
    })

    const afterImport = await this.prisma.session.findUnique({ where: { id: session.id } })
    const canvas = parseCanvas(afterImport?.canvasData)
    const nodeIds = generatingNodeIds(preview.dump, imported.idMap)
    canvas.compositionRunGroup = {
      nodeIds,
      dumpHash: input.dumpHash,
      createdAt: new Date().toISOString(),
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        canvasData: JSON.stringify(canvas),
        compositionPreview: JSON.stringify({
          ...preview,
          lastImportedHash: input.dumpHash,
          lastAddedNodeIds: imported.addedNodeIds,
          lastImportedSlotKey: slotKey,
          lastCanvasCommands: imported.canvasCommands,
        }),
      },
    })

    return {
      addedNodeIds: imported.addedNodeIds,
      canvasCommands: imported.canvasCommands,
      dumpHash: input.dumpHash,
    }
  }

  private async loadOwnedSession(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('会话不存在')
    if (session.userId !== userId) throw new ForbiddenException()
    return session
  }
}

function asCopy(copy: object | undefined): CompositionCopy {
  if (!copy || typeof copy !== 'object') return {}
  return copy as CompositionCopy
}

function parseStoredPending(raw: string | null | undefined): StoredPending | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredPending
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function isPendingFresh(ts: string | undefined): boolean {
  if (!ts) return true
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return true
  return Date.now() - parsed <= PENDING_TTL_MS
}

function resolvePreviewUtterance(
  incoming: string,
  pendingRaw: string | null | undefined,
): string {
  const pending = parseStoredPending(pendingRaw)
  const original = pending?.utterance?.trim()
  if (!original || !isPendingFresh(pending?.ts)) return incoming
  if (isCompositionStructureUtterance(incoming)) return incoming
  return `${original} ${incoming.trim()}`.trim()
}

function countCanvasNodes(raw: string | null | undefined): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw) as { nodes?: unknown }
    return Array.isArray(parsed.nodes) ? parsed.nodes.length : 0
  } catch {
    return 0
  }
}

function parseCanvas(raw: string | null | undefined): CanvasData {
  if (!raw) {
    throw new BadRequestException({ userMessage: COMPILE_FAILED })
  }
  try {
    const parsed = JSON.parse(raw) as CanvasData
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException({ userMessage: COMPILE_FAILED })
    }
    return {
      ...parsed,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    }
  } catch (err) {
    if (err instanceof BadRequestException) throw err
    throw new BadRequestException({ userMessage: COMPILE_FAILED })
  }
}

function parseLandedMeta(raw: string | null | undefined): LandedMeta | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as LandedMeta
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function parseConfirmablePreview(raw: string | null | undefined): StoredPreview | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredPreview
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.hash !== 'string' || !parsed.dump) return null
    return parsed
  } catch {
    return null
  }
}

function generatingNodeIds(
  dump: WorkflowDocument,
  idMap: Record<string, string> | undefined,
): string[] {
  const dumpIds = dump.graph.nodes
    .map((node) => node.id)
    .filter((id) => !id.startsWith(SOURCE_PREFIX))
  return dumpIds.map((id) => (idMap && idMap[id] ? idMap[id] : id))
}
