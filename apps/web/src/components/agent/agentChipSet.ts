/** @vitest-environment node */

import { hasModifyIntent } from '@lnkpi/shared'

export type AgentChipSet =
  | 'plan'
  | 'copy'
  | 'topo'
  | 'atomic'
  | 'image_qa'
  | 'scheme_select'
  | 'macro_scheme_select'
  | 'delivery_confirm'
  | null

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
}

function userJustRequestedModify(latestUserText: string | undefined): boolean {
  return hasModifyIntent(latestUserText)
}

/** Which confirm chip row to show under the agent input. */
export function detectAgentChipSet(
  assistantText: string,
  ctx?: ChipSetContext,
): AgentChipSet {
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
