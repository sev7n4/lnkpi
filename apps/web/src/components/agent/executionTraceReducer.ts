import type { CanvasAction } from '@lnkpi/shared'
import {
  canvasActionLabel,
  labelFromTextReplace,
  nodeStatusLabel,
} from '@/components/agent/executionStepLabels'

export type ExecutionStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'waiting_user'
  | 'skipped'

export type ExecutionStepKind =
  | 'phase'
  | 'text_stage'
  | 'canvas'
  | 'tool'
  | 'node_gen'
  | 'task'

export interface ExecutionStep {
  id: string
  kind: ExecutionStepKind
  label: string
  detail?: string
  status: ExecutionStepStatus
  startedAt?: number
  endedAt?: number
  ms?: number
  meta?: {
    nodeId?: string
    taskId?: string
    toolName?: string
    errorCode?: string
  }
}

export interface ExecutionTraceState {
  steps: ExecutionStep[]
  collapsed: boolean
  turnStartedAt: number
  turnEndedAt?: number
  totalMs?: number
}

let stepCounter = 0

function nextStepId(prefix: string): string {
  stepCounter += 1
  return `${prefix}-${stepCounter}-${Date.now()}`
}

export function createExecutionTrace(): ExecutionTraceState {
  return {
    steps: [],
    collapsed: true,
    turnStartedAt: Date.now(),
  }
}

function completeStep(step: ExecutionStep, status: ExecutionStepStatus = 'done') {
  const now = Date.now()
  step.status = status
  step.endedAt = now
  if (step.startedAt) step.ms = now - step.startedAt
}

function upsertTextStage(trace: ExecutionTraceState, label: string, detail?: string) {
  const last = trace.steps[trace.steps.length - 1]
  if (last?.kind === 'text_stage' && last.label === label && last.status === 'running') {
    if (detail) last.detail = detail
    completeStep(last)
    return
  }
  if (last?.kind === 'text_stage' && last.label === label && last.status === 'done') {
    return
  }
  const now = Date.now()
  trace.steps.push({
    id: nextStepId('text'),
    kind: 'text_stage',
    label,
    detail,
    status: 'done',
    startedAt: now,
    endedAt: now,
    ms: 0,
  })
}

export function applyTextReplaceStage(trace: ExecutionTraceState, text: string) {
  const label = labelFromTextReplace(text)
  if (!label) return
  upsertTextStage(trace, label, text.slice(0, 120))
}

export function applyCanvasAction(trace: ExecutionTraceState, action: CanvasAction) {
  const label = canvasActionLabel(action)
  const nodeId = action.payload?.id
  const now = Date.now()
  trace.steps.push({
    id: nextStepId('canvas'),
    kind: 'canvas',
    label,
    status: 'done',
    startedAt: now,
    endedAt: now,
    ms: 0,
    meta: nodeId ? { nodeId } : undefined,
  })
}

export function applyNodeStatus(
  trace: ExecutionTraceState,
  data: { nodeId: string; status: string; url?: string },
) {
  const label = nodeStatusLabel(data.status)
  const isRunning = data.status === 'generating'
  const existing = trace.steps.find(
    (s) => s.kind === 'node_gen' && s.meta?.nodeId === data.nodeId && s.status === 'running',
  )
  if (existing) {
    existing.label = label
    if (isRunning) return
    completeStep(existing, data.status === 'failed' ? 'failed' : 'done')
    return
  }
  const now = Date.now()
  trace.steps.push({
    id: nextStepId('node'),
    kind: 'node_gen',
    label,
    status: isRunning ? 'running' : data.status === 'failed' ? 'failed' : 'done',
    startedAt: now,
    endedAt: isRunning ? undefined : now,
    ms: isRunning ? undefined : 0,
    meta: { nodeId: data.nodeId },
    detail: data.url ? '已生成预览' : undefined,
  })
}

export function applyToolCall(
  trace: ExecutionTraceState,
  name: string,
  result?: unknown,
) {
  const existing = trace.steps.find(
    (s) => s.kind === 'tool' && s.meta?.toolName === name && s.status === 'running',
  )
  if (existing && result !== undefined) {
    existing.detail = summarizeToolResult(result)
    completeStep(existing)
    return
  }
  const now = Date.now()
  trace.steps.push({
    id: nextStepId('tool'),
    kind: 'tool',
    label: `调用 ${name}`,
    status: result !== undefined ? 'done' : 'running',
    startedAt: now,
    endedAt: result !== undefined ? now : undefined,
    ms: result !== undefined ? 0 : undefined,
    meta: { toolName: name },
    detail: result !== undefined ? summarizeToolResult(result) : undefined,
  })
}

function summarizeToolResult(result: unknown): string | undefined {
  if (result == null) return undefined
  if (typeof result === 'string') return result.slice(0, 80)
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.message === 'string') return r.message.slice(0, 80)
    if (typeof r.status === 'string') return r.status
  }
  return undefined
}

export function applyTaskUpdate(
  trace: ExecutionTraceState,
  data: {
    id: string
    status: string
    title?: string
    nodeId?: string
    errorHint?: string
  },
) {
  const label = data.title ? `生成「${data.title}」` : '批量生成任务'
  let step = trace.steps.find((s) => s.kind === 'task' && s.meta?.taskId === data.id)
  if (!step) {
    const now = Date.now()
    step = {
      id: nextStepId('task'),
      kind: 'task',
      label,
      status: 'running',
      startedAt: now,
      meta: { taskId: data.id, nodeId: data.nodeId },
    }
    trace.steps.push(step)
  }
  if (data.status === 'running' || data.status === 'retrying') {
    step.status = 'running'
    step.label = data.status === 'retrying' ? `${label}（重试中）` : label
    return
  }
  if (data.status === 'done') {
    completeStep(step)
    return
  }
  if (data.status === 'failed' || data.status === 'needs_user') {
    step.detail = data.errorHint
    completeStep(step, data.status === 'needs_user' ? 'waiting_user' : 'failed')
  }
}

export function finalizeExecutionTrace(trace: ExecutionTraceState) {
  const now = Date.now()
  trace.turnEndedAt = now
  trace.totalMs = now - trace.turnStartedAt
  for (const step of trace.steps) {
    if (step.status === 'running') {
      completeStep(step)
    }
  }
}

export function visibleStepCount(trace: ExecutionTraceState): number {
  return trace.steps.length
}
