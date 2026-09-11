import { guideGroupLabel } from '@lnkpi/shared'
import type { GuideGroupId } from '@lnkpi/shared'

const UNGROUPED_GROUP_ID = 'ungrouped'
const UNGROUPED_GROUP_LABEL = '其他'

export function filterGuideItems<
  T extends { id: string; label: string; description: string; groupId?: string },
>(items: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return items
  }

  return items.filter((item) => {
    const fields = [item.id, item.label, item.description]
    if (item.groupId) {
      fields.push(item.groupId)
    }
    return fields.some((field) => field.toLowerCase().includes(normalized))
  })
}

export function groupGuideItems<T extends { groupId?: string }>(
  items: T[],
  order: string[],
): Array<{ groupId: string; groupLabel: string; items: T[] }> {
  const byGroup = new Map<string, T[]>()
  const ungrouped: T[] = []

  for (const item of items) {
    if (!item.groupId) {
      ungrouped.push(item)
      continue
    }
    const bucket = byGroup.get(item.groupId) ?? []
    bucket.push(item)
    byGroup.set(item.groupId, bucket)
  }

  const grouped: Array<{ groupId: string; groupLabel: string; items: T[] }> = []

  for (const groupId of order) {
    const groupItems = byGroup.get(groupId)
    if (!groupItems?.length) {
      continue
    }
    grouped.push({
      groupId,
      groupLabel: guideGroupLabel(groupId as GuideGroupId),
      items: groupItems,
    })
  }

  if (ungrouped.length > 0) {
    grouped.push({
      groupId: UNGROUPED_GROUP_ID,
      groupLabel: UNGROUPED_GROUP_LABEL,
      items: ungrouped,
    })
  }

  return grouped
}
