/** @vitest-environment node */

import type { AgentChipSet } from './agentChipSet'
import type { AgentPresentationEnvelope, DeliveryCardGroup } from './presentation/types'

export interface AgentInterruptPayload {
  node?: string | null
  phase?: string | null
  interrupted?: boolean
  imageQaReason?: string | null
  imageQaMetrics?: ImageQaMetrics | null
  visionUsed?: boolean | null
  retakePending?: boolean | null
  effectiveUtterance?: string | null
  presentation?: AgentPresentationEnvelope | null
}

export interface RetakePhaseInput {
  phase?: string | null
  retakePending?: boolean | null
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

export interface ProductVisualMacroScheme {
  id: string
  label?: string | null
  summary?: string | null
  tags?: string[] | null
  recommended?: boolean
  recommend_reason?: string | null
}

export interface ProductVisualShot {
  shot_id: string
  type_id: string
  label?: string | null
  macro_scheme_id?: string | null
  variant_count?: number
}

const GATE_TO_CHIP: Record<string, AgentChipSet> = {
  await_confirm: 'plan',
  await_copy_confirm: 'copy',
  await_topo: 'topo',
  await_atomic_confirm: 'atomic',
  await_image_qa: 'image_qa',
  await_scheme_select: 'scheme_select',
  await_macro_scheme_select: 'macro_scheme_select',
  await_shot_confirm: 'topo',
  await_shot_topo_confirm: 'topo',
  await_delivery_confirm: 'delivery_confirm',
}

export interface ImageQaMetrics {
  is_white_bg?: boolean | null
  is_sharp_enough?: boolean | null
  product_identifiable?: boolean | null
  vision_used?: boolean | null
}

export const IMAGE_QA_OPTIONS = [
  { id: 'confirm_pass', label: '就用这张图，继续', message: '就用这张图，继续' },
  { id: 'retake', label: '重新拍摄', message: '我重新拍摄上传' },
  { id: 'ai_white_bg', label: '生成白底图', message: '生成标准白底图' },
] as const

export type ImageQaOptionId = (typeof IMAGE_QA_OPTIONS)[number]['id']

export const SCHEME_DECISION_PREFIX = '__scheme_decision__'
export const MACRO_SCHEME_DECISION_PREFIX = '__macro_scheme_decision__'
export const DELIVERY_DECISION_PREFIX = '__delivery_decision__'

const MACHINE_PAYLOAD_PREFIXES = [
  SCHEME_DECISION_PREFIX,
  MACRO_SCHEME_DECISION_PREFIX,
  DELIVERY_DECISION_PREFIX,
] as const

const INTERNAL_QA_ERROR_SNIPPETS = [
  '识图模型返回格式异常',
  'vision_format_error',
  'format_error',
] as const

function lineHasMachinePayload(line: string): boolean {
  const trimmed = line.trimStart().replace(/^["']+|["']+$/g, '')
  return MACHINE_PAYLOAD_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

function filterMachinePayloadLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !lineHasMachinePayload(line))
    .join('\n')
    .trim()
}

/** Strip machine-only resume payloads from visible text (spec §2.3). */
export function filterUserVisibleText(content: string): string {
  return filterMachinePayloadLines(content)
}

/** True when bubble content is only machine resume JSON (hide user/assistant bubble). */
export function isMachineOnlyVisibleText(content: string): boolean {
  return !filterMachinePayloadLines(content).trim()
}

/** Strip machine payloads and internal QA error strings from assistant visible text. */
export function filterAssistantVisibleText(content: string): string {
  return filterMachinePayloadLines(content)
    .split('\n')
    .filter((line) => !INTERNAL_QA_ERROR_SNIPPETS.some((snippet) => line.includes(snippet)))
    .join('\n')
    .trim()
}

export function resolveGatePrimaryActionLabel(
  presentation: AgentPresentationEnvelope | null | undefined,
  phase: string | null | undefined,
): string {
  const fromPres = String(presentation?.primary_action?.label ?? '').trim()
  if (fromPres) return fromPres
  if (phase === 'await_shot_confirm') return '确认构图，生成预览'
  if (phase === 'await_shot_topo_confirm' || phase === 'await_topo') {
    const eta = presentation?.body?.eta_min
    if (typeof eta === 'number' && eta > 0) return `开始出图（约 ${eta} 分钟）`
    return '开始出图'
  }
  return '确认出图'
}

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

/** Default macro selection: recommended ids, else first (max 2 enforced server-side). */
export function defaultMacroSchemeSelection(
  schemes: ProductVisualMacroScheme[] | null | undefined,
): string[] {
  const list = schemes ?? []
  if (!list.length) return []
  if (list.length === 1) return [list[0].id]
  const recommended = list.filter((s) => s.recommended).map((s) => s.id)
  if (recommended.length) return recommended.slice(0, 2)
  return [list[0].id]
}

/** Toggle macro checkbox; evict non-recommended ids before recommended when over max. */
export function toggleMacroSchemeSelection(
  current: string[],
  schemeId: string,
  checked: boolean,
  schemes: ProductVisualMacroScheme[] | null | undefined,
  max = 2,
): string[] {
  if (!checked) return current.filter((id) => id !== schemeId)
  if (current.includes(schemeId)) return current

  const recommended = new Set(
    (schemes ?? []).filter((s) => s.recommended).map((s) => s.id),
  )
  const next = [...current, schemeId]
  if (next.length <= max) return next

  for (const id of current) {
    if (!recommended.has(id)) {
      return [...current.filter((x) => x !== id), schemeId]
    }
  }
  return [...current.slice(1), schemeId]
}

export function buildMacroSchemeConfirmMessage(selectedIds: string[]): string {
  const payload = JSON.stringify({ action: 'confirm', selected_ids: selectedIds })
  return `${MACRO_SCHEME_DECISION_PREFIX}${payload}`
}

/** A+B macro footer hint — mirrors runtime copy macro.ab_hint_mixed. */
export function buildMacroAbFooterHint(
  selectedCount: number,
  expectedDeliveryCount?: number | null,
): string {
  if (selectedCount < 2) return ''
  const k = String(selectedCount)
  const p =
    expectedDeliveryCount != null && expectedDeliveryCount > 0
      ? String(expectedDeliveryCount)
      : '若干'
  return `已选 ${k} 套风格 → 预计场景图 ${p} 张。不同构图将分别采用 A/B 风格，并非每个场景各出 2 张。`
}

/** Client-side delivery_cards groups when runtime presentation.groups missing (UX-PV-08). */
export function buildClientDeliveryGroups(
  shots: ProductVisualShot[] | null | undefined,
  genByKey: Record<string, { url?: string | null; title?: string | null }> | null | undefined,
  userLabels: string[] | null | undefined,
  selections: Record<string, string>,
): DeliveryCardGroup[] {
  const groups: DeliveryCardGroup[] = []
  const labels = userLabels ?? []
  const byKey = genByKey ?? {}
  for (let index = 0; index < (shots ?? []).length; index++) {
    const shot = shots![index]
    const shotId = shot.shot_id?.trim()
    if (!shotId) continue
    const variants = Math.max(1, Math.min(3, shot.variant_count ?? 1))
    const keys =
      variants === 1
        ? [shotId]
        : Array.from({ length: variants }, (_, i) => `${shotId}__v${i + 1}`)
    const ready = keys.filter((k) => Boolean(byKey[k]?.url))
    if (!ready.length) continue
    const selected = selections[shotId] || ready[0]
    const macro = shot.macro_scheme_id?.trim()
    const shotLabel = shot.label?.trim() || shotId
    const subtitle = macro ? `[方案${macro}] ${shotLabel}` : shotLabel
    groups.push({
      label: labels[index]?.trim() || shotLabel,
      subtitle,
      shot_id: shotId,
      recommended: selected === ready[0],
      selected_variant_key: selected,
      candidates: ready.map((variantKey, i) => ({
        variant_key: variantKey,
        url: byKey[variantKey]?.url ?? null,
        title: byKey[variantKey]?.title ?? null,
        recommended: i === 0,
      })),
    })
  }
  return groups
}

/** Default variant key per shot (first ready gen key). */
export function defaultShotDeliverySelections(
  shots: ProductVisualShot[] | null | undefined,
  genByKey: Record<string, { url?: string | null }> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  const byKey = genByKey ?? {}
  for (const shot of shots ?? []) {
    const shotId = shot.shot_id
    if (!shotId) continue
    const variants = Math.max(1, Math.min(3, shot.variant_count ?? 1))
    const keys =
      variants === 1
        ? [shotId]
        : Array.from({ length: variants }, (_, i) => `${shotId}__v${i + 1}`)
    const ready = keys.find((k) => byKey[k]?.url)
    if (ready) out[shotId] = ready
  }
  return out
}

export function buildShotDeliverySwitchMessage(shotId: string, variantKey: string): string {
  const payload = JSON.stringify({
    action: 'switch_scheme',
    type_id: shotId,
    scheme_id: variantKey,
  })
  return `${DELIVERY_DECISION_PREFIX}${payload}`
}

export function buildShotDeliveryConfirmMessage(selections: Record<string, string>): string {
  const payload = JSON.stringify({ action: 'confirm_delivery', selections })
  return `${DELIVERY_DECISION_PREFIX}${payload}`
}

/** Default single-scheme delivery pick per type (recommended when available). */
export function defaultDeliverySelections(
  plan: ProductVisualPlan | null | undefined,
  genByKey: Record<string, { url?: string | null }> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  const byKey = genByKey ?? {}
  for (const imageType of plan?.image_types ?? []) {
    const typeId = imageType.type_id
    const schemes = imageType.schemes ?? []
    const selectedIds = imageType.selected_scheme_ids ?? []
    const candidateIds = selectedIds.filter((sid) => byKey[`${typeId}__${sid}`])
    const fallbackIds =
      candidateIds.length > 0
        ? candidateIds
        : schemes
            .map((s) => s.scheme_id)
            .filter((sid) => byKey[`${typeId}__${sid}`])
    const pool = fallbackIds.length ? fallbackIds : selectedIds.length ? selectedIds : schemes.map((s) => s.scheme_id)
    if (!pool.length) continue
    const recommended = schemes.filter((s) => s.recommended).map((s) => s.scheme_id)
    const pick = recommended.find((sid) => pool.includes(sid)) ?? pool[0]
    out[typeId] = pick
  }
  return out
}

export function buildDeliverySwitchMessage(typeId: string, schemeId: string): string {
  const payload = JSON.stringify({ action: 'switch_scheme', type_id: typeId, scheme_id: schemeId })
  return `${DELIVERY_DECISION_PREFIX}${payload}`
}

export function buildDeliveryRefineMessage(typeId: string, schemeId: string, feedback: string): string {
  const payload = JSON.stringify({
    action: 'refine_type',
    type_id: typeId,
    scheme_id: schemeId,
    feedback,
  })
  return `${DELIVERY_DECISION_PREFIX}${payload}`
}

export function buildDeliveryConfirmMessage(selections: Record<string, string>): string {
  const payload = JSON.stringify({ action: 'confirm_delivery', selections })
  return `${DELIVERY_DECISION_PREFIX}${payload}`
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

/** UX-PV-12: retake flow awaiting new upload + continue with stored utterance. */
export function isRetakePendingPhase(data: RetakePhaseInput | null | undefined): boolean {
  if (!data) return false
  if (data.retakePending === true) return true
  return data.phase === 'await_retake_upload'
}

/** Resend stored demand after retake upload (message body = effective_utterance). */
export function buildRetakeContinueMessage(effectiveUtterance: string): string {
  return effectiveUtterance.trim()
}

export interface ImageQaOption {
  id: string
  label: string
  message: string
}

/** User-facing QA title from presentation envelope (never raw imageQaReason). */
export function resolveImageQaTitle(
  presentation: AgentPresentationEnvelope | null | undefined,
): string {
  return String(presentation?.title ?? '').trim()
}

export function resolveImageQaBodyText(
  presentation: AgentPresentationEnvelope | null | undefined,
): string {
  const understanding = String(presentation?.body?.understanding ?? '').trim()
  const text = String(presentation?.body?.text ?? '').trim()
  if (understanding && text) return `${understanding}\n${text}`
  return understanding || text
}

export function resolveImageQaChecks(
  presentation: AgentPresentationEnvelope | null | undefined,
): Array<{ label: string; ok: boolean }> {
  return presentation?.body?.checks ?? []
}

/** Option chips from presentation.options, else IMAGE_QA_OPTIONS labels. */
export function resolveImageQaOptions(
  presentation: AgentPresentationEnvelope | null | undefined,
): ReadonlyArray<ImageQaOption> {
  const fromPres = presentation?.options
  if (fromPres?.length) {
    return fromPres.map((o) => ({
      id: o.id,
      label: o.label,
      message: o.message,
    }))
  }
  return IMAGE_QA_OPTIONS
}

export function interruptPayloadFromThreadState(
  data:
    | {
        phase?: string | null
        interrupted?: boolean
        nextNodes?: string[]
        presentation?: AgentPresentationEnvelope | null
        retakePending?: boolean | null
        effectiveUtterance?: string | null
        imageQaReason?: string | null
        imageQaMetrics?: ImageQaMetrics | null
      }
    | null
    | undefined,
): AgentInterruptPayload | null {
  if (!data) return null
  if (!data.interrupted && !isRetakePendingPhase(data)) return null
  return {
    interrupted: true,
    phase: data.phase ?? null,
    node: data.nextNodes?.[0] ?? null,
    presentation: data.presentation ?? null,
    retakePending: data.retakePending ?? null,
    effectiveUtterance: data.effectiveUtterance ?? null,
    imageQaReason: data.imageQaReason ?? null,
    imageQaMetrics: data.imageQaMetrics ?? null,
  }
}
