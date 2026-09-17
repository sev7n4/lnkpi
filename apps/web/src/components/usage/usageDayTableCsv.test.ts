import { describe, expect, it } from 'vitest'
import {
  buildUsageDayTableCsv,
  isUsageActivityDay,
  usageCsvFileName,
  type UsageTableTotals,
} from './usageDayTableCsv'
import type { UsageDayPoint } from '@/services/users-api'

const empty: UsageDayPoint = {
  date: '2026-09-15',
  generationCount: 0,
  netConsumed: 0,
  byCategory: { text: 0, image: 0, audio: 0, video: 0 },
  otherNetConsumed: 0,
}

const totals: UsageTableTotals = {
  generationCount: 9,
  netConsumed: 100,
  byCategory: { text: 1, image: 20, audio: 3, video: 40 },
}

describe('isUsageActivityDay', () => {
  it('keeps consume-only and generation-only days', () => {
    expect(isUsageActivityDay(empty)).toBe(false)
    expect(isUsageActivityDay({ ...empty, netConsumed: 8 })).toBe(true)
    expect(isUsageActivityDay({ ...empty, generationCount: 1 })).toBe(true)
  })
})

describe('buildUsageDayTableCsv', () => {
  it('emits BOM, newest-first activity rows, and overview totals not row sums', () => {
    const csv = buildUsageDayTableCsv(
      [
        { ...empty, date: '2026-09-16', generationCount: 2, netConsumed: 10, byCategory: { ...empty.byCategory, image: 10 } },
        empty,
        { ...empty, date: '2026-09-14', generationCount: 0, netConsumed: 5, byCategory: { ...empty.byCategory, text: 5 } },
      ],
      totals,
    )
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n')
    expect(lines[0]).toBe('日期,生成次数,积分消耗,文本,图片,音频,视频')
    expect(lines[1]).toBe('2026-09-16,2,10,0,10,0,0')
    expect(lines[2]).toBe('2026-09-14,0,5,5,0,0,0')
    expect(lines[3]).toBe('合计,9,100,1,20,3,40')
    expect(lines).toHaveLength(4)
  })
})

describe('usageCsvFileName', () => {
  it('uses the Shanghai calendar day', () => {
    expect(usageCsvFileName(new Date('2026-09-16T12:00:00.000Z'))).toBe('lnkpi-usage-2026-09-16.csv')
    expect(usageCsvFileName(new Date('2026-09-16T16:30:00.000Z'))).toBe('lnkpi-usage-2026-09-17.csv')
  })
})
