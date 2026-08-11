/** Product visual v2 presentation envelope (runtime SSE / thread-state). */

export interface AgentPresentationStepper {
  current: string
  completed: string[]
}

export interface AgentPresentationPrimaryAction {
  label: string
  message: string
  disabled?: boolean
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

export interface ShotTableRow {
  shot_id: string
  label: string
  type: string
  summary?: string
  node_id?: string | null
}

export interface DeliverySummaryFinalizedRow {
  title: string
  macro?: string
  node_id?: string
  shot_id?: string
}

export interface DeliverySummaryBasicsRow {
  title: string
  node_id?: string
  optional?: boolean
}

export interface DeliveryCardCandidate {
  variant_key: string
  url?: string | null
  title?: string | null
  recommended?: boolean
}

export interface DeliveryCardGroup {
  label: string
  subtitle?: string
  shot_id: string
  recommended?: boolean
  selected_variant_key?: string | null
  candidates: DeliveryCardCandidate[]
}

export interface AgentPresentationBody {
  text?: string
  footer_hint?: string
  expected_delivery_count?: number
  hint?: string
  groups?: DeliveryCardGroup[]
  checks?: Array<{ label: string; ok: boolean }>
  callout?: string
  callout_conflict?: string
  prose?: string
  schemes?: MacroSchemeCardBody[]
  max_select?: number
  nodes?: TopoCardNode[]
  eta_min?: number
  scene_count?: number
  credits_hint?: string
  mermaid?: string
  shots?: ShotTableRow[]
  headline?: string
  finalized?: DeliverySummaryFinalizedRow[]
  basics?: DeliverySummaryBasicsRow[]
  basics_section_title?: string
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
