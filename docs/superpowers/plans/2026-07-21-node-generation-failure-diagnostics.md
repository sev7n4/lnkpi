# 节点生成失败诊断（C2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现简约 C2 失败 UX（ⓘ 浮层 + Dock 28px 胶囊）与按需完整诊断 API（含脱敏 `providerSnippet`），复制文本含 `nodeId` + `taskId`。

**Architecture:** 共享包提供 `ErrorCode`、脱敏与复制格式化；服务端失败时写 metadata + 短结构化错误体，并暴露 `GET …/diagnostic`；前端短字段落节点，点 ⓘ/复制时按 `taskId` 拉取并缓存诊断。

**Tech Stack:** NestJS、Prisma `GenerationRecord`/`Material` metadata JSON、Vue 3、Vitest、现有 `NodeTaskCornerActions` / `DockToolbarShell` / `useNodeGeneration`

**Spec:** `docs/superpowers/specs/2026-07-21-node-generation-failure-diagnostics-design.md`

## Global Constraints

- UI 锁定 **C2**：卡片短错 + 18px ⓘ + 重试；选中失败节点才显示 Dock **28px 胶囊**
- 数据锁定 **方案 2**：短失败不含 `providerSnippet`；诊断按需 GET
- 标识锁定 **A**：复制带 `nodeId` + `taskId`；不引入 `nodeCode`
- 非失败记录 diagnostic → **404**
- 脱敏后 snippet ≤ 2048 字符；禁止在 UI 常驻展示未脱敏原文
- TDD：每个任务先写失败测试再实现；提交信息用中文或 `feat:`/`fix:`/`test:` 前缀

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/generationDiagnostics.ts` | `ErrorCode`、脱敏、复制文本、短/完整 DTO 类型 |
| `packages/shared/src/generationDiagnostics.test.ts` | 共享单测 |
| `packages/shared/src/index.ts` | 导出 |
| `apps/server/src/common/generation-diagnostics.ts` | 服务端组装 diagnostic / 映射 ErrorCode（可 thin-wrap shared） |
| `apps/server/src/studio/studio.service.ts` | 失败 metadata + `getGenerationDiagnostic` |
| `apps/server/src/studio/studio.controller.ts` | `GET generations/:id/diagnostic` |
| `apps/server/src/canvas/material.service.ts` | 同上 material 路径 |
| `apps/server/src/canvas/canvas.controller.ts` | `GET materials/:id/diagnostic` |
| `apps/web/src/services/studio-api.ts` / `canvas-api.ts` | diagnostic 客户端 |
| `apps/web/src/utils/generationDiagnostic.ts` | 缓存 + `formatCopy` 包装 + 解析短错误 |
| `apps/web/src/composables/useNodeGeneration.ts` | 写入 `errorCode` 等短字段 |
| `apps/web/src/components/canvas/NodeTaskCornerActions.vue` | ⓘ + 浮层 |
| `apps/web/src/components/canvas/dock-studio/shared/DockFailureChip.vue` | Dock 胶囊 |
| `apps/web/src/components/canvas/dock-studio/shared/DockToolbarShell.vue` | 插入 chip slot |
| `apps/web/src/styles/neo-node.css` | ⓘ / 浮层 / 胶囊样式 |

---

### Task 1: Shared ErrorCode、脱敏与复制格式化

**Files:**
- Create: `packages/shared/src/generationDiagnostics.ts`
- Create: `packages/shared/src/generationDiagnostics.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `export type ErrorCode = 'insufficient_points' | 'upstream_timeout' | 'upstream_error' | 'cancelled' | 'invalid_input' | 'model_unavailable' | 'upload_required' | 'fallback_pending' | 'unknown'`
  - `export type TaskKind = 'generation' | 'material'`
  - `export interface GenerationDiagnostic { userMessage: string; code: ErrorCode; taskKind: TaskKind; taskId: string; nodeId?: string; nodeLabel?: string; sessionId?: string; model?: string | null; channelId?: string | null; apiFormat?: string | null; httpStatus?: number | null; occurredAt: string; providerSnippet: string | null; hint?: string }`
  - `export function redactProviderSnippet(raw: string, maxLen = 2048): string`
  - `export function formatDiagnosticCopy(d: GenerationDiagnostic): string`
  - `export function mapMessageToErrorCode(message: string): ErrorCode`（启发式映射，供服务端兜底）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  formatDiagnosticCopy,
  redactProviderSnippet,
  mapMessageToErrorCode,
} from './generationDiagnostics'

describe('redactProviderSnippet', () => {
  it('redacts bearer tokens and truncates', () => {
    const raw = `Authorization: Bearer sk-live-abc123secret\nemail user@example.com\n${'x'.repeat(3000)}`
    const out = redactProviderSnippet(raw, 200)
    expect(out).not.toContain('sk-live-abc123secret')
    expect(out).not.toMatch(/user@example\.com/)
    expect(out.length).toBeLessThanOrEqual(220)
    expect(out).toContain('truncated')
  })
})

describe('formatDiagnosticCopy', () => {
  it('formats stable key lines including nodeId and taskId', () => {
    const text = formatDiagnosticCopy({
      userMessage: '上游超时',
      code: 'upstream_timeout',
      taskKind: 'generation',
      taskId: 'gen_1',
      nodeId: 'node_1',
      occurredAt: '2026-07-21T00:00:00.000Z',
      providerSnippet: 'timeout of 90000ms exceeded',
    })
    expect(text).toContain('lnkpi diagnostic')
    expect(text).toContain('code: upstream_timeout')
    expect(text).toContain('taskId: gen_1')
    expect(text).toContain('nodeId: node_1')
    expect(text).toContain('providerSnippet:')
  })
})

describe('mapMessageToErrorCode', () => {
  it('maps known phrases', () => {
    expect(mapMessageToErrorCode('积分不足')).toBe('insufficient_points')
    expect(mapMessageToErrorCode('timeout of 90000ms exceeded')).toBe('upstream_timeout')
    expect(mapMessageToErrorCode('weird')).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/generationDiagnostics.test.ts`  
（若 shared 尚无 vitest 脚本，用 `pnpm --filter @lnkpi/shared exec vitest run` 并确保 `package.json` 有 vitest；或先把测试放在 `packages/shared` 现有测试方式下——当前 shared 用节点旁 `*.test.ts`，agent 包用 vitest；**本仓库 shared 已有 `*.test.ts` 且被 agent/server 引用时，优先：`cd packages/shared && npx vitest run src/generationDiagnostics.test.ts`**）  
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

在 `packages/shared/src/generationDiagnostics.ts` 实现类型与上述三函数：

- `redactProviderSnippet`：替换 `/Bearer\s+\S+/gi`、`/sk-[A-Za-z0-9_-]{8,}/g`、邮箱、手机号；URL 中 `key|token|signature=` 打码；超长截断 + `\n…(truncated)`
- `formatDiagnosticCopy`：按 spec 行式输出；空字段省略；`providerSnippet` 用 `providerSnippet: |\n  ` 缩进多行
- `mapMessageToErrorCode`：包含 `积分不足`→`insufficient_points`，`timeout`/`ETIMEDOUT`→`upstream_timeout`，`已取消`→`cancelled`，`参考图尚未上传`→`upload_required`，`模型`+`停用`→`model_unavailable`，默认 `unknown`

`index.ts` 增加：`export * from './generationDiagnostics'`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/generationDiagnostics.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/generationDiagnostics.ts packages/shared/src/generationDiagnostics.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): generation diagnostic types, redact, and copy format"
```

---

### Task 2: Studio diagnostic API + 失败 metadata

**Files:**
- Create: `apps/server/src/studio/studio.diagnostic.test.ts`（或扩展现有 `studio.fallback.test.ts` 旁新文件）
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.controller.ts`

**Interfaces:**
- Consumes: `GenerationDiagnostic`, `redactProviderSnippet`, `mapMessageToErrorCode`, `ErrorCode` from `@lnkpi/shared`
- Produces:
  - `StudioService.getGenerationDiagnostic(userId: string, id: string): Promise<GenerationDiagnostic>`
  - 失败更新 metadata 时写入 `errorCode`、`errorRaw`（未脱敏原文，仅服务端存）、`failedAt`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
// 按仓库现有 studio 测试风格 mock Prisma；断言：
// 1) status !== failed → NotFoundException
// 2) 成功时 providerSnippet 不含 raw key，且 code 来自 metadata.errorCode

it('getGenerationDiagnostic returns 404 when not failed', async () => {
  // arrange record status completed
  await expect(svc.getGenerationDiagnostic('u1', 'g1')).rejects.toThrow(/不存在|找不到|诊断/)
})

it('getGenerationDiagnostic redacts provider snippet', async () => {
  // arrange failed + metadata.errorRaw = 'Bearer sk-secret hello'
  const d = await svc.getGenerationDiagnostic('u1', 'g1')
  expect(d.code).toBe('upstream_error')
  expect(d.taskKind).toBe('generation')
  expect(d.taskId).toBe('g1')
  expect(d.providerSnippet).not.toContain('sk-secret')
})
```

（具体 mock 语法对齐 `studio.fallback.test.ts`。）

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.diagnostic.test.ts`  
Expected: FAIL — `getGenerationDiagnostic` undefined

- [ ] **Step 3: Write minimal implementation**

1. `getGeneration(userId, id)` 已有则复用；若 `status` 不是 `failed`/`error` → `NotFoundException('诊断不可用')`
2. `parseMeta` 读取 `errorCode`、`errorRaw`、`model`、`channelId`、`apiFormat`、`httpStatus`、`failedAt`
3. 返回：

```ts
{
  userMessage: meta.userMessage ?? record 失败默认文案 ?? '生成失败',
  code: (meta.errorCode as ErrorCode) ?? mapMessageToErrorCode(String(meta.errorRaw ?? '')),
  taskKind: 'generation',
  taskId: record.id,
  model: record.model ?? meta.model ?? null,
  channelId: meta.channelId ?? null,
  apiFormat: meta.apiFormat ?? null,
  httpStatus: typeof meta.httpStatus === 'number' ? meta.httpStatus : null,
  occurredAt: meta.failedAt ?? record.createdAt.toISOString(),
  providerSnippet: meta.errorRaw ? redactProviderSnippet(String(meta.errorRaw)) : null,
  hint: hintForCode(code), // 本地小函数：timeout→稍后重试；points→充值 等
}
```

4. Controller：

```ts
@Get('generations/:id/diagnostic')
async generationDiagnostic(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
  const data = await this.studioService.getGenerationDiagnostic(req.user.sub, id)
  return { data }
}
```

5. 在**至少一处**代表性 catch（如文本/图片生成失败更新 `status: 'failed'` 处）写入：

```ts
metadata: JSON.stringify({
  ...existingMeta,
  errorCode: mapMessageToErrorCode(errMsg),
  errorRaw: errMsg.slice(0, 8000),
  userMessage: /* 友好文案 */,
  failedAt: new Date().toISOString(),
})
```

并在 `BadRequestException` 抛出时使用对象 body：

```ts
throw new BadRequestException({
  message: userMessage,
  errorCode,
  taskKind: 'generation',
  taskId: record.id,
  refundedPoints, // 若有
})
```

（其余失败路径可在本任务末尾批量补齐同一 helper，避免漏网。）

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.diagnostic.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio/studio.service.ts apps/server/src/studio/studio.controller.ts apps/server/src/studio/studio.diagnostic.test.ts
git commit -m "feat(server): studio generation diagnostic endpoint"
```

---

### Task 3: Material diagnostic API + 失败 metadata

**Files:**
- Create: `apps/server/src/canvas/material.diagnostic.test.ts`
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/canvas/canvas.controller.ts`

**Interfaces:**
- Produces: `MaterialService.getMaterialDiagnostic(userId, id): Promise<GenerationDiagnostic>`（`taskKind: 'material'`）
- 与 Task 2 相同 metadata 字段约定

- [ ] **Step 1: Write the failing test**

镜像 Task 2：非 failed → 抛错；failed + `errorRaw` 含 secret → snippet 已脱敏；`taskKind === 'material'`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/canvas/material.diagnostic.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- `GET` 路由挂在 canvas controller（与现有 `cancelMaterial` 同级鉴权）
- 通过 material → shot → session 校验 `userId`
- 失败 catch 写 `errorCode` / `errorRaw` / `userMessage` / `failedAt`
- 短错误 `BadRequestException` body 含 `taskKind: 'material'`, `taskId: material.id`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/canvas/material.diagnostic.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/canvas/material.service.ts apps/server/src/canvas/canvas.controller.ts apps/server/src/canvas/material.diagnostic.test.ts
git commit -m "feat(server): material diagnostic endpoint"
```

---

### Task 4: Web API + diagnostic 缓存 / 复制工具

**Files:**
- Create: `apps/web/src/utils/generationDiagnostic.ts`
- Create: `apps/web/src/utils/generationDiagnostic.test.ts`
- Modify: `apps/web/src/services/studio-api.ts`
- Modify: `apps/web/src/services/canvas-api.ts`
- Modify: `apps/web/src/utils/generationPointsMessage.ts`（解析 `errorCode` / `taskId` 从 axios body，保持旧行为兼容）

**Interfaces:**
- Produces:
  - `studioApi.getGenerationDiagnostic(id: string): Promise<GenerationDiagnostic>`
  - `canvasApi.getMaterialDiagnostic(id: string): Promise<GenerationDiagnostic>`
  - `parseShortGenerationError(err: unknown): { userMessage: string; errorCode?: ErrorCode; taskKind?: TaskKind; taskId?: string; refundedPoints?: number }`
  - `createDiagnosticCache()` → `{ get(taskKind, taskId, fetcher), clear(taskId?) }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDiagnosticCache, parseShortGenerationError } from './generationDiagnostic'

it('parseShortGenerationError reads structured body', () => {
  const parsed = parseShortGenerationError({
    response: {
      data: {
        message: '上游超时',
        errorCode: 'upstream_timeout',
        taskKind: 'generation',
        taskId: 'g1',
      },
    },
  })
  expect(parsed).toMatchObject({
    userMessage: '上游超时',
    errorCode: 'upstream_timeout',
    taskId: 'g1',
  })
})

it('createDiagnosticCache dedupes in-flight fetches', async () => {
  const cache = createDiagnosticCache()
  const fetcher = vi.fn().mockResolvedValue({ taskId: 'g1', code: 'unknown' })
  const a = cache.get('generation', 'g1', fetcher)
  const b = cache.get('generation', 'g1', fetcher)
  await Promise.all([a, b])
  expect(fetcher).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/generationDiagnostic.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// studio-api
getGenerationDiagnostic: (id: string) =>
  api.get<{ data: GenerationDiagnostic }>(`/studio/generations/${id}/diagnostic`).then((r) => r.data.data),

// canvas-api
getMaterialDiagnostic: (id: string) =>
  api.get<{ data: GenerationDiagnostic }>(`/canvas/materials/${id}/diagnostic`).then((r) => r.data.data),
```

`parseShortGenerationError`：优先结构化字段；否则 fallback `formatGenerationFailureMessage` 逻辑（可内部调用现有函数）。

`createDiagnosticCache`：`Map<string, Promise<GenerationDiagnostic>>`，key = `${taskKind}:${taskId}`。

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/generationDiagnostic.ts apps/web/src/utils/generationDiagnostic.test.ts apps/web/src/services/studio-api.ts apps/web/src/services/canvas-api.ts apps/web/src/utils/generationPointsMessage.ts
git commit -m "feat(web): diagnostic API client and cache"
```

---

### Task 5: useNodeGeneration 写入短失败字段

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Consumes: `parseShortGenerationError`
- Produces: 节点 data 增加 `errorCode?: ErrorCode`；确保已有 `generationRecordId` / `materialId` 在失败时仍在；导出或 provide `fetchNodeDiagnostic(nodeId)`（可选，若 UI 直接调 cache+api 也可只在 Task 6/7 组装）

- [ ] **Step 1: Write failing test**

在现有 `useNodeGeneration.test.ts` 增加：mock 生成抛出 structured axios error → `patchNodeData` 收到 `errorMessage` + `errorCode` + 保留 `generationRecordId`。

- [ ] **Step 2: Run — expect FAIL**（尚未写 errorCode）

- [ ] **Step 3: Update `patchGenerationError`**

```ts
function patchGenerationError(nodeId: string, err: unknown, signal?: AbortSignal) {
  // … abort / refund 分支保持
  const short = parseShortGenerationError(err)
  if (short.userMessage.includes('积分不足')) deps.onInsufficientPoints?.()
  if (!nodeAcceptsWrite(nodeId)) return
  const node = findNodeById(deps.nodes.value, nodeId)
  const patch: Record<string, unknown> = {
    status: NODE_GENERATION_STATUS.error,
    errorMessage: short.userMessage,
  }
  if (short.errorCode) patch.errorCode = short.errorCode
  if (short.taskKind === 'generation' && short.taskId) patch.generationRecordId = short.taskId
  if (short.taskKind === 'material' && short.taskId) patch.materialId = short.taskId
  // 若 node 已有 id，不要清空
  deps.patchNodeData(nodeId, patch)
}
```

轮询失败路径（`applyStudioRecord` 等 status error）同样写入 `errorCode`（从 record.metadata 解析若可得）。

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useNodeGeneration.ts apps/web/src/composables/useNodeGeneration.test.ts
git commit -m "feat(web): persist short failure code and task id on nodes"
```

---

### Task 6: C2 卡片 ⓘ + 诊断浮层

**Files:**
- Create: `apps/web/src/components/canvas/NodeDiagnosticPopover.vue`
- Modify: `apps/web/src/components/canvas/NodeTaskCornerActions.vue`
- Modify: `apps/web/src/components/canvas/nodeTaskChrome.test.ts`（若有组件测则加；否则新增 `NodeTaskCornerActions` 相关测或轻量测 popover helper）
- Modify: `apps/web/src/styles/neo-node.css`
- Modify: 各节点传入 props（`CanvasNodeText.vue` 等）：增加 `errorCode`、`generationRecordId`/`materialId` 透传若需要

**Interfaces:**
- `NodeTaskCornerActions` props 增加：`errorCode?: string`；`taskKind?: 'generation' | 'material'`；`taskId?: string`；`nodeLabel?: string`；`sessionId?: string`
- 点击 ⓘ：`stopPropagation`；拉取 diagnostic；展示 `userMessage` + `hint` + 复制按钮
- 复制：`formatDiagnosticCopy({ ...diag, nodeId, nodeLabel, sessionId })` + `navigator.clipboard.writeText`

- [ ] **Step 1: Write failing test**

优先测纯函数/小组件：若用 VTU 成本高，则测「组装 copy 时合并 nodeId」的 helper（放在 `generationDiagnostic.ts` 的 `buildCopyForNode(diag, ctx)`）。

```ts
it('buildCopyForNode merges node context', () => {
  const text = buildCopyForNode(
    { userMessage: 'x', code: 'unknown', taskKind: 'generation', taskId: 'g1', occurredAt: 't', providerSnippet: null },
    { nodeId: 'n1', nodeLabel: '文本', sessionId: 's1' },
  )
  expect(text).toContain('nodeId: n1')
  expect(text).toContain('sessionId: s1')
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement UI**

`NodeTaskCornerActions` 错误行：

```vue
<p v-if="showError" class="neo-task-error-row">
  <span class="neo-task-error">{{ err }}</span>
  <button type="button" class="neo-task-diag-btn" aria-label="诊断信息" title="诊断信息" @click="openDiag">ⓘ</button>
</p>
```

浮层：绝对定位、暗色、`userMessage`、`hint`、主按钮「复制诊断」；点击外部关闭。

样式：`.neo-task-diag-btn` 18×18，默认 `color: rgba(255,255,255,.35)`，hover 淡紫；不增加「详情」文案。

`fallback_pending`：同样显示 ⓘ（spec），文案 hint 引导确认/取消回退。

- [ ] **Step 4: 相关 vitest PASS；手动不要求本任务**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/NodeTaskCornerActions.vue apps/web/src/components/canvas/NodeDiagnosticPopover.vue apps/web/src/styles/neo-node.css apps/web/src/utils/generationDiagnostic.ts apps/web/src/utils/generationDiagnostic.test.ts apps/web/src/components/canvas/CanvasNode*.vue
git commit -m "feat(web): C2 node diagnostic info button and popover"
```

---

### Task 7: Dock 28px 失败胶囊

**Files:**
- Create: `apps/web/src/components/canvas/dock-studio/shared/DockFailureChip.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/shared/DockToolbarShell.vue`
- Modify: 各 `*DockPanel.vue` 或仅 Shell：通过 props/`slot` 在 header 下插入 chip
- Modify: `DockStudioToolbar.vue` / `DockStudioRouter` 传入失败态

**Interfaces:**
- 当 `status` 为 `error`/`failed`（及可选 `fallback_pending`）且节点选中（Dock 已可见）时渲染：
  - 文案：截断 `errorMessage`
  - 按钮：复制（同 Task 6 的 `buildCopyForNode` + cache）
- 高度约 28px；圆角胶囊；不挤压 prompt（margin-bottom 8px）

- [ ] **Step 1: Write failing test**

`DockFailureChip` 可见性：无 `errorMessage` 不渲染；有则显示复制按钮（可用 VTU 或纯 props→computed）。

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

在 `DockToolbarShell` 增加可选 slot `failure` 或 props：

```vue
<div v-if="failureMessage" class="dock-failure-chip">
  <span class="dock-failure-chip__msg">{{ failureMessage }}</span>
  <button type="button" @click="emit('copy-diagnostic')">复制</button>
</div>
```

各面板从 `node.data` 传入；`DockStudioToolbar` 已仅在选中可编辑节点时显示 → 满足「选中才出现」。

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/dock-studio/
git commit -m "feat(web): dock failure chip with copy diagnostic"
```

---

### Task 8: 端到端校验与收尾

**Files:**
- 必要时补 `studio.integration.test.ts` 对 diagnostic 路由的冒烟
- 更新 spec status（可选）

- [ ] **Step 1: Run full verification**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/generationDiagnostics.test.ts
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.diagnostic.test.ts src/canvas/material.diagnostic.test.ts
pnpm --filter @lnkpi/web exec vitest run src/utils/generationDiagnostic.test.ts src/composables/useNodeGeneration.test.ts
pnpm build
```

Expected: all PASS / build OK

- [ ] **Step 2: Manual checklist（本地或预发）**

- [ ] 失败节点仅短错 + ⓘ + 重试  
- [ ] ⓘ 打开浮层可复制，含 `nodeId`/`taskId`，snippet 无 key  
- [ ] 选中失败节点 Dock 有胶囊；取消选中胶囊随 Dock 消失  
- [ ] 短失败网络面板无 `providerSnippet`  
- [ ] 非失败 id 请求 diagnostic → 404  

- [ ] **Step 3: Commit（若有收尾改动）**

```bash
git add -u
git commit -m "test: verify generation failure diagnostics end-to-end"
```

---

## Spec coverage self-check

| Spec item | Task |
|-----------|------|
| C2 ⓘ + 浮层 | 6 |
| Dock 28px 胶囊 | 7 |
| 短失败无 snippet | 2, 3, 5 |
| 按需 diagnostic GET | 2, 3, 4 |
| 完整字段 + 脱敏 | 1, 2, 3 |
| nodeId + taskId，无 nodeCode | 1, 6 |
| ErrorCode 枚举 | 1, 2, 5 |
| 非失败 404 | 2, 3 |
| fallback_pending 可 ⓘ | 6 |
| 测试：复制一致 / 脱敏 | 1, 4, 6, 8 |

## Placeholder / type consistency

- `GenerationDiagnostic`、`ErrorCode`、`TaskKind` 以 Task 1 为准，后续任务不得改名
- `taskId` 始终对应 `generationRecordId` 或 `materialId`
- 复制统一 `formatDiagnosticCopy` / `buildCopyForNode`，禁止手写第二套模板
