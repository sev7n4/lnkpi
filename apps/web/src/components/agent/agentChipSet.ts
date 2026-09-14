/** @vitest-environment node */

import { hasModifyIntent } from '@lnkpi/shared'

export type AgentChipSet =
  | 'plan'
  | 'copy'
  | 'topo'
  | 'atomic'
  | 'generation_propose'
  | 'image_qa'
  | 'scheme_select'
  | 'macro_scheme_select'
  | 'delivery_confirm'
  | null

export type AgentToolCallLike = {
  name?: string | null
  result?: unknown
}

// 修复 P2-1 + UX 文案：PLAN_SNIPPETS 兼容新格式 "1. 采纳推荐" 和旧格式 "1 / A"
const PLAN_SNIPPETS = ['1. 采纳推荐', '1 / A', '确认方案', '请选择：'] as const
const COPY_SNIPPETS = ['【主文案草稿】', '写入主文案'] as const
const TOPO_SNIPPETS = ['确认出图', '当前资产拓扑', '要改拓扑'] as const

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

/** Which confirm chip row to show under the agent input. */
export function detectAgentChipSet(
  assistantText: string,
  ctx?: ChipSetContext,
): AgentChipSet {
  // Phase 2b: dock-equivalent confirm (never atomic_create resume)
  if (extractProposeGenerationNodeId(ctx?.toolCalls)) {
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
