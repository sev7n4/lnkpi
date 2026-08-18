export interface GroupChildNode {
  id: string
  type?: string
  parentNode?: string
  data?: Record<string, unknown>
}

export function getGroupChildIds(nodes: GroupChildNode[], groupId: string): string[] {
  const fromData = nodes.find((n) => n.id === groupId)?.data?.childIds
  const linked = nodes.filter((n) => n.parentNode === groupId).map((n) => n.id)
  if (!linked.length) return Array.isArray(fromData) ? fromData.filter((x): x is string => typeof x === 'string') : []
  const merged = [...(Array.isArray(fromData) ? fromData : []), ...linked]
  return [...new Set(merged.filter((x): x is string => typeof x === 'string'))]
}
