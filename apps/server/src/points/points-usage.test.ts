import { describe, expect, it } from 'vitest'
import {
  fillCalendarDays,
  filterHeatmapDays,
  foldDailyUsage,
  generationCountFromParts,
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

describe('foldDailyUsage', () => {
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
})
