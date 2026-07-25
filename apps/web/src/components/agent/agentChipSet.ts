/** @vitest-environment node */

export type AgentChipSet = 'plan' | 'copy' | null

const PLAN_SNIPPET = '请确认是否按此方案拆解画布并出图'
const COPY_SNIPPETS = ['【主文案草稿】', '写入主文案'] as const

/** Which confirm chip row to show under the agent input. */
export function detectAgentChipSet(assistantText: string): AgentChipSet {
  const t = (assistantText || '').trim()
  if (!t) return null
  if (COPY_SNIPPETS.some((s) => t.includes(s))) return 'copy'
  if (t.includes(PLAN_SNIPPET)) return 'plan'
  return null
}
