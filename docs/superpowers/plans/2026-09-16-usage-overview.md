# Usage Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/profile` billing tab with an Agnes-style usage overview (lifetime KPI cards, 6-month heatmap, calendar-day trend, daily table with ledger drill-down) on the existing dark profile chrome.

**Architecture:** Pure Shanghai-calendar helpers + daily fold functions first. `MembershipService` loads lifetime totals via Prisma `groupBy` and daily buckets via SQLite `$queryRaw` (`date(datetime(createdAt, '+8 hours'))`). Vue splits into four presentational components; `ProfilePage` fetches `GET /membership/usage` once per usage-tab visit and `GET /membership/usage-days` when the trend range changes. Day ledger reuses `transactions` with `day=YYYY-MM-DD`.

**Tech Stack:** NestJS, Prisma 6 + SQLite, Vue 3 + Vitest + Vue Test Utils, Tailwind / neo tokens, SVG polyline (no chart library).

**Spec:** [docs/superpowers/specs/2026-09-16-usage-overview-agnes-design.md](../specs/2026-09-16-usage-overview-agnes-design.md)

## Global Constraints

- Structure replica of Agnes usage page; dark personal-center skin; heatmap green is the only strong accent
- Tab label **用量**; `?tab=billing` and `?tab=usage` both open it; `router.replace` still writes `tab=billing`
- Three independent windows: lifetime overview, rolling 6 Shanghai calendar months heatmap, trend/table `7d|30d|month` as Shanghai calendar days including today
- Do **not** reuse `resolvePointsRange('7d')` rolling 168h; do **not** change `points-summary`
- Net consume: `max(0, -sum(consume.amount) - sum(refund.amount))` per category; grant excluded; daily net does not replay cross-day refunds
- Generation count: distinct non-empty `generationId` among `consume` + 1 per `consume` with null/empty id; refund/grant excluded
- SQLite `$queryRaw` for day buckets; never `findMany` all user txs into Node to bucket
- No export, custom range, year tab, light theme, settings shell, new Prisma fields, ECharts
- Heatmap is read-only; not 180 tab stops
- Day expand: `limit=50` + cursor load-more; one open row
- Commit per task; do not stage `.pnpm-store/` or unrelated files
- Branch: `feature/usage-overview`

## File map

| Path | Role |
|------|------|
| `apps/server/src/points/points-usage-range.ts` | `7d`/`30d`/`month` calendar windows, 6-month heatmap window, `parseShanghaiDay` |
| `apps/server/src/points/points-usage-range.test.ts` | Range / day-parse tests |
| `apps/server/src/points/points-usage.ts` | Net fold, generation count, fill calendar days, heatmap filter |
| `apps/server/src/points/points-usage.test.ts` | Fold / fill tests |
| `apps/server/src/membership/membership.service.ts` | `usage`, `usageDays`, `listTransactions` `day` |
| `apps/server/src/membership/membership.service.test.ts` | Service tests with `$queryRaw` mock |
| `apps/server/src/membership/membership.controller.ts` | `GET usage`, `GET usage-days`, `day` query |
| `apps/web/src/services/users-api.ts` | Client types + `usage` / `usageDays` / `day` |
| `apps/web/src/components/usage/usageHeatmapGrid.ts` | Week grid + intensity |
| `apps/web/src/components/usage/usageHeatmapGrid.test.ts` | Grid tests |
| `apps/web/src/components/usage/UsageOverviewCards.vue` | Five KPI cards |
| `apps/web/src/components/usage/UsageHeatmap.vue` | 6-month calendar |
| `apps/web/src/components/usage/UsageTrend.vue` | Range + series + SVG line |
| `apps/web/src/components/usage/UsageDayTable.vue` | Daily table + expand ledger |
| `apps/web/src/pages/ProfilePage.vue` | Tab copy + compose four sections |
| `apps/web/src/pages/ProfilePage.test.ts` | Tab / fetch / empty copy |

---

### Task 1: Shanghai usage range helpers

**Files:**
- Create: `apps/server/src/points/points-usage-range.ts`
- Create: `apps/server/src/points/points-usage-range.test.ts`

**Interfaces:**
- Consumes: `shanghaiDayKey` from `apps/server/src/points/points-insights.ts`
- Produces:
  - `export type UsageDaysRangeKey = '7d' | '30d' | 'month'`
  - `export function parseUsageDaysRange(raw?: string): UsageDaysRangeKey`
  - `export function shanghaiMidnight(y: number, month0: number, day: number): Date`
  - `export function addShanghaiCalendarMonths(fromKey: string, deltaMonths: number): string`
  - `export function resolveUsageDaysRange(range: UsageDaysRangeKey, now?: Date): { from: Date; to: Date; fromKey: string; toKey: string }`
  - `export function resolveHeatmapRange(now?: Date): { from: Date; to: Date; fromKey: string; toKey: string }`
  - `export function parseShanghaiDay(raw: string): { from: Date; next: Date } | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  addShanghaiCalendarMonths,
  parseShanghaiDay,
  parseUsageDaysRange,
  resolveHeatmapRange,
  resolveUsageDaysRange,
} from './points-usage-range'

describe('parseUsageDaysRange', () => {
  it('accepts 7d, 30d, month and falls back to 7d', () => {
    expect(parseUsageDaysRange('7d')).toBe('7d')
    expect(parseUsageDaysRange('30d')).toBe('30d')
    expect(parseUsageDaysRange('month')).toBe('month')
    expect(parseUsageDaysRange('all')).toBe('7d')
    expect(parseUsageDaysRange()).toBe('7d')
  })
})

describe('resolveUsageDaysRange', () => {
  it('uses 7 Shanghai calendar days including today, not 168 hours', () => {
    const now = new Date('2026-09-16T12:00:00.000Z')
    const r = resolveUsageDaysRange('7d', now)
    expect(r.fromKey).toBe('2026-09-10')
    expect(r.toKey).toBe('2026-09-16')
    expect(r.from.toISOString()).toBe('2026-09-09T16:00:00.000Z')
  })

  it('uses 30 Shanghai calendar days including today', () => {
    const r = resolveUsageDaysRange('30d', new Date('2026-09-16T12:00:00.000Z'))
    expect(r.fromKey).toBe('2026-08-18')
    expect(r.toKey).toBe('2026-09-16')
  })

  it('month is Shanghai 1st 00:00 through now', () => {
    const now = new Date('2026-09-16T12:00:00.000Z')
    const r = resolveUsageDaysRange('month', now)
    expect(r.fromKey).toBe('2026-09-01')
    expect(r.toKey).toBe('2026-09-16')
    expect(r.from.toISOString()).toBe('2026-08-31T16:00:00.000Z')
    expect(r.to).toBe(now)
  })
})

describe('resolveHeatmapRange', () => {
  it('subtracts 6 calendar months including today', () => {
    const r = resolveHeatmapRange(new Date('2026-09-16T12:00:00.000Z'))
    expect(r.fromKey).toBe('2026-03-16')
    expect(r.toKey).toBe('2026-09-16')
  })

  it('clamps overflow day to last day of target month', () => {
    expect(addShanghaiCalendarMonths('2026-03-31', -6)).toBe('2025-09-30')
    const r = resolveHeatmapRange(new Date('2026-03-31T04:00:00.000Z'))
    expect(r.fromKey).toBe('2025-09-30')
    expect(r.toKey).toBe('2026-03-31')
  })
})

describe('parseShanghaiDay', () => {
  it('returns [00:00, next 00:00) in Shanghai', () => {
    const d = parseShanghaiDay('2026-09-16')
    expect(d?.from.toISOString()).toBe('2026-09-15T16:00:00.000Z')
    expect(d?.next.toISOString()).toBe('2026-09-16T16:00:00.000Z')
  })

  it('rejects malformed and impossible days', () => {
    expect(parseShanghaiDay('2026-9-16')).toBeNull()
    expect(parseShanghaiDay('2026-02-31')).toBeNull()
    expect(parseShanghaiDay('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points-usage-range.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
import { shanghaiDayKey } from './points-insights'

export type UsageDaysRangeKey = '7d' | '30d' | 'month'

const SH_OFFSET_MS = 8 * 60 * 60 * 1000

export function parseUsageDaysRange(raw?: string): UsageDaysRangeKey {
  return raw === '30d' || raw === 'month' ? raw : '7d'
}

export function shanghaiMidnight(y: number, month0: number, day: number): Date {
  return new Date(Date.UTC(y, month0, day, 0, 0, 0) - SH_OFFSET_MS)
}

function shanghaiParts(d: Date) {
  const shifted = new Date(d.getTime() + SH_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  }
}

function lastDayOfMonth(y: number, month0: number): number {
  return new Date(Date.UTC(y, month0 + 1, 0)).getUTCDate()
}

export function addShanghaiCalendarMonths(fromKey: string, deltaMonths: number): string {
  const [ys, ms, ds] = fromKey.split('-').map(Number)
  const idx = ys * 12 + (ms - 1) + deltaMonths
  const y = Math.floor(idx / 12)
  const m0 = ((idx % 12) + 12) % 12
  const day = Math.min(ds, lastDayOfMonth(y, m0))
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function resolveUsageDaysRange(
  range: UsageDaysRangeKey,
  now = new Date(),
): { from: Date; to: Date; fromKey: string; toKey: string } {
  const toKey = shanghaiDayKey(now)
  const { y, m, day } = shanghaiParts(now)
  if (range === 'month') {
    const from = shanghaiMidnight(y, m, 1)
    return { from, to: now, fromKey: shanghaiDayKey(from), toKey }
  }
  const back = range === '7d' ? 6 : 29
  const from = shanghaiMidnight(y, m, day - back)
  return { from, to: now, fromKey: shanghaiDayKey(from), toKey }
}

export function resolveHeatmapRange(now = new Date()): {
  from: Date
  to: Date
  fromKey: string
  toKey: string
} {
  const toKey = shanghaiDayKey(now)
  const fromKey = addShanghaiCalendarMonths(toKey, -6)
  const [y, m, d] = fromKey.split('-').map(Number)
  return { from: shanghaiMidnight(y, m - 1, d), to: now, fromKey, toKey }
}

export function parseShanghaiDay(raw: string): { from: Date; next: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const from = shanghaiMidnight(y, m - 1, d)
  if (shanghaiDayKey(from) !== raw) return null
  return { from, next: shanghaiMidnight(y, m - 1, d + 1) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points-usage-range.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/points/points-usage-range.ts apps/server/src/points/points-usage-range.test.ts
git commit -m "feat(server): add Shanghai calendar windows for usage days"
```

---

### Task 2: Daily fold / net / generation-count pure functions

**Files:**
- Create: `apps/server/src/points/points-usage.ts`
- Create: `apps/server/src/points/points-usage.test.ts`

**Interfaces:**
- Consumes: `UsageDaysRangeKey` from `points-usage-range.ts`
- Produces types and functions listed in the implementation below (`foldDailyUsage`, `fillCalendarDays`, `filterHeatmapDays`, `netFromKindCategorySums`, `generationCountFromParts`)

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points-usage.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
export interface UsageCategoryBreakdown {
  text: number
  image: number
  audio: number
  video: number
}

export interface UsageDayPoint {
  date: string
  generationCount: number
  netConsumed: number
  byCategory: UsageCategoryBreakdown
  otherNetConsumed: number
}

export interface UsageOverview {
  netConsumedTotal: number
  byCategory: UsageCategoryBreakdown
  otherNetConsumed: number
  generationCount: number
  activeDays: number
}

export interface UsageHeatmapDay {
  date: string
  netConsumed: number
  generationCount: number
}

export interface UsageOverviewResponse {
  overview: UsageOverview
  heatmap: {
    from: string
    to: string
    activeDays: number
    days: UsageHeatmapDay[]
  }
}

export interface UsageDaysResponse {
  range: '7d' | '30d' | 'month'
  from: string
  to: string
  days: UsageDayPoint[]
}

export interface DailyAmountRow {
  day: string
  kind: string
  category: string
  amountSum: number
}

export interface DailyGenerationRow {
  day: string
  distinctGens: number
  nullGens: number
}

const EMPTY_CATEGORY: UsageCategoryBreakdown = { text: 0, image: 0, audio: 0, video: 0 }

function emptyDay(date: string): UsageDayPoint {
  return {
    date,
    generationCount: 0,
    netConsumed: 0,
    byCategory: { ...EMPTY_CATEGORY },
    otherNetConsumed: 0,
  }
}

export function netFromKindCategorySums(
  rows: Array<{ kind: string; category: string; amountSum: number }>,
): { byCategory: UsageCategoryBreakdown; otherNetConsumed: number; netConsumedTotal: number } {
  const consumed = { text: 0, image: 0, audio: 0, video: 0, other: 0 }
  const refunded = { text: 0, image: 0, audio: 0, video: 0, other: 0 }
  for (const row of rows) {
    const category = row.category in consumed ? (row.category as keyof typeof consumed) : 'other'
    if (row.kind === 'consume') consumed[category] += row.amountSum
    if (row.kind === 'refund') refunded[category] += row.amountSum
  }
  const net = (key: keyof typeof consumed) => Math.max(0, -consumed[key] - refunded[key])
  const byCategory = {
    text: net('text'),
    image: net('image'),
    audio: net('audio'),
    video: net('video'),
  }
  const otherNetConsumed = net('other')
  return {
    byCategory,
    otherNetConsumed,
    netConsumedTotal: byCategory.text + byCategory.image + byCategory.audio + byCategory.video + otherNetConsumed,
  }
}

export function generationCountFromParts(parts: { distinctGens: number; nullGens: number }): number {
  return Math.max(0, parts.distinctGens) + Math.max(0, parts.nullGens)
}

function nextDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export function foldDailyUsage(
  amountRows: DailyAmountRow[],
  generationRows: DailyGenerationRow[],
): UsageDayPoint[] {
  const byDay = new Map<string, DailyAmountRow[]>()
  for (const row of amountRows) {
    const list = byDay.get(row.day) ?? []
    list.push(row)
    byDay.set(row.day, list)
  }
  const gens = new Map(generationRows.map((row) => [row.day, row]))
  const days = new Set([...byDay.keys(), ...gens.keys()])
  return [...days]
    .sort()
    .map((date) => {
      const net = netFromKindCategorySums(byDay.get(date) ?? [])
      const gen = gens.get(date)
      return {
        date,
        generationCount: gen ? generationCountFromParts(gen) : 0,
        netConsumed: net.netConsumedTotal,
        byCategory: net.byCategory,
        otherNetConsumed: net.otherNetConsumed,
      }
    })
}

export function fillCalendarDays(fromKey: string, toKey: string, days: UsageDayPoint[]): UsageDayPoint[] {
  const map = new Map(days.map((day) => [day.date, day]))
  const filled: UsageDayPoint[] = []
  for (let key = fromKey; key <= toKey; key = nextDateKey(key)) {
    filled.push(map.get(key) ?? emptyDay(key))
  }
  return filled
}

export function filterHeatmapDays(days: UsageDayPoint[]): UsageHeatmapDay[] {
  return days
    .filter((day) => day.netConsumed > 0 || day.generationCount > 0)
    .map((day) => ({
      date: day.date,
      netConsumed: day.netConsumed,
      generationCount: day.generationCount,
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points-usage.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/points/points-usage.ts apps/server/src/points/points-usage.test.ts
git commit -m "feat(server): fold daily usage nets and generation counts"
```

---

### Task 3: MembershipService.usage / usageDays

**Files:**
- Modify: `apps/server/src/membership/membership.service.ts`
- Modify: `apps/server/src/membership/membership.service.test.ts`

**Interfaces:**
- Consumes: `foldDailyUsage`, `fillCalendarDays`, `filterHeatmapDays`, `netFromKindCategorySums`, `generationCountFromParts`, `resolveHeatmapRange`, `resolveUsageDaysRange`, `UsageDaysRangeKey`
- Produces:
  - `usage(userId: string, now?: Date): Promise<UsageOverviewResponse>`
  - `usageDays(userId: string, range: UsageDaysRangeKey, now?: Date): Promise<UsageDaysResponse>`

`$queryRaw` must stay parameterized. Coerce sums with `Number(...)` (SQLite may return bigint). Table name: `"PointTransaction"`.

- [ ] **Step 1: Extend the Prisma mock and add failing tests** in `membership.service.test.ts`

Add `$queryRaw` to the `useValue` object next to `$transaction`. Keep existing `pointsSummary` tests passing.

```ts
const $queryRaw = vi.fn()
// in useValue:
$queryRaw,
```

```ts
it('returns lifetime overview and sparse heatmap days from raw daily rows', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
  groupBy.mockResolvedValue([
    { kind: 'consume', category: 'image', _sum: { amount: -30 } },
    { kind: 'refund', category: 'image', _sum: { amount: 10 } },
  ])
  $queryRaw
    .mockResolvedValueOnce([{ distinctGens: 2, nullGens: 1, activeDays: 4 }])
    .mockResolvedValueOnce([
      { day: '2026-09-14', kind: 'consume', category: 'image', amountSum: -20 },
    ])
    .mockResolvedValueOnce([{ day: '2026-09-14', distinctGens: 1, nullGens: 0 }])

  const result = await service.usage('u1')
  expect(result.overview).toEqual({
    netConsumedTotal: 20,
    byCategory: { text: 0, image: 20, audio: 0, video: 0 },
    otherNetConsumed: 0,
    generationCount: 3,
    activeDays: 4,
  })
  expect(result.heatmap.from).toBe('2026-03-16')
  expect(result.heatmap.to).toBe('2026-09-16')
  expect(result.heatmap.days).toEqual([{ date: '2026-09-14', netConsumed: 20, generationCount: 1 }])
  expect($queryRaw).toHaveBeenCalledTimes(3)
  vi.useRealTimers()
})

it('fills every calendar day for usageDays 7d', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
  $queryRaw
    .mockResolvedValueOnce([{ day: '2026-09-16', kind: 'consume', category: 'video', amountSum: -40 }])
    .mockResolvedValueOnce([{ day: '2026-09-16', distinctGens: 1, nullGens: 0 }])

  const result = await service.usageDays('u1', '7d')
  expect(result.range).toBe('7d')
  expect(result.from).toBe('2026-09-10')
  expect(result.to).toBe('2026-09-16')
  expect(result.days).toHaveLength(7)
  expect(result.days.at(-1)).toMatchObject({ date: '2026-09-16', netConsumed: 40, generationCount: 1 })
  expect(result.days[0]).toMatchObject({ date: '2026-09-10', netConsumed: 0, generationCount: 0 })
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership/membership.service.test.ts`

Expected: FAIL (`usage` is not a function)

- [ ] **Step 3: Implement on MembershipService**

Add imports:

```ts
import {
  parseShanghaiDay,
  resolveHeatmapRange,
  resolveUsageDaysRange,
  type UsageDaysRangeKey,
} from '../points/points-usage-range'
import {
  fillCalendarDays,
  filterHeatmapDays,
  foldDailyUsage,
  generationCountFromParts,
  netFromKindCategorySums,
  type DailyAmountRow,
  type DailyGenerationRow,
  type UsageDaysResponse,
  type UsageOverviewResponse,
} from '../points/points-usage'
```

Private helpers (keep SQL exactly like this):

```ts
private async queryLifetimeStats(userId: string) {
  const rows = await this.prisma.$queryRaw<
    Array<{ distinctGens: number | bigint; nullGens: number | bigint; activeDays: number | bigint }>
  >`
    SELECT
      (SELECT COUNT(DISTINCT generationId) FROM PointTransaction
        WHERE userId = ${userId} AND kind = 'consume'
          AND generationId IS NOT NULL AND generationId != '') AS distinctGens,
      (SELECT COUNT(*) FROM PointTransaction
        WHERE userId = ${userId} AND kind = 'consume'
          AND (generationId IS NULL OR generationId = '')) AS nullGens,
      (SELECT COUNT(DISTINCT date(datetime(createdAt, '+8 hours'))) FROM PointTransaction
        WHERE userId = ${userId} AND kind = 'consume') AS activeDays
  `
  const row = rows[0] ?? { distinctGens: 0, nullGens: 0, activeDays: 0 }
  return {
    generationCount: generationCountFromParts({
      distinctGens: Number(row.distinctGens),
      nullGens: Number(row.nullGens),
    }),
    activeDays: Number(row.activeDays),
  }
}

private async queryDailyAmountRows(userId: string, from: Date, to: Date): Promise<DailyAmountRow[]> {
  const rows = await this.prisma.$queryRaw<
    Array<{ day: string; kind: string; category: string; amountSum: number | bigint }>
  >`
    SELECT date(datetime(createdAt, '+8 hours')) AS day,
           kind,
           category,
           SUM(amount) AS amountSum
    FROM PointTransaction
    WHERE userId = ${userId} AND createdAt >= ${from} AND createdAt <= ${to}
    GROUP BY day, kind, category
  `
  return rows.map((row) => ({
    day: row.day,
    kind: row.kind,
    category: row.category,
    amountSum: Number(row.amountSum),
  }))
}

private async queryDailyGenerationRows(userId: string, from: Date, to: Date): Promise<DailyGenerationRow[]> {
  const rows = await this.prisma.$queryRaw<
    Array<{ day: string; distinctGens: number | bigint; nullGens: number | bigint }>
  >`
    SELECT date(datetime(createdAt, '+8 hours')) AS day,
           COUNT(DISTINCT CASE WHEN generationId IS NOT NULL AND generationId != '' THEN generationId END) AS distinctGens,
           SUM(CASE WHEN generationId IS NULL OR generationId = '' THEN 1 ELSE 0 END) AS nullGens
    FROM PointTransaction
    WHERE userId = ${userId} AND kind = 'consume'
      AND createdAt >= ${from} AND createdAt <= ${to}
    GROUP BY day
  `
  return rows.map((row) => ({
    day: row.day,
    distinctGens: Number(row.distinctGens),
    nullGens: Number(row.nullGens),
  }))
}
```

Public methods:

```ts
async usage(userId: string, now = new Date()): Promise<UsageOverviewResponse> {
  const heatmapRange = resolveHeatmapRange(now)
  const [grouped, lifetime, amountRows, generationRows] = await Promise.all([
    this.prisma.pointTransaction.groupBy({
      by: ['kind', 'category'],
      where: { userId },
      _sum: { amount: true },
    }),
    this.queryLifetimeStats(userId),
    this.queryDailyAmountRows(userId, heatmapRange.from, heatmapRange.to),
    this.queryDailyGenerationRows(userId, heatmapRange.from, heatmapRange.to),
  ])
  const net = netFromKindCategorySums(
    grouped.map((row) => ({
      kind: row.kind,
      category: row.category,
      amountSum: row._sum.amount ?? 0,
    })),
  )
  const folded = foldDailyUsage(amountRows, generationRows)
  const days = filterHeatmapDays(folded)
  return {
    overview: {
      netConsumedTotal: net.netConsumedTotal,
      byCategory: net.byCategory,
      otherNetConsumed: net.otherNetConsumed,
      generationCount: lifetime.generationCount,
      activeDays: lifetime.activeDays,
    },
    heatmap: {
      from: heatmapRange.fromKey,
      to: heatmapRange.toKey,
      activeDays: days.filter((day) => day.generationCount > 0).length,
      days,
    },
  }
}

async usageDays(
  userId: string,
  range: UsageDaysRangeKey,
  now = new Date(),
): Promise<UsageDaysResponse> {
  const window = resolveUsageDaysRange(range, now)
  const [amountRows, generationRows] = await Promise.all([
    this.queryDailyAmountRows(userId, window.from, window.to),
    this.queryDailyGenerationRows(userId, window.from, window.to),
  ])
  return {
    range,
    from: window.fromKey,
    to: window.toKey,
    days: fillCalendarDays(window.fromKey, window.toKey, foldDailyUsage(amountRows, generationRows)),
  }
}
```

Heatmap `activeDays` is consume days in the 6-month window (`generationCount > 0`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership/membership.service.test.ts src/points/points-usage.test.ts`

Expected: PASS (existing `pointsSummary` tests still pass)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/membership/membership.service.ts apps/server/src/membership/membership.service.test.ts
git commit -m "feat(server): add membership usage and usage-days aggregations"
```

---

### Task 4: transactions `day` + HTTP routes

**Files:**
- Modify: `apps/server/src/membership/membership.service.ts` (`listTransactions`)
- Modify: `apps/server/src/membership/membership.service.test.ts`
- Modify: `apps/server/src/membership/membership.controller.ts`
- Modify: `apps/server/src/membership/membership.controller.test.ts`

**Interfaces:**
- Produces:
  - `listTransactions(userId, opts: { range?: PointsRangeKey; day?: string; kind?: PointKind; category?: PointCategory; cursor?: string; limit?: number })`
  - `GET /membership/usage`
  - `GET /membership/usage-days?range=`
  - `GET /membership/transactions?day=`

- [ ] **Step 1: Write failing service + parse tests**

```ts
it('filters transactions to a Shanghai day and ignores range', async () => {
  findMany.mockResolvedValue([{ id: 'tx1' }])
  await service.listTransactions('u1', { day: '2026-09-16', range: 'month', limit: 50 })
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        userId: 'u1',
        createdAt: {
          gte: new Date('2026-09-15T16:00:00.000Z'),
          lt: new Date('2026-09-16T16:00:00.000Z'),
        },
      }),
    }),
  )
})

it('throws on invalid day', async () => {
  await expect(service.listTransactions('u1', { day: '2026-02-31' })).rejects.toThrow('无效日期')
})
```

Controller tests — import `parseUsageDaysRange` from `../points/points-usage-range` already covered; add:

```ts
import { parseUsageDaysRange, parseShanghaiDay } from '../points/points-usage-range'

it('usage-days illegal range is 7d', () => {
  expect(parseUsageDaysRange('nope')).toBe('7d')
})
```

Keep `parseLimit` tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership/membership.service.test.ts src/membership/membership.controller.test.ts`

Expected: FAIL on `day` filter

- [ ] **Step 3: Implement**

`listTransactions` — `range` optional, default `'month'` only when `day` is absent. Keep the existing `findMany` / cursor / `limit+1` logic; only the `createdAt` window changes:

```ts
async listTransactions(
  userId: string,
  opts: {
    range?: PointsRangeKey
    day?: string
    kind?: PointKind
    category?: PointCategory
    cursor?: string
    limit?: number
  },
) {
  let from: Date | null
  let to: Date
  let createdAt: { gte?: Date; lte?: Date; lt?: Date }
  if (opts.day) {
    const parsed = parseShanghaiDay(opts.day)
    if (!parsed) throw new BadRequestException('无效日期')
    from = parsed.from
    to = parsed.next
    createdAt = { gte: parsed.from, lt: parsed.next }
  } else {
    const resolved = resolvePointsRange(opts.range ?? 'month')
    from = resolved.from
    to = resolved.to
    createdAt = from ? { gte: from, lte: to } : { lte: to }
  }
  const limit = opts.limit ?? 50
  const rows = await this.prisma.pointTransaction.findMany({
    where: {
      userId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.category ? { category: opts.category } : {}),
      createdAt,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit)
  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    from: from?.toISOString() ?? null,
    to: to.toISOString(),
  }
}
```

For `day`, `to` in the response can be `parsed.next.toISOString()` (exclusive bound). Callers only need items.

Controller — add `BadRequestException` import. New handlers after `points-summary`:

```ts
@Get('usage')
@UseGuards(AuthGuard)
async usage(@Req() req: { user: { sub: string } }) {
  const data = await this.membershipService.usage(req.user.sub)
  return { code: 0, message: 'ok', data }
}

@Get('usage-days')
@UseGuards(AuthGuard)
async usageDays(
  @Req() req: { user: { sub: string } },
  @Query('range') range?: string,
) {
  const data = await this.membershipService.usageDays(req.user.sub, parseUsageDaysRange(range))
  return { code: 0, message: 'ok', data }
}
```

Change `transactions`:

```ts
@Query('day') day?: string,
...
if (day && !parseShanghaiDay(day)) throw new BadRequestException('无效日期')
const data = await this.membershipService.listTransactions(req.user.sub, {
  range: day ? undefined : parseRange(range),
  day,
  kind,
  category,
  cursor,
  limit: parseLimit(limit),
})
```

Import `parseUsageDaysRange` and `parseShanghaiDay`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership src/points/points-usage-range.test.ts src/points/points-usage.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/membership/membership.service.ts apps/server/src/membership/membership.service.test.ts apps/server/src/membership/membership.controller.ts apps/server/src/membership/membership.controller.test.ts
git commit -m "feat(server): expose usage endpoints and transaction day filter"
```

---

### Task 5: Web membership API types

**Files:**
- Modify: `apps/web/src/services/users-api.ts`

**Interfaces:**
- Produces: `UsageDaysRangeKey`, `UsageOverviewResponse`, `UsageDaysResponse`, `membershipApi.usage()`, `membershipApi.usageDays(range)`, `transactions` accepts `day?: string`

- [ ] **Step 1: Add types and methods** (no separate test file; ProfilePage tests in Task 10 cover calls)

```ts
export type UsageDaysRangeKey = '7d' | '30d' | 'month'

export interface UsageCategoryBreakdown {
  text: number
  image: number
  audio: number
  video: number
}

export interface UsageDayPoint {
  date: string
  generationCount: number
  netConsumed: number
  byCategory: UsageCategoryBreakdown
  otherNetConsumed: number
}

export interface UsageHeatmapDay {
  date: string
  netConsumed: number
  generationCount: number
}

export interface UsageOverviewResponse {
  overview: {
    netConsumedTotal: number
    byCategory: UsageCategoryBreakdown
    otherNetConsumed: number
    generationCount: number
    activeDays: number
  }
  heatmap: {
    from: string
    to: string
    activeDays: number
    days: UsageHeatmapDay[]
  }
}

export interface UsageDaysResponse {
  range: UsageDaysRangeKey
  from: string
  to: string
  days: UsageDayPoint[]
}
```

Extend `transactions` params with `day?: string`. Add:

```ts
usage: () => api.get<{ data: UsageOverviewResponse }>('/membership/usage'),
usageDays: (range?: UsageDaysRangeKey) =>
  api.get<{ data: UsageDaysResponse }>('/membership/usage-days', { params: { range } }),
```

Keep `pointsSummary` (other callers / unused by this page).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/services/users-api.ts
git commit -m "feat(web): add membership usage API client types"
```

---

### Task 6: Heatmap grid + UsageHeatmap

**Files:**
- Create: `apps/web/src/components/usage/usageHeatmapGrid.ts`
- Create: `apps/web/src/components/usage/usageHeatmapGrid.test.ts`
- Create: `apps/web/src/components/usage/UsageHeatmap.vue`
- Create: `apps/web/src/components/usage/UsageHeatmap.test.ts`

**Interfaces:**
- Consumes: `UsageHeatmapDay`
- Produces: `heatmapLevel`, `buildHeatmapGrid`, `UsageHeatmap` props `{ from: string; to: string; activeDays: number; days: UsageHeatmapDay[] }`

- [ ] **Step 1: Write grid tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildHeatmapGrid, heatmapLevel } from './usageHeatmapGrid'

describe('heatmapLevel', () => {
  it('maps 0 and empty max to level 0 and quarters to 1-4', () => {
    expect(heatmapLevel(0, 100)).toBe(0)
    expect(heatmapLevel(10, 0)).toBe(0)
    expect(heatmapLevel(25, 100)).toBe(1)
    expect(heatmapLevel(50, 100)).toBe(2)
    expect(heatmapLevel(75, 100)).toBe(3)
    expect(heatmapLevel(100, 100)).toBe(4)
  })
})

describe('buildHeatmapGrid', () => {
  it('pads from Monday of from-week to Sunday of to-week and marks out-of-range', () => {
    const grid = buildHeatmapGrid({
      from: '2026-09-16',
      to: '2026-09-16',
      days: [{ date: '2026-09-16', netConsumed: 80, generationCount: 2 }],
    })
    expect(grid).toHaveLength(7)
    const inRange = grid.flat().filter((c) => c.inRange)
    expect(inRange).toHaveLength(1)
    expect(inRange[0].date).toBe('2026-09-16')
    expect(inRange[0].level).toBe(4)
    expect(grid.flat().some((c) => !c.inRange)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/usageHeatmapGrid.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement `usageHeatmapGrid.ts`**

```ts
import type { UsageHeatmapDay } from '@/services/users-api'

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4

export interface HeatmapCell {
  date: string
  inRange: boolean
  netConsumed: number
  generationCount: number
  level: HeatmapLevel
}

export function heatmapLevel(net: number, max: number): HeatmapLevel {
  if (net <= 0 || max <= 0) return 0
  const ratio = net / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function mondayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd === 0 ? 6 : wd - 1
}

export function buildHeatmapGrid(input: {
  from: string
  to: string
  days: UsageHeatmapDay[]
}): HeatmapCell[][] {
  const byDate = new Map(input.days.map((day) => [day.date, day]))
  const max = Math.max(0, ...input.days.map((day) => day.netConsumed))
  const start = addDays(input.from, -mondayIndex(input.from))
  const end = addDays(input.to, 6 - mondayIndex(input.to))
  const columns: HeatmapCell[][] = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    const col: HeatmapCell[] = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i)
      const inRange = date >= input.from && date <= input.to
      const hit = byDate.get(date)
      col.push({
        date,
        inRange,
        netConsumed: inRange ? (hit?.netConsumed ?? 0) : 0,
        generationCount: inRange ? (hit?.generationCount ?? 0) : 0,
        level: inRange ? heatmapLevel(hit?.netConsumed ?? 0, max) : 0,
      })
    }
    columns.push(col)
  }
  return [0, 1, 2, 3, 4, 5, 6].map((row) => columns.map((col) => col[row]))
}
```

Rows are Mon→Sun; columns are weeks. `UsageHeatmap.vue` renders `grid` as `display:grid` with `grid-template-rows: repeat(7, 1fr)` and week columns.

- [ ] **Step 4: Implement `UsageHeatmap.vue`**

Props: `from`, `to`, `activeDays`, `days`.

Template structure:

- Header: 「活跃度」, legend 低 + 4 greens + 高, 「{{ activeDays }} 个活跃日」, `{{ from }} – {{ to }}`
- Left gutter: 周一 / 周三 / 周五 aligned to rows 0/2/4
- Cells: `h-3 w-3 rounded-[3px]`; out-of-range and empty `bg-white/[0.06]`; levels `#0e4429` `#006d32` `#26a641` `#39d353`
- In-range cells: native `title="{{date}} · 净消耗 {{net}} · 生成 {{count}}"`
- Wrapper `overflow-x-auto`; inner not a button per cell (`div` only)
- Container `tabindex="0"` once

- [ ] **Step 5: Component smoke test**

```ts
import { mount } from '@vue/test-utils'
import UsageHeatmap from './UsageHeatmap.vue'

it('renders active day copy and does not use buttons for cells', () => {
  const wrapper = mount(UsageHeatmap, {
    props: {
      from: '2026-09-16',
      to: '2026-09-16',
      activeDays: 1,
      days: [{ date: '2026-09-16', netConsumed: 10, generationCount: 1 }],
    },
  })
  expect(wrapper.text()).toContain('1 个活跃日')
  expect(wrapper.findAll('button').length).toBe(0)
})
```

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/usageHeatmapGrid.test.ts src/components/usage/UsageHeatmap.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/usage/usageHeatmapGrid.ts apps/web/src/components/usage/usageHeatmapGrid.test.ts apps/web/src/components/usage/UsageHeatmap.vue apps/web/src/components/usage/UsageHeatmap.test.ts
git commit -m "feat(web): add dark GitHub-style usage heatmap"
```

---

### Task 7: UsageOverviewCards

**Files:**
- Create: `apps/web/src/components/usage/UsageOverviewCards.vue`
- Create: `apps/web/src/components/usage/UsageOverviewCards.test.ts`

**Interfaces:**
- Consumes: `UsageOverviewResponse['overview']`
- Produces: five unlabeled-as-buttons cards: 净消耗积分 / 图片消耗 / 视频消耗 / 生成次数 / 累计活跃

- [ ] **Step 1: Write failing test**

```ts
import { mount } from '@vue/test-utils'
import UsageOverviewCards from './UsageOverviewCards.vue'

it('renders five lifetime metrics with thousand separators', () => {
  const wrapper = mount(UsageOverviewCards, {
    props: {
      overview: {
        netConsumedTotal: 14877,
        byCategory: { text: 1, image: 2794, audio: 0, video: 4260 },
        otherNetConsumed: 0,
        generationCount: 6911,
        activeDays: 68,
      },
    },
  })
  expect(wrapper.text()).toContain('净消耗积分')
  expect(wrapper.text()).toContain('图片消耗')
  expect(wrapper.text()).toContain('视频消耗')
  expect(wrapper.text()).toContain('生成次数')
  expect(wrapper.text()).toContain('累计活跃')
  expect(wrapper.text()).toContain('14,877')
  expect(wrapper.findAll('button').length).toBe(0)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/UsageOverviewCards.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

Section title 「用量总览」. Five cells in `grid grid-cols-2 lg:grid-cols-5 gap-3`. Each: `rounded-xl border border-white/8 bg-[#16161C] p-4`. Label `text-xs text-white/45`. Value `mt-2 text-2xl font-semibold tabular-nums`. Format with `new Intl.NumberFormat('zh-CN').format(Math.round(n))`. Image value = `overview.byCategory.image`; video = `overview.byCategory.video`.

- [ ] **Step 4: Run test**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/UsageOverviewCards.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/usage/UsageOverviewCards.vue apps/web/src/components/usage/UsageOverviewCards.test.ts
git commit -m "feat(web): add usage overview KPI cards"
```

---

### Task 8: UsageTrend SVG

**Files:**
- Create: `apps/web/src/components/usage/UsageTrend.vue`
- Create: `apps/web/src/components/usage/UsageTrend.test.ts`

**Interfaces:**
- Props: `range: UsageDaysRangeKey`, `days: UsageDayPoint[]`, `loading?: boolean`
- Emits: `update:range` with `'7d' | '30d' | 'month'`
- Series keys: `'generationCount' | 'netConsumed' | 'text' | 'image' | 'audio' | 'video'`
- Default series: `generationCount`

- [ ] **Step 1: Write failing tests**

```ts
import { mount } from '@vue/test-utils'
import UsageTrend from './UsageTrend.vue'

const days = [
  {
    date: '2026-09-15',
    generationCount: 2,
    netConsumed: 10,
    byCategory: { text: 0, image: 10, audio: 0, video: 0 },
    otherNetConsumed: 0,
  },
  {
    date: '2026-09-16',
    generationCount: 0,
    netConsumed: 0,
    byCategory: { text: 0, image: 0, audio: 0, video: 0 },
    otherNetConsumed: 0,
  },
]

it('emits range change and defaults to generationCount', async () => {
  const wrapper = mount(UsageTrend, { props: { range: '7d', days } })
  expect(wrapper.text()).toContain('用量趋势')
  expect(wrapper.text()).toContain('近 7 天')
  await wrapper.get('button[data-range="30d"]').trigger('click')
  expect(wrapper.emitted('update:range')?.[0]).toEqual(['30d'])
  expect(wrapper.find('polyline').exists()).toBe(true)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/UsageTrend.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

Left capsules: 近 7 天 / 近 30 天 / 本月 with `data-range`. Selected `bg-white/12`, not indigo.

Right series capsules: 生成次数 / 积分消耗 / 文本 / 图片 / 音频 / 视频. Local `ref` series, default `'generationCount'`.

Value accessor:

```ts
function seriesValue(day: UsageDayPoint, series: SeriesKey): number {
  if (series === 'generationCount') return day.generationCount
  if (series === 'netConsumed') return day.netConsumed
  return day.byCategory[series]
}
```

SVG `viewBox="0 0 640 200"` polyline. `max = Math.max(1, ...values)`. Point i: `x = n===1 ? 320 : (i/(n-1))*640`, `y = 200 - (v/max)*180 - 10`. Stroke `rgba(255,255,255,0.8)` fill none. Circles r=3. Each circle `title="{{date}} · {{value}}"`. No begin/end dual series. `v-if="loading"` show skeleton `h-48 animate-pulse bg-white/5`. `prefers-reduced-motion`: no CSS animation class when `loading` is false.

- [ ] **Step 4: Run test**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/UsageTrend.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/usage/UsageTrend.vue apps/web/src/components/usage/UsageTrend.test.ts
git commit -m "feat(web): add usage trend range toggle and SVG line"
```

---

### Task 9: UsageDayTable + day ledger

**Files:**
- Create: `apps/web/src/components/usage/UsageDayTable.vue`
- Create: `apps/web/src/components/usage/UsageDayTable.test.ts`

**Interfaces:**
- Props: `days: UsageDayPoint[]`, `loading?: boolean`
- Uses `membershipApi.transactions({ day, limit: 50, cursor })`
- Table rows = `days.filter(d => d.generationCount > 0)` sorted date desc
- Empty copy: `还没有消耗。去创作后，这里会按日汇总。` + `router-link` to `/workflow`

- [ ] **Step 1: Write failing tests** with mocked `membershipApi.transactions`

```ts
const transactions = vi.fn()
vi.mock('@/services/users-api', () => ({
  membershipApi: { transactions: (...args: unknown[]) => transactions(...args) },
}))
```

- renders columns 日期 / 生成次数 / 积分消耗 / 文本 / 图片 / 音频 / 视频
- hides zero-generation days
- empty state contains the copy and `/workflow`
- clicking a row calls `transactions` with `{ day: '2026-09-16', limit: 50 }`
- clicking the same row again does not call a second time after collapse (or calls 0 while collapsed)
- clicking a second row collapses the first (only one `[data-expanded]` )

Use `days` with one zero day and one consume day. Mock resolve `{ data: { data: { items: [{ id: 't1', reason: '生成', amount: -10, kind: 'consume', category: 'image', createdAt: '2026-09-16T01:00:00.000Z', model: 'x', generationId: 'g1', balanceAfter: 3, status: null }], nextCursor: 'c1' } } }`.

Load-more: if `nextCursor` show button 「加载更多」; click calls with `cursor: 'c1'`.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/UsageDayTable.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

Reuse ProfilePage formatting for createdAt / kindLabels / categoryLabels / amount color (copy those small helpers into the table component; do not import ProfilePage).

Expanded block lists items; error string in the expanded area only; 「这一天没有流水。」 when items empty after success.

- [ ] **Step 4: Run test**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/usage/UsageDayTable.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/usage/UsageDayTable.vue apps/web/src/components/usage/UsageDayTable.test.ts
git commit -m "feat(web): add usage day table with ledger drill-down"
```

---

### Task 10: ProfilePage usage tab composition

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`
- Modify: `apps/web/src/pages/ProfilePage.test.ts`

**Interfaces:**
- Consumes: all four usage components + `membershipApi.usage` / `usageDays`
- Produces: billing tab UI replaced; account tab unchanged

- [ ] **Step 1: Rewrite ProfilePage tests first** (they will fail against current billing UI)

Replace `vi.mock('@/services/users-api')` with:

```ts
vi.mock('@/services/users-api', () => ({
  membershipApi: {
    usage: vi.fn().mockResolvedValue({
      data: {
        data: {
          overview: {
            netConsumedTotal: 20,
            byCategory: { text: 0, image: 20, audio: 0, video: 0 },
            otherNetConsumed: 0,
            generationCount: 3,
            activeDays: 5,
          },
          heatmap: {
            from: '2026-03-16',
            to: '2026-09-16',
            activeDays: 1,
            days: [{ date: '2026-09-16', netConsumed: 20, generationCount: 1 }],
          },
        },
      },
    }),
    usageDays: vi.fn().mockResolvedValue({
      data: {
        data: {
          range: '7d',
          from: '2026-09-10',
          to: '2026-09-16',
          days: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-09-${String(10 + i).padStart(2, '0')}`,
            generationCount: 0,
            netConsumed: 0,
            byCategory: { text: 0, image: 0, audio: 0, video: 0 },
            otherNetConsumed: 0,
          })),
        },
      },
    }),
    transactions: vi.fn().mockResolvedValue({
      data: { data: { items: [], nextCursor: null, from: null, to: new Date().toISOString() } },
    }),
  },
}))
```

Keep account-tab test. Replace billing test:

```ts
it('renders usage overview on billing and usage query tabs', async () => {
  routeQuery.tab = 'billing'
  const wrapper = await mountProfile()
  expect(wrapper.text()).toContain('用量')
  expect(wrapper.text()).toContain('用量总览')
  expect(wrapper.text()).toContain('净消耗积分')
  expect(wrapper.text()).toContain('累计活跃')
  expect(wrapper.text()).not.toContain('积分账单')
  expect(wrapper.text()).not.toContain('单日峰值')
})

it('treats tab=usage as the usage panel', async () => {
  routeQuery.tab = 'usage'
  const wrapper = await mountProfile()
  expect(wrapper.text()).toContain('用量总览')
})

it('does not fetch usage on the account tab', async () => {
  const { membershipApi } = await import('@/services/users-api')
  await mountProfile()
  expect(membershipApi.usage).not.toHaveBeenCalled()
  expect(membershipApi.usageDays).not.toHaveBeenCalled()
})
```

Need to get the mocked fns from the hoisted mock:

```ts
const membershipMocks = vi.hoisted(() => ({
  usage: vi.fn(),
  usageDays: vi.fn(),
  transactions: vi.fn(),
}))
```

Assign default resolved values in `beforeEach`. Account test asserts `membershipMocks.usage` not called. Billing test asserts `usage` and `usageDays` called once.

Stub child components only if mount is too heavy; prefer real children since they are presentational.

- [ ] **Step 2: Run tests to verify fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts`

Expected: FAIL (still shows 积分账单 / fetches pointsSummary)

- [ ] **Step 3: Wire ProfilePage**

Outer wrapper: `mx-auto max-w-6xl px-6 py-10`. Account column inner: `max-w-3xl`.

Tab buttons: `[['account', '账户'], ['billing', '用量']]`. `activeTab` computed:

```ts
const raw = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
if (raw === 'billing' || raw === 'usage') return 'billing'
return 'account'
```

`setTab('billing')` still writes `{ tab: 'billing' }`.

Remove `pointsSummary` / category filter / insightOptions / billKindTab from this page.

State:

```ts
const usage = ref<UsageOverviewResponse | null>(null)
const usageDays = ref<UsageDaysResponse | null>(null)
const usageRange = ref<UsageDaysRangeKey>('7d')
const usageError = ref('')
const daysError = ref('')
const usageLoading = ref(false)
const daysLoading = ref(false)
```

`loadUsage()` calls `membershipApi.usage()` only. `loadUsageDays()` calls `membershipApi.usageDays(usageRange.value)` only.

`watch(activeTab)`: if billing, `loadUsage` + `loadUsageDays`. `watch(usageRange)`: only `loadUsageDays`.

`onMounted`: load profile as today; if already billing tab, load usage pair; do not call `pointsSummary`.

Usage template:

```vue
<div v-if="activeTab === 'billing'" class="space-y-4">
  <div v-if="usageError" class="rounded-2xl border border-red-400/15 p-6 text-sm text-red-300/80">
    {{ usageError }}
    <button type="button" class="ml-2 underline" @click="loadUsage">重新加载</button>
  </div>
  <UsageOverviewCards v-else-if="usage" :overview="usage.overview" />
  <div v-else class="h-28 animate-pulse rounded-2xl bg-white/5" />

  <UsageHeatmap
    v-if="usage && !usageError"
    :from="usage.heatmap.from"
    :to="usage.heatmap.to"
    :active-days="usage.heatmap.activeDays"
    :days="usage.heatmap.days"
  />

  <div v-if="daysError" class="rounded-2xl border border-red-400/15 p-6 text-sm text-red-300/80">
    {{ daysError }}
    <button type="button" class="ml-2 underline" @click="loadUsageDays">重新加载</button>
  </div>
  <template v-else>
    <UsageTrend :range="usageRange" :days="usageDays?.days ?? []" :loading="daysLoading" @update:range="usageRange = $event" />
    <UsageDayTable :days="usageDays?.days ?? []" :loading="daysLoading" />
  </template>
</div>
```

`loadUsage` catch → `usageError = '用量总览加载失败，请稍后重试'`. `loadUsageDays` catch → `daysError = '用量趋势加载失败，请稍后重试'`.

Delete unused billing helpers (rangeOptions old 7d/month/all, category toggle, insights). Keep invite/account code.

- [ ] **Step 4: Run page tests**

Run: `pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts src/components/usage`

Expected: PASS

- [ ] **Step 5: Run server tests once more**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership src/points/points-usage.test.ts src/points/points-usage-range.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ProfilePage.vue apps/web/src/pages/ProfilePage.test.ts
git commit -m "feat(web): replace profile billing tab with usage overview"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| Lifetime five cards | 2, 3, 7, 10 |
| 6-month heatmap, Mon start, green levels, no click | 1, 3, 6, 10 |
| Trend 7d/30d/month + six series + SVG | 1, 2, 8, 10 |
| Daily table + expand ledger + load more | 4, 9, 10 |
| Dual endpoints + day query | 3, 4, 5 |
| SQLite `$queryRaw` | 3 |
| Tab 用量 / billing deep link | 10 |
| Independent fetch / error regions | 10 |
| `points-summary` unchanged | 3 (existing tests) |

## Placeholder scan

No TBD / “handle edge cases later”. Invalid `day` is `BadRequestException('无效日期')`. Empty table copy is specified. Chart library is SVG polyline.
