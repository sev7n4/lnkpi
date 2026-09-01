export type PointsRangeKey = '7d' | 'month' | 'all'

const SH_OFFSET_MS = 8 * 60 * 60 * 1000

function shanghaiParts(d: Date) {
  const shifted = new Date(d.getTime() + SH_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  }
}

function shanghaiMidnight(y: number, m0: number, day: number) {
  return new Date(Date.UTC(y, m0, day, 0, 0, 0) - SH_OFFSET_MS)
}

export function resolvePointsRange(range: PointsRangeKey, now = new Date()): { from: Date | null; to: Date } {
  const to = now

  switch (range) {
    case 'month': {
      const { y, m } = shanghaiParts(now)
      return { from: shanghaiMidnight(y, m, 1), to }
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to }
    case 'all':
      return { from: null, to }
  }
}
