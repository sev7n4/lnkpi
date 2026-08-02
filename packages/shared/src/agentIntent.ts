/** Mirror of `services/agent-runtime/app/graph/intent.py` MODIFY_HINTS (W9). */
export const MODIFY_INTENT_KEYWORDS = [
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
] as const

/** Client-side modify intent detection for chip-set suppression (W9). */
export function hasModifyIntent(text: string | undefined): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (t === '3' || t === 'C' || t === 'c') return true
  return MODIFY_INTENT_KEYWORDS.some((kw) => t.includes(kw))
}
