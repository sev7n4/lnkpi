# 个人中心积分 UX 采纳（Neowow）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `#270` 积分统计基础上，扩展 `points-summary` 返回用量洞察 KPI，并增强 `ProfilePage` 的会员转化条、账单密度与 kind 分段筛选。

**Architecture:** 将 insights 日聚合逻辑提取为 `points-insights.ts` 纯函数（TDD）；`MembershipService.pointsSummary` 在现有 `groupBy` 后追加 `findMany` 拉取窗口内 consume 行并计算 KPI；`ProfilePage` 单页三段布局复用现有 `MembershipModal` 与 `membershipApi`。

**Tech Stack:** NestJS、Prisma、Vue 3 + Vitest、现有 `/membership/points-summary` 与 `/membership/transactions`

**Spec:** `docs/superpowers/specs/2026-09-01-points-stats-neowow-adoption-design.md`

## Global Constraints

- 汇总与 insights 共用 `range`（`7d` | `month` | `all`，默认 `month`）；日界 `Asia/Shanghai`；响应带回 `from`/`to`
- insights 净消耗口径与分类卡一致（consume − refund）；峰值/活跃/连续仅统计 `kind=consume`
- `grant` 不参与 insights；`balanceAfter` 历史 null → UI 显示 `—`
- kind 分段：全部 / 消耗（`consume`）/ 获得（`grant`）；退款仅在「全部」展示
- 充值与升级均打开现有 `MembershipModal`；不新建支付流
- 分支从最新 `origin/main`（含 `#270`）拉取：`feat/points-stats-neowow-adoption`
- 验证：`pnpm --filter @lnkpi/server exec vitest run` 全绿；相关 web 测试通过
- 不把 `.superpowers/`、deploy 审计 JSON 等无关文件加入 commit

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `apps/server/src/points/points-insights.ts` | 上海日 bucket、streak、insights 纯函数 |
| `apps/server/src/points/points-insights.test.ts` | insights 口径单测 |
| `apps/server/src/membership/membership.service.ts` | `PointsSummaryDto.insights` + 查询 consume 行 |
| `apps/server/src/membership/membership.service.test.ts` | 扩展 `pointsSummary` 断言含 insights |
| `apps/web/src/services/users-api.ts` | `PointsSummary.insights` 类型 |
| `apps/web/src/pages/ProfilePage.vue` | 资产卡、KPI 卡、kind 分段、balanceAfter |
| `apps/web/src/pages/ProfilePage.test.ts` | 创建：渲染与分段映射冒烟 |

---

### Task 1: insights 纯函数（TDD）

**Files:**
- Create: `apps/server/src/points/points-insights.ts`
- Create: `apps/server/src/points/points-insights.test.ts`

**Interfaces:**
- Produces:
  - `export interface PointsInsights { netConsumedTotal: number; peakDayConsumed: number; avgDailyConsumed: number; activeDays: number; longestStreakDays: number }`
  - `export function shanghaiDayKey(d: Date): string` — 返回 `YYYY-MM-DD`（上海日历日）
  - `export function calendarDaysInclusive(from: Date, to: Date): number`
  - `export function computeLongestStreak(dayKeys: string[]): number`
  - `export function computePointsInsights(input: { netConsumedTotal: number; consumeRows: Array<{ createdAt: Date; amount: number }>; from: Date | null; to: Date }): PointsInsights`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  calendarDaysInclusive,
  computeLongestStreak,
  computePointsInsights,
  shanghaiDayKey,
} from './points-insights'

describe('shanghaiDayKey', () => {
  it('uses Asia/Shanghai calendar day', () => {
    // 2026-08-01 00:30 CST = 2026-07-31T16:30:00Z
    expect(shanghaiDayKey(new Date('2026-07-31T16:30:00.000Z'))).toBe('2026-08-01')
  })
})

describe('computeLongestStreak', () => {
  it('returns 0 for empty', () => {
    expect(computeLongestStreak([])).toBe(0)
  })

  it('counts consecutive calendar days', () => {
    expect(computeLongestStreak(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-05'])).toBe(3)
  })
})

describe('computePointsInsights', () => {
  const to = new Date('2026-08-10T12:00:00.000Z')
  const from = new Date('2026-08-01T00:00:00.000Z')

  it('computes peak, active days, streak, and avg from consume rows', () => {
    const insights = computePointsInsights({
      netConsumedTotal: 45,
      from,
      to,
      consumeRows: [
        { createdAt: new Date('2026-08-02T10:00:00.000Z'), amount: -20 },
        { createdAt: new Date('2026-08-02T18:00:00.000Z'), amount: -10 },
        { createdAt: new Date('2026-08-03T10:00:00.000Z'), amount: -15 },
      ],
    })
    expect(insights.netConsumedTotal).toBe(45)
    expect(insights.peakDayConsumed).toBe(30)
    expect(insights.activeDays).toBe(2)
    expect(insights.longestStreakDays).toBe(2)
    expect(insights.avgDailyConsumed).toBeCloseTo(45 / calendarDaysInclusive(from, to), 5)
  })

  it('returns zeros when no consume rows', () => {
    const insights = computePointsInsights({
      netConsumedTotal: 0,
      from,
      to,
      consumeRows: [],
    })
    expect(insights).toEqual({
      netConsumedTotal: 0,
      peakDayConsumed: 0,
      avgDailyConsumed: 0,
      activeDays: 0,
      longestStreakDays: 0,
    })
  })

  it('uses from=null with earliest consume day for calendar span', () => {
    const insights = computePointsInsights({
      netConsumedTotal: 10,
      from: null,
      to,
      consumeRows: [{ createdAt: new Date('2026-08-09T10:00:00.000Z'), amount: -10 }],
    })
    expect(insights.activeDays).toBe(1)
    expect(insights.avgDailyConsumed).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points-insights.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
export interface PointsInsights {
  netConsumedTotal: number
  peakDayConsumed: number
  avgDailyConsumed: number
  activeDays: number
  longestStreakDays: number
}

const SH_OFFSET_MS = 8 * 60 * 60 * 1000

export function shanghaiDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + SH_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function calendarDaysInclusive(from: Date, to: Date): number {
  const start = parseDayKey(shanghaiDayKey(from))
  const end = parseDayKey(shanghaiDayKey(to))
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, diff + 1)
}

export function computeLongestStreak(dayKeys: string[]): number {
  if (!dayKeys.length) return 0
  const sorted = [...new Set(dayKeys)].sort()
  let best = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDayKey(sorted[i - 1])
    const cur = parseDayKey(sorted[i])
    const gap = Math.round((cur.getTime() - prev.getTime()) / 86_400_000)
    if (gap === 1) {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 1
    }
  }
  return best
}

export function computePointsInsights(input: {
  netConsumedTotal: number
  consumeRows: Array<{ createdAt: Date; amount: number }>
  from: Date | null
  to: Date
}): PointsInsights {
  const { netConsumedTotal, consumeRows, to } = input
  if (!consumeRows.length) {
    return {
      netConsumedTotal,
      peakDayConsumed: 0,
      avgDailyConsumed: 0,
      activeDays: 0,
      longestStreakDays: 0,
    }
  }

  const dayTotals = new Map<string, number>()
  for (const row of consumeRows) {
    const key = shanghaiDayKey(row.createdAt)
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + Math.abs(row.amount))
  }

  const activeDayKeys = [...dayTotals.keys()].sort()
  const peakDayConsumed = Math.max(...[...dayTotals.values()])
  const effectiveFrom =
    input.from ?? parseDayKey(activeDayKeys[0])
  const windowDays = calendarDaysInclusive(effectiveFrom, to)

  return {
    netConsumedTotal,
    peakDayConsumed,
    avgDailyConsumed: netConsumedTotal / Math.max(1, windowDays),
    activeDays: activeDayKeys.length,
    longestStreakDays: computeLongestStreak(activeDayKeys),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points-insights.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/points/points-insights.ts apps/server/src/points/points-insights.test.ts
git commit -m "feat(server): add points insights pure functions"
```

---

### Task 2: 扩展 MembershipService.pointsSummary

**Files:**
- Modify: `apps/server/src/membership/membership.service.ts`
- Modify: `apps/server/src/membership/membership.service.test.ts`

**Interfaces:**
- Consumes: `computePointsInsights`, `PointsInsights` from `../points/points-insights`
- Produces: `PointsSummaryDto` 含 `insights: PointsInsights`

- [ ] **Step 1: Update failing service test**

在 `membership.service.test.ts` 的 `beforeEach` mock 中增加 `findFirst = vi.fn()`（用于 `all` 最早交易日），并更新聚合测试期望：

```ts
const findMany = vi.fn()
const findFirst = vi.fn()
// prisma mock:
pointTransaction: { findMany, groupBy, findFirst },

it('aggregates non-negative net consumption and insights for the selected range', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
  groupBy.mockResolvedValue([
    { kind: 'consume', category: 'image', _sum: { amount: -30 } },
    { kind: 'refund', category: 'image', _sum: { amount: 10 } },
    { kind: 'grant', category: 'other', _sum: { amount: 100 } },
  ])
  findMany.mockResolvedValue([
    { createdAt: new Date('2026-08-18T10:00:00.000Z'), amount: -20 },
    { createdAt: new Date('2026-08-19T10:00:00.000Z'), amount: -10 },
  ])

  const result = await service.pointsSummary('u1', 'month')
  expect(result.byCategory.image).toBe(20)
  expect(result.insights).toEqual({
    netConsumedTotal: 20,
    peakDayConsumed: 20,
    avgDailyConsumed: expect.any(Number),
    activeDays: 2,
    longestStreakDays: 2,
  })
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1', kind: 'consume' }),
      select: { createdAt: true, amount: true },
    }),
  )
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership/membership.service.test.ts`
Expected: FAIL — `insights` undefined

- [ ] **Step 3: Implement in membership.service.ts**

在 `PointsSummaryDto` 增加 `insights: PointsInsights`，`pointsSummary` 末尾：

```ts
import { computePointsInsights, type PointsInsights } from '../points/points-insights'

export interface PointsSummaryDto {
  // ...existing
  insights: PointsInsights
}

async pointsSummary(userId: string, range: PointsRangeKey): Promise<PointsSummaryDto> {
  const { from, to } = resolvePointsRange(range)
  // ...existing groupBy loop...

  const netConsumedTotal =
    netConsumed('text') +
    netConsumed('image') +
    netConsumed('audio') +
    netConsumed('video') +
    netConsumed('other')

  const consumeRows = await this.prisma.pointTransaction.findMany({
    where: {
      userId,
      kind: 'consume',
      createdAt: from ? { gte: from, lte: to } : { lte: to },
    },
    select: { createdAt: true, amount: true },
  })

  const insights = computePointsInsights({
    netConsumedTotal,
    consumeRows,
    from,
    to,
  })

  return {
    range,
    from: from?.toISOString() ?? null,
    to: to.toISOString(),
    byCategory: { /* unchanged */ },
    otherNetConsumed: netConsumed('other'),
    refundTotal,
    grantTotal,
    insights,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/membership/membership.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/membership/membership.service.ts apps/server/src/membership/membership.service.test.ts
git commit -m "feat(server): extend points-summary with usage insights"
```

---

### Task 3: 同步 Web API 类型

**Files:**
- Modify: `apps/web/src/services/users-api.ts`

**Interfaces:**
- Produces: `PointsSummary.insights: PointsInsights`

- [ ] **Step 1: Add types**

```ts
export interface PointsInsights {
  netConsumedTotal: number
  peakDayConsumed: number
  avgDailyConsumed: number
  activeDays: number
  longestStreakDays: number
}

export interface PointsSummary {
  // ...existing
  insights: PointsInsights
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lnkpi/web exec vue-tsc --noEmit`
Expected: PASS（或仅 ProfilePage 尚未用 insights 时不报错）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/users-api.ts
git commit -m "feat(web): add PointsInsights type for points-summary"
```

---

### Task 4: ProfilePage 资产卡 + MembershipModal

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`

**Interfaces:**
- Consumes: `MembershipModal` from `@/components/membership/MembershipModal.vue`
- Produces: `showMembership` ref；充值/升级按钮

- [ ] **Step 1: Add script imports and state**

```ts
import MembershipModal from '@/components/membership/MembershipModal.vue'

const showMembership = ref(false)

const membershipLabel = computed(() => {
  const m = profile.value?.membership
  if (m === 'pro') return '专业版'
  if (m === 'studio') return '工作室版'
  return '免费版'
})

const isFreeMembership = computed(() => !profile.value?.membership || profile.value.membership === 'free')
```

- [ ] **Step 2: Replace profile grid with asset card**

将原 `积分余额` + `会员等级` 双格改为单资产卡：

```vue
<div class="mt-6 rounded-xl border border-white/8 bg-[#242424] p-5">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="text-xs text-white/40">可用总积分</p>
      <p class="text-3xl font-semibold text-[#818cf8]">{{ profile.points ?? 0 }}</p>
    </div>
    <span class="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/60">{{ membershipLabel }}</span>
  </div>
  <p v-if="isFreeMembership" class="mt-3 text-xs text-white/35">开通会员，获得更多积分与高级能力</p>
  <div class="mt-4 flex gap-3">
    <button type="button" class="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black" @click="showMembership = true">
      充值
    </button>
    <button type="button" class="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/80" @click="showMembership = true">
      {{ isFreeMembership ? '升级会员' : '管理会员' }}
    </button>
  </div>
</div>

<MembershipModal v-model="showMembership" />
```

- [ ] **Step 3: Manual smoke**

启动 web，登录后打开 `/profile`，点击充值/升级应弹出「积分与会员」对话框。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProfilePage.vue
git commit -m "feat(web): profile asset card with membership modal CTAs"
```

---

### Task 5: ProfilePage 用量洞察 KPI 卡

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`

**Interfaces:**
- Consumes: `summary.insights` from `pointsSummary` response

- [ ] **Step 1: Add KPI config**

```ts
const insightOptions = [
  { key: 'netConsumedTotal' as const, label: '净消耗' },
  { key: 'peakDayConsumed' as const, label: '单日峰值' },
  { key: 'avgDailyConsumed' as const, label: '日均消耗' },
  { key: 'activeDays' as const, label: '活跃天数' },
  { key: 'longestStreakDays' as const, label: '最长连续活跃' },
]

function formatInsightValue(key: keyof import('@/services/users-api').PointsInsights, value: number) {
  if (key === 'avgDailyConsumed') return value < 10 ? value.toFixed(1) : Math.round(value).toString()
  return String(Math.round(value))
}
```

- [ ] **Step 2: Add template block below category grid**

```vue
<div v-if="summary?.insights" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
  <div
    v-for="item in insightOptions"
    :key="item.key"
    class="rounded-xl border border-white/8 bg-[#242424] p-4"
  >
    <p class="text-xs text-white/45">{{ item.label }}</p>
    <p class="mt-2 text-xl font-semibold text-white/85">
      {{ formatInsightValue(item.key, summary.insights[item.key]) }}
    </p>
  </div>
</div>
```

- [ ] **Step 3: Verify range switch updates KPI numbers**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProfilePage.vue
git commit -m "feat(web): profile usage insight KPI cards"
```

---

### Task 6: 账单 kind 分段 + balanceAfter 密度

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`

**Interfaces:**
- Consumes: `filterKind` ref；映射到 `membershipApi.transactions({ kind })`

- [ ] **Step 1: Replace chip kind filter with segmented control**

```ts
type BillKindTab = 'all' | 'consume' | 'grant'

const billKindTab = ref<BillKindTab>('all')

watch(billKindTab, (tab) => {
  filterKind.value = tab === 'all' ? undefined : tab
})

watch(filterKind, (kind) => {
  if (!kind) billKindTab.value = 'all'
  else if (kind === 'consume' || kind === 'grant') billKindTab.value = kind
  // refund chip from summary cards still sets filterKind='refund' without changing tab
})
```

模板：在汇总区下方、明细列表上方放分段：

```vue
<div class="mb-4 flex rounded-xl bg-[#242424] p-1">
  <button
    v-for="tab in ([['all','全部'],['consume','消耗'],['grant','获得']] as const)"
    :key="tab[0]"
    type="button"
    class="flex-1 rounded-lg px-3 py-2 text-xs transition"
    :class="billKindTab === tab[0] ? 'bg-[#6366f1] text-white' : 'text-white/50'"
    @click="billKindTab = tab[0]"
  >
    {{ tab[1] }}
  </button>
</div>
```

保留「退款积分」对照卡点击 → `filterKind='refund'`（与分段并存）。

- [ ] **Step 2: Add balanceAfter to transaction card footer**

```vue
<div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
  <time class="text-xs text-white/30" :datetime="tx.createdAt">{{ formatCreatedAt(tx.createdAt) }}</time>
  <div class="flex items-center gap-3">
    <span v-if="tx.generationId" class="font-mono text-[11px] text-[#818cf8]/70">
      生成 ID · {{ shortGenerationId(tx.generationId) }}
    </span>
    <span class="text-xs text-white/35">
      余额 {{ tx.balanceAfter ?? '—' }}
    </span>
  </div>
</div>
```

- [ ] **Step 3: Refine empty state copy**

```vue
<p v-if="!transactions.length" class="...">
  {{ filterCategory || filterKind ? '该条件下暂无记录' : '暂无该时间范围的账单记录' }}
</p>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProfilePage.vue
git commit -m "feat(web): profile bill kind tabs and balance-after display"
```

---

### Task 7: ProfilePage 冒烟测试

**Files:**
- Create: `apps/web/src/pages/ProfilePage.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProfilePage from './ProfilePage.vue'

vi.mock('@/services/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { data: { nickname: '测', phone: '1', points: 34, membership: 'free' } } }) },
}))
vi.mock('@/services/users-api', () => ({
  membershipApi: {
    pointsSummary: vi.fn().mockResolvedValue({
      data: {
        data: {
          range: 'month',
          from: null,
          to: new Date().toISOString(),
          byCategory: { text: 0, image: 20, audio: 0, video: 0 },
          otherNetConsumed: 0,
          refundTotal: 0,
          grantTotal: 0,
          insights: { netConsumedTotal: 20, peakDayConsumed: 20, avgDailyConsumed: 1, activeDays: 1, longestStreakDays: 1 },
        },
      },
    }),
    transactions: vi.fn().mockResolvedValue({ data: { data: { items: [], nextCursor: null, from: null, to: new Date().toISOString() } } }),
  },
}))
vi.mock('@/components/membership/MembershipModal.vue', () => ({ default: { template: '<div />' } }))

describe('ProfilePage', () => {
  it('renders insight KPI labels', async () => {
    setActivePinia(createPinia())
    const wrapper = mount(ProfilePage, { global: { stubs: ['router-link'] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('净消耗'))
    expect(wrapper.text()).toContain('单日峰值')
    expect(wrapper.text()).toContain('充值')
  })
})
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts`
Expected: PASS

- [ ] **Step 3: Run full server suite**

Run: `pnpm --filter @lnkpi/server exec vitest run`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProfilePage.test.ts
git commit -m "test(web): profile page insights and CTA smoke"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 扩展 `points-summary` insights 五指标 | Task 1–2 |
| 共用 range | Task 2, 5 |
| 资产卡双 CTA → MembershipModal | Task 4 |
| KPI 卡展示 | Task 5 |
| kind 分段 全部/消耗/获得 | Task 6 |
| balanceAfter 展示 | Task 6 |
| 退款仅在全部 | Task 6 |
| 测试要点 | Task 1, 2, 7 |

## Pre-flight

执行前确保本地基于 `#270`：

```bash
git fetch origin
git checkout main && git merge origin/main   # 或从 origin/main 新建分支
git checkout -b feat/points-stats-neowow-adoption
```
