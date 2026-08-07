import type { CanvasAction, LinkedCanvasOutput } from '@lnkpi/shared'
import type { AgentTaskItem } from './agentTaskProgress'
import type { ExecutionStep } from './executionTraceReducer'

export const COLLAPSE_THRESHOLD = 4
export const COLLAPSE_VISIBLE_COUNT = 3
export const TITLE_MAX_LEN = 20

export interface BuildCanvasOutputsOpts {
  traceSteps?: ExecutionStep[]
  taskItems?: Array<Pick<AgentTaskItem, 'nodeId' | 'title' | 'status' | 'kind'>>
  persistedOutputs?: LinkedCanvasOutput[]
}

export function shouldCollapseOutputs(count: number): boolean {
  return count > COLLAPSE_THRESHOLD
}

export function visibleOutputCount(count: number, expanded: boolean): number {
  if (!shouldCollapseOutputs(count) || expanded) return count
  return COLLAPSE_VISIBLE_COUNT
}

export function truncateTitle(title: string, maxLen = TITLE_MAX_LEN): string {
  const trimmed = title.trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen)}…`
}

function mapTraceStatus(status: ExecutionStep['status']): LinkedCanvasOutput['status'] | null {
  switch (status) {
    case 'running':
    case 'pending':
      return 'running'
    case 'failed':
      return 'failed'
    case 'done':
      return 'done'
    default:
      return null
  }
}

function mapTaskStatus(status: AgentTaskItem['status']): LinkedCanvasOutput['status'] {
  switch (status) {
    case 'done':
      return 'done'
    case 'failed':
    case 'needs_user':
      return 'failed'
    case 'pending':
    case 'running':
    case 'retrying':
      return 'running'
    default:
      return 'running'
  }
}

function inferNodeTypeFromStep(step: ExecutionStep): string {
  if (step.kind === 'node_gen') return 'image'
  if (step.kind === 'canvas') {
    const label = step.label
    if (label.includes('图片')) return 'image'
    if (label.includes('视频')) return 'video'
    if (label.includes('音频')) return 'audio'
    if (label.includes('文案') || label.includes('文本')) return 'text'
    if (label.includes('分镜')) return 'shot'
    if (label.includes('提示词') || label.includes('方案')) return 'prompt'
  }
  return 'image'
}

function titleFromStepLabel(label: string): string {
  const match = label.match(/[「"]([^」"]+)[」"]/)
  if (match?.[1]) return truncateTitle(match[1])
  return truncateTitle(label.replace(/^添加.*?节点/, '').trim() || label)
}

function stepToOutput(step: ExecutionStep): LinkedCanvasOutput | null {
  const nodeId = step.meta?.nodeId
  if (!nodeId) return null
  const status = mapTraceStatus(step.status)
  if (!status) return null
  if (!['node_gen', 'canvas', 'task'].includes(step.kind) && !step.meta?.nodeId) return null
  return {
    nodeId,
    title: titleFromStepLabel(step.label),
    nodeType: inferNodeTypeFromStep(step),
    status,
  }
}

function taskItemToOutput(
  item: Pick<AgentTaskItem, 'nodeId' | 'title' | 'status' | 'kind'>,
): LinkedCanvasOutput | null {
  if (!item.nodeId) return null
  return {
    nodeId: item.nodeId,
    title: truncateTitle(item.title),
    nodeType: item.kind || 'image',
    status: mapTaskStatus(item.status),
  }
}

function mergeOutputs(sources: LinkedCanvasOutput[][]): LinkedCanvasOutput[] {
  const map = new Map<string, LinkedCanvasOutput>()
  for (const source of sources) {
    for (const out of source) {
      const existing = map.get(out.nodeId)
      if (!existing) {
        map.set(out.nodeId, out)
        continue
      }
      map.set(out.nodeId, {
        ...existing,
        ...out,
        title: out.title.length > existing.title.length ? out.title : existing.title,
      })
    }
  }
  return Array.from(map.values())
}

export function buildCanvasOutputs(opts: BuildCanvasOutputsOpts): LinkedCanvasOutput[] {
  const fromTrace = (opts.traceSteps ?? [])
    .map(stepToOutput)
    .filter((x): x is LinkedCanvasOutput => x != null)
  const fromPersisted = opts.persistedOutputs ?? []
  const fromTasks = (opts.taskItems ?? [])
    .map(taskItemToOutput)
    .filter((x): x is LinkedCanvasOutput => x != null)

  return mergeOutputs([fromTrace, fromPersisted, fromTasks])
}

export function parsePersistedToolCalls(raw: string | undefined | null): CanvasAction[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is CanvasAction =>
        item != null && typeof item === 'object' && typeof item.type === 'string',
    )
  } catch {
    return []
  }
}

function inferStatusFromNodeData(data?: Record<string, unknown>): LinkedCanvasOutput['status'] {
  const status = String(data?.status ?? '').toLowerCase()
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'generating' || status === 'pending' || status === 'running') return 'running'
  return 'done'
}

export function parseLinkedOutputsFromToolCalls(
  actions?: CanvasAction[] | string | null,
): LinkedCanvasOutput[] {
  const normalized = Array.isArray(actions) ? actions : parsePersistedToolCalls(actions)
  return normalized
    .filter((action) => action.type === 'add_node' && action.payload?.id)
    .map((action) => ({
      nodeId: action.payload!.id!,
      title: truncateTitle(
        String(action.payload!.data?.title || action.payload!.data?.prompt || '未命名'),
      ),
      nodeType: String(action.payload!.nodeType || 'image'),
      status: inferStatusFromNodeData(action.payload!.data),
    }))
}

export function resolveMessageOutputs(opts: {
  linkedOutputs?: LinkedCanvasOutput[]
  canvasActions?: CanvasAction[]
  traceSteps?: ExecutionStep[]
  taskItems?: Array<Pick<AgentTaskItem, 'nodeId' | 'title' | 'status' | 'kind'>>
  isLiveTurn?: boolean
}): LinkedCanvasOutput[] {
  if (opts.isLiveTurn) {
    return buildCanvasOutputs({
      traceSteps: opts.traceSteps,
      taskItems: opts.taskItems,
      persistedOutputs: opts.linkedOutputs,
    })
  }
  if (opts.linkedOutputs?.length) return opts.linkedOutputs
  if (opts.traceSteps?.length) {
    return buildCanvasOutputs({ traceSteps: opts.traceSteps })
  }
  return parseLinkedOutputsFromToolCalls(opts.canvasActions)
}

export function locatableNodeIds(outputs: LinkedCanvasOutput[]): string[] {
  return outputs.filter((o) => o.status === 'done' || o.status === 'failed').map((o) => o.nodeId)
}
