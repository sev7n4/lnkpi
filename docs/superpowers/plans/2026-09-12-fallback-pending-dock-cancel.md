# fallback_pending Dock Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock 在 `fallback_pending` 时显示生成箭头（非停止方块）；取消走 `cancelPlatformFallback` 并同步 DB/节点终态，避免 poll 把已取消节点写回 pending。

**Architecture:** 在 `dockStudio.ts` 拆出 `isDockGenerateBusy`（仅 `generating`）。Canvas Dock 的 `generating` prop 改用该 helper + `isNodeBusy`。`cancelGeneration` 对 pending 调平台回退取消 API。`shouldApplyGenerationPoll` 拒绝在节点已是 `error`/`failed` 时用 incoming `fallback_pending` 覆盖。

**Tech Stack:** Vue 3 + Vitest（`apps/web`）、既有 `studioApi` / `canvasApi`

**Spec:** `docs/superpowers/specs/2026-09-12-fallback-pending-dock-cancel-design.md`

## Global Constraints

- Dock spinning **不含** `fallback_pending`；面板只读仍可用 `isNodeGenerating`（含 pending）
- 取消 pending → API `cancelPlatformFallback` / `cancelMaterialPlatformFallback` → 节点 `status: error`
- 禁止长期 `fallback_pending` + 取消类 `errorMessage`
- 不改 BYOK 确认弹窗产品流；不改 Agnes 参考图上限
- 分支：`fix/fallback-pending-dock-cancel`；勿 push main

## File map

| File | Role |
|------|------|
| `apps/web/src/constants/dockStudio.ts` | 新增 `isDockGenerateBusy` |
| `apps/web/src/constants/dockStudio.test.ts` | helper 单测 |
| `apps/web/src/pages/CanvasPage.vue` | `selectedNodeGenerating` 改用 busy helper |
| `apps/web/src/composables/useNodeGeneration.ts` | cancel pending + generate toggle 守卫 |
| `apps/web/src/composables/useNodeGeneration.test.ts` | cancel pending 单测 |
| `apps/web/src/utils/generationPollGate.ts` | 拒绝 error→pending 回写 |
| `apps/web/src/utils/generationPollGate.test.ts` | gate 单测 |

---

### Task 1: `isDockGenerateBusy` helper

**Files:**
- Modify: `apps/web/src/constants/dockStudio.ts`
- Modify: `apps/web/src/constants/dockStudio.test.ts`

**Interfaces:**
- Consumes: `NODE_GENERATION_STATUS`
- Produces: `isDockGenerateBusy(status: unknown): boolean` — true iff `status === 'generating'`

- [ ] **Step 1: Write the failing test**

Append to `dockStudio.test.ts`:

```ts
import { isDockGenerateBusy, isNodeGenerating, NODE_GENERATION_STATUS } from '@/constants/dockStudio'

describe('isDockGenerateBusy', () => {
  it('is true only for generating', () => {
    expect(isDockGenerateBusy(NODE_GENERATION_STATUS.generating)).toBe(true)
  })

  it('is false for fallback_pending (Dock shows arrow)', () => {
    expect(isDockGenerateBusy(NODE_GENERATION_STATUS.fallback_pending)).toBe(false)
  })

  it('is false for idle/terminal statuses', () => {
    expect(isDockGenerateBusy(NODE_GENERATION_STATUS.draft)).toBe(false)
    expect(isDockGenerateBusy(NODE_GENERATION_STATUS.error)).toBe(false)
    expect(isDockGenerateBusy(NODE_GENERATION_STATUS.completed)).toBe(false)
    expect(isDockGenerateBusy(undefined)).toBe(false)
  })
})
```

Keep existing `isNodeGenerating` tests unchanged（pending 仍为 true）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/web exec vitest run src/constants/dockStudio.test.ts`

Expected: FAIL — `isDockGenerateBusy` is not exported / undefined

- [ ] **Step 3: Write minimal implementation**

In `dockStudio.ts` after `isNodeGenerating`:

```ts
/** Dock 生成按钮「停止方块」态：仅真正生成中（不含 fallback_pending）。 */
export function isDockGenerateBusy(status: unknown): boolean {
  return status === NODE_GENERATION_STATUS.generating
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/web exec vitest run src/constants/dockStudio.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/constants/dockStudio.ts apps/web/src/constants/dockStudio.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add isDockGenerateBusy for Dock stop-button state

EOF
)"
```

---

### Task 2: Wire Dock `generating` prop + generate toggle guard

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue`（`selectedNodeGenerating` + imports）
- Modify: `apps/web/src/composables/useNodeGeneration.ts`（`generateForNode` / 同类 early-cancel 守卫）

**Interfaces:**
- Consumes: `isDockGenerateBusy` from Task 1
- Produces: Dock `generating===false` when status is `fallback_pending`；点击箭头不再因 pending 走「取消并 return」

- [ ] **Step 1: Update `selectedNodeGenerating`**

In `CanvasPage.vue` import `isDockGenerateBusy`（可保留 `isNodeGenerating` 供其它只读处使用）。

Replace:

```ts
const selectedNodeGenerating = computed(() => {
  const node = editorNode.value
  if (!node) return false
  return isNodeBusy(node.id) || isNodeGenerating(node.data?.status)
})
```

With:

```ts
const selectedNodeGenerating = computed(() => {
  const node = editorNode.value
  if (!node) return false
  return isNodeBusy(node.id) || isDockGenerateBusy(node.data?.status)
})
```

- [ ] **Step 2: Fix generate toggle guards in `useNodeGeneration.ts`**

Import `isDockGenerateBusy`.

Wherever generate entry does「若 busy/generating 则 cancel 并 return」（当前约三处：`generateForNode` 及 shot/其它同类入口，搜 `cancelGeneration(node.id)` 前的 `isNodeGenerating` 守卫），改为：

```ts
if (isNodeBusy(node.id) || isDockGenerateBusy(node.data?.status)) {
  cancelGeneration(node.id)
  return
}
```

**保留** `isNodeGenerating` 用于：面板 readonly、`acceptsGenerationWrite`、shot 子节点取消扫描、精修入口等 edit-lock。

- [ ] **Step 3: Run related unit tests**

Run:

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/constants/dockStudio.test.ts \
  src/composables/useNodeGeneration.test.ts
```

Expected: 现有用例 PASS（若有依赖「pending 时点生成即取消」的用例会红，按 Step 2 语义改断言为「允许进入生成 / 不立刻 cancel」）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CanvasPage.vue apps/web/src/composables/useNodeGeneration.ts apps/web/src/composables/useNodeGeneration.test.ts
git commit -m "$(cat <<'EOF'
fix(web): stop treating fallback_pending as Dock generating

EOF
)"
```

---

### Task 3: `cancelGeneration` 走平台回退取消

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Consumes: `studioApi.cancelPlatformFallback`, `canvasApi.cancelMaterialPlatformFallback`
- Produces: pending 取消后节点 `status: 'error'`，`errorMessage` 含「已取消平台回退」或服务端 userMessage；DB 经 API 变 `failed`

- [ ] **Step 1: Write the failing test**

In `useNodeGeneration.test.ts` 增加（按现有 `createDeps` / mock 风格）：

```ts
it('cancelGeneration on fallback_pending calls cancelPlatformFallback and sets error', async () => {
  vi.mocked(studioApi.cancelPlatformFallback).mockResolvedValue(
    mockAxiosResponse({
      data: {
        id: 'rec-fb-cancel',
        type: 'video',
        prompt: 'x',
        status: 'failed',
        metadata: JSON.stringify({ userMessage: '已取消平台回退', cancelled: true }),
        createdAt: new Date().toISOString(),
      },
    }),
  )

  const node = createNode(
    'video',
    {
      status: NODE_GENERATION_STATUS.fallback_pending,
      generationRecordId: 'rec-fb-cancel',
      prompt: 'x',
    },
    'video-fb',
  )
  const { api, deps } = createDeps([node])

  api.cancelGeneration('video-fb')
  await vi.waitFor(() =>
    expect(studioApi.cancelPlatformFallback).toHaveBeenCalledWith('rec-fb-cancel'),
  )
  expect(studioApi.cancelGeneration).not.toHaveBeenCalled()
  expect(deps.patchNodeData).toHaveBeenCalledWith(
    'video-fb',
    expect.objectContaining({
      status: NODE_GENERATION_STATUS.error,
      errorMessage: expect.stringMatching(/已取消/),
    }),
  )
})
```

若 material 路径有对称 API，再加一条 `materialId` + `cancelMaterialPlatformFallback` 用例（节点 `fallback_pending` + `materialId`，无 `generationRecordId`）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeGeneration.test.ts -t "cancelGeneration on fallback_pending"`

Expected: FAIL — 仍调 `cancelGeneration` 或节点变成 `draft`

- [ ] **Step 3: Implement cancel path**

重构 `cancelGeneration` / `cancelRemoteGeneration`：

1. 读节点：若 `status === fallback_pending`：
   - 有 `generationRecordId` → `await studioApi.cancelPlatformFallback(id)`（勿 `.catch` 吞掉到「成功假象」；失败则 `patchGenerationError` 或至少 `status: error` + 可读文案，保留 taskId）
   - 否则有 `materialId` → `await canvasApi.cancelMaterialPlatformFallback(id)`
2. 成功本地 patch：

```ts
deps.patchNodeData(nodeId, {
  status: NODE_GENERATION_STATUS.error,
  errorMessage: '已取消平台回退',
  // 保留 generationRecordId / materialId 便于诊断复制
})
```

3. 停止 poll、`markIdle`、`syncGeneratingFlag`、`refreshPointsAfterGeneration`、可选 `saveCanvas`（若 deps 在 cancel 路径已有 save 则沿用；否则与 confirm-cancel 路径一致调用 `deps.saveCanvas?.()`）。
4. **非** pending：保持现有本地 `draft` + `cancelRemoteGeneration`（`cancelGeneration` / `cancelMaterial`）行为。
5. shot 子节点循环里，若 child 为 `fallback_pending`，同样走平台回退取消而非仅 draft。

实现时注意：`cancelGeneration` 目前是同步函数 + `void cancelRemoteGeneration`。pending 路径改为 `void (async () => { ... })()` 或把远程取消提成 async 并在测试里 `waitFor`，与现有 cancel 测试一致。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeGeneration.test.ts`

Expected: PASS（含原 fallback confirm / cancel 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useNodeGeneration.ts apps/web/src/composables/useNodeGeneration.test.ts
git commit -m "$(cat <<'EOF'
fix(web): cancel fallback_pending via cancelPlatformFallback

EOF
)"
```

---

### Task 4: Poll gate — 禁止 error 被 pending 复活

**Files:**
- Modify: `apps/web/src/utils/generationPollGate.ts`
- Modify: `apps/web/src/utils/generationPollGate.test.ts`

**Interfaces:**
- Consumes: `NODE_GENERATION_STATUS`
- Produces: `shouldApplyGenerationPoll` 在 `nodeStatus ∈ {error, failed}` 且 `incomingStatus === fallback_pending` 时返回 `false`；`incomingStatus === failed/error/completed` 仍可写回同 recordId

- [ ] **Step 1: Write the failing test**

```ts
it('rejects fallback_pending overwrite after local error cancel', () => {
  expect(
    shouldApplyGenerationPoll({
      nodeStatus: 'error',
      nodeRecordId: 'rec-1',
      incomingRecordId: 'rec-1',
      incomingStatus: 'fallback_pending',
    }),
  ).toBe(false)
})

it('still applies failed terminal after error for same recordId', () => {
  expect(
    shouldApplyGenerationPoll({
      nodeStatus: 'error',
      nodeRecordId: 'rec-1',
      incomingRecordId: 'rec-1',
      incomingStatus: 'failed',
    }),
  ).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/generationPollGate.test.ts`

Expected: 第一条 FAIL（当前因 `TERMINAL_POLL_STATUSES` 含 `fallback_pending` 会返回 true）

- [ ] **Step 3: Implement gate**

在 `shouldApplyGenerationPoll` 中，在「Terminal poll for the same recordId」分支之前或之内：

```ts
// User already cancelled / failed locally — do not revive fallback_pending.
if (
  incomingStatus === NODE_GENERATION_STATUS.fallback_pending &&
  (nodeStatus === NODE_GENERATION_STATUS.error ||
    nodeStatus === NODE_GENERATION_STATUS.failed)
) {
  return false
}
```

`draft` 已有整段拒绝，保持不变。

可选：从 `TERMINAL_POLL_STATUSES` 移除 `fallback_pending`，改为仅在 `isNodeGenerating(nodeStatus)` 时接受 pending 写回（节点仍 generating/pending 时允许进入 fallback_pending）。若移除，需确认「generating → fallback_pending」仍走 `isNodeGenerating` 分支（会 return true）——因此移除更干净。

推荐实现：

```ts
const TERMINAL_POLL_STATUSES = new Set<string>([
  NODE_GENERATION_STATUS.completed,
  NODE_GENERATION_STATUS.failed,
  NODE_GENERATION_STATUS.error,
  // fallback_pending is NOT terminal for overwrite-from-error recovery
])
```

`generating`/`fallback_pending` 节点仍通过 `isNodeGenerating(nodeStatus)` 接受写回。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/generationPollGate.test.ts src/composables/useNodeGeneration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/generationPollGate.ts apps/web/src/utils/generationPollGate.test.ts
git commit -m "$(cat <<'EOF'
fix(web): block poll from reviving fallback_pending after error

EOF
)"
```

---

### Task 5: 验证 + 收尾

**Files:** none new（跑全量相关测试）

- [ ] **Step 1: Run focused web tests**

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/constants/dockStudio.test.ts \
  src/utils/generationPollGate.test.ts \
  src/composables/useNodeGeneration.test.ts \
  src/components/canvas/dock-studio/shared/dockFailureChip.test.ts \
  src/components/canvas/nodeTaskChrome.test.ts
```

Expected: all PASS

- [ ] **Step 2: Spec checklist（人工核对）**

- [ ] `fallback_pending` → Dock 停止方块不再亮（`isDockGenerateBusy` false）
- [ ] cancel pending → `cancelPlatformFallback` + 节点 `error`
- [ ] poll 不把 `error` 写回 `fallback_pending`
- [ ] confirm 平台回退 happy path 测试仍绿
- [ ] `isNodeGenerating(fallback_pending)` 仍为 true（只读锁）

- [ ] **Step 3: Commit plan doc if not yet committed；push 分支（仅当用户要求 PR 时再开 PR）**

若本 plan 文件尚未入库：

```bash
git add docs/superpowers/plans/2026-09-12-fallback-pending-dock-cancel.md
git commit -m "$(cat <<'EOF'
docs: plan fallback_pending Dock cancel and button semantics

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Dock 箭头 for pending | Task 1–2 |
| 取消走 cancelPlatformFallback | Task 3 |
| 节点 error + 文案 | Task 3 |
| 禁止半残态 / poll 回弹 | Task 3–4 |
| `isNodeGenerating` 保留 edit-lock | Task 1–2（不改语义） |
| 确认流不变 | Task 5 回归 |
| Agnes 上限 / 第三态按钮 | Non-goal，无任务 |

**Placeholder scan:** none  
**Type consistency:** `isDockGenerateBusy(status: unknown): boolean` 贯穿 Task 1–2
