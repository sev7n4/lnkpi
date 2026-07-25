/** @vitest-environment node */

export type AgentChipSet = 'plan' | 'copy' | 'topo' | null

const PLAN_SNIPPETS = ['1 / A', '确认方案', '请选择：'] as const
const COPY_SNIPPETS = ['【主文案草稿】', '写入主文案'] as const
const TOPO_SNIPPETS = ['确认出图', '当前资产拓扑', '要改拓扑'] as const

/** Which confirm chip row to show under the agent input. */
export function detectAgentChipSet(assistantText: string): AgentChipSet {
  const t = (assistantText || '').trim()
  if (!t) return null
  // Draft + out图门: show topo row (includes 写入主文案 + 确认出图)
  if (t.includes('【主文案草稿】') && TOPO_SNIPPETS.some((s) => t.includes(s))) return 'topo'
  if (COPY_SNIPPETS.some((s) => t.includes(s)) && t.includes('【主文案草稿】')) return 'copy'
  if (TOPO_SNIPPETS.some((s) => t.includes(s))) return 'topo'
  if (COPY_SNIPPETS.some((s) => t.includes(s))) return 'copy'
  if (PLAN_SNIPPETS.some((s) => t.includes(s))) return 'plan'
  return null
}
