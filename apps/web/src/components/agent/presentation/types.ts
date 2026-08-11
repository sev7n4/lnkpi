/** Product visual v2 presentation envelope (runtime SSE / thread-state). */

export interface AgentPresentationStepper {
  current: string
  completed: string[]
}

export interface AgentPresentationPrimaryAction {
  label: string
  message: string
}

export interface MacroSchemeCardBody {
  id: string
  label?: string
  summary?: string
  tags?: string[]
  recommended?: boolean
  recommend_reason?: string | null
}

export interface TopoCardNode {
  key: string
  title: string
  category: string
  depends_on_labels?: string[]
  node_id?: string
}

export interface AgentPresentationBody {
  text?: string
  footer_hint?: string
  expected_delivery_count?: number
  checks?: Array<{ label: string; ok: boolean }>
  callout?: string
  prose?: string
  schemes?: MacroSchemeCardBody[]
  max_select?: number
  nodes?: TopoCardNode[]
  eta_min?: number
  scene_count?: number
  credits_hint?: string
  mermaid?: string
}

export interface AgentPresentationEnvelope {
  kind: string
  stepper: AgentPresentationStepper
  context_recap?: string
  title?: string
  body?: AgentPresentationBody
  primary_action?: AgentPresentationPrimaryAction
  secondary_actions?: AgentPresentationPrimaryAction[]
  options?: Array<{ id: string; label: string; message: string }>
}

/** Nine-step product_visual journey labels (spec §1). */
export const PRESENTATION_STEPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'image_qa', label: '检查产品图' },
  { id: 'scheme_draft', label: '理解需求 · 出方案' },
  { id: 'macro_select', label: '选宏观风格' },
  { id: 'ssot_persist', label: '方案落盘' },
  { id: 'shot_plan', label: '定构图清单' },
  { id: 'topo_preview', label: '预览出图计划' },
  { id: 'generating', label: '出图中' },
  { id: 'delivery', label: '选定稿' },
  { id: 'done', label: '交付完成' },
]
