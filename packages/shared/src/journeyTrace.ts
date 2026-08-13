export type JourneyStepId =
  | 'image_qa' | 'scheme_draft' | 'macro_select' | 'ssot_persist'
  | 'shot_plan' | 'topo_preview' | 'generating' | 'delivery' | 'done'

export type JourneyStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface JourneyStepRecord {
  id: JourneyStepId
  label: string
  status: JourneyStepStatus
  enteredAt?: string
  completedAt?: string
  ms?: number
  summary?: string
  snapshot?: Record<string, unknown>
}

export interface JourneyTraceSnapshot {
  version: 1
  flowMode: 'product_visual'
  steps: JourneyStepRecord[]
  current: JourneyStepId
  startedAt: string
  updatedAt: string
  finishedAt?: string
  totalMs?: number
}

export interface AgentMessageMetadata {
  journeyTrace?: JourneyTraceSnapshot
  executionTrace?: Record<string, unknown>
  presentation?: Record<string, unknown>
  executionEvents?: Array<{ type: string; data: unknown }>
}

export const JOURNEY_STEP_LABELS: Record<JourneyStepId, string> = {
  image_qa: '检查产品图',
  scheme_draft: '理解需求 · 出方案',
  macro_select: '选宏观风格',
  ssot_persist: '方案落盘',
  shot_plan: '定构图清单',
  topo_preview: '预览出图计划',
  generating: '出图中',
  delivery: '选定稿',
  done: '交付完成',
}
