import type { UsageCategoryBreakdown, UsageDayPoint } from '@/services/users-api'

export interface UsageTableTotals {
  generationCount: number
  netConsumed: number
  byCategory: UsageCategoryBreakdown
}

const SH_OFFSET_MS = 8 * 60 * 60 * 1000

export function isUsageActivityDay(day: UsageDayPoint): boolean {
  return day.generationCount > 0 || day.netConsumed > 0
}

export const USAGE_TABLE_COLUMNS = ['日期', '生成次数', '积分消耗', '文本', '图片', '音频', '视频'] as const

function csvLine(cells: Array<string | number>): string {
  return cells.join(',')
}

export function buildUsageDayTableCsv(days: UsageDayPoint[], totals: UsageTableTotals): string {
  const rows = days
    .filter(isUsageActivityDay)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
  const lines = [
    csvLine([...USAGE_TABLE_COLUMNS]),
    ...rows.map((day) =>
      csvLine([
        day.date,
        day.generationCount,
        day.netConsumed,
        day.byCategory.text,
        day.byCategory.image,
        day.byCategory.audio,
        day.byCategory.video,
      ]),
    ),
    csvLine([
      '合计',
      totals.generationCount,
      totals.netConsumed,
      totals.byCategory.text,
      totals.byCategory.image,
      totals.byCategory.audio,
      totals.byCategory.video,
    ]),
  ]
  return `\uFEFF${lines.join('\n')}\n`
}

export function usageCsvFileName(now = new Date()): string {
  const shifted = new Date(now.getTime() + SH_OFFSET_MS)
  return `lnkpi-usage-${shifted.toISOString().slice(0, 10)}.csv`
}
