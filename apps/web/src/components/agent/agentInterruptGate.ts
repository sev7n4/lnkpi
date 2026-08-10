/** @vitest-environment node */

import type { AgentChipSet } from './agentChipSet'

export interface AgentInterruptPayload {
  node?: string | null
  phase?: string | null
  interrupted?: boolean
}

export interface ProductVisualScheme {
  scheme_id: string
  name?: string | null
  recommended?: boolean
  prompt: string
}

export interface ProductVisualImageType {
  type_id: string
  type_label: string
  schemes: ProductVisualScheme[]
  selected_scheme_ids?: string[]
}

export interface ProductVisualPlan {
  visual_intent: {
    primary_goal?: string
    industry_context?: string | null
    confidence?: number
    user_stated_constraints?: string[]
    output_types_requested?: string[]
  }
  image_types: ProductVisualImageType[]
}

const GATE_TO_CHIP: Record<string, AgentChipSet> = {
  await_confirm: 'plan',
  await_copy_confirm: 'copy',
  await_topo: 'topo',
  await_atomic_confirm: 'atomic',
  await_image_qa: 'image_qa',
  await_scheme_select: 'scheme_select',
}

export const IMAGE_QA_OPTIONS = [
  { id: 'retake', label: '重新拍摄', message: '我重新拍摄上传' },
  { id: 'ai_white_bg', label: '生成白底图', message: '生成标准白底图' },
] as const

export type ImageQaOptionId = (typeof IMAGE_QA_OPTIONS)[number]['id']

export const SCHEME_DECISION_PREFIX = '__scheme_decision__'

/** Default checkbox state: recommended per type, else first scheme. */
export function defaultSchemeSelections(plan: ProductVisualPlan | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const imageType of plan?.image_types ?? []) {
    const schemes = imageType.schemes ?? []
    if (!schemes.length) continue
    const recommended = schemes.filter((s) => s.recommended).map((s) => s.scheme_id)
    out[imageType.type_id] =
      schemes.length === 1
        ? [schemes[0].scheme_id]
        : recommended.length
          ? recommended
          : [schemes[0].scheme_id]
  }
  return out
}

/** Types that need user selection (multi-scheme). */
export function selectableImageTypes(plan: ProductVisualPlan | null | undefined): ProductVisualImageType[] {
  return (plan?.image_types ?? []).filter((t) => (t.schemes?.length ?? 0) > 1)
}

export function buildVisualIntentSummary(plan: ProductVisualPlan | null | undefined): string {
  const intent = plan?.visual_intent
  if (!intent) return ''
  const parts: string[] = []
  if (intent.primary_goal) parts.push(intent.primary_goal)
  if (intent.industry_context) parts.push(intent.industry_context)
  const requested = intent.output_types_requested ?? []
  if (requested.length) parts.push(requested.join('、'))
  const constraints = intent.user_stated_constraints ?? []
  if (constraints.length) parts.push(constraints.join('；'))
  return parts.filter(Boolean).join(' · ')
}

export function buildSchemeConfirmMessage(selections: Record<string, string[]>): string {
  const payload = JSON.stringify({ action: 'confirm_schemes', selections })
  return `${SCHEME_DECISION_PREFIX}${payload}`
}

/** Map Runtime SSE ``interrupt`` / thread-state to confirm chip row. */
export function chipSetFromInterrupt(
  payload: AgentInterruptPayload | null | undefined,
): AgentChipSet {
  if (!payload) return null
  const phase = payload.phase?.trim()
  if (phase && GATE_TO_CHIP[phase]) return GATE_TO_CHIP[phase]
  const node = payload.node?.trim()
  if (node && GATE_TO_CHIP[node]) return GATE_TO_CHIP[node]
  if (payload.interrupted) {
    return null
  }
  return null
}

export function interruptPayloadFromThreadState(
  data:
    | {
        phase?: string | null
        interrupted?: boolean
        nextNodes?: string[]
      }
    | null
    | undefined,
): AgentInterruptPayload | null {
  if (!data?.interrupted) return null
  return {
    interrupted: true,
    phase: data.phase ?? null,
    node: data.nextNodes?.[0] ?? null,
  }
}
