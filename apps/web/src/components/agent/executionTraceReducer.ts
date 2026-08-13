import type { CanvasAction } from '@lnkpi/shared'
import { formatStructuredError } from '@/components/agent/executionStepErrors'
import {
  canvasActionLabel,
  labelFromTextReplace,
  nodeStatusLabel,
} from '@/components/agent/executionStepLabels'
import type { JourneyStepId, JourneyTraceSnapshot } from '@/components/agent/journeyTraceTypes'

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
  | 'thinking'
  | 'explore'
  | 'workflow_step'

export interface ExecutionStep {
  id: string
  kind: ExecutionStepKind
  label: string
  detail?: string
  status: ExecutionStepStatus
  startedAt?: number
  endedAt?: number
  ms?: number
  parentStepId?: string
  journeyStepId?: JourneyStepId
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

function journeyStepId(stepId: JourneyStepId): string {
  return `journey:${stepId}`
}

function parseIsoMs(iso?: string): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

function runningWorkflowStepId(trace: ExecutionTraceState): string | undefined {
  return trace.steps.find((s) => s.kind === 'workflow_step' && s.status === 'running')?.id
}

function attachParentStep(trace: ExecutionTraceState, step: ExecutionStep) {
  if (step.kind !== 'text_stage' && step.kind !== 'canvas' && step.kind !== 'task') return
  const parentId = runningWorkflowStepId(trace)
  if (parentId) step.parentStepId = parentId
}

function rebindOrphanChildSteps(trace: ExecutionTraceState) {
  const parentId = runningWorkflowStepId(trace)
  if (!parentId) return
  for (const step of trace.steps) {
    if (
      (step.kind === 'text_stage' || step.kind === 'canvas' || step.kind === 'task') &&
      !step.parentStepId
    ) {
      step.parentStepId = parentId
    }
  }
}

export function workflowStepsFromSnapshot(snapshot: JourneyTraceSnapshot): ExecutionStep[] {
  return snapshot.steps.map((record) => {
    const startedAt = parseIsoMs(record.enteredAt)
    const endedAt = parseIsoMs(record.completedAt)
    return {
      id: journeyStepId(record.id),
      kind: 'workflow_step',
      label: record.label,
      detail: record.summary,
      status: record.status,
      journeyStepId: record.id,
      startedAt,
      endedAt,
      ms: record.ms,
    }
  })
}

export function applyJourneyUpdate(trace: ExecutionTraceState, snapshot: JourneyTraceSnapshot) {
  for (const record of snapshot.steps) {
    const id = journeyStepId(record.id)
    let step = trace.steps.find((s) => s.id === id || s.journeyStepId === record.id)
    const startedAt = parseIsoMs(record.enteredAt)
    const endedAt = parseIsoMs(record.completedAt)
    if (!step) {
      step = {
        id,
        kind: 'workflow_step',
        label: record.label,
        status: record.status,
        journeyStepId: record.id,
        startedAt,
        endedAt,
        ms: record.ms,
        detail: record.summary,
      }
      trace.steps.push(step)
    } else {
      step.id = id
      step.kind = 'workflow_step'
      step.label = record.label
      step.status = record.status
      step.journeyStepId = record.id
      step.detail = record.summary
      if (startedAt !== undefined) step.startedAt = startedAt
      if (endedAt !== undefined) step.endedAt = endedAt
      if (record.ms !== undefined) step.ms = record.ms
    }
  }
  rebindOrphanChildSteps(trace)
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
  const step: ExecutionStep = {
    id: nextStepId('text'),
    kind: 'text_stage',
    label,
    detail,
    status: 'done',
    startedAt: now,
    endedAt: now,
    ms: 0,
  }
  attachParentStep(trace, step)
  trace.steps.push(step)
}

function removeDuplicateTextStage(trace: ExecutionTraceState, label: string) {
  const idx = trace.steps.findIndex(
    (s) => s.kind === 'text_stage' && s.label === label && s.status === 'done',
  )
  if (idx >= 0) trace.steps.splice(idx, 1)
}

export function applyStep(
  trace: ExecutionTraceState,
  data: {
    id: string
    kind?: string
    label: string
    status: string
    detail?: string
    ms?: number
    nodeId?: string
  },
) {
  const status = data.status as ExecutionStepStatus
  let step = trace.steps.find((s) => s.id === data.id)
  const now = Date.now()
  if (!step) {
    step = {
      id: data.id,
      kind: 'phase',
      label: data.label,
      status,
      startedAt: now,
      meta: data.nodeId ? { nodeId: data.nodeId } : undefined,
      detail: data.detail,
    }
    trace.steps.push(step)
    removeDuplicateTextStage(trace, data.label)
  } else {
    step.label = data.label
    step.status = status
    if (data.detail) step.detail = data.detail
  }
  if (status === 'done' || status === 'failed' || status === 'waiting_user') {
    step.endedAt = now
    step.ms = data.ms ?? (step.startedAt ? now - step.startedAt : 0)
  }
}

export function applyPhaseHint(
  trace: ExecutionTraceState,
  data: { phase?: string; label: string },
) {
  const id = `phase-hint:${data.phase || 'gate'}`
  let step = trace.steps.find((s) => s.id === id)
  if (!step) {
    step = {
      id,
      kind: 'phase',
      label: data.label,
      status: 'waiting_user',
      startedAt: Date.now(),
    }
    trace.steps.push(step)
  } else {
    step.label = data.label
    step.status = 'waiting_user'
  }
}

export function applyStructuredError(
  trace: ExecutionTraceState,
  data: {
    message?: string
    error_type?: string
    retry_hint?: string
    tool_name?: string
  },
) {
  const { label, detail } = formatStructuredError(data)
  const now = Date.now()
  trace.steps.push({
    id: nextStepId('error'),
    kind: 'phase',
    label,
    detail,
    status: 'failed',
    startedAt: now,
    endedAt: now,
    ms: 0,
    meta: data.error_type ? { errorCode: data.error_type } : undefined,
  })
}

export function applyThinking(
  trace: ExecutionTraceState,
  data: { status: string; summary?: string },
) {
  const id = 'thinking:parse'
  let step = trace.steps.find((s) => s.id === id)
  if (!step) {
    step = {
      id,
      kind: 'thinking',
      label: '思考中…',
      status: data.status === 'done' ? 'done' : 'running',
      startedAt: Date.now(),
      detail: data.summary,
    }
    trace.steps.unshift(step)
  } else {
    step.status = data.status === 'done' ? 'done' : 'running'
    if (data.summary) step.detail = data.summary
    if (data.status === 'done') completeStep(step)
  }
}

export function applyExplore(
  trace: ExecutionTraceState,
  data: {
    label?: string
    nodeCount?: number
    nodeTitles?: string[]
    episodicUsed?: boolean
    topicSwitch?: boolean
  },
) {
  const titles = (data.nodeTitles || []).slice(0, 3).join('、')
  const suffix = (data.nodeCount || 0) > 3 ? '等' : ''
  const detailParts: string[] = []
  if (titles) detailParts.push(titles + suffix)
  if (data.topicSwitch) detailParts.push('已切换话题，未引用历史任务')
  else if (data.episodicUsed === false) detailParts.push('未引用历史对话')
  const now = Date.now()
  trace.steps.push({
    id: nextStepId('explore'),
    kind: 'explore',
    label: data.label || '参考画布上下文',
    detail: detailParts.join('；') || `已参考 ${data.nodeCount ?? 0} 个节点`,
    status: 'done',
    startedAt: now,
    endedAt: now,
    ms: 0,
  })
}

export function applyTextReplaceStage(trace: ExecutionTraceState, text: string) {
  const label = labelFromTextReplace(text)
  if (!label) return
  if (trace.steps.some((s) => s.kind === 'phase' && s.label === label)) return
  upsertTextStage(trace, label, text.slice(0, 120))
}

export function applyCanvasAction(trace: ExecutionTraceState, action: CanvasAction) {
  const label = canvasActionLabel(action)
  const nodeId = action.payload?.id
  const now = Date.now()
  const step: ExecutionStep = {
    id: nextStepId('canvas'),
    kind: 'canvas',
    label,
    status: 'done',
    startedAt: now,
    endedAt: now,
    ms: 0,
    meta: nodeId ? { nodeId } : undefined,
  }
  attachParentStep(trace, step)
  trace.steps.push(step)
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
    errorCode?: string
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
    attachParentStep(trace, step)
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
    if (data.errorCode) {
      step.meta = { ...step.meta, errorCode: data.errorCode }
    }
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
