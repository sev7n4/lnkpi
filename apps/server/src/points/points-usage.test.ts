import { describe, expect, it } from 'vitest'
import {
  coerceDayKey,
  fillCalendarDays,
  filterHeatmapDays,
  foldDailyUsage,
  generationCountFromParts,
  isUsageActivityDay,
  netFromKindCategorySums,
} from './points-usage'

describe('netFromKindCategorySums', () => {
  it('nets consume and refund and ignores grant', () => {
    const net = netFromKindCategorySums([
      { kind: 'consume', category: 'image', amountSum: -30 },
      { kind: 'refund', category: 'image', amountSum: 10 },
      { kind: 'grant', category: 'other', amountSum: 100 },
      { kind: 'consume', category: 'other', amountSum: -5 },
    ])
    expect(net.byCategory.image).toBe(20)
    expect(net.otherNetConsumed).toBe(5)
    expect(net.netConsumedTotal).toBe(25)
  })
})

describe('generationCountFromParts', () => {
  it('adds distinct ids and null rows; ignores refund', () => {
    expect(generationCountFromParts({ distinctGens: 2, nullGens: 1 })).toBe(3)
  })
})

describe('coerceDayKey', () => {
  it('keeps YYYY-MM-DD and drops null', () => {
    expect(coerceDayKey('2026-09-16')).toBe('2026-09-16')
    expect(coerceDayKey(null)).toBeNull()
  })

  it('maps UTC evening to the next Shanghai calendar day', () => {
    expect(coerceDayKey(new Date('2026-09-16T16:30:00.000Z'))).toBe('2026-09-17')
  })
})

describe('foldDailyUsage', () => {
  it('drops null day buckets so they cannot collapse the calendar', () => {
    const days = foldDailyUsage(
      [{ day: null as unknown as string, kind: 'consume', category: 'image', amountSum: -20 }],
      [{ day: null as unknown as string, distinctGens: 1, nullGens: 0 }],
    )
    expect(days).toEqual([])
  })

  it('nets same-day refund and counts consume gens', () => {
    const days = foldDailyUsage(
      [
        { day: '2026-09-14', kind: 'consume', category: 'image', amountSum: -80 },
        { day: '2026-09-14', kind: 'refund', category: 'image', amountSum: 80 },
        { day: '2026-09-15', kind: 'consume', category: 'video', amountSum: -40 },
        { day: '2026-09-15', kind: 'grant', category: 'other', amountSum: 100 },
      ],
      [
        { day: '2026-09-14', distinctGens: 1, nullGens: 0 },
        { day: '2026-09-15', distinctGens: 1, nullGens: 0 },
      ],
    )
    expect(days).toEqual([
      {
        date: '2026-09-14',
        generationCount: 1,
        netConsumed: 0,
        byCategory: { text: 0, image: 0, audio: 0, video: 0 },
        otherNetConsumed: 0,
      },
      {
        date: '2026-09-15',
        generationCount: 1,
        netConsumed: 40,
        byCategory: { text: 0, image: 0, audio: 0, video: 40 },
        otherNetConsumed: 0,
      },
    ])
  })
})

describe('isUsageActivityDay', () => {
  const empty = {
    date: '2026-09-15',
    generationCount: 0,
    netConsumed: 0,
    byCategory: { text: 0, image: 0, audio: 0, video: 0 },
    otherNetConsumed: 0,
  }

  it('keeps consume-only and generation-only days, drops empty calendar days', () => {
    expect(isUsageActivityDay(empty)).toBe(false)
    expect(isUsageActivityDay({ ...empty, netConsumed: 10 })).toBe(true)
    expect(isUsageActivityDay({ ...empty, generationCount: 1 })).toBe(true)
  })
})

describe('fillCalendarDays', () => {
  it('inserts zero days ascending', () => {
    const filled = fillCalendarDays('2026-09-14', '2026-09-16', [
      {
        date: '2026-09-15',
        generationCount: 1,
        netConsumed: 10,
        byCategory: { text: 0, image: 10, audio: 0, video: 0 },
        otherNetConsumed: 0,
      },
    ])
    expect(filled.map((d) => d.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(filled[0].generationCount).toBe(0)
    expect(filled[1].netConsumed).toBe(10)
  })
})

describe('filterHeatmapDays', () => {
  it('keeps net>0 or generationCount>0', () => {
    const rows = filterHeatmapDays([
      {
        date: '2026-09-14',
        generationCount: 1,
        netConsumed: 0,
        byCategory: { text: 0, image: 0, audio: 0, video: 0 },
        otherNetConsumed: 0,
      },
      {
        date: '2026-09-15',
        generationCount: 0,
        netConsumed: 0,
        byCategory: { text: 0, image: 0, audio: 0, video: 0 },
        otherNetConsumed: 0,
      },
    ])
    expect(rows).toEqual([{ date: '2026-09-14', netConsumed: 0, generationCount: 1 }])
  })

  it('drops null dates so heatmap cells can match YYYY-MM-DD', () => {
    expect(
      filterHeatmapDays([
        {
          date: null as unknown as string,
          generationCount: 2,
          netConsumed: 30,
          byCategory: { text: 0, image: 30, audio: 0, video: 0 },
          otherNetConsumed: 0,
        },
      ]),
    ).toEqual([])
  })
})
