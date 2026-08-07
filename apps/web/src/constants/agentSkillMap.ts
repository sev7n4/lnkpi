/**
 * Agent dock skills — only entries with Nest → Runtime mapping (see agent-skill-map.ts).
 * Unconnected placeholders (分镜/润色/整理) are omitted until Skill packages exist.
 */

export interface AgentSkillDef {
  id: string
  label: string
  desc: string
  /** Runtime skill directory name (validated by discover_skills). */
  runtimeSkillId: string
}

/** Backend-connected skills shown in the Agent dock 「技能」 menu. */
export const AGENT_SKILLS: AgentSkillDef[] = [
  {
    id: 'canvas',
    label: '营销方案编排',
    desc: '多节点 Campaign 方案与画布拆分（enterprise-marketing-campaign）',
    runtimeSkillId: 'enterprise-marketing-campaign',
  },
]

export function getAgentSkill(id: string | null | undefined): AgentSkillDef | undefined {
  if (!id) return undefined
  return AGENT_SKILLS.find((s) => s.id === id)
}

export const AGENT_INPUT_PLACEHOLDER_AUTO =
  '描述需求，@ 引用素材，Cmd/Ctrl + Enter 发送…'

export function agentInputPlaceholder(skill: AgentSkillDef | undefined): string {
  if (!skill) return AGENT_INPUT_PLACEHOLDER_AUTO
  return `已选技能「${skill.label}」— 描述编排需求，Cmd/Ctrl + Enter 发送…`
}
