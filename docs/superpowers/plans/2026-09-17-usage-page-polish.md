# 用量页对账与布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用量明细改为全历史并对齐总览、支持 CSV 导出；趋势补齐坐标；活跃度标月份并铺满卡片；账户卡片与用量同宽。

**Architecture:** `usage-days` 增加 `range=all`（稀疏、不铺日历）。ProfilePage 并行拉趋势窗口与 `all`；表底和 CSV 合计直接用 overview。趋势/年历的刻度与月份抽纯函数再接到 Vue。

**Tech Stack:** Vue 3 + Vitest + NestJS + 现有 `points-usage-range.ts` / `points-usage.ts`

## Global Constraints

- 净消耗 / 生成次数口径不变；趋势窗口仍为 `7d|30d|month`
- 非法 `range` 回落 `7d`；`all` 合法
- 明细合计用 overview，不对逐日净消耗二次加总
- CSV 仅按日表 + 合计，不含流水
- 账户去 `max-w-3xl`，根容器仍 `max-w-6xl`
- TDD：先红后绿；不要 `git add -A`；不要提交 `.pnpm-store`

## File map

- Modify: `apps/server/src/points/points-usage-range.ts` — `all` 解析与窗口
- Modify: `apps/server/src/points/points-usage.ts` — `UsageDaysResponse.range` 含 `all`；`isUsageActivityDay`
- Modify: `apps/server/src/membership/membership.service.ts` — `all` 不 fill
- Modify: `apps/web/src/services/users-api.ts` — 类型同步
- Create: `apps/web/src/components/usage/usageDayTableCsv.ts`
- Create: `apps/web/src/components/usage/usageTrendAxis.ts`
- Modify: `UsageDayTable.vue` / `UsageTrend.vue` / `UsageHeatmap.vue` / `usageHeatmapGrid.ts` / `ProfilePage.vue` 及对应测试

---

### Task 1: `range=all` 解析与 lifetime 窗口

**Files:**
- Modify: `apps/server/src/points/points-usage-range.ts`
- Modify: `apps/server/src/points/points-usage-range.test.ts`
- Modify: `apps/server/src/points/points-usage.ts`（`UsageDaysResponse.range`）
- Modify: `apps/server/src/membership/membership.controller.test.ts`

**Interfaces:**
- Produces: `UsageDaysRangeKey = '7d' | '30d' | 'month' | 'all'`
- `parseUsageDaysRange('all')` → `'all'`
- `resolveUsageDaysRange('all', now)` → `from = new Date(0)`，`to = now`，keys 为上海日历日

- [ ] **Step 1: 改现有测试** `parseUsageDaysRange('all')` 现定期望 `'7d'`，改为 `'all'`；补 `resolveUsageDaysRange('all')`

```ts
it('accepts 7d, 30d, month, all and falls back to 7d', () => {
  expect(parseUsageDaysRange('all')).toBe('all')
  expect(parseUsageDaysRange('nope')).toBe('7d')
})

it('all starts at unix epoch shanghai day through now', () => {
  const now = new Date('2026-09-16T12:00:00.000Z')
  const r = resolveUsageDaysRange('all', now)
  expect(r.from.toISOString()).toBe('1970-01-01T00:00:00.000Z')
  expect(r.to).toBe(now)
  expect(r.toKey).toBe('2026-09-16')
})
```

- [ ] **Step 2: 实现** `parseUsageDaysRange` 接受 `all`；`resolveUsageDaysRange` 对 `all` 返回 epoch→now
- [ ] **Step 3: 跑测试绿灯** `pnpm --filter @lnkpi/server exec vitest run src/points/points-usage-range.test.ts src/membership/membership.controller.test.ts`

---

### Task 2: `usageDays('all')` 稀疏返回

**Files:**
- Modify: `apps/server/src/points/points-usage.ts`
- Modify: `apps/server/src/points/points-usage.test.ts`
- Modify: `apps/server/src/membership/membership.service.ts`
- Modify: `apps/server/src/membership/membership.service.test.ts`

**Interfaces:**
- Produces: `isUsageActivityDay(day: UsageDayPoint): boolean` — `generationCount > 0 || netConsumed > 0`
- `usageDays(..., 'all')` 返回 fold 后的活动日，不 `fillCalendarDays`，`range === 'all'`

- [ ] **Step 1: 失败测试** `isUsageActivityDay`：消耗无生成 = true；全 0 = false；仅生成 = true

```ts
it('usageDays all returns sparse activity days without filling the calendar', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
  $queryRaw
    .mockResolvedValueOnce([{ day: '2026-09-16', kind: 'consume', category: 'video', amountSum: -40 }])
    .mockResolvedValueOnce([{ day: '2026-09-16', distinctGens: 1, nullGens: 0 }])
  const result = await service.usageDays('u1', 'all')
  expect(result.range).toBe('all')
  expect(result.days).toHaveLength(1)
  expect(result.days[0]).toMatchObject({ date: '2026-09-16', netConsumed: 40, generationCount: 1 })
  vi.useRealTimers()
})
```

- [ ] **Step 2: 实现** `all` 分支：`foldDailyUsage(...).filter(isUsageActivityDay)`
- [ ] **Step 3: 绿灯** `pnpm --filter @lnkpi/server exec vitest run src/membership/membership.service.test.ts src/points/points-usage.test.ts`

---

### Task 3: 明细全量、表底对齐总览、CSV

**Files:**
- Create: `apps/web/src/components/usage/usageDayTableCsv.ts`
- Create: `apps/web/src/components/usage/usageDayTableCsv.test.ts`
- Modify: `apps/web/src/components/usage/UsageDayTable.vue`
- Modify: `apps/web/src/components/usage/UsageDayTable.test.ts`
- Modify: `apps/web/src/services/users-api.ts` — `UsageDaysRangeKey` 含 `all`
- Modify: `apps/web/src/pages/ProfilePage.vue` — 独立拉 `usageDays('all')`
- Modify: `apps/web/src/pages/ProfilePage.test.ts`

**Interfaces:**
- `UsageDayTable` props: `days`, `loading?`, `totals: { generationCount, netConsumed, byCategory }`
- `buildUsageDayTableCsv(days, totals): string` 以 `\uFEFF` 开头
- ProfilePage：`allDaysFetchGeneration`；切趋势不重拉 `all`

- [ ] **Step 1: CSV 与表格失败测试**
  - 活动日含 `generationCount === 0 && netConsumed > 0`
  - 全 0 日仍隐藏
  - `data-total` 行数字 = totals（不是行加总）
  - 有「导出 CSV」
  - ProfilePage 用量 Tab `usageDays` 被调用 `'7d'` 与 `'all'`；点 30d 只再调 `'30d'`
  - 账户不再有 `.max-w-3xl`（可与 Task 6 同测，本任务先改 fetch）

- [ ] **Step 2: 实现** 过滤、合计、导出、ProfilePage 双请求
- [ ] **Step 3: 绿灯** web vitest：`UsageDayTable` `usageDayTableCsv` `ProfilePage`

CSV 列：`日期,生成次数,积分消耗,文本,图片,音频,视频`；合计行首列「合计」。

导出：`URL.createObjectURL` + `<a download="lnkpi-usage-YYYY-MM-DD.csv">`；无行时按钮 `disabled`。

---

### Task 4: 趋势横纵坐标

**Files:**
- Create: `apps/web/src/components/usage/usageTrendAxis.ts`
- Create: `apps/web/src/components/usage/usageTrendAxis.test.ts`
- Modify: `apps/web/src/components/usage/UsageTrend.vue`
- Modify: `apps/web/src/components/usage/UsageTrend.test.ts`

**Interfaces:**
- `trendPlot = { width: 640, height: 200, pad: { l: 44, r: 12, t: 10, b: 28 } }`
- `trendYTicks(max: number): number[]` → `[0, mid, max]`，max<2 则 `[0, max]`
- `trendXTickIndexes(range: '7d'|'30d'|'month', n: number): number[]` — 7d 全选；30d 步长 5 含末；month 步长 4 含末
- `formatTrendXLabel(date: string): string` — `'2026-09-16'` → `'9/16'`

- [ ] **Step 1: 轴函数测试 + Vue 测试** svg 含 `data-y-tick` / `data-x-tick`
- [ ] **Step 2: 实现折线落在 pad 内，画网格与刻度文本**
- [ ] **Step 3: 绿灯** UsageTrend + usageTrendAxis 测试

---

### Task 5: 活跃度月份 + 铺满

**Files:**
- Modify: `apps/web/src/components/usage/usageHeatmapGrid.ts`
- Modify: `apps/web/src/components/usage/usageHeatmapGrid.test.ts`
- Modify: `apps/web/src/components/usage/UsageHeatmap.vue`
- Modify: `apps/web/src/components/usage/UsageHeatmap.test.ts`

**Interfaces:**
- `heatmapMonthLabels(columns: HeatmapCell[][]): { week: number; label: string }[]`
- 列的月份取该列第一个 `inRange` 的 `date`；换月输出 `M月`，跨年或第一条 `YYYY年M月`

- [ ] **Step 1: 网格测试** 跨月跨年标签；Vue 测试有「9月」或「2026年9月」，格子无 `h-3 w-3`，外层 `w-full`
- [ ] **Step 2: 实现** 月份行 + `grid-auto-columns: 1fr` + `aspect-square w-full`
- [ ] **Step 3: 绿灯** heatmap 测试

---

### Task 6: 账户同宽

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`
- Modify: `apps/web/src/pages/ProfilePage.test.ts`

- [ ] 去掉账户 `max-w-3xl`；测试改为账户容器 `class` 含 `space-y-4` 且不含 `max-w-3xl`，与用量同在 `max-w-6xl` 根下

---

### Task 7: 全量验证

```bash
pnpm --filter @lnkpi/server exec vitest run src/points/points-usage-range.test.ts src/points/points-usage.test.ts src/membership/membership.service.test.ts src/membership/membership.controller.test.ts
pnpm --filter @lnkpi/web exec vitest run src/components/usage src/pages/ProfilePage.test.ts
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
```

浏览器：`/profile` 账户与用量卡片左右对齐；用量趋势能读坐标；活跃度有月份且铺满；明细合计 = 五卡；导出 CSV。
