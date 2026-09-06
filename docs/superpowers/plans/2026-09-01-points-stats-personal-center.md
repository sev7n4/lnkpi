# 个人中心积分统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展积分账本结构化字段，提供按文本/图/音/视频的净消耗汇总与可筛选明细 API，并在个人中心用卡片式 UI 展示（含时间戳）。

**Architecture:** 以 `PointTransaction` 为单一事实源；`PointsService.consume/refund` 与 membership grant 写入 `kind/category/status/model/generationId/balanceAfter`；`MembershipService` 按 `Asia/Shanghai` 窗口聚合汇总与分页明细；存量用 `reason` 映射回填；`ProfilePage` 卡片式汇总+明细。

**Tech Stack:** NestJS、Prisma、Vue 3、Vitest、现有 `/membership/*` API

**Spec:** `docs/superpowers/specs/2026-09-01-points-stats-personal-center-design.md`

## Global Constraints

- 汇总口径：四分类展示**净消耗**；另展示 `refundTotal` / `grantTotal`；grant 不进四分类净消耗
- 时间范围：默认 `month`；可选 `7d` / `month` / `all`；日界 `Asia/Shanghai`；响应带回 `from`/`to`
- 明细信息密度：本期 B（时间、kind、category、amount、reason、model、generationId、status）；演进 C 不实现
- 存量：按 `reason` 回填；无法识别 → `category=other`
- UI：卡片式汇总网格 + 卡片式明细列表
- 分支建议：从最新主线拉 `feat/points-stats-personal-center`（勿堆在无关 feature 分支上）
- 验证：相关 vitest 绿；`pnpm --filter @lnkpi/server exec vitest run` 与改动相关 web 测试通过
- 不把 `.superpowers/`、`.seedream-backup/`、deploy 审计 JSON 等无关文件加入 commit

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `apps/server/src/points/point-tx.types.ts` | `PointKind` / `PointCategory` / `PointTxStatus` / `PointTxMeta` |
| `apps/server/src/points/reason-map.ts` | `reason` → 结构化字段映射（回填与可选兜底） |
| `apps/server/src/points/reason-map.test.ts` | 映射表单测 |
| `apps/server/src/points/points-range.ts` | `resolvePointsRange(range)` → `{ from, to }`（上海时区） |
| `apps/server/src/points/points-range.test.ts` | 窗口边界单测 |
| `apps/server/src/points/points.service.ts` | consume/refund 写结构化字段 + `balanceAfter` |
| `apps/server/src/points/points.service.test.ts` | 更新断言含 meta |
| `apps/server/prisma/schema.prisma` | `PointTransaction` 新列与索引 |
| `apps/server/prisma/migrations/YYYYMMDDHHMMSS_point_tx_stats/migration.sql` | 迁移 |
| `apps/server/scripts/backfill-point-transactions.ts` | 存量回填脚本 |
| `apps/server/src/membership/membership.service.ts` | `listTransactions` 筛选分页 + `pointsSummary` |
| `apps/server/src/membership/membership.service.test.ts` | 汇总口径与筛选单测 |
| `apps/server/src/membership/membership.controller.ts` | query 参数 + `GET points-summary` |
| `apps/server/src/studio/studio.service.ts` | 所有 consume/refund 传 category（及有则 model/generationId） |
| `apps/server/src/canvas/material.service.ts` | 同上 |
| `apps/server/src/canvas/scene-composer.service.ts` | 批量扣费 `category: other`（或多类型时 other） |
| `apps/web/src/services/users-api.ts` | transactions 扩展 + `pointsSummary` |
| `apps/web/src/pages/ProfilePage.vue` | 卡片式汇总与明细 |
| `apps/web/src/pages/ProfilePage.test.ts`（可选） | 汇总/筛选渲染冒烟 |

---

### Task 1: 类型 + reason 映射纯函数（TDD）

**Files:**
- Create: `apps/server/src/points/point-tx.types.ts`
- Create: `apps/server/src/points/reason-map.ts`
- Create: `apps/server/src/points/reason-map.test.ts`

**Interfaces:**
- Produces:
  - `export type PointKind = 'consume' | 'refund' | 'grant'`
  - `export type PointCategory = 'text' | 'image' | 'audio' | 'video' | 'other'`
  - `export type PointTxStatus = 'success' | 'failed_refund' | 'cancelled_refund' | 'byok_refund'`
  - `export interface PointTxMeta { kind: PointKind; category: PointCategory; status?: PointTxStatus | null; model?: string | null; generationId?: string | null }`
  - `export function mapReasonToPointFields(reason: string, amount: number): { kind: PointKind; category: PointCategory; status: PointTxStatus | null }`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { mapReasonToPointFields } from './reason-map'

describe('mapReasonToPointFields', () => {
  it('maps 图像生成 to consume/image/success', () => {
    expect(mapReasonToPointFields('图像生成', -10)).toEqual({
      kind: 'consume',
      category: 'image',
      status: 'success',
    })
  })

  it('maps 文本生成-失败退款', () => {
    expect(mapReasonToPointFields('文本生成-失败退款', 5)).toEqual({
      kind: 'refund',
      category: 'text',
      status: 'failed_refund',
    })
  })

  it('maps 图像生成-取消退款', () => {
    expect(mapReasonToPointFields('图像生成-取消退款', 10)).toEqual({
      kind: 'refund',
      category: 'image',
      status: 'cancelled_refund',
    })
  })

  it('maps BYOK 退款', () => {
    expect(mapReasonToPointFields('视频生成-BYOK失败退款', 30)).toEqual({
      kind: 'refund',
      category: 'video',
      status: 'byok_refund',
    })
  })

  it('maps 每日签到 to grant/other', () => {
    expect(mapReasonToPointFields('每日签到', 100)).toEqual({
      kind: 'grant',
      category: 'other',
      status: null,
    })
  })

  it('maps 升级 专业版 to grant/other', () => {
    expect(mapReasonToPointFields('升级 专业版', 5000)).toEqual({
      kind: 'grant',
      category: 'other',
      status: null,
    })
  })

  it('unknown negative amount → consume/other/success', () => {
    expect(mapReasonToPointFields('神秘扣费', -3)).toEqual({
      kind: 'consume',
      category: 'other',
      status: 'success',
    })
  })

  it('unknown positive amount → grant/other/null', () => {
    expect(mapReasonToPointFields('神秘入账', 3)).toEqual({
      kind: 'grant',
      category: 'other',
      status: null,
    })
  })

  it('maps 平台回退生成 to consume/other', () => {
    expect(mapReasonToPointFields('平台回退生成', -10)).toEqual({
      kind: 'consume',
      category: 'other',
      status: 'success',
    })
  })

  it('maps 导演台批量生成 prefix to consume/other', () => {
    expect(mapReasonToPointFields('导演台批量生成 ×3', -40)).toEqual({
      kind: 'consume',
      category: 'other',
      status: 'success',
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/reason-map.test.ts`  
Expected: FAIL（module not found）

- [ ] **Step 3: Implement types + mapper**

`point-tx.types.ts`：导出上文类型。

`reason-map.ts` 逻辑要点：
1. 若 `reason` 含 `-失败退款` / `-取消退款` / `-BYOK失败退款` / `失败退款` / `取消退款`（平台回退变体）→ `kind=refund`，解析 status，category 用前缀表。
2. 前缀/全文表：`文本生成|提示词模式生成` → text；`图像生成|图像变体|图像精修` → image；`视频生成` → video；含 `音频` → audio。
3. `每日签到` 或 `升级 ` 开头 → grant/other/null。
4. `平台回退` / `导演台批量生成` → consume 或 refund（看后缀），category=`other`。
5. 否则按 `amount` 符号兜底（见测试）。

另导出小表供实现：

```ts
const CATEGORY_BY_LABEL: Array<{ match: RegExp; category: PointCategory }> = [
  { match: /文本生成|提示词模式生成/, category: 'text' },
  { match: /图像生成|图像变体|图像精修/, category: 'image' },
  { match: /视频生成/, category: 'video' },
  { match: /音频/, category: 'audio' },
]
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/reason-map.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/points/point-tx.types.ts apps/server/src/points/reason-map.ts apps/server/src/points/reason-map.test.ts
git commit -m "feat(points): add reason→ledger field mapper"
```

---

### Task 2: 时间窗口 `resolvePointsRange`（TDD）

**Files:**
- Create: `apps/server/src/points/points-range.ts`
- Create: `apps/server/src/points/points-range.test.ts`

**Interfaces:**
- Produces: `export type PointsRangeKey = '7d' | 'month' | 'all'`
- Produces: `export function resolvePointsRange(range: PointsRangeKey, now?: Date): { from: Date | null; to: Date }`
- Consumes: 无

- [ ] **Step 1: Write failing tests**

用固定 `now = new Date('2026-09-15T08:00:00+08:00')`：

```ts
it('month starts at Shanghai month start', () => {
  const { from, to } = resolvePointsRange('month', now)
  expect(from!.toISOString()).toBe(new Date('2026-09-01T00:00:00+08:00').toISOString())
  expect(to.toISOString()).toBe(now.toISOString())
})

it('7d is now minus 7 days', () => {
  const { from } = resolvePointsRange('7d', now)
  expect(from!.toISOString()).toBe(new Date('2026-09-08T08:00:00+08:00').toISOString())
})

it('all has null from', () => {
  expect(resolvePointsRange('all', now).from).toBeNull()
})
```

实现时用显式 offset 计算上海墙钟（避免依赖运行环境 TZ）：例如用 `Temporal` 若项目已有，否则用手动 `+08:00` 字符串/`Date` 算术。推荐：

```ts
const SH_OFFSET_MS = 8 * 60 * 60 * 1000
function shanghaiParts(d: Date) {
  const shifted = new Date(d.getTime() + SH_OFFSET_MS)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), day: shifted.getUTCDate(), ... }
}
function shanghaiMidnight(y: number, m0: number, day: number) {
  return new Date(Date.UTC(y, m0, day, 0, 0, 0) - SH_OFFSET_MS)
}
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement `points-range.ts`**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add apps/server/src/points/points-range.ts apps/server/src/points/points-range.test.ts
git commit -m "feat(points): resolve Shanghai billing time ranges"
```

---

### Task 3: Prisma 迁移扩展 `PointTransaction`

**Files:**
- Modify: `apps/server/prisma/schema.prisma`（`PointTransaction` 模型）
- Create: `apps/server/prisma/migrations/<timestamp>_point_tx_stats/migration.sql`

**Interfaces:**
- Produces: DB 列 `kind`、`category`、`status`、`model`、`generationId`、`balanceAfter` + 索引

- [ ] **Step 1: Update schema**

```prisma
model PointTransaction {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  amount       Int
  reason       String
  kind         String   @default("consume")
  category     String   @default("other")
  status       String?
  model        String?
  generationId String?
  balanceAfter Int?
  createdAt    DateTime @default(now())

  @@index([userId, createdAt])
  @@index([userId, kind, category, createdAt])
}
```

- [ ] **Step 2: Add migration SQL**

```sql
-- AlterTable
ALTER TABLE "PointTransaction" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'consume';
ALTER TABLE "PointTransaction" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "PointTransaction" ADD COLUMN "status" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "model" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "generationId" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "balanceAfter" INTEGER;

-- CreateIndex
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt");
CREATE INDEX "PointTransaction_userId_kind_category_createdAt_idx" ON "PointTransaction"("userId", "kind", "category", "createdAt");
```

（若表已有部分索引名冲突，按 Prisma 生成名为准。）

- [ ] **Step 3: Apply locally**

Run: `pnpm --filter @lnkpi/server exec prisma migrate deploy`（或项目惯用 `prisma migrate dev`）  
Expected: 迁移成功

- [ ] **Step 4: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/
git commit -m "feat(db): add structured fields on PointTransaction"
```

---

### Task 4: `PointsService` 写入结构化字段 + balanceAfter

**Files:**
- Modify: `apps/server/src/points/points.service.ts`
- Modify: `apps/server/src/points/points.service.test.ts`

**Interfaces:**
- Consumes: `PointTxMeta` from `point-tx.types.ts`
- Produces:
  - `consume(userId: string, cost: number, reason: string, meta: PointTxMeta): Promise<void>`
  - `refund(userId: string, amount: number, reason: string, meta: PointTxMeta): Promise<void>`
  - （可选）`grant(userId: string, amount: number, reason: string, meta: Omit<PointTxMeta,'kind'> & { kind?: 'grant' }): Promise<void>` — 或 membership 直接 create；推荐 PointsService 统一 `grant` 以便写 `balanceAfter`

- [ ] **Step 1: Update failing tests** — `create` 期望含结构化字段与 `balanceAfter`

在 consume 测试中 mock：`updateMany` 后 `findUnique` 返回 `{ points: 90 }`，断言：

```ts
expect(create).toHaveBeenCalledWith({
  data: {
    userId: 'u1',
    amount: -10,
    reason: '图像生成',
    kind: 'consume',
    category: 'image',
    status: 'success',
    model: 'seedream',
    generationId: null,
    balanceAfter: 90,
  },
})
```

调用改为：

```ts
await svc.consume('u1', 10, '图像生成', {
  kind: 'consume',
  category: 'image',
  status: 'success',
  model: 'seedream',
})
```

refund 测试类似（`kind: 'refund'`, `status: 'failed_refund'`, `amount: 5`, `balanceAfter` 来自 findUnique）。

- [ ] **Step 2: Run — expect FAIL**（签名/字段不匹配）

- [ ] **Step 3: Implement**

事务内：

```ts
const updated = await tx.user.updateMany({ where: { id: userId, points: { gte: cost } }, data: { points: { decrement: cost } } })
if (updated.count === 0) throw new BadRequestException('积分不足')
const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
await tx.pointTransaction.create({
  data: {
    userId,
    amount: -cost,
    reason,
    kind: meta.kind,
    category: meta.category,
    status: meta.status ?? 'success',
    model: meta.model ?? null,
    generationId: meta.generationId ?? null,
    balanceAfter: user?.points ?? null,
  },
})
```

`refund` / `grant` 同理（increment）。

- [ ] **Step 4: Run points.service.test.ts — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(points): write structured ledger meta on consume/refund"
```

---

### Task 5: 存量回填脚本

**Files:**
- Create: `apps/server/scripts/backfill-point-transactions.ts`

**Interfaces:**
- Consumes: `mapReasonToPointFields`
- Produces: CLI 可重复执行；只更新仍为默认且未回填完成的行（建议条件：`category = 'other' AND model IS NULL AND generationId IS NULL AND status IS NULL` **且** `kind = 'consume'` 的默认行会误伤真实 other——改用：全表扫描按 reason 重算 kind/category/status，**幂等覆盖** kind/category/status，永不写 model/generationId/balanceAfter）

- [ ] **Step 1: Implement script**

```ts
// 伪代码要点
import { PrismaClient } from '@prisma/client'
import { mapReasonToPointFields } from '../src/points/reason-map'

const prisma = new PrismaClient()
async function main() {
  const batchSize = 200
  let cursor: string | undefined
  let updated = 0
  for (;;) {
    const rows = await prisma.pointTransaction.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    })
    if (!rows.length) break
    for (const row of rows) {
      const mapped = mapReasonToPointFields(row.reason, row.amount)
      await prisma.pointTransaction.update({
        where: { id: row.id },
        data: { kind: mapped.kind, category: mapped.category, status: mapped.status },
      })
      updated++
    }
    cursor = rows[rows.length - 1].id
  }
  console.log(`backfilled ${updated} rows`)
}
main().finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Dry-run on local DB（若有数据）**

Run: `pnpm --filter @lnkpi/server exec tsx scripts/backfill-point-transactions.ts`  
Expected: 打印 backfilled N

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts/backfill-point-transactions.ts
git commit -m "chore(points): add PointTransaction backfill script"
```

---

### Task 6: Membership 汇总 + 明细分页 API（TDD）

**Files:**
- Modify: `apps/server/src/membership/membership.service.ts`
- Create: `apps/server/src/membership/membership.service.test.ts`
- Modify: `apps/server/src/membership/membership.controller.ts`

**Interfaces:**
- Consumes: `resolvePointsRange`, Prisma
- Produces:
  - `listTransactions(userId, opts: { range: PointsRangeKey; kind?: PointKind; category?: PointCategory; cursor?: string; limit?: number }): Promise<{ items: PointTxDto[]; nextCursor: string | null; from: string | null; to: string }>`
  - `pointsSummary(userId, range: PointsRangeKey): Promise<PointsSummaryDto>`

`PointsSummaryDto`：

```ts
{
  range: PointsRangeKey
  from: string | null  // ISO
  to: string
  byCategory: {
    text: number
    image: number
    audio: number
    video: number
  }  // netConsumed，展示用非负
  otherNetConsumed: number
  refundTotal: number
  grantTotal: number
}
```

净消耗：`net = (-sum(consume amounts)) - sum(refund amounts)`；若 `net < 0` 则 API 仍返回真实值，UI 按 spec 按 0 展示（或 clamp——**实现选 clamp≥0 与 spec「不为负时按 0 展示」一致，在 service 内 `Math.max(0, net)`**）。

- [ ] **Step 1: Write membership.service.test.ts**

用 mock prisma：给定一组 txs，断言 `pointsSummary('month')`：
- image consume -10、-20 + refund +10 → net 20
- grant 100 → grantTotal 100，不进 byCategory
- text 无记录 → 0

`listTransactions`：过滤 category=image 只返回 image 行；limit+cursor。

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement service methods**

`pointsSummary` 可用 `groupBy` 或一次 `findMany` 在内存聚合（用户量级可接受）；优先：

```ts
const where = { userId, createdAt: from ? { gte: from, lte: to } : { lte: to } }
const rows = await this.prisma.pointTransaction.findMany({ where, select: { amount: true, kind: true, category: true } })
```

然后 JS 聚合。

`listTransactions`：

```ts
findMany({
  where: { userId, ...(kind&&{kind}), ...(category&&{category}), createdAt: ... },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
})
```

- [ ] **Step 4: Controller**

```ts
@Get('transactions')
async transactions(@Req() req, @Query('range') range = 'month', @Query('kind') kind?, @Query('category') category?, @Query('cursor') cursor?, @Query('limit') limit?) {
  const data = await this.membershipService.listTransactions(req.user.sub, {
    range: parseRange(range),
    kind,
    category,
    cursor,
    limit: limit ? Number(limit) : 50,
  })
  return { code: 0, message: 'ok', data }
}

@Get('points-summary')
async pointsSummary(@Req() req, @Query('range') range = 'month') {
  const data = await this.membershipService.pointsSummary(req.user.sub, parseRange(range))
  return { code: 0, message: 'ok', data }
}
```

`parseRange`：非法值回退 `'month'`。

- [ ] **Step 5: claimDaily / upgrade 写入 grant meta**

```ts
await this.prisma.pointTransaction.create({
  data: {
    userId,
    amount: bonus,
    reason: '每日签到',
    kind: 'grant',
    category: 'other',
    status: null,
    balanceAfter: user.points,
  },
})
```

（若改走 `points.grant`，同步改测试。）

- [ ] **Step 6: Run membership + points tests — PASS**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(membership): points summary and filtered transactions API"
```

---

### Task 7: 生成路径补齐 `PointTxMeta`

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/canvas/scene-composer.service.ts`
- Modify: 受影响的 `*.test.ts`（mock consume/refund 现需第 4 参）

**Interfaces:**
- Consumes: `PointTxMeta`
- Produces: 所有 `points.consume` / `points.refund` 调用带 meta

**分类约定（写死在调用点）：**

| chargeReason / 场景 | category |
|---------------------|----------|
| 文本生成、提示词模式生成 | text |
| 图像生成、图像变体、图像精修 | image |
| 视频生成 | video |
| 音频生成（若有） | audio |
| 平台回退*、导演台批量* | other（若 material.type 已知则用 image/video） |

退款：`kind: 'refund'`，`category` 与对应 consume 相同，`status` 按后缀：`failed_refund` / `cancelled_refund` / `byok_refund`（预检拒绝用 `failed_refund`）。

有 `generationId` / `model` 时传入；consume 时尚无 generationId 则 `null`。

辅助（可放 `point-tx.types.ts` 旁）：

```ts
export function consumeMeta(category: PointCategory, extra?: Partial<PointTxMeta>): PointTxMeta {
  return { kind: 'consume', category, status: 'success', ...extra }
}
export function refundMeta(category: PointCategory, status: PointTxStatus, extra?: Partial<PointTxMeta>): PointTxMeta {
  return { kind: 'refund', category, status, ...extra }
}
```

- [ ] **Step 1: 修编译 — 全局搜 `points.consume(` / `points.refund(`，补第 4 参**
- [ ] **Step 2: 更新 studio/material fallback 单测里的 mock 与期望**
- [ ] **Step 3: Run**

```bash
pnpm --filter @lnkpi/server exec vitest run src/points src/membership src/studio/studio.fallback.test.ts src/canvas/material.fallback.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(points): pass category meta from studio/canvas charge sites"
```

---

### Task 8: Web API 客户端

**Files:**
- Modify: `apps/web/src/services/users-api.ts`

**Interfaces:**
- Produces:

```ts
export type PointsRangeKey = '7d' | 'month' | 'all'
export type PointKind = 'consume' | 'refund' | 'grant'
export type PointCategory = 'text' | 'image' | 'audio' | 'video' | 'other'

export interface PointTransactionItem {
  id: string
  amount: number
  reason: string
  createdAt: string
  kind: PointKind
  category: PointCategory
  status: string | null
  model: string | null
  generationId: string | null
  balanceAfter: number | null
}

export interface PointsSummary {
  range: PointsRangeKey
  from: string | null
  to: string
  byCategory: Record<'text' | 'image' | 'audio' | 'video', number>
  otherNetConsumed: number
  refundTotal: number
  grantTotal: number
}

// membershipApi:
transactions: (params?: { range?: PointsRangeKey; kind?: PointKind; category?: PointCategory; cursor?: string; limit?: number }) =>
  api.get<{ data: { items: PointTransactionItem[]; nextCursor: string | null; from: string | null; to: string } }>(...)

pointsSummary: (range?: PointsRangeKey) =>
  api.get<{ data: PointsSummary }>('/membership/points-summary', { params: { range } })
```

注意：后端若返回 `{ items, nextCursor }` 而不是裸数组，前端必须改；**Task 6 统一成对象包装**，打破旧 `data: Array`——仅 ProfilePage 使用，可接受。

- [ ] **Step 1: 改 `users-api.ts`**
- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): membership points summary and transaction query types"
```

---

### Task 9: ProfilePage 卡片式 UI

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`
- Create（推荐）: `apps/web/src/pages/ProfilePage.test.ts` — 用 shallow mount 或抽纯函数测格式化；若项目少页面测试，可只做手动验证清单

**Interfaces:**
- Consumes: `membershipApi.pointsSummary` / `transactions`

- [ ] **Step 1: 状态与加载**

```ts
const range = ref<PointsRangeKey>('month')
const summary = ref<PointsSummary | null>(null)
const transactions = ref<PointTransactionItem[]>([])
const filterCategory = ref<PointCategory | undefined>()
const filterKind = ref<PointKind | undefined>()
const nextCursor = ref<string | null>(null)

async function reload() {
  const [s, tx] = await Promise.all([
    membershipApi.pointsSummary(range.value),
    membershipApi.transactions({
      range: range.value,
      category: filterCategory.value,
      kind: filterKind.value,
    }),
  ])
  summary.value = s.data.data
  transactions.value = tx.data.data.items
  nextCursor.value = tx.data.data.nextCursor
}
watch([range, filterCategory, filterKind], () => { void reload() })
```

- [ ] **Step 2: 模板结构**

1. 保留头像/余额/会员卡  
2. **筛选卡**：三个按钮 `近 7 天` / `本月` / `全部`  
3. **汇总网格**：四张分类卡显示 `summary.byCategory.*`；点击设 `filterCategory`；弱样式卡显示 `refundTotal`、`grantTotal`；`otherNetConsumed > 0` 显示其他卡  
4. **明细卡列表**：每卡显示 reason、kind/category 徽章、金额、`createdAt` 格式化、`model`；有 `generationId` 时显示「查看生成」按钮（本期可 `console` 或禁用 + title「即将支持」——**实现选：仅当有 generationId 时渲染文字链接，href 暂指向 `/workflow` 或省略跳转只展示 ID 截断**，避免假路由）

金额 class：`amount < 0` 红，`>= 0` 绿。

空态：`暂无该时间范围的账单记录`

- [ ] **Step 3: 手动验证清单**

- 默认本月；切换 7d/全部会刷新  
- 点「图片」卡后明细仅图片（或筛选生效）  
- 每条有时间戳  
- 退款与获得样式可区分  

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): card UI for points summary and ledger on profile"
```

---

### Task 10: 端到端冒烟 + 文档勾选

**Files:**
- 无强制代码；可选在 spec 状态改为「实现中/已实现」

- [ ] **Step 1: 跑全量相关测试**

```bash
pnpm --filter @lnkpi/server exec vitest run src/points src/membership
pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts  # 若已添加
```

- [ ] **Step 2: 本地启动后** 登录 → 个人中心 → 确认汇总数字与扣费/退款后变化（若环境允许）
- [ ] **Step 3: Final commit（若有收尾）**

```bash
git commit -m "docs: note points stats profile feature ready for QA"
```

---

## Self-Review（对照 spec）

| Spec 项 | Task |
|---------|------|
| 扩展 PointTransaction 字段/索引 | T3 |
| kind/category/status/model/generationId/balanceAfter 写入 | T4、T7、T6 grant |
| reason 回填 | T1 + T5 |
| GET transactions 筛选/分页/range | T6 + T8 |
| GET points-summary 净消耗+退款+获得 | T6 + T8 |
| Asia/Shanghai 窗口 | T2 + T6 |
| Profile 卡片 UI + 时间戳 | T9 |
| 演进 C | **不在 plan 实现**（仅 spec §4） |
| 测试要点 | T1/T2/T4/T6/T10 |

无 TBD 占位；`generationId` 跳转路由明确为可选弱展示，避免假深链。
