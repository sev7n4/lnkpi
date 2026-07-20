# 积分退款与画布/Dock/节点 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 真正退款与明确积分文案、画布右上实时积分/用户、Dock 取消显性化、上游文本不灌 prompt、节点圆形运行/重试图标——单 PR 一次交付。

**Architecture:** 服务端 `PointsService.refund` + 生成路径「先扣后做、失败/取消/BYOK-pending 必退、确认平台再扣」；请求 `close` 标记取消以保证 sync 接口也能退。前端统一 `apiErrorMessage`、`auth` 积分同步、`CanvasAccountChrome`；Dock 收窄 locked 样式；去掉 `textPrompt` seed；`nodeTaskChrome` 改为圆形图标模型。

**Tech Stack:** NestJS、Prisma、Vue 3、Pinia、Vitest、现有 Studio/Material/Dock 组件

**Spec:** `docs/superpowers/specs/2026-07-20-points-dock-node-ux-design.md`

## Global Constraints

- 真正退款；取消只要已扣费一律退；BYOK `fallback_pending` 立刻退，确认平台再扣
- 文案：`积分不足，请充值后再试` / `生成失败，N 积分已返回` / `已取消，N 积分已返回`
- 画布顶栏方案 A：主题 | 积分胶囊 | 头像昵称下拉
- 单 PR；分支建议 `fix/points-dock-node-ux`
- 不把 `.superpowers/` 加入 commit（可写入 `.gitignore`）
- 相关单测绿；提交前 `pnpm --filter @lnkpi/server exec vitest run` 与 `pnpm --filter @lnkpi/web exec vitest run` 通过

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `apps/server/src/points/points.service.ts` | `refund`；可选 `consume` 返回 balance |
| `apps/server/src/points/points.service.test.ts` | refund / 幂等相关单测 |
| `apps/server/src/points/charge-session.ts`（新建） | `chargedPoints` / `refundedPoints` metadata 助手 + 取消标志 |
| `apps/server/src/studio/studio.service.ts` | 扣费后失败退；BYOK pending 先退；confirm 再扣；req close 取消 |
| `apps/server/src/canvas/material.service.ts` | 同上（素材路径） |
| `apps/server/src/studio/studio.fallback.test.ts` | 更新为 pending 已退 + confirm 再扣 |
| `apps/server/src/canvas/material.fallback.test.ts` | 同上 |
| `apps/web/src/utils/apiError.ts`（新建）或抽自 `provider-api` | 共享 `apiErrorMessage` |
| `apps/web/src/stores/auth.ts` | `setPoints` / `refreshPoints` |
| `apps/web/src/composables/useNodeGeneration.ts` | 错误文案、取消文案、刷新积分 |
| `apps/web/src/components/canvas/CanvasAccountChrome.vue`（新建） | 画布右上积分+用户 |
| `apps/web/src/pages/CanvasPage.vue` | 挂载账户条；会员弹窗 |
| `apps/web/src/styles/neo-node.css` | Dock locked 收窄；圆形任务控件样式 |
| `apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue` | 停止态更高对比 |
| `apps/web/src/components/canvas/DockStudioToolbar.vue` | locked 语义保留但样式变弱 |
| `apps/web/src/components/canvas/dock-studio/panels/*DockPanel.vue` | 删除 textPrompt seed |
| `apps/web/src/components/canvas/nodeTaskChrome.ts` | 圆形控件状态模型 |
| `apps/web/src/components/canvas/NodeTaskCornerActions.vue` | 圆形图标 UI |
| `apps/web/src/components/canvas/NodeTaskBadge.vue` | 弱化/移除标题文字徽章或仅保留耗时旁注 |
| `.gitignore` | 忽略 `.superpowers/` |

---

### Task 1: PointsService.refund + charge metadata helpers

**Files:**
- Modify: `apps/server/src/points/points.service.ts`
- Modify: `apps/server/src/points/points.service.test.ts`
- Create: `apps/server/src/points/charge-session.ts`
- Create: `apps/server/src/points/charge-session.test.ts`
- Modify: `.gitignore`（追加 `.superpowers/`）

**Interfaces:**
- Produces:
  - `PointsService.refund(userId: string, amount: number, reason: string): Promise<void>`
  - `applyChargeMeta(meta: Record<string, unknown>, chargedPoints: number): Record<string, unknown>`
  - `applyRefundMeta(meta: Record<string, unknown>, refundedPoints: number, refundReason: string): Record<string, unknown>`
  - `alreadyRefunded(meta: Record<string, unknown>): boolean`

- [ ] **Step 1: Write failing refund test**

在 `points.service.test.ts` 追加：

```ts
it('increments points and writes positive transaction on refund', async () => {
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'pt2', ...args.data }))
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ user: { updateMany }, pointTransaction: { create } }),
  )
  const moduleRef = await Test.createTestingModule({
    providers: [
      PointsService,
      { provide: PrismaService, useValue: { $transaction } },
    ],
  }).compile()

  await moduleRef.get(PointsService).refund('u1', 5, '文本生成退款')

  expect(updateMany).toHaveBeenCalledWith({
    where: { id: 'u1' },
    data: { points: { increment: 5 } },
  })
  expect(create).toHaveBeenCalledWith({
    data: { userId: 'u1', amount: 5, reason: '文本生成退款' },
  })
})

it('no-ops when refund amount <= 0', async () => {
  const $transaction = vi.fn()
  const moduleRef = await Test.createTestingModule({
    providers: [
      PointsService,
      { provide: PrismaService, useValue: { $transaction } },
    ],
  }).compile()
  await moduleRef.get(PointsService).refund('u1', 0, 'x')
  expect($transaction).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/points.service.test.ts`
Expected: FAIL（`refund` 不存在）

- [ ] **Step 3: Implement refund**

```ts
async refund(userId: string, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return
  await this.prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { id: userId },
      data: { points: { increment: amount } },
    })
    await tx.pointTransaction.create({
      data: { userId, amount, reason },
    })
  })
}
```

- [ ] **Step 4: Add charge-session helpers + tests**

```ts
export function applyChargeMeta(meta: Record<string, unknown>, chargedPoints: number) {
  return { ...meta, chargedPoints }
}

export function alreadyRefunded(meta: Record<string, unknown>): boolean {
  return typeof meta.refundedPoints === 'number' && meta.refundedPoints > 0
}

export function applyRefundMeta(
  meta: Record<string, unknown>,
  refundedPoints: number,
  refundReason: string,
) {
  return { ...meta, refundedPoints, refundReason }
}
```

单测覆盖 `alreadyRefunded` true/false。

- [ ] **Step 5: Append `.superpowers/` to `.gitignore`**

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/`

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/points .gitignore
git commit -m "feat(server): add points refund and charge metadata helpers"
```

---

### Task 2: Studio 生成失败退款 + BYOK pending 先退 + confirm 再扣

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.fallback.test.ts`
- Create or extend: `apps/server/src/studio/studio.refund.test.ts`（可选，或扩 fallback 测）

**Interfaces:**
- Consumes: `PointsService.refund`, `applyChargeMeta`, `applyRefundMeta`, `alreadyRefunded`
- Produces: generation metadata 含 `chargedPoints` / `refundedPoints`；`fallback_pending` 时已退费；`confirmPlatformFallback` 内再次 `consume`

**约定（`generateText` 为模板，image/video/audio/prompt 同构）：**

```ts
const cost = 5
await this.points.consume(userId, cost, '文本生成')
// … resolve + try generate …
// success metadata: applyChargeMeta({...}, cost)
// BYOK catch → await this.points.refund(userId, cost, '文本生成-BYOK失败退款')
//   status fallback_pending, metadata: applyRefundMeta(applyChargeMeta({...}, cost), cost, 'byok_failed')
// platform throw → await refund then rethrow
```

`confirmPlatformFallback` 在真正调平台前：

```ts
const platformCost = /* 与类型对应：text 5 / image 10*n / … */
await this.points.consume(userId, platformCost, '平台回退生成')
try {
  // existing platform generate…
  // metadata: chargedPoints: platformCost, priorByokRefunded: true
} catch (err) {
  await this.points.refund(userId, platformCost, '平台回退失败退款')
  // update failed + refundedPoints
  throw err
}
```

- [ ] **Step 1: Update fallback tests to expect refund on pending + consume on confirm**

在 `studio.fallback.test.ts`：mock `points.refund` 与 `points.consume`；断言 user 失败路径调用 `refund`；`confirmPlatformFallback` 调用 `consume`。

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.fallback.test.ts`

- [ ] **Step 3: Implement studio.service 退款/再扣逻辑**

覆盖：`generateText`、`generatePrompt`、`generateImage`、`generateAudio`、视频更新失败路径、`confirmPlatformFallback`、`cancelPlatformFallback`（已退过则不再退）。

平台路径失败（非 BYOK）：`consume` 后 catch → `refund` → throw。

- [ ] **Step 4: Run fallback + 相关 studio 测 — PASS**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.fallback.test.ts src/points/`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio
git commit -m "feat(studio): refund on failure and re-charge on platform fallback confirm"
```

---

### Task 3: Material 路径对齐 + 请求取消退款

**Files:**
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/canvas/material.fallback.test.ts`
- Modify: `apps/server/src/studio/studio.controller.ts`（传入 `req` 或 abort 标志）
- Modify: `apps/server/src/studio/studio.service.ts`（`bindRequestCancel(req)`）
- Modify: `apps/server/src/canvas/canvas.controller.ts`（素材生成同样绑定）

**Interfaces:**
- Produces: `createCancelFlag(req: { on(event: 'close', cb: () => void): void }): { isCancelled(): boolean }`
- 生成结束后若 `isCancelled()`：`refund`（若未退）并返回/标记取消，不把成功结果当作有效完成（或写 `status: 'failed'` + refund 文案元数据）

```ts
export function createCancelFlag(req: { on(event: string, cb: () => void): void; aborted?: boolean }) {
  let cancelled = Boolean(req.aborted)
  req.on('close', () => {
    cancelled = true
  })
  return { isCancelled: () => cancelled }
}
```

Sync 文本示例：

```ts
const cancel = createCancelFlag(req)
await this.points.consume(...)
try {
  const { text } = await createTextProvider(...).generate(...)
  if (cancel.isCancelled()) {
    await this.safeRefund(userId, cost, '文本生成-取消退款')
    throw new BadRequestException('已取消')
  }
  return create completed with chargedPoints
} catch (err) {
  // BYOK / platform / cancel 分支按 Task 2；注意 alreadyRefunded
}
```

客户端 abort → 连接 close → 即便上游已返回也退款并抛「已取消」。

Material 异步：在现有 cancel/停轮询对应的服务端更新 failed 时调用 `safeRefund`；若仅有前端停轮询，增加 `POST .../material/:id/cancel`（若已有则挂退款）。**先查** `material.service` 是否已有 cancel；没有则最小新增：将 status 置 failed + refund。

- [ ] **Step 1: Write/adjust material.fallback tests for refund-on-pending + consume-on-confirm**

- [ ] **Step 2: Implement material + cancel flag wiring**

- [ ] **Step 3: Run**

Run: `pnpm --filter @lnkpi/server exec vitest run src/canvas/material.fallback.test.ts src/studio/studio.fallback.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/canvas apps/server/src/studio apps/server/src/points
git commit -m "feat(canvas): align material refunds and cancel-via-request-close"
```

---

### Task 4: 前端错误文案 + 积分实时刷新

**Files:**
- Create: `apps/web/src/utils/apiError.ts`（从 `provider-api.ts` 挪出 `apiErrorMessage` 并 re-export）
- Modify: `apps/web/src/services/provider-api.ts`（re-export 保持兼容）
- Modify: `apps/web/src/stores/auth.ts` — `setPoints`、`refreshPoints`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`
- Create: `apps/web/src/utils/generationPointsMessage.ts` + test

**Interfaces:**
- Produces:
  - `formatGenerationFailureMessage(err: unknown, refundedPoints?: number): string`
  - `formatCancelledMessage(refundedPoints: number): string`
  - `auth.refreshPoints(): Promise<number>`
  - `auth.setPoints(n: number): void`

```ts
export function formatGenerationFailureMessage(err: unknown, refundedPoints?: number): string {
  const raw = apiErrorMessage(err, '生成失败')
  if (raw.includes('积分不足')) return '积分不足，请充值后再试'
  if (raw.includes('已取消')) {
    return refundedPoints && refundedPoints > 0
      ? `已取消，${refundedPoints} 积分已返回`
      : '已取消'
  }
  if (refundedPoints && refundedPoints > 0) {
    return `生成失败，${refundedPoints} 积分已返回`
  }
  return raw === 'Request failed with status code 400' ? '生成失败' : raw
}
```

`useNodeGeneration` catch：
- `formatGenerationFailureMessage(err)`
- 若文案含「积分不足」，可选 `deps.onInsufficientPoints?.()`（Canvas 打开 MembershipModal）
- 每次生成结束（成功/失败/取消）调用 `auth.refreshPoints()`（`membershipApi.getPoints`）

取消路径 `cancelGeneration`：patch `errorMessage` 为取消文案；因 sync 退款在服务端 close 后发生，取消后仍 `refreshPoints()`（可短 delay 或依赖 abort 后的错误响应）。若 abort 导致 Axios cancel 而无 body，文案用 `已取消` 并 refresh；若后续拿到带 `refundedPoints` 的错误再覆盖。

- [ ] **Step 1: Failing unit tests for message helpers + generation catch mapping**

- [ ] **Step 2: Implement utils + auth + wire useNodeGeneration**

- [ ] **Step 3: Run**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/generationPointsMessage.test.ts src/composables/useNodeGeneration.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/utils apps/web/src/stores/auth.ts apps/web/src/services/provider-api.ts apps/web/src/composables
git commit -m "feat(web): surface points shortage/refund messages and refresh balance"
```

---

### Task 5: CanvasAccountChrome（方案 A）

**Files:**
- Create: `apps/web/src/components/canvas/CanvasAccountChrome.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Optional smoke: 组件浅测或手工验收清单写入 PR

**UI：**
- 右上现有主题按钮旁：`{{ points }} 积分` 按钮 → `MembershipModal`
- 头像字 + 昵称 → 下拉或两个入口：资料 `/profile`、退出 `auth.logout()`
- 绑定 `auth.user?.points`；MembershipModal 内领取/升级后已有写回则复用

```vue
<!-- 示意结构 -->
<div class="canvas-account-chrome">
  <button type="button" class="canvas-points-pill" @click="showMembership = true">
    {{ auth.user?.points ?? 0 }} 积分
  </button>
  <div class="canvas-user-menu">...</div>
  <MembershipModal v-model="showMembership" />
</div>
```

- [ ] **Step 1: Implement component + mount on CanvasPage beside theme toggle**

- [ ] **Step 2: Manual check / minimal test that points render from auth store**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/CanvasAccountChrome.vue apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): show points and user chrome on immersive canvas"
```

---

### Task 6: Dock 生成中 — 停止显性、少置灰

**Files:**
- Modify: `apps/web/src/styles/neo-node.css`（`.is-dock-locked` 规则）
- Modify: `apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue`
- Modify: panels 仅保留控件级 `disabled`（已有则不动逻辑）

**CSS 目标：**
- 删除或改写对非 generate/close 按钮的 `opacity: 0.55` 全局灰；改为依赖各 input `:disabled` 默认样式（轻微即可）
- `.dock-generate-btn.is-generating`：黑底白方块、`opacity: 1`、`box-shadow` 轻微强调，**禁止**被父级降透明

```css
.dock-generate-btn.is-generating {
  background: #111;
  color: #fff;
  opacity: 1;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}
```

- [ ] **Step 1: Adjust CSS + generate button styles**

- [ ] **Step 2: Visual sanity（本地或浏览器）：生成中停止钮对比清晰，参数控件 disabled 但不整条发灰**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/neo-node.css apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue
git commit -m "fix(web): make dock stop control obvious while keeping params disabled"
```

---

### Task 7: 去掉上游 textPrompt 灌入 prompt

**Files:**
- Modify: `TextDockPanel.vue`、`ImageDockPanel.vue`、`VideoDockPanel.vue`、`AudioDockPanel.vue`、`ShotDockPanel.vue`、`SceneComposerDockPanel.vue`
- Modify/add tests if panels 有测；否则在 `useUpstreamNodeContext` 或 dock 相关测里断言「不再 patch prompt」

**每个 panel 删除类似：**

```ts
if (!prompt.value.trim() && ctx.textPrompt) {
  prompt.value = ctx.textPrompt
  emit('patch', { prompt: ctx.textPrompt })
}
```

保留 chips / `@` / generate 时 refs。`AudioDockPanel` 的 disabled 条件若依赖 `upstream.textPrompt`，改为「有 prompt 或有 refs/芯片」即可。

- [ ] **Step 1: Remove seed blocks from all listed panels**

- [ ] **Step 2: Run web tests touching dock/upstream if any**

Run: `pnpm --filter @lnkpi/web exec vitest run src/composables/useUpstreamNodeContext.test.ts src/composables/useNodeGeneration.test.ts`（若文件不存在则跳过缺失路径）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/dock-studio/panels
git commit -m "fix(web): stop seeding upstream text into dock prompt editors"
```

---

### Task 8: 节点圆形运行/取消/重试图标 + 耗时

**Files:**
- Modify: `apps/web/src/components/canvas/nodeTaskChrome.ts`
- Modify: `apps/web/src/components/canvas/nodeTaskChrome.test.ts`
- Modify: `apps/web/src/components/canvas/NodeTaskCornerActions.vue`
- Modify: `apps/web/src/components/canvas/NodeTaskBadge.vue`（改为仅旁侧耗时或合并进 CornerActions）
- Modify: `apps/web/src/styles/neo-node.css`
- Modify: `NeoBaseNode.vue` 若徽章槽需调整

**状态模型建议：**

```ts
export type TaskChromeView = {
  action: 'cancel' | 'retry' | null
  showSpinner: boolean
  elapsedText: string | null // generating 时 m:ss
  tone: TaskBadgeTone
  flashSuccess?: boolean
}

export function resolveTaskChrome(input: {
  status: unknown
  startedAt?: string
  nowMs: number
  completedFlash?: boolean
}): TaskChromeView | null
```

UI：圆形 28px 按钮；generating = spinner/pulse + 点击 cancel；error = retry 图标；旁侧 `elapsedText`；完成 flash 后 null。

保留现有 provide `CANVAS_NODE_CANCEL_KEY` / `RETRY_KEY`。

- [ ] **Step 1: Rewrite pure functions + failing tests for chrome view**

- [ ] **Step 2: Implement circular CornerActions; slim/remove text badge**

- [ ] **Step 3: Run**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/nodeTaskChrome.test.ts src/composables/useNodeGeneration.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas apps/web/src/styles/neo-node.css
git commit -m "feat(web): circular node run/cancel/retry controls with elapsed time"
```

---

### Task 9: 全量回归与 PR

**Files:** 无新功能；验证 + PR

- [ ] **Step 1: Run server + web tests**

```bash
pnpm --filter @lnkpi/server exec vitest run
pnpm --filter @lnkpi/web exec vitest run
```

Expected: PASS（或仅有与本变更无关的既有失败时需先确认）

- [ ] **Step 2: Build web（若仓库惯例需要）**

```bash
pnpm --filter @lnkpi/web build
```

- [ ] **Step 3: 按 spec 验收清单手测**

- [ ] **Step 4: Push + `gh pr create`（标题/正文覆盖 5 项与测试计划）**

---

## Self-Review (plan vs spec)

| Spec 项 | Task |
|---------|------|
| §1 退款 / 不足文案 / BYOK 先退再扣 | T1–T4 |
| §2 画布账户条 | T5 |
| §3 Dock 取消显性 | T6 |
| §4 不灌 prompt | T7 |
| §5 圆形图标 + m:ss | T8 |
| 单 PR | T9 |
| `.superpowers` 不提交 | T1 gitignore |

无 TBD 占位；`refund` / `chargedPoints` / `fallback` 语义前后一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-20-points-dock-node-ux.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间复审  
2. **Inline Execution** — 本会话按 `executing-plans` 连续做，设检查点  

选哪种？
