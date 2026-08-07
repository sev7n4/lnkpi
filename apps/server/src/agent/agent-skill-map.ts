/** UI skill id → Runtime skill_id. Only ids listed in AGENT_SKILLS (web) should appear here. */
export const SKILL_UI_TO_RUNTIME: Record<string, string | undefined> = {
  canvas: 'enterprise-marketing-campaign',
}

export function mapUiSkillId(uiSkillId?: string): string | undefined {
  if (!uiSkillId) return undefined
  return SKILL_UI_TO_RUNTIME[uiSkillId]
}
