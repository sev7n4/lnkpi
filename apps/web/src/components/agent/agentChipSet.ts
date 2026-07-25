/** @vitest-environment node */

export type AgentChipSet = 'plan' | 'copy' | 'topo' | null

const PLAN_SNIPPETS = ['1 / A', '确认方案', '请选择：'] as const
const COPY_SNIPPETS = ['【主文案草稿】', '写入主文案'] as const
const TOPO_SNIPPETS = ['确认出图', '当前资产拓扑', '要改拓扑'] as const

/**
 * 修复 P1-4：上下文感知的 chipSet 检测
 *
 * 之前的问题：仅根据 assistant 文本反推 phase → 用户输入 "3"（修改模式）后，
 * Agent 重新生成包含 "请选择" 的回复，前端就误判为"plan 阶段"，显示 1/A 确认按钮。
 *
 * 修复：必须同时检查"最近用户消息"——如果最近用户消息是"3" 或"修改骨架" 等
 * 显式 modify intent，assistant 回复的 "请选择" 应当被识别为 "modify-mode plan"，不显示 chip
 * （让用户自然地继续对话或等下一轮 plan 生成）
 */
export interface ChipSetContext {
  /** 最近一条用户消息（用于判断用户是否在表达 modify intent） */
  latestUserText?: string
}

// 注意：需与 services/agent-runtime/app/graph/nodes/intake.py 的 _MODIFY_HINTS 保持同步
// 关键词用于检测用户在已有方案上的修改意图（vs 全新需求）
const _MODIFY_INTENT_KEYWORDS = [
  '改成',
  '改一下',
  '修改',
  '调整',
  '换成',
  '改为',
  '更偏',
  '强调',
  '增加',
  '加上',
  '删掉',
  '删除',
  '去掉',
  '移除',
  '再改',
  '改一版',
  '自己说明',
  '自己说',
  '改拓扑',
]

function userJustRequestedModify(latestUserText: string | undefined): boolean {
  if (!latestUserText) return false
  const t = latestUserText.trim()
  if (!t) return false
  // 显式 ABC 选项 + 自定义修改（3/C）→ 后续 assistant 是 modify 模式
  if (t === '3' || t === 'C' || t === 'c') return true
  return _MODIFY_INTENT_KEYWORDS.some((kw) => t.includes(kw))
}

/** Which confirm chip row to show under the agent input. */
export function detectAgentChipSet(
  assistantText: string,
  ctx?: ChipSetContext,
): AgentChipSet {
  const t = (assistantText || '').trim()
  if (!t) return null

  // 修复 P1-4：用户刚刚输入了 modify intent，但 agent 还没完全消化（assistant 还在 plan 阶段）
  // 这种情况下不显示 chip 按钮，让用户继续对话
  if (userJustRequestedModify(ctx?.latestUserText)) {
    return null
  }

  // Draft + out图门: show topo row (includes 写入主文案 + 确认出图)
  if (t.includes('【主文案草稿】') && TOPO_SNIPPETS.some((s) => t.includes(s))) return 'topo'
  if (COPY_SNIPPETS.some((s) => t.includes(s)) && t.includes('【主文案草稿】')) return 'copy'
  if (TOPO_SNIPPETS.some((s) => t.includes(s))) return 'topo'
  if (COPY_SNIPPETS.some((s) => t.includes(s))) return 'copy'
  if (PLAN_SNIPPETS.some((s) => t.includes(s))) return 'plan'
  return null
}
