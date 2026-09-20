/** @vitest-environment node */

import { hasModifyIntent } from '@lnkpi/shared'

export type AgentChipSet =
  | 'plan'
  | 'copy'
  | 'topo'
  | 'atomic'
  | 'generation_propose'
  | 'recipe_confirm'
  | 'recipe_promote'
  | 'recipe_promote_seed'
  | 'recipe_promote_variant'
  | 'image_qa'
  | 'scheme_select'
  | 'macro_scheme_select'
  | 'delivery_confirm'
  | null

export type AgentToolCallLike = {
  name?: string | null
  result?: unknown
}

/** Minimal canvas node shape for pending_confirm SSOT recover (Phase 2c.1). */
export type CanvasNodeLike = {
  id: string
  /** Align with taskProgressReconcile.CanvasNodeLike (null allowed). */
  data?: Record<string, unknown> | null
}

// 修复 P2-1 + UX 文案：PLAN_SNIPPETS 兼容新格式 "1. 采纳推荐" 和旧格式 "1 / A"
const PLAN_SNIPPETS = ['1. 采纳推荐', '1 / A', '确认方案', '请选择：'] as const
const COPY_SNIPPETS = ['【主文案草稿】', '写入主文案'] as const
const TOPO_SNIPPETS = ['确认出图', '当前资产拓扑', '要改拓扑'] as const
const RECIPE_CONFIRM_SNIPPETS = ['请确认是否把改动落到画布', '请确认是否把构图落到画布'] as const
const RECIPE_PROMOTE_SNIPPETS = ['这份工作流更像哪一种'] as const
const RECIPE_PROMOTE_SEED_SNIPPETS = ['将锁定这些核心步骤'] as const
const RECIPE_PROMOTE_VARIANT_SNIPPETS = ['请确认是否保存为改版'] as const

/**
 * 修复 P1-4 + P2-1：上下文感知的 chipSet 检测
 *
 * 优先级：
 * 1. 如果 assistant 已回复 confirm/copy/topo 选项 → 显示对应按钮
 *    （即使玩家之前输入了 modify intent，agent 已消化并回复新 confirm，应该显示按钮让用户确认）
 * 2. 如果用户刚输入 modify intent + assistant 回复的是过渡消息（不含 confirm 选项）→ 抑制
 *    （agent 还在处理 modify，等它完成）
 */
export interface ChipSetContext {
  /** 最近一条用户消息（用于判断用户是否在表达 modify intent） */
  latestUserText?: string
  /** 最近一条 assistant 的 toolCalls（用于 Phase 2b propose_generation） */
  toolCalls?: AgentToolCallLike[] | null
  /** Phase 2c.1: canvas nodes for pending_confirm SSOT recover */
  canvasNodes?: CanvasNodeLike[] | null
  /** Phase 2c.1: selected node id (selected pending wins) */
  selectedNodeId?: string | null
}

function userJustRequestedModify(latestUserText: string | undefined): boolean {
  return hasModifyIntent(latestUserText)
}

function parseToolResult(result: unknown): Record<string, unknown> | null {
  if (result == null) return null
  if (typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>
  }
  if (typeof result === 'string') {
    const trimmed = result.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

function nodeIdFromProposePayload(payload: Record<string, unknown>): string | null {
  const status = payload.status
  if (status !== 'pending_confirm') return null
  const raw = payload.nodeId ?? payload.node_id
  if (typeof raw !== 'string') return null
  const nodeId = raw.trim()
  return nodeId || null
}

/**
 * Last successful `propose_generation` with `status: pending_confirm` → nodeId.
 * Accepts dict or JSON-string tool results; prefers camelCase `nodeId`, falls back to `node_id`.
 */
export function extractProposeGenerationNodeId(
  toolCalls: AgentToolCallLike[] | null | undefined,
): string | null {
  if (!toolCalls?.length) return null
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const tc = toolCalls[i]
    if (String(tc?.name ?? '').trim() !== 'propose_generation') continue
    const payload = parseToolResult(tc.result)
    if (!payload) continue
    const nodeId = nodeIdFromProposePayload(payload)
    if (nodeId) return nodeId
  }
  return null
}

function timestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value)
    if (Number.isFinite(asNum) && value.trim() === String(asNum)) return asNum
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.NEGATIVE_INFINITY
}

/**
 * Phase 2c.1 §1.2: which pending_confirm node drives the side-rail chip.
 * Selected pending wins; else newest by updatedAt → createdAt; tie-break by id.
 */
export function resolvePendingConfirmNodeId(
  nodes: CanvasNodeLike[] | null | undefined,
  selectedNodeId?: string | null,
): string | null {
  if (!nodes?.length) return null
  const pending = nodes.filter((n) => n?.data?.status === 'pending_confirm')
  if (!pending.length) return null

  const selected = String(selectedNodeId ?? '').trim()
  if (selected && pending.some((n) => n.id === selected)) return selected

  pending.sort((a, b) => {
    const aUpdated = timestampMs(a.data?.updatedAt)
    const bUpdated = timestampMs(b.data?.updatedAt)
    const aCreated = timestampMs(a.data?.createdAt)
    const bCreated = timestampMs(b.data?.createdAt)
    const aTs = aUpdated > Number.NEGATIVE_INFINITY ? aUpdated : aCreated
    const bTs = bUpdated > Number.NEGATIVE_INFINITY ? bUpdated : bCreated
    if (bTs !== aTs) return bTs - aTs
    return String(b.id).localeCompare(String(a.id))
  })
  return pending[0]?.id ?? null
}

export type ConfirmProposeDeps = {
  generateForNode: (nodeId: string) => void | Promise<void>
  sendPreset?: (text: string) => void | Promise<void>
}

/**
 * Phase 2c.1 C2: confirm propose → dock generateForNode only (never sendPreset / atomic).
 */
export async function confirmProposeGeneration(
  nodeId: string,
  deps: ConfirmProposeDeps,
): Promise<void> {
  const id = String(nodeId ?? '').trim()
  if (!id) return
  await deps.generateForNode(id)
}

/**
 * Phase 2c.3 E1: pending_confirm beats await_atomic_confirm interrupt chips.
 * Other interrupt chip sets are unchanged.
 */
export function applyAtomicProposeChipPriority(
  interruptChip: AgentChipSet,
  pendingNodeId: string | null | undefined,
): AgentChipSet {
  if (interruptChip === 'atomic' && String(pendingNodeId ?? '').trim()) {
    return 'generation_propose'
  }
  return interruptChip
}

const MEDIA_NODE_TYPES = new Set(['image', 'video', 'text', 'audio'])

export type ResolveAtomicConfirmNodeInput = {
  canvasNodes?: CanvasNodeLike[] | null
  selectedNodeId?: string | null
  /** Thread-state atomicNodeId from Nest/runtime */
  atomicNodeId?: string | null
  /** Optional selected node type (image/video/…) */
  selectedNodeType?: string | null
}

/**
 * Phase 2c.3 §3.2: pending → atomicNodeId → selected media node → null.
 */
export function resolveAtomicConfirmNodeId(
  input: ResolveAtomicConfirmNodeInput,
): string | null {
  const pending = resolvePendingConfirmNodeId(input.canvasNodes, input.selectedNodeId)
  if (pending) return pending

  const fromThread = String(input.atomicNodeId ?? '').trim()
  if (fromThread) return fromThread

  const selected = String(input.selectedNodeId ?? '').trim()
  if (!selected) return null

  const typeHint = String(input.selectedNodeType ?? '').trim()
  if (MEDIA_NODE_TYPES.has(typeHint)) return selected

  const node = input.canvasNodes?.find((n) => n.id === selected)
  const dataType = String(node?.data?.type ?? '').trim()
  if (MEDIA_NODE_TYPES.has(dataType)) return selected
  // Vue-flow nodes often store type on the node object; allow via data._type fallback only.
  return null
}

export type ConfirmAtomicDeps = {
  generateForNode: (nodeId: string) => void | Promise<void>
  sendPreset: (text: string) => void | Promise<void>
  /** Clear local interrupt gate + resume revise/cancel (no atomic gen). */
  unwindAtomicInterrupt?: () => void | Promise<void>
}

/**
 * Phase 2c.3 E2/E3: prefer dock generateForNode; fallback sendPreset only if no nodeId.
 */
export async function confirmAtomicGeneration(
  nodeId: string | null | undefined,
  deps: ConfirmAtomicDeps,
): Promise<'dock' | 'preset'> {
  const id = String(nodeId ?? '').trim()
  if (id) {
    await deps.unwindAtomicInterrupt?.()
    await deps.generateForNode(id)
    return 'dock'
  }
  await deps.sendPreset('确认生成')
  return 'preset'
}

export function canvasHasRecipeParent(nodes: CanvasNodeLike[] | null | undefined): boolean {
  return Boolean(
    nodes?.some((node) => {
      const recipeId = String(node?.data?.recipeId ?? '').trim()
      const parentRecipeId = String(node?.data?.parentRecipeId ?? '').trim()
      return Boolean(recipeId || parentRecipeId)
    }),
  )
}

/** Which confirm chip row to show under the agent input. */
export function detectAgentChipSet(
  assistantText: string,
  ctx?: ChipSetContext,
): AgentChipSet {
  // Phase 2b: dock-equivalent confirm (never atomic_create resume)
  if (extractProposeGenerationNodeId(ctx?.toolCalls)) {
    return 'generation_propose'
  }

  // Phase 2c.1 C1: recover generation_propose from canvas pending_confirm SSOT
  if (resolvePendingConfirmNodeId(ctx?.canvasNodes, ctx?.selectedNodeId)) {
    return 'generation_propose'
  }

  const t = (assistantText || '').trim()
  if (!t) return null

  // 修复 P2-1：优先检查 assistant 是否已回复 confirm/copy/topo 选项
  // 如果已回复，显示对应按钮（即使用户之前输入了 modify intent）
  // 这允许 modify → agent 重新生成 → 新 confirm → 用户确认 的完整流程
  if (t.includes('【主文案草稿】') && !t.includes('已将确认的主文案写入')) return 'copy'
  if (t.includes('【主文案草稿】') && TOPO_SNIPPETS.some((s) => t.includes(s))) return 'topo'
  if (t.includes('视频/音频生成将消耗积分')) return 'atomic'
  if (t.includes('提交前需你确认')) return 'atomic'
  if (RECIPE_CONFIRM_SNIPPETS.some((s) => t.includes(s))) return 'recipe_confirm'
  if (RECIPE_PROMOTE_SEED_SNIPPETS.some((s) => t.includes(s))) return 'recipe_promote_seed'
  if (RECIPE_PROMOTE_VARIANT_SNIPPETS.some((s) => t.includes(s))) return 'recipe_promote_variant'
  if (RECIPE_PROMOTE_SNIPPETS.some((s) => t.includes(s))) return 'recipe_promote'
  if (TOPO_SNIPPETS.some((s) => t.includes(s))) return 'topo'
  if (COPY_SNIPPETS.some((s) => t.includes(s))) return 'copy'
  if (PLAN_SNIPPETS.some((s) => t.includes(s))) return 'plan'

  // 修复 P1-4：用户刚输入 modify intent，但 agent 还在处理（assistant 回复过渡消息）
  // 此时 assistant 回复的是"正在基于当前方案调整…"之类的过渡消息，不含 confirm 选项
  // 不显示 chip 按钮，让用户等 agent 完成重新生成
  if (userJustRequestedModify(ctx?.latestUserText)) {
    return null
  }

  return null
}

/**
 * propose 卡片节点解析：画布 pending_confirm SSOT 优先，toolCalls 提取兜底。
 *
 * 回归背景（2026-09-21）：多节点 propose 场景下确认卡片出卡时序不稳定——
 * 旧优先级（extract ?? SSOT）在最后一轮消息含 propose toolCalls 时，
 * 确认该节点后 extract 仍返回同一 nodeId，latch 命中且 ?? 短路使 SSOT
 * 永不被咨询 → 下一张卡片死等 agent 下一轮 turn（几十秒到几分钟）。
 * 现改为 SSOT 优先：确认一张后节点状态离开 pending_confirm，computed
 * 立即重算出下一张；extract 仅覆盖「toolCalls 已返回、画布节点尚未落库」
 * 的竞态窗口。
 */
export function resolveProposeChipNodeId(input: {
  toolCalls?: AgentToolCallLike[] | null
  canvasNodes?: CanvasNodeLike[] | null
  selectedNodeId?: string | null
}): string | null {
  const fromCanvas = resolvePendingConfirmNodeId(input.canvasNodes, input.selectedNodeId)
  if (fromCanvas) return fromCanvas
  return extractProposeGenerationNodeId(input.toolCalls)
}
