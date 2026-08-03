export const SKILL_UI_TO_RUNTIME: Record<string, string | undefined> = {
  canvas: 'enterprise-marketing-campaign',
  storyboard: undefined,
  polish: undefined,
  organize: undefined,
}

export function mapUiSkillId(uiSkillId?: string): string | undefined {
  if (!uiSkillId) return undefined
  return SKILL_UI_TO_RUNTIME[uiSkillId]
}
