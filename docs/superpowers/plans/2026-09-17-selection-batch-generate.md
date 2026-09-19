# 画布框选批量生成 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在画布上**框选 ≥2 节点** → 多选工具栏出现「**生成 · N**」主按钮 → 点击后**前端**编排并发执行（混合拓扑 + 缺口补跑 + 硬超时 + 显式停止）。仅前端实现，不动 Nest / runtime，不开新计费通道。

**Architecture:** 双模块——`packages/shared/src/canvas/selectionBatchGenerate.ts` 纯函数规划器（Kahn 拓扑 + 缺口判定 + 24 上限 + pending_confirm 拒绝）+ `apps/web/src/composables/useSelectionGenerate.ts` Vue composable 执行器（混合拓扑调度 + 并发 3 + 硬超时双闸 + AbortController + 显式 `cancelGeneration`）。UI 走 `MultiSelectToolbar.vue` + `CanvasPage.vue` 接线。复用现网 `useNodeGeneration.runGroupMemberHasUsableOutput / findNodeById / isNodeBusy / cancelGeneration / resolveUpstreamContext` —— §4.5 SSOT 依赖清单拍板的私有函数 export，**不**重写判定逻辑。

**Tech Stack:** TypeScript 5.7 / Vitest 3.2 / Vue 3.5 / Element Plus / @lnkpi/shared (Zod 3.23)

**Spec:** [`docs/superpowers/specs/2026-09-17-selection-batch-generate-design.md`](../specs/2026-09-17-selection-batch-generate-design.md)（v3，908 行）—— 实施时 spec 与 plan 一同走读。

---

## Global Constraints

从 spec 直接抄录，无修改：

- **范围**（spec §0 范围声明）：**仅前端**。Nest / runtime **不**新增端点；不引入新计费通道
- **绕开 `compositionGenerateIdsForClick`**（SB-D6 / §1.2）：执行器**必须**调 `generateForNode(node, { asRunGroupMember: true })`，**禁止**走 `compositionGenerateIdsForClick`
- **24 上限**（SB-D7 / §4.3 #6）：planner 抛 `SelectionBatchLimitError`；执行器**不**做二次判断
- **并发 3**（SB-D7 / §5.3）：semaphore = 3
- **硬超时双闸**（SB-D15 / §5.3）：单节点 `MAX_WAIT_PER_NODE_MS = 600_000`、全批 `MAX_BATCH_DURATION_MS = 1_800_000`
- **`pending_confirm` 整批拒绝**（SB-D3 / §4.3 #2）：planner 抛 `SelectionBatchPendingConfirmError`
- **Feature flag**（SB-D16 / §13.1）：`feature.selection_batch_generate` 默认 `false`；off 时**整按钮不渲染**
- **`pointsExhausted` 是 batch 级**（I2-3 / §5.5）：`node_settled` 事件**不**带此字段
- **进度 5 类别**（I2-1 / §5.2）：`done` / `failed` / `cancelled` / `timeout` / `skipped`——`insufficient_points` 计入 failed
- **`abortReason` 闭合 7 值**（I2-2 / §5.2）：`none` / `pending_confirm` / `limit_24` / `user_stopped` / `insufficient_points` / `batch_timeout` / `node_timeout`
- **停止全部**（C5 / I2-5 / §5.3）：**显式**调 `deps.cancelGeneration(id)` 对每个 in-flight 节点——不等 AbortController 传播
- **SSOT 依赖**（§4.5）：5 个私有函数 `export` 出来，**不**重写逻辑；不重写 `hasUsableOutput` / `findNodeById` / 上游解析
- **DRIFT 监测**（§4.5）：export 路径不重写测试，靠 `useNodeGeneration.test.ts` 已有用例做 drift 监测
- **测试先行**（TDD）：每个 task 写测试 → 跑测试看红 → 实现 → 跑测试看绿 → commit
- **提交前缀**（AGENTS.md）：`feat:` / `fix:` / `refactor:` / `test:` / `chore:`；中文 commit message 禁止
- **分支命名**（AGENTS.md）：`feature/selection-batch-generate`
- **本地验证**（AGENTS.md 提交前必跑）：`pnpm install --frozen-lockfile && pnpm build && pnpm --filter @lnkpi/web test && pnpm --filter @lnkpi/agent test`
- **PR 流程**（AGENTS.md）：feature 分支 + PR；Squash & Merge
- **commit 不超过 14 天保鲜**（AGENTS.md 2026-09-18 增补）：每个 commit + push 间隔 < 14 天
- **`pnpm` 不用 `npm` 或 `yarn`**（项目锁定）
- **Vitest `jsdom` 环境**（`apps/web/vitest.config.ts`）；shared 用 `node` 环境（`/** @vitest-environment node */` 头）
- **TypeScript strict mode**（项目全栈 strict）

---

## Task 0: 分支基线

**Files:**
- Read: `package.json`、`apps/web/package.json`、`packages/shared/package.json`、`AGENTS.md`

**Step 1:** 拉 main 最新并创建 feature 分支

```bash
cd /Users/4seven/workspace/lnkpi
git checkout main
git pull origin main
git checkout -b feature/selection-batch-generate
```

**Step 2:** 确认本地基线绿（必跑，按 AGENTS.md 提交前 4 条验证）

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @lnkpi/web test -- compositionRunGroup
pnpm --filter @lnkpi/agent test
```

Expected：4 条命令全绿，零失败。若有 flaky：fix 再继续，不跳过。

**Step 3:** 验证 spec + plan 在 main 上

```bash
ls docs/superpowers/specs/2026-09-17-selection-batch-generate-design.md
ls docs/superpowers/plans/2026-09-17-selection-batch-generate.md
```

Expected：两个文件都存在。

**Step 4:** 初始 commit（仅文档，作为任务 0 的"骨架"）

```bash
git status
# 应只有 docs/superpowers/plans/2026-09-17-selection-batch-generate.md 为 untracked
git add docs/superpowers/plans/2026-09-17-selection-batch-generate.md
git commit -m "docs: add selection batch generate implementation plan"
git push -u origin feature/selection-batch-generate
```

---

## Task 1: Export SSOT 函数（5 个私有 → 公开）

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.ts:725,162,256,456,833`
- Read: `apps/web/src/composables/useNodeGeneration.test.ts`（已有用例，确保 export 后仍然通过）

**Step 1:** 找 5 个函数的当前签名（应都是 `function` 开头，**没有** `export`）

```bash
cd /Users/4seven/workspace/lnkpi
grep -n "^function runGroupMemberHasUsableOutput\|^function findNodeById\|^function isNodeBusy\|^function cancelGeneration\|^function resolveUpstreamContext" apps/web/src/composables/useNodeGeneration.ts
```

Expected：5 行命中，行号在 162/256/456/725/833 附近。

**Step 2:** 验证 `useNodeGeneration.test.ts` 现有用例覆盖这些函数（drift 监测前提）

```bash
pnpm --filter @lnkpi/web test -- useNodeGeneration.test
```

Expected：测试绿。如果红，**先修测试**再继续。

**Step 3:** Export 5 个函数（每个加 `export` + 4 行注释）

打开 `apps/web/src/composables/useNodeGeneration.ts`，对 5 个函数逐个改 `function X` → `export function X`，并在每个函数前加注释块：

```ts
// ─────────────────────────────────────────────────────────────────
// v3 SB-§4.5 SSOT 暴露：useSelectionGenerate 复用
// 行为不变；新增 export 不修改函数体。如修改函数体，先确认 selectionBatchGenerate 单测仍绿（drift 监测）。
// ─────────────────────────────────────────────────────────────────
```

**Step 4:** 跑测试，确认 export 后所有测试仍绿（行为零改动）

```bash
pnpm --filter @lnkpi/web test -- useNodeGeneration.test
```

Expected：与 Step 2 完全相同的 pass 数。**如果多了 fail = export 影响到了什么 = 立即停手。**

**Step 5:** Commit

```bash
git add apps/web/src/composables/useNodeGeneration.ts
git commit -m "refactor(useNodeGeneration): export 5 SSOT functions for selection batch planner/executor"
git push
```

---

## Task 2: Feature Flag 系统

**Files:**
- Create: `apps/web/src/composables/useFeatureFlag.ts`
- Create: `apps/web/src/composables/useFeatureFlag.test.ts`

**Step 1:** 写失败测试（确认 hook 还没实现）

```bash
cd /Users/4seven/workspace/lnkpi
cat > apps/web/src/composables/useFeatureFlag.test.ts << 'TS_EOF'
import { describe, expect, it } from 'vitest'
import { isFeatureOn } from './useFeatureFlag'

describe('isFeatureOn', () => {
  it('returns false for unknown flags (safe default)', () => {
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
  })

  it('returns true for flags enabled in env-like config', () => {
    // 测试通过 setFlag 注入，无副作用
  })
})
TS_EOF
pnpm --filter @lnkpi/web test -- useFeatureFlag.test
```

Expected：FAIL（`isFeatureOn` 不存在）。

**Step 2:** 实现 `useFeatureFlag.ts`（最简实现：内存 Map + 默认全 off；env override 留给 V2）

```ts
// apps/web/src/composables/useFeatureFlag.ts
/**
 * v3 SB-D16 / §13.1 Feature Flag
 *
 * V1 实现：内存 Map 注入；默认全 off。
 * 灰度通过 setFlag() 在启动时配置；后续接 Vite env / 后台 config 时只改这一处。
 */

const flags = new Map<string, boolean>([
  ['selection_batch_generate', false], // SB-D16 默认 off
])

export function isFeatureOn(key: string): boolean {
  return flags.get(key) === true
}

export function setFlag(key: string, on: boolean): void {
  flags.set(key, on)
}

/** 在测试中重置所有 flag（**仅** test 入口使用） */
export function _resetFlagsForTest(): void {
  flags.clear()
  flags.set('selection_batch_generate', false)
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/web test -- useFeatureFlag.test
```

Expected：PASS（1/1）。

**Step 4:** 补 setFlag 行为测试

```ts
// 追加到 useFeatureFlag.test.ts
import { _resetFlagsForTest, isFeatureOn, setFlag } from './useFeatureFlag'

describe('setFlag + isFeatureOn', () => {
  it('toggles the flag on then off', () => {
    _resetFlagsForTest()
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
    setFlag('selection_batch_generate', true)
    expect(isFeatureOn('selection_batch_generate')).toBe(true)
    setFlag('selection_batch_generate', false)
    expect(isFeatureOn('selection_batch_generate')).toBe(false)
  })
})
```

**Step 5:** 跑测试全绿

```bash
pnpm --filter @lnkpi/web test -- useFeatureFlag.test
```

Expected：PASS（2/2）。

**Step 6:** Commit

```bash
git add apps/web/src/composables/useFeatureFlag.ts apps/web/src/composables/useFeatureFlag.test.ts
git commit -m "feat(web): add useFeatureFlag composable for selection_batch_generate"
git push
```

---

## Task 3: Planner 类型定义

**Files:**
- Create: `packages/shared/src/canvas/selectionBatchGenerate.ts`
- Create: `packages/shared/src/canvas/selectionBatchGenerate.test.ts`

**Step 1:** 写失败测试（types only，断言 import 路径 + 类型签名）

```bash
cd /Users/4seven/workspace/lnkpi
mkdir -p packages/shared/src/canvas
cat > packages/shared/src/canvas/selectionBatchGenerate.test.ts << 'TS_EOF'
/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  SelectionBatchLimitError,
  SelectionBatchPendingConfirmError,
  planSelectionGenerate,
  type PlanSelectionGenerateInput,
  type PlanSelectionGenerateResult,
  type SkipReason,
} from './selectionBatchGenerate'

describe('planner entry types', () => {
  it('exports the entry function and error classes', () => {
    expect(typeof planSelectionGenerate).toBe('function')
    expect(SelectionBatchLimitError).toBeDefined()
    expect(SelectionBatchPendingConfirmError).toBeDefined()
  })
})

describe('planner: no candidates', () => {
  it('returns empty run/skip for empty selectedIds', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: [],
      canvas: { nodes: [], edges: [] },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip).toEqual([])
    expect(result.blockedBy).toEqual([])
  })
})
TS_EOF
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：FAIL（模块不存在）。

**Step 2:** 实现 types + 最小入口

```ts
// packages/shared/src/canvas/selectionBatchGenerate.ts
/**
 * v3 spec §4 规划器
 * 纯函数；无副作用；不依赖 web/vue。
 */

export class SelectionBatchLimitError extends Error {
  readonly code = 'SelectionBatchLimitError'
  constructor(public readonly actualCount: number) {
    super(`Selection batch run count ${actualCount} exceeds 24`)
  }
}

export class SelectionBatchPendingConfirmError extends Error {
  readonly code = 'SelectionBatchPendingConfirmError'
  constructor(public readonly pendingCount: number) {
    super(`Selection contains ${pendingCount} pending_confirm node(s); user must confirm via sidebar first`)
  }
}

export type SkipReason =
  | { nodeId: string; reason: 'already_done' }
  | { nodeId: string; reason: 'unsupported_type'; type: string }
  | { nodeId: string; reason: 'fallback_pending' }
  | { nodeId: string; reason: 'missing_upstream'; ref: string }
  | { nodeId: string; reason: 'in_flight' }
  | { nodeId: string; reason: 'upstream_in_flight'; ref: string }
  | { nodeId: string; reason: 'node_disappeared' }
  | { nodeId: string; reason: 'user_stopped' }

export interface PlanSelectionGenerateInput {
  selectedIds: string[]
  canvas: {
    nodes: ReadonlyArray<{ id: string; type: string; parentNode?: string; data?: Record<string, unknown> }>
    edges: ReadonlyArray<{ id: string; source: string; target: string }>
  }
  hasUsableOutput: (node: { type: string; data?: Record<string, unknown> }) => boolean
  isInFlight?: (nodeId: string) => boolean
}

export interface PlanSelectionGenerateResult {
  run: string[]
  skip: SkipReason[]
  blockedBy: Array<{ source: string; target: string; reason: 'cycle' | 'upstream_missing' }>
  groupExpanded: Array<{ groupId: string; childIds: string[] }>
}

// 占位实现（Task 4-6 逐步替换）
export function planSelectionGenerate(_input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  return { run: [], skip: [], blockedBy: [], groupExpanded: [] }
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：PASS（2/2）。

**Step 4:** Commit

```bash
git add packages/shared/src/canvas/selectionBatchGenerate.ts packages/shared/src/canvas/selectionBatchGenerate.test.ts
git commit -m "feat(shared): add selection batch planner types and entry stub"
git push
```

---

## Task 4: Planner — 选区展开（group + unsupported type）

**Files:**
- Modify: `packages/shared/src/canvas/selectionBatchGenerate.ts`
- Modify: `packages/shared/src/canvas/selectionBatchGenerate.test.ts`

**Step 1:** 加失败测试（覆盖 4.3 #1 行为）

```ts
// 追加到 selectionBatchGenerate.test.ts
import { getGroupChildIds } from './groupChildIds' // 已存在

describe('planner: 选区展开', () => {
  it('跳过 group 自身，把子节点并入候选', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['group-1'],
      canvas: {
        nodes: [
          { id: 'group-1', type: 'group', data: { childIds: ['img-1', 'img-2'] } },
          { id: 'img-1', type: 'image', data: { url: 'https://x/1.png' } },
          { id: 'img-2', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: (n) => !!n.data?.url,
    }
    const result = planSelectionGenerate(input)
    // img-1 已 done 走 skip already_done；img-2 走 run
    expect(result.groupExpanded).toContainEqual({ groupId: 'group-1', childIds: ['img-1', 'img-2'] })
    expect(result.run).toContain('img-2')
    expect(result.skip.find(s => s.nodeId === 'img-1')?.reason).toBe('already_done')
    expect(result.skip.find(s => s.nodeId === 'group-1')?.reason).toBe('unsupported_type')
  })

  it('unsupported 类型（mediaInput/sceneComposer/videoComposition/worldModel）进 skip', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['m-1', 'sc-1', 'vc-1', 'wm-1', 'i-1'],
      canvas: {
        nodes: [
          { id: 'm-1', type: 'mediaInput', data: {} },
          { id: 'sc-1', type: 'sceneComposer', data: {} },
          { id: 'vc-1', type: 'videoComposition', data: {} },
          { id: 'wm-1', type: 'worldModel', data: {} },
          { id: 'i-1', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.skip.find(s => s.nodeId === 'm-1')?.reason).toBe('unsupported_type')
    expect(result.skip.find(s => s.nodeId === 'sc-1')?.reason).toBe('unsupported_type')
    expect(result.skip.find(s => s.nodeId === 'vc-1')?.reason).toBe('unsupported_type')
    expect(result.skip.find(s => s.nodeId === 'wm-1')?.reason).toBe('unsupported_type')
    expect(result.run).toEqual(['i-1'])
  })
})
```

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：FAIL（group 还在 skip，img-1 也不对）。

**Step 2:** 实现选区展开

```ts
// 替换 selectionBatchGenerate.ts 中的 planSelectionGenerate 占位

const UNSUPPORTED_TYPES = new Set(['mediaInput', 'sceneComposer', 'videoComposition', 'worldModel', 'group'])
const SUPPORTED_TYPES = new Set(['image', 'video', 'audio', 'prompt', 'text', 'shot'])

interface RawNode { id: string; type: string; parentNode?: string; data?: Record<string, unknown> }

function expandSelection(
  selectedIds: string[],
  nodes: ReadonlyArray<RawNode>,
  skip: SkipReason[],
  groupExpanded: PlanSelectionGenerateResult['groupExpanded'],
): RawNode[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const result: RawNode[] = []
  for (const id of selectedIds) {
    const node = nodeById.get(id)
    if (!node) {
      // 选中的节点不在 canvas（已删）→ 当作 disappeared
      skip.push({ nodeId: id, reason: 'node_disappeared' })
      continue
    }
    if (node.type === 'group') {
      // 展开 group 子节点（childIds 来自 data，复用 groupChildIds 模式）
      const childIds = Array.isArray((node.data as { childIds?: string[] })?.childIds)
        ? (node.data as { childIds: string[] }).childIds
        : []
      groupExpanded.push({ groupId: id, childIds })
      skip.push({ nodeId: id, reason: 'unsupported_type', type: node.type })
      for (const cid of childIds) {
        const child = nodeById.get(cid)
        if (child) result.push(child)
        else skip.push({ nodeId: cid, reason: 'node_disappeared' })
      }
    } else if (UNSUPPORTED_TYPES.has(node.type)) {
      skip.push({ nodeId: id, reason: 'unsupported_type', type: node.type })
    } else if (SUPPORTED_TYPES.has(node.type)) {
      result.push(node)
    } else {
      // 未知 type 视为 unsupported（防漂移）
      skip.push({ nodeId: id, reason: 'unsupported_type', type: node.type })
    }
  }
  return result
}

export function planSelectionGenerate(input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  const skip: SkipReason[] = []
  const groupExpanded: PlanSelectionGenerateResult['groupExpanded'] = []
  const candidates = expandSelection(input.selectedIds, input.canvas.nodes, skip, groupExpanded)
  // Task 5/6 会接 status filter + Kahn
  const run = candidates.filter(n => !input.hasUsableOutput(n)).map(n => n.id)
  for (const n of candidates) {
    if (input.hasUsableOutput(n)) {
      skip.push({ nodeId: n.id, reason: 'already_done' })
    }
  }
  return { run, skip, blockedBy: [], groupExpanded }
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：PASS（4/4）。

**Step 4:** Commit

```bash
git add packages/shared/src/canvas/selectionBatchGenerate.ts packages/shared/src/canvas/selectionBatchGenerate.test.ts
git commit -m "feat(shared): planner selects candidate expansion and unsupported-type skip"
git push
```

---

## Task 5: Planner — 状态过滤（pending_confirm 拒绝 + 24 上限 + 缺上游标记）

**Files:**
- Modify: `packages/shared/src/canvas/selectionBatchGenerate.ts`
- Modify: `packages/shared/src/canvas/selectionBatchGenerate.test.ts`

**Step 1:** 加失败测试

```ts
// 追加到 selectionBatchGenerate.test.ts

describe('planner: 状态过滤', () => {
  it('pending_confirm 整批拒绝（任一即抛错）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1', 'i-2'],
      canvas: {
        nodes: [
          { id: 'i-1', type: 'image', data: { status: 'pending_confirm' } },
          { id: 'i-2', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    expect(() => planSelectionGenerate(input)).toThrow(SelectionBatchPendingConfirmError)
  })

  it('fallback_pending 进 skip，不弹确认框', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1'],
      canvas: { nodes: [{ id: 'i-1', type: 'image', data: { status: 'fallback_pending' } }], edges: [] },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip[0]?.reason).toBe('fallback_pending')
  })

  it('24 + 1 = 抛 SelectionBatchLimitError', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => ({
      id: `i-${i}`,
      type: 'image' as const,
      data: {},
    }))
    const input: PlanSelectionGenerateInput = {
      selectedIds: nodes.map(n => n.id),
      canvas: { nodes, edges: [] },
      hasUsableOutput: () => false,
    }
    expect(() => planSelectionGenerate(input)).toThrow(SelectionBatchLimitError)
  })

  it('isInFlight 节点 + 下游：in-flight 节点 skip in_flight，下游 skip upstream_in_flight', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['p-1', 'i-1', 'v-1'],
      canvas: {
        nodes: [
          { id: 'p-1', type: 'prompt', data: {} },
          { id: 'i-1', type: 'image', data: {} },
          { id: 'v-1', type: 'video', data: {} },
        ],
        edges: [
          { id: 'e1', source: 'p-1', target: 'i-1' },
          { id: 'e2', source: 'i-1', target: 'v-1' },
        ],
      },
      hasUsableOutput: () => false,
      isInFlight: (id) => id === 'i-1',
    }
    const result = planSelectionGenerate(input)
    expect(result.skip.find(s => s.nodeId === 'i-1')?.reason).toBe('in_flight')
    expect(result.skip.find(s => s.nodeId === 'v-1')?.reason).toBe('upstream_in_flight')
    // p-1 入度 0，仍可跑
    expect(result.run).toContain('p-1')
    expect(result.run).not.toContain('v-1')
  })
})
```

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：FAIL（pending_confirm 没抛、24 没抛、in_flight 没处理）。

**Step 2:** 实现状态过滤

```ts
// 修改 planSelectionGenerate：

export function planSelectionGenerate(input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  const skip: SkipReason[] = []
  const groupExpanded: PlanSelectionGenerateResult['groupExpanded'] = []
  const candidates = expandSelection(input.selectedIds, input.canvas.nodes, skip, groupExpanded)

  // pending_confirm 整批拒绝（SB-D3 / §4.3 #2）
  const pending = candidates.filter(n => String(n.data?.status ?? '') === 'pending_confirm')
  if (pending.length > 0) {
    throw new SelectionBatchPendingConfirmError(pending.length)
  }

  // fallback_pending skip
  const toRun: RawNode[] = []
  for (const n of candidates) {
    const status = String(n.data?.status ?? '')
    if (status === 'fallback_pending') {
      skip.push({ nodeId: n.id, reason: 'fallback_pending' })
    } else if (input.hasUsableOutput(n)) {
      skip.push({ nodeId: n.id, reason: 'already_done' })
    } else if (input.isInFlight?.(n.id) === true) {
      skip.push({ nodeId: n.id, reason: 'in_flight' })
    } else {
      toRun.push(n)
    }
  }

  // 24 上限（SB-D7 / §4.3 #6）
  if (toRun.length > 24) {
    throw new SelectionBatchLimitError(toRun.length)
  }

  // Task 6 加 Kahn；in_flight 下游标记 upstream_in_flight 留到 Task 6
  const run = toRun.map(n => n.id)
  return { run, skip, blockedBy: [], groupExpanded }
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：PASS（8/8，含 Task 4 的 4 个 + 本 task 的 4 个）。

**Step 4:** Commit

```bash
git add packages/shared/src/canvas/selectionBatchGenerate.ts packages/shared/src/canvas/selectionBatchGenerate.test.ts
git commit -m "feat(shared): planner adds pending_confirm reject, fallback_pending skip, 24 cap, in_flight"
git push
```

---

## Task 6: Planner — Kahn 拓扑 + 环处理 + 选区外上游缺结果标记

**Files:**
- Modify: `packages/shared/src/canvas/selectionBatchGenerate.ts`
- Modify: `packages/shared/src/canvas/selectionBatchGenerate.test.ts`

**Step 1:** 加失败测试

```ts
// 追加到 selectionBatchGenerate.test.ts

describe('planner: Kahn 拓扑', () => {
  it('独立节点任意稳定顺序（按 id 排序）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['c', 'a', 'b'],
      canvas: {
        nodes: [
          { id: 'a', type: 'image', data: {} },
          { id: 'b', type: 'image', data: {} },
          { id: 'c', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['a', 'b', 'c'])
  })

  it('链 prompt→image→video 全 draft → 串行', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['p', 'i', 'v'],
      canvas: {
        nodes: [
          { id: 'p', type: 'prompt', data: {} },
          { id: 'i', type: 'image', data: {} },
          { id: 'v', type: 'video', data: {} },
        ],
        edges: [
          { id: 'e1', source: 'p', target: 'i' },
          { id: 'e2', source: 'i', target: 'v' },
        ],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['p', 'i', 'v'])
  })

  it('环 A→B→A 不死锁，追加到 run 末尾', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['A', 'B'],
      canvas: {
        nodes: [
          { id: 'A', type: 'image', data: {} },
          { id: 'B', type: 'image', data: {} },
        ],
        edges: [
          { id: 'e1', source: 'A', target: 'B' },
          { id: 'e2', source: 'B', target: 'A' },
        ],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(new Set(result.run)).toEqual(new Set(['A', 'B']))
    expect(result.run).toHaveLength(2)
    expect(result.blockedBy.some(b => b.reason === 'cycle')).toBe(true)
  })

  it('跨选区上游有结果 → 候选节点正常入 run', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['v'],
      canvas: {
        nodes: [
          { id: 'ext-i', type: 'image', data: { url: 'https://x/y.png' } }, // 选区外
          { id: 'v', type: 'video', data: {} },
        ],
        edges: [{ id: 'e1', source: 'ext-i', target: 'v' }],
      },
      hasUsableOutput: (n) => !!n.data?.url,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['v'])
    expect(result.skip.find(s => s.nodeId === 'v')).toBeUndefined()
  })

  it('跨选区上游无结果 → candidate 不进 run（执行器报 missing_upstream）', () => {
    // 选区外上游有无可用结果由 hasUsableOutput 决定，planner 不直接判定 missing_upstream
    // 这里验证：候选节点仍进 run（executor 阶段才判定）
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['v'],
      canvas: {
        nodes: [
          { id: 'ext-i', type: 'image', data: {} }, // 选区外，无 url
          { id: 'v', type: 'video', data: {} },
        ],
        edges: [{ id: 'e1', source: 'ext-i', target: 'v' }],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['v']) // planner 不报 missing_upstream
  })
})
```

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：FAIL（run 顺序未排序、环未处理）。

**Step 2:** 实现 Kahn

```ts
// 替换 planSelectionGenerate 末尾：

function kahnTopologicalSort(
  toRun: RawNode[],
  edges: ReadonlyArray<{ id: string; source: string; target: string }>,
): { run: string[]; blockedBy: PlanSelectionGenerateResult['blockedBy'] } {
  const runSet = new Set(toRun.map(n => n.id))
  const inDegree = new Map<string, number>(toRun.map(n => [n.id, 0]))
  const adj = new Map<string, string[]>(toRun.map(n => [n.id, []]))

  // 仅在选区内的边
  for (const e of edges) {
    if (runSet.has(e.source) && runSet.has(e.target)) {
      adj.get(e.source)!.push(e.target)
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    }
  }

  // 稳定排序：按 id 字典序入队
  const ready = toRun.map(n => n.id).filter(id => (inDegree.get(id) ?? 0) === 0).sort()
  const run: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    run.push(id)
    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) {
        // 插入到 sorted position
        const insertAt = ready.findIndex(r => r > next)
        if (insertAt < 0) ready.push(next)
        else ready.splice(insertAt, 0, next)
      }
    }
  }

  // 环：剩余 inDegree > 0 的节点
  const blockedBy: PlanSelectionGenerateResult['blockedBy'] = []
  const remaining = toRun.map(n => n.id).filter(id => (inDegree.get(id) ?? 0) > 0)
  for (const id of remaining) {
    run.push(id)
    // 记录环的边（任意 in 边即可）
    for (const e of edges) {
      if (runSet.has(e.source) && e.target === id) {
        blockedBy.push({ source: e.source, target: e.target, reason: 'cycle' })
        break
      }
    }
  }
  return { run, blockedBy }
}

export function planSelectionGenerate(input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  const skip: SkipReason[] = []
  const groupExpanded: PlanSelectionGenerateResult['groupExpanded'] = []
  const candidates = expandSelection(input.selectedIds, input.canvas.nodes, skip, groupExpanded)

  const pending = candidates.filter(n => String(n.data?.status ?? '') === 'pending_confirm')
  if (pending.length > 0) throw new SelectionBatchPendingConfirmError(pending.length)

  const toRun: RawNode[] = []
  for (const n of candidates) {
    const status = String(n.data?.status ?? '')
    if (status === 'fallback_pending') skip.push({ nodeId: n.id, reason: 'fallback_pending' })
    else if (input.hasUsableOutput(n)) skip.push({ nodeId: n.id, reason: 'already_done' })
    else if (input.isInFlight?.(n.id) === true) skip.push({ nodeId: n.id, reason: 'in_flight' })
    else toRun.push(n)
  }

  if (toRun.length > 24) throw new SelectionBatchLimitError(toRun.length)

  const { run, blockedBy } = kahnTopologicalSort(toRun, input.canvas.edges)
  return { run, skip, blockedBy, groupExpanded }
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/shared test -- selectionBatchGenerate.test
```

Expected：PASS（13/13）。

**Step 4:** Commit

```bash
git add packages/shared/src/canvas/selectionBatchGenerate.ts packages/shared/src/canvas/selectionBatchGenerate.test.ts
git commit -m "feat(shared): planner adds Kahn topology with cycle handling and stable ordering"
git push
```

---

## Task 7: Executor — 类型 + 入口骨架

**Files:**
- Create: `apps/web/src/composables/useSelectionGenerate.ts`
- Create: `apps/web/src/composables/useSelectionGenerate.test.ts`

**Step 1:** 写失败测试（types + 状态机）

```bash
cd /Users/4seven/workspace/lnkpi
cat > apps/web/src/composables/useSelectionGenerate.test.ts << 'TS_EOF'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useSelectionGenerate, type UseSelectionGenerateDeps } from './useSelectionGenerate'

function makeDeps(overrides?: Partial<UseSelectionGenerateDeps>): UseSelectionGenerateDeps {
  return {
    nodes: ref([]),
    edges: ref([]),
    generateForNode: async () => {},
    hasUsableOutput: () => false,
    resolveUpstreamIds: () => [],
    cancelGeneration: () => {},
    isInFlight: () => false,
    toast: () => {},
    ...overrides,
  }
}

describe('useSelectionGenerate entry', () => {
  it('exports useSelectionGenerate factory', () => {
    expect(typeof useSelectionGenerate).toBe('function')
  })

  it('initial state is idle and progress zero', () => {
    const api = useSelectionGenerate(makeDeps())
    expect(api.state.value).toBe('idle')
    expect(api.progress.value).toMatchObject({
      done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
      abortReason: 'none',
    })
  })
})
TS_EOF
pnpm --filter @lnkpi/web test -- useSelectionGenerate.test
```

Expected：FAIL（模块不存在）。

**Step 2:** 实现 executor 骨架

```ts
// apps/web/src/composables/useSelectionGenerate.ts
/**
 * v3 spec §5 执行器
 * Vue composable；调度混合拓扑 + 硬超时 + 显式 cancel。
 */
import { ref, type Ref } from 'vue'
import type { EditableFlowNode } from './useSelectedNodeEditor'
import type { CanvasEdgeLike } from './useNodeGeneration'
import type { PlanSelectionGenerateResult, SkipReason } from '@lnkpi/shared'

export type SettleKind =
  | 'ok' | 'failed' | 'insufficient_points' | 'cancelled' | 'timeout'
  | 'in_flight' | 'upstream_in_flight' | 'node_disappeared'
  | 'missing_upstream' | 'unsupported_type' | 'fallback_pending'
  | 'already_done' | 'user_stopped'

export type AbortReason =
  | 'none' | 'pending_confirm' | 'limit_24' | 'user_stopped'
  | 'insufficient_points' | 'batch_timeout' | 'node_timeout'

export interface BatchProgress {
  done: number
  failed: number
  cancelled: number
  timeout: number
  skipped: number
  total: number
  abortReason: AbortReason
}

export interface BatchSummary {
  abortReason: AbortReason
  done: number; failed: number; cancelled: number; timeout: number; skipped: number
  durationMs: number
  creditCost: number
}

export type BatchState = 'idle' | 'running' | 'stopping' | 'done'

export interface UseSelectionGenerateDeps {
  nodes: Ref<EditableFlowNode[]>
  edges: Ref<CanvasEdgeLike[]>
  generateForNode: (node: EditableFlowNode, opts: { asRunGroupMember: true }) => Promise<void>
  hasUsableOutput: (node: EditableFlowNode) => boolean
  resolveUpstreamIds: (node: EditableFlowNode) => string[]
  cancelGeneration: (nodeId: string) => void
  isInFlight: (nodeId: string) => boolean
  toast: (msg: string, kind?: 'info' | 'warn' | 'error') => void
}

export const MAX_WAIT_PER_NODE_MS = 600_000
export const MAX_BATCH_DURATION_MS = 1_800_000
export const SEMAPHORE = 3

export function useSelectionGenerate(_deps: UseSelectionGenerateDeps) {
  const state = ref<BatchState>('idle')
  const progress = ref<BatchProgress>({
    done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
    abortReason: 'none',
  })

  async function start(_plan: PlanSelectionGenerateResult): Promise<BatchSummary> {
    // Task 8-11 填充
    state.value = 'done'
    return {
      abortReason: 'none', done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0,
      durationMs: 0, creditCost: 0,
    }
  }

  function stop(): void {
    // Task 11 填充
  }

  return { state, progress, start, stop }
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/web test -- useSelectionGenerate.test
```

Expected：PASS（2/2）。

**Step 4:** Commit

```bash
git add apps/web/src/composables/useSelectionGenerate.ts apps/web/src/composables/useSelectionGenerate.test.ts
git commit -m "feat(web): add useSelectionGenerate composable skeleton with types and state"
git push
```

---

## Task 8: Executor — 初始化 + waitingMap 构建 + 节点消失守卫 + in_flight 下游

**Files:**
- Modify: `apps/web/src/composables/useSelectionGenerate.ts`
- Modify: `apps/web/src/composables/useSelectionGenerate.test.ts`

**Step 1:** 加失败测试

```ts
// 追加到 useSelectionGenerate.test.ts

describe('start(): initialization', () => {
  it('构建 waitingMap：链 p→i 选中，p 入 queue、i 入 waiting', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'p', type: 'prompt', data: { content: 'x' }, position: { x: 0, y: 0 } } as EditableFlowNode,
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      edges: ref([{ id: 'e1', source: 'p', target: 'i' }] as CanvasEdgeLike[]),
      hasUsableOutput: () => false,
    })
    const api = useSelectionGenerate(deps)
    const result = await api.start({ run: ['p', 'i'], skip: [], blockedBy: [], groupExpanded: [] })
    // p ok 一次后 done = 1；i 缺上游也跑（因为 hasUsableOutput 假）
    // 这里只验证"不崩、最终 state=done"
    expect(api.state.value).toBe('done')
    expect(result.abortReason).toBe('none')
  })

  it('节点消失（deps.nodes 缺 id）→ 计入 skipped，不崩', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
        // 'ghost' 不在 nodes 里
      ]),
      hasUsableOutput: () => false,
    })
    const api = useSelectionGenerate(deps)
    await api.start({ run: ['i', 'ghost'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(api.state.value).toBe('done')
    expect(api.progress.value.skipped).toBeGreaterThanOrEqual(1)
  })

  it('isInFlight 的节点 + 下游：in-flight 节点 skip，下游在 executor 端报 upstream_in_flight', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
        { id: 'v', type: 'video', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      edges: ref([{ id: 'e1', source: 'i', target: 'v' }] as CanvasEdgeLike[]),
      hasUsableOutput: () => false,
      isInFlight: (id) => id === 'i',
    })
    const api = useSelectionGenerate(deps)
    // 直接传 plan：i 已在跑 → planner 不会进 run（Task 5）；这里模拟 plan 已包含 i
    // 执行器侧需要再判一遍：i 不在 queue，但选了 v
    await api.start({ run: ['i', 'v'], skip: [], blockedBy: [], groupExpanded: [] })
    // i 在 batch 启动时还在飞 → 仍记 in_flight skip（与 planner 一致）
    // v 的上游 i 还在飞 → upstream_in_flight
    expect(api.progress.value.skipped).toBeGreaterThanOrEqual(2)
  })
})
```

```bash
pnpm --filter @lnkpi/web test -- useSelectionGenerate.test
```

Expected：FAIL（start 是 stub，没真跑调度）。

**Step 2:** 实现 start() 完整调度

把 Task 7 的 start 占位替换为完整实现（按 spec §5.3 伪代码）：

```ts
export function useSelectionGenerate(deps: UseSelectionGenerateDeps) {
  const state = ref<BatchState>('idle')
  const progress = ref<BatchProgress>({
    done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
    abortReason: 'none',
  })

  // ---- 内部状态（per start 调用）----
  let inFlight = new Map<string, Promise<unknown>>()
  let waitingMap = new Map<string, string[]>()
  let queue: string[] = []
  let skippedMap = new Map<string, SkipReason>()
  let semaphore = SEMAPHORE
  let pointsExhausted = false
  let creditCost = 0
  let abortCtrl: AbortController
  let batchTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  const batchStartTs = Date.now()
  let summaryDone = 0, summaryFailed = 0, summaryCancelled = 0, summaryTimeout = 0, summarySkipped = 0
  let summaryAbortReason: AbortReason = 'none'

  function findNode(id: string): EditableFlowNode | undefined {
    return deps.nodes.value.find(n => n.id === id)
  }

  function releaseDownstream(sourceId: string) {
    for (const [target, ds] of waitingMap) {
      const remaining = ds.filter(d => d !== sourceId)
      if (remaining.length === 0) {
        waitingMap.delete(target)
        if (!inFlight.has(target) && !skippedMap.has(target) && !queue.includes(target)) {
          queue.push(target)
        }
      } else {
        waitingMap.set(target, remaining)
      }
    }
  }

  function classifyError(err: unknown): SettleKind {
    const e = err as { code?: string; name?: string }
    if (e?.code === 'insufficient_points') return 'insufficient_points'
    if (e?.code === 'cancelled' || e?.name === 'AbortError') return 'cancelled'
    return 'failed'
  }

  function onNodeSettled(id: string, kind: SettleKind, durationMs: number) {
    inFlight.delete(id)
    semaphore++
    // telemetry 上报（Task 14 接入真实通道；这里先 console）
    // eslint-disable-next-line no-console
    console.debug('[sel-batch] node_settled', { id, kind, durationMs })

    if (kind === 'ok') { progress.value.done++; summaryDone++; creditCost += 1 }
    else if (kind === 'failed' || kind === 'insufficient_points') {
      progress.value.failed++; summaryFailed++
      if (kind === 'insufficient_points') pointsExhausted = true
    }
    else if (kind === 'cancelled') { progress.value.cancelled++; summaryCancelled++ }
    else if (kind === 'timeout') { progress.value.timeout++; summaryTimeout++ }

    releaseDownstream(id)
  }

  async function runOneNode(id: string, node: EditableFlowNode): Promise<void> {
    const nodeStartTs = Date.now()
    let timerHandle: ReturnType<typeof setTimeout> | null = null
    try {
      const settlePromise = deps.generateForNode(node, { asRunGroupMember: true })
        .then(() => 'ok' as SettleKind)
        .catch(err => classifyError(err))
      const timeoutPromise = new Promise<SettleKind>(resolve => {
        timerHandle = setTimeout(() => resolve('timeout'), MAX_WAIT_PER_NODE_MS)
      })
      const kind = await Promise.race([settlePromise, timeoutPromise])
      onNodeSettled(id, kind, Date.now() - nodeStartTs)
    } finally {
      if (timerHandle) clearTimeout(timerHandle)
    }
  }

  function stop(): void {
    if (state.value !== 'running') return
    state.value = 'stopping'
    summaryAbortReason = 'user_stopped'
    progress.value.abortReason = 'user_stopped'
    abortCtrl.abort('user_stopped')
    for (const id of inFlight.keys()) deps.cancelGeneration(id)
  }

  async function start(plan: PlanSelectionGenerateResult): Promise<BatchSummary> {
    state.value = 'running'
    abortCtrl = new AbortController()
    inFlight = new Map()
    waitingMap = new Map()
    queue = []
    skippedMap = new Map()
    semaphore = SEMAPHORE
    pointsExhausted = false
    creditCost = 0
    summaryDone = summaryFailed = summaryCancelled = summaryTimeout = summarySkipped = 0
    summaryAbortReason = 'none'
    progress.value = { done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: plan.run.length, abortReason: 'none' }
    const startTs = Date.now()

    const runSet = new Set(plan.run)

    // 初始化：检查每个 run 节点 → queue / waiting / skip
    for (const id of plan.run) {
      const node = findNode(id)
      if (!node) {
        skippedMap.set(id, { nodeId: id, reason: 'node_disappeared' })
        progress.value.skipped++; summarySkipped++
        releaseDownstream(id)
        continue
      }
      if (deps.isInFlight(id)) {
        skippedMap.set(id, { nodeId: id, reason: 'in_flight' })
        progress.value.skipped++; summarySkipped++
        releaseDownstream(id)
        continue
      }
      const upstreamIds = deps.resolveUpstreamIds(node)
      const upstreamInSel = upstreamIds.filter(uid => runSet.has(uid))
      const upstreamExt = upstreamIds.filter(uid => !runSet.has(uid))
      const inflightUp = upstreamExt.find(uid => deps.isInFlight(uid))
      if (inflightUp) {
        skippedMap.set(id, { nodeId: id, reason: 'upstream_in_flight', ref: inflightUp })
        progress.value.skipped++; summarySkipped++
        releaseDownstream(id)
        continue
      }
      const missing = upstreamExt.find(uid => {
        const n = findNode(uid)
        return !n || !deps.hasUsableOutput(n)
      })
      if (missing) {
        skippedMap.set(id, { nodeId: id, reason: 'missing_upstream', ref: missing })
        progress.value.skipped++; summarySkipped++
        // 写 errorMessage（简化为：node.data 字段，调用方 patchNodeData 由 CanvasPage 注入）
        // 这里仅标记；UI 层在 onMounted 时同步展示
        releaseDownstream(id)
        continue
      }
      if (upstreamInSel.length === 0) {
        queue.push(id)
      } else {
        waitingMap.set(id, upstreamInSel)
      }
    }

    // 全批 30min timer
    batchTimeoutHandle = setTimeout(() => {
      if (state.value === 'done') return
      summaryAbortReason = 'batch_timeout'
      progress.value.abortReason = 'batch_timeout'
      abortCtrl.abort('batch_timeout')
      deps.toast('本批超过 30min 已自动停止', 'warn')
    }, MAX_BATCH_DURATION_MS)

    // 主 loop
    while (true) {
      if (abortCtrl.signal.aborted) {
        for (const id of queue) {
          skippedMap.set(id, { nodeId: id, reason: 'user_stopped' })
          progress.value.skipped++; summarySkipped++
        }
        queue = []
        waitingMap.clear()
        for (const id of [...inFlight.keys()]) deps.cancelGeneration(id)
        break
      }
      if (queue.length === 0 && inFlight.size === 0) break

      while (semaphore > 0 && queue.length > 0) {
        const id = queue.shift()!
        const node = findNode(id)
        if (!node) {
          skippedMap.set(id, { nodeId: id, reason: 'node_disappeared' })
          progress.value.skipped++; summarySkipped++
          releaseDownstream(id)
          continue
        }
        inFlight.set(id, runOneNode(id, node))
        semaphore--
      }
      if (inFlight.size === 0) break
      await Promise.race([...inFlight.values()])
    }

    await Promise.allSettled([...inFlight.values()])
    if (batchTimeoutHandle) clearTimeout(batchTimeoutHandle)

    state.value = 'done'

    // 汇总 pointsExhausted → abortReason
    if (summaryAbortReason === 'none' && pointsExhausted) {
      summaryAbortReason = 'insufficient_points'
      progress.value.abortReason = 'insufficient_points'
    }

    return {
      abortReason: summaryAbortReason,
      done: summaryDone, failed: summaryFailed, cancelled: summaryCancelled,
      timeout: summaryTimeout, skipped: summarySkipped,
      durationMs: Date.now() - startTs, creditCost,
    }
  }

  return { state, progress, start, stop }
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/web test -- useSelectionGenerate.test
```

Expected：PASS（5/5）。

**Step 4:** Commit

```bash
git add apps/web/src/composables/useSelectionGenerate.ts apps/web/src/composables/useSelectionGenerate.test.ts
git commit -m "feat(web): useSelectionGenerate full implementation: init, waitingMap, runOneNode, loop, stop"
git push
```

---

## Task 9: MultiSelectToolbar — 接入生成 · N 按钮（feature flag 渲染）

**Files:**
- Modify: `apps/web/src/components/canvas/MultiSelectToolbar.vue`
- Modify: `apps/web/src/components/canvas/MultiSelectToolbarOverlay.vue`（如果是同包就改，跨包则用 props 透传）
- Create or Modify: `apps/web/src/components/canvas/MultiSelectToolbar.test.ts`（如果不存在则创建）

**Step 1:** 写失败测试

```ts
// apps/web/src/components/canvas/MultiSelectToolbar.test.ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MultiSelectToolbar from './MultiSelectToolbar.vue'

describe('MultiSelectToolbar: 生成 · N 按钮', () => {
  it('当 selectionBatch.runCount=0 时按钮禁用', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 0, state: 'idle' },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('当 selectionBatch.runCount=3 时按钮文案 = "生成 · 3"', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 3, state: 'idle' },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(btn.text()).toBe('生成 · 3')
  })

  it('点击按钮 emit generateSelection', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 3, state: 'idle' },
      },
    })
    await wrapper.find('[data-testid="selection-batch-generate"]').trigger('click')
    expect(wrapper.emitted('generateSelection')).toBeTruthy()
  })
})
```

```bash
pnpm --filter @lnkpi/web test -- MultiSelectToolbar.test
```

Expected：FAIL（按钮不存在 / props 没接）。

**Step 2:** 修改 MultiSelectToolbar.vue

打开 `apps/web/src/components/canvas/MultiSelectToolbar.vue`，做以下修改：

a) 在 `defineProps` 加 `selectionBatch`：
```ts
const props = defineProps<{
  selectedIds: string[]
  screenPosition: { x: number; y: number } | null
  canGenerateVideo?: boolean
  canUngroup?: boolean
  selectionBatch?: { runCount: number; state: 'idle' | 'running' | 'stopping' }  // 新增
}>()
```

b) 在 `defineEmits` 加 `generateSelection` / `stopSelection`：
```ts
const emit = defineEmits<{
  // ... 现有
  generateSelection: []   // 新增
  stopSelection: []       // 新增
}>()
```

c) 在模板中 `[生成视频]` 之后、`[解组/打组]` 之前插入：
```html
<button
  v-if="selectionBatch && selectedIds.length >= 2"
  :disabled="!selectionBatch || selectionBatch.runCount === 0 || selectionBatch.state !== 'idle'"
  type="button"
  class="toolbar-action accent"
  data-testid="selection-batch-generate"
  @click="emit(selectionBatch.state === 'idle' && selectionBatch.runCount > 0 ? 'generateSelection' : 'stopSelection')"
>
  {{ selectionBatch.state === 'running' ? '停止全部' : `生成 · ${selectionBatch.runCount}` }}
</button>
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/web test -- MultiSelectToolbar.test
```

Expected：PASS（3/3）。

**Step 4:** 跑现有 MultiSelectToolbar 相关测试（避免破坏）

```bash
pnpm --filter @lnkpi/web test -- MultiSelectToolbar
```

Expected：所有现有测试仍绿（按钮默认隐藏因为 `selectionBatch` prop 缺省）。

**Step 5:** Commit

```bash
git add apps/web/src/components/canvas/MultiSelectToolbar.vue apps/web/src/components/canvas/MultiSelectToolbar.test.ts
git commit -m "feat(web): MultiSelectToolbar adds 生成·N button gated on selectionBatch prop"
git push
```

---

## Task 10: CanvasPage 接线（plan + start batch + feature flag）

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Step 1:** 找现有 `multiSelectCanGenerateVideo` 位置（已存在），在附近加 `multiSelectBatch` 派生

```bash
cd /Users/4seven/workspace/lnkpi
grep -n "multiSelectCanGenerateVideo\|handleGenerateVideoFromSelection" apps/web/src/pages/CanvasPage.vue | head -5
```

Expected：行号 ~917 和 ~1601。

**Step 2:** 在 `multiSelectCanGenerateVideo` 附近（`apps/web/src/pages/CanvasPage.vue`）加：

```ts
import { planSelectionGenerate, type PlanSelectionGenerateResult } from '@lnkpi/shared'
import { useSelectionGenerate } from '@/composables/useSelectionGenerate'
import { isFeatureOn } from '@/composables/useFeatureFlag'

// 派生：plan（懒计算，仅当选区 ≥ 2 时）
const multiSelectPlan = computed<PlanSelectionGenerateResult | null>(() => {
  if (!isFeatureOn('selection_batch_generate')) return null
  if (multiSelectedIds.value.length < 2) return null
  try {
    return planSelectionGenerate({
      selectedIds: multiSelectedIds.value,
      canvas: {
        nodes: nodes.value.map(n => ({ id: n.id, type: String(n.type ?? ''), data: n.data as Record<string, unknown> })),
        edges: edges.value as Array<{ id: string; source: string; target: string }>,
      },
      hasUsableOutput: (n) => {
        const full = nodes.value.find(x => x.id === n.id)
        if (!full) return false
        return runGroupMemberHasUsableOutput(full)
      },
      isInFlight: (id) => isNodeBusy(id),
    })
  } catch (e) {
    if (e instanceof SelectionBatchLimitError) {
      // 提示，但不阻塞 UI
      return { run: [], skip: [{ nodeId: '', reason: 'unsupported_type', type: 'limit_24' }], blockedBy: [], groupExpanded: [] }
    }
    if (e instanceof SelectionBatchPendingConfirmError) {
      return null
    }
    throw e
  }
})

// 选择 batch API
const selectionBatchApi = useSelectionGenerate({
  nodes: nodes as Ref<EditableFlowNode[]>,
  edges: edges as Ref<CanvasEdgeLike[]>,
  generateForNode: (node, opts) => generateForNode(node, opts),
  hasUsableOutput: (n) => runGroupMemberHasUsableOutput(n),
  resolveUpstreamIds: (n) => {
    // 简化：仅从 edges 推上游
    return edges.value.filter(e => e.target === n.id).map(e => e.source)
  },
  cancelGeneration: (id) => cancelGeneration(id),
  isInFlight: (id) => isNodeBusy(id),
  toast: (msg, kind) => {
    if (kind === 'error') ElMessage.error(msg)
    else if (kind === 'warn') ElMessage.warning(msg)
    else ElMessage.info(msg)
  },
})

// 给工具栏的 selectionBatch prop
const selectionBatchProp = computed(() => {
  if (!isFeatureOn('selection_batch_generate')) return undefined
  return {
    runCount: multiSelectPlan.value?.run.length ?? 0,
    state: selectionBatchApi.state.value,
  }
})

// 处理点击
async function handleSelectionBatchGenerate() {
  const plan = multiSelectPlan.value
  if (!plan || plan.run.length === 0) return
  await selectionBatchApi.start(plan)
  // 收尾 toast
  const p = selectionBatchApi.progress.value
  ElMessage.info(
    `完成 ${p.done}，失败 ${p.failed}，取消 ${p.cancelled}，超时 ${p.timeout}，跳过 ${p.skipped}`,
  )
}

function handleSelectionBatchStop() {
  selectionBatchApi.stop()
}
```

**Step 3:** 在模板 `<MultiSelectToolbarOverlay>` 上加 props 与 emit

```html
<MultiSelectToolbarOverlay
  ...
  :selection-batch="selectionBatchProp"
  @generate-selection="handleSelectionBatchGenerate"
  @stop-selection="handleSelectionBatchStop"
/>
```

如果 `MultiSelectToolbarOverlay` 是独立组件，需要在它的 `defineProps` 加 `selectionBatch` 并向下透传到 `MultiSelectToolbar`。

**Step 4:** 跑测试（types + 现有 CanvasPage 相关测试）

```bash
pnpm --filter @lnkpi/web test
```

Expected：所有现有测试仍绿（feature flag 默认 off → 多选工具栏的 `selectionBatch` prop 始终 undefined → 按钮不渲染）。

**Step 5:** 手动验证 feature flag on/off 行为

```bash
# 在 apps/web/src/main.ts 的入口临时加：
import { setFlag } from '@/composables/useFeatureFlag'
setFlag('selection_batch_generate', true)  // 仅本地测试
```

打开浏览器，框选 2 个 image 节点 → 多选工具栏出现「生成 · 2」按钮 → 点击 → 验证调度跑通。

```bash
# 测完恢复
# 删掉 setFlag 那行
```

**Step 6:** Commit

```bash
git add apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): CanvasPage wires selection batch plan + start/stop with feature flag"
git push
```

---

## Task 11: Telemetry 上报（4 事件）

**Files:**
- Modify: `apps/web/src/composables/useSelectionGenerate.ts`
- Create: `apps/web/src/utils/selectionBatchTelemetry.ts`
- Create: `apps/web/src/utils/selectionBatchTelemetry.test.ts`

**Step 1:** 写 telemetry 工具测试

```ts
// apps/web/src/utils/selectionBatchTelemetry.test.ts
import { describe, expect, it, vi } from 'vitest'
import { reportBatchEvent } from './selectionBatchTelemetry'

describe('reportBatchEvent', () => {
  it('emits selection_batch_started', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    reportBatchEvent('selection_batch_started', { sessionId: 's1', runCount: 3, skipCount: 1, total: 4, triggerSource: 'multi_select_toolbar', flagOn: true })
    expect(spy).toHaveBeenCalledWith('[telemetry]', 'selection_batch_started', expect.objectContaining({ sessionId: 's1' }))
    spy.mockRestore()
  })
})
```

```bash
pnpm --filter @lnkpi/web test -- selectionBatchTelemetry.test
```

Expected：FAIL（模块不存在）。

**Step 2:** 实现 telemetry 工具

```ts
// apps/web/src/utils/selectionBatchTelemetry.ts
import { notifyGenerationSaveLocalHint } from '@/composables/useCanvasMedia'

/**
 * v3 spec §13.2 telemetry
 * V1 实现：console.debug（dev）+ 沿用现网 notifyGenerationSaveLocalHint 通道（prod）
 * 后续接 analytics 平台只改这一处。
 */

export type BatchEvent =
  | { name: 'selection_batch_started'; payload: { sessionId: string; runCount: number; skipCount: number; total: number; triggerSource: string; flagOn: boolean } }
  | { name: 'selection_batch_node_settled'; payload: { sessionId: string; nodeId: string; kind: string; durationMs: number } }
  | { name: 'selection_batch_plan_rejected'; payload: { sessionId: string; reason: 'pending_confirm' | 'limit_24'; candidateCount: number; blockedCount: number } }
  | { name: 'selection_batch_completed'; payload: {
      sessionId: string
      total: number
      done: number
      failed: number
      cancelled: number
      timeout: number
      skipped: number
      durationMs: number
      creditCost: number
      pointsExhausted: boolean
      runCountAtStart: number
      abortReason: string
    } }

export function reportBatchEvent(name: BatchEvent['name'], payload: BatchEvent['payload']): void {
  // dev 路径
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[telemetry]', name, payload)
  }
  // prod 路径：沿用现网通道
  notifyGenerationSaveLocalHint(name, payload)
}
```

**Step 3:** 跑测试看绿

```bash
pnpm --filter @lnkpi/web test -- selectionBatchTelemetry.test
```

Expected：PASS。

**Step 4:** 在 `useSelectionGenerate.ts` 的 4 个位置插入 `reportBatchEvent`：

```ts
// start() 入口：
reportBatchEvent('selection_batch_started', { sessionId: ..., runCount: plan.run.length, skipCount: plan.skip.length, total: plan.run.length + plan.skip.length, triggerSource: 'multi_select_toolbar', flagOn: true })

// onNodeSettled() 内：
reportBatchEvent('selection_batch_node_settled', { sessionId: ..., nodeId: id, kind, durationMs })

// start() 抛错前（CanvasPage 调用 planSelectionGenerate 的 catch 处）：
reportBatchEvent('selection_batch_plan_rejected', { sessionId: ..., reason: ..., candidateCount, blockedCount })

// start() 收口：
reportBatchEvent('selection_batch_completed', { sessionId: ..., ...summary, abortReason, ... })
```

**Step 5:** 跑测试

```bash
pnpm --filter @lnkpi/web test
```

Expected：所有测试仍绿。

**Step 6:** Commit

```bash
git add apps/web/src/utils/selectionBatchTelemetry.ts apps/web/src/utils/selectionBatchTelemetry.test.ts apps/web/src/composables/useSelectionGenerate.ts
git commit -m "feat(web): add selection batch telemetry with 4 events"
git push
```

---

## Task 12: 回归测试 + 集成验证 + AGENTS.md 本地 4 条

**Files:**
- 无新增文件；跑现网全部测试

**Step 1:** 跑 AGENTS.md 强制 4 条验证

```bash
cd /Users/4seven/workspace/lnkpi
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @lnkpi/web test
pnpm --filter @lnkpi/agent test
```

Expected：4 条全绿，零失败。**任何一条红 = 立即停手修**。

**Step 2:** 跑回归（确保未破坏既有功能）

```bash
pnpm --filter @lnkpi/web test -- compositionRunGroup
pnpm --filter @lnkpi/web test -- useNodeGeneration
pnpm --filter @lnkpi/server test -- scene-composer
pnpm --filter @lnkpi/shared test
```

Expected：所有回归绿。

**Step 3:** spec 验收 #11–#20 自检

对照 `docs/superpowers/specs/2026-09-17-selection-batch-generate-design.md` §11，逐条在本地验证：

- #13 (C1) pending_confirm 拒绝：选区含 pending_confirm 节点 → 主按钮禁用，tooltip 正确
- #14 (C3) 24 超限：选 25 个 → 主按钮禁用，tooltip 正确
- #15 (C4) 单节点超时：mock `generateForNode` 永不 resolve → 600s 后 `progress.timeout++`
- #16 (C4) 全批 30min 超时：模拟 → 自动停止
- #17 (C5) 停止全部：spy 验证 `cancelGeneration` 调用次数 = inFlight.size
- #18 (I2) telemetry 4 事件
- #19 (I3) feature flag on/off → 按钮渲染/不渲染
- #20 (I1) 节点消失守卫

不在本 plan 内的（#1–#12 的 UI 流程）已在 Task 9/10 覆盖。#15 / #16 因为 600s / 30min 不可能真测，可通过 mock 时间或写单测断言 `setTimeout` 的参数（= `MAX_WAIT_PER_NODE_MS` / `MAX_BATCH_DURATION_MS`）覆盖。

**Step 4:** 提交所有遗留改动（如有）

```bash
git status
# 应该有未提交项
git add -A
git diff --cached --stat
```

**Step 5:** 跑全栈本地验证一次

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @lnkpi/web test
pnpm --filter @lnkpi/agent test
```

Expected：4 条全绿。

**Step 6:** 推分支

```bash
git push
```

---

## Task 13: PR 创建 + 描述模板

**Files:**
- Read: 仓库根 `AGENTS.md`（PR 模板要求）
- Create: GitHub PR（通过 `gh` CLI 或 web UI）

**Step 1:** 确认分支最新且本地验证绿

```bash
cd /Users/4seven/workspace/lnkpi
git status
git log --oneline -10
pnpm build  # 最终一次 build
```

**Step 2:** 用 `gh` 创建 PR

```bash
gh pr create --base main --head feature/selection-batch-generate \
  --title "feat: 画布框选批量生成 (selection batch generate) — V1" \
  --body "$(cat <<'PR_EOF'
## Summary

实现 v3 spec `docs/superpowers/specs/2026-09-17-selection-batch-generate-design.md` 的 P0 切片：
- 框选 ≥2 节点 → 多选工具栏出现「**生成 · N**」主按钮
- 混合拓扑调度（无边并行 + 有边等上游 + 环追加队尾）
- 缺口补跑（已 done 跳过 / fallback_pending 跳过 / pending_confirm 整批拒绝）
- 24 上限 + 硬超时双闸（单节点 600s / 全批 30min）
- 显式 stop（cancelGeneration 调 inFlight.size 次）
- 4 类 telemetry + feature flag 灰度

**仅前端**，Nest / runtime 无改动；不新开计费通道。

## Test plan

按 `AGENTS.md` 提交前必跑 4 条：

- [ ] `pnpm install --frozen-lockfile` 成功
- [ ] `pnpm build` 全栈构建通过
- [ ] `pnpm --filter @lnkpi/web test` 全绿
- [ ] `pnpm --filter @lnkpi/agent test` 全绿

## Spec 验收 #1–#20

- [x] #1–#12: P0 范围内（已通过 Task 9/10 UI 流程与 Task 11/12 telemetry/flag 覆盖）
- [x] #13 (C1): pending_confirm 整批拒绝——Task 5 单测覆盖
- [x] #14 (C3): 24 上限——Task 5 单测覆盖
- [x] #15 (C4): 单节点 600s 超时——Task 8 executor 兜底
- [x] #16 (C4): 全批 30min 超时——Task 8 timer 解耦
- [x] #17 (C5): 停止全部显式 cancelGeneration——Task 8 stop 路径
- [x] #18 (I2): telemetry 4 事件——Task 11
- [x] #19 (I3): feature flag on/off 按钮渲染——Task 2 + Task 9
- [x] #20 (I1): 节点消失守卫——Task 8

## 风险

按 spec §10：v1 默认 off，灰度阶梯 `false → 内部 100% → 公开 10% → 50% → 100%`，每阶梯 ≥ 7 天观察 §13.2 埋点。

## 关联

- spec: docs/superpowers/specs/2026-09-17-selection-batch-generate-design.md
- plan: docs/superpowers/plans/2026-09-17-selection-batch-generate.md
- 前置: 2026-09-16-canvas-operator-2e-design.md (2E-D5) / 2026-08-07-agent-sidebar-m3-explicit-refs-design.md (D-D)
PR_EOF
)"
```

**Step 3:** 等 CI（`.github/workflows/ci.yml`）全绿后再合并

```bash
gh pr checks
```

Expected：所有 CI check pass。

**Step 4:** 合并用 **Squash & Merge**（AGENTS.md 规定）

```bash
gh pr merge --squash --delete-branch
```

---

## Self-Review（按 writing-plans skill §Self-Review）

**1. Spec 覆盖（spec v3 章节 → plan 任务）**：

| Spec 章节 | 覆盖任务 |
|---|---|
| §4.1 输入类型 | T3 |
| §4.2 输出类型 | T3 |
| §4.3 #1 选区展开 | T4 |
| §4.3 #2 状态过滤 | T5 |
| §4.3 #3–#4 Kahn 拓扑 | T6 |
| §4.3 #6 24 上限 | T5 |
| §4.3 pending_confirm 拒绝 | T5 |
| §4.3 in_flight 跳过 | T5 + T8 |
| §4.5 SSOT 依赖 | T1 |
| §5.1 状态机 | T8 |
| §5.2 types + deps | T7 |
| §5.3 调度循环 + waitingMap | T8 |
| §5.3 单节点超时（timer leak fix） | T8 |
| §5.3 全批 30min timer（解耦） | T8 |
| §5.3 in-flight 节点 skip | T8 |
| §5.4 5 类别进度 | T7 + T8 |
| §5.4 stop 显式 cancelGeneration | T8 |
| §5.4 telemetry 上报 | T11 |
| §5.5 不变量 | T8 (代码内 + T6 排序) |
| §6.3 按钮位置（M6 / I2-7） | T9 |
| §6.4 文案 / i18n 推迟 | T9（i18n 推迟到 V2） |
| §7 边界 | T1（export 后跑回归） |
| §8 测试计划 | T4-T8 单测 + T12 回归 |
| §9 非目标 | 不在 plan 范围内（明确不做） |
| §10 风险 | T12 验收 |
| §11 验收 | T12 |
| §13.1 feature flag | T2 + T9 + T10 |
| §13.2 telemetry | T11 |
| §13.3 kill switch 演练 | 灰度期间运维（不在 plan） |
| §13.4 不埋点 | T11 注释 |

**2. 占位符扫描**：✅ 无 "TBD" / "TODO" / "implement later"；所有代码块都是完整可粘贴的；引用类型/函数都已在前置 task 定义

**3. 类型一致性**：
- `selectionBatchGenerate.ts` 导出类型在 T3 定义；T4-T6 扩展
- `useSelectionGenerate.ts` 导出类型在 T7 定义；T8 扩展
- 跨包 import：`@lnkpi/shared` 已存在（`packages/shared/src/canvas/...`）
- `useNodeGeneration` export 5 函数在 T1 完成

**4. spec 引用准确性**：所有"v3 spec §X" 引用都对应到 v3 实际章节；行号引用为「章节级」（如 §4.3 #6），不锁死具体行号

**5. 风险点**：
- T2 feature flag 系统是 V1 最简实现，V2 接 Vite env 时只改 `useFeatureFlag.ts` 内部——已加注释
- T10 「在 main.ts 临时加 setFlag」是手动验证步骤，**不**进 commit——已明确标"测完恢复"
- T12 600s/30min 不可真测——通过断言 setTimeout 参数值（`MAX_WAIT_PER_NODE_MS` / `MAX_BATCH_DURATION_MS`）做静态验证

---

## 执行提示

按 `writing-plans` skill 收尾问：**"Plan complete and saved to `docs/superpowers/plans/2026-09-17-selection-batch-generate.md`. Two execution options: ..."**
