/** UI skill id → Runtime skill_id. Only ids listed in AGENT_SKILLS (web) should appear here. */
export const SKILL_UI_TO_RUNTIME: Record<string, string | undefined> = {
  canvas: 'enterprise-marketing-campaign',
  'product-visual': 'ecommerce-product-visual',
}

export function mapUiSkillId(uiSkillId?: string): string | undefined {
  if (!uiSkillId) return undefined
  const mapped = SKILL_UI_TO_RUNTIME[uiSkillId]
  if (mapped) return mapped
  // Allow runtime skill_id pass-through for API / tests.
  if (uiSkillId === 'ecommerce-product-visual') return uiSkillId
  return undefined
}
