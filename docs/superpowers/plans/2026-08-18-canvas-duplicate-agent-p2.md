# 画布「新建副本」P2 — Agent `duplicate_node` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 P0/P1 已验证的画布副本语义提升为 monorepo SSOT（`@lnkpi/shared`），并让 Agent `duplicate_node` 工具与 UI 右键/`Cmd+D` 行为一致（internal 边、含上游一层、数据清洗、多节点子图）。

**Architecture:** 核心逻辑从 `apps/web` 抽到 `packages/shared/src/canvas/duplicateSubgraph.ts`；Web 改为 re-export；Server `duplicateNode` 调用 shared 后 **整图 persist**（nodes + edges，含 `parentNode`），并返回 `CanvasAction[]` 供 SSE 流式预览；Agent-runtime 扩展 tool 参数与 description。

**Tech Stack:** `@lnkpi/shared` + Vitest、`apps/server` NestJS、`apps/web` Vue 3、`services/agent-runtime` Python LangChain tools

**Spec:** `docs/superpowers/specs/2026-08-17-canvas-node-duplicate-design.md`（P2 节）  
**Related:** `docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md` §1.1 `duplicate_node`

## Global Constraints

- 默认 edge 模式：**internal**（edge 两端均在复制集合内）
- 含上游：**仅直接上游一层**，不递归；参数名 `includeUpstream`
- 多节点：支持 `nodeIds: string[]`（≥2 时等价 UI 多选 internal，**不提供** upstream）
- 副本 offset 默认 **`(+48, +48)`**（与 UI 一致，替换 server 旧版 +40）
- 清除 **`generationRecordId`**、**`materialId`**；生成中状态重置（与 P0 sanitize 一致）
- Agent 写入 **不进入** 用户 Undo 栈（P4 再议）；`handleAgentTurnComplete` 仍 `loadSession()` 以 DB 为准
- ID 策略：shared 接受 **`createNodeId(type)` 注入**；server 用现有 `nextNodeId`，web 可保留 `*-dup-*` 前缀
- TDD：先写失败测试再实现；提交前缀 `feat:`

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/canvas/groupChildIds.ts` | group 子节点闭包（从 web 抽离） |
| `packages/shared/src/canvas/duplicateSubgraph.ts` | SSOT：选区解析、拷贝、sanitize、edge 过滤 |
| `packages/shared/src/canvas/duplicateSubgraph.test.ts` | 迁移 + 补充 server 场景测试 |
| `packages/shared/src/canvas/duplicateToCanvasActions.ts` | `DuplicateSubgraphResult` → `CanvasAction[]` |
| `packages/shared/src/index.ts` | export canvas 模块 |
| `apps/web/src/utils/duplicateCanvasSubgraph.ts` | 薄 re-export + web 类型 alias |
| `apps/web/src/utils/duplicateCanvasSubgraph.test.ts` | 保留 smoke import 或删并重定向 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | 重写 `duplicateNode` + persist 整图 |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | 扩展 `DuplicateNodeDto` |
| `apps/server/src/agent/agent-canvas-tools.service.test.ts` | 子图/上游/多选/边 测试 |
| `services/agent-runtime/app/tools/definitions.py` | 扩展 `DuplicateNodeInput` + description |

---

### Task 0: 分支基线

- [ ] **Step 1:** `git checkout main && git pull origin main`
- [ ] **Step 2:** `git checkout -b feature/canvas-duplicate-agent-p2`
- [ ] **Step 3:** `pnpm build && pnpm --filter @lnkpi/web test -- duplicateCanvasSubgraph` 确认 P0/P1 基线绿

---

### Task 1: Shared SSOT — `duplicateSubgraph`

**Files:**
- Create: `packages/shared/src/canvas/groupChildIds.ts`
- Create: `packages/shared/src/canvas/duplicateSubgraph.ts`
- Create: `packages/shared/src/canvas/duplicateSubgraph.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `export interface DuplicateCanvasNode { id; type?; position; data?; parentNode? }`
  - `export interface DuplicateCanvasEdge { id; source; target; animated?; style? }`
  - `export type DuplicateEdgeMode = 'none' | 'internal' | 'upstream'`
  - `export function getGroupChildIds(nodes, groupId): string[]`
  - `export function resolveDuplicateSourceIds(nodes, edges, contextNodeId, multiSelectedIds, edgeMode): string[]`
  - `export function sanitizeNodeDataForDuplicate(type, data): Record<string, unknown>`
  - `export function duplicateSubgraph(nodes, edges, sourceIds, options?): DuplicateSubgraphResult`
  - Options 新增：`createNodeId?: (type: string) => string`（默认 `${type}-dup-${Date.now()}-${n}`）

- [ ] **Step 1: 创建 `groupChildIds.ts`**

```ts
export interface GroupChildNode {
  id: string
  type?: string
  parentNode?: string
  data?: Record<string, unknown>
}

export function getGroupChildIds(nodes: GroupChildNode[], groupId: string): string[] {
  const fromData = nodes.find((n) => n.id === groupId)?.data?.childIds
  const linked = nodes.filter((n) => n.parentNode === groupId).map((n) => n.id)
  if (!linked.length) return Array.isArray(fromData) ? fromData.filter((x): x is string => typeof x === 'string') : []
  const merged = [...(Array.isArray(fromData) ? fromData : []), ...linked]
  return [...new Set(merged.filter((x): x is string => typeof x === 'string'))]
}
```

- [ ] **Step 2: 迁移 `duplicateSubgraph.ts`**

从 `apps/web/src/utils/duplicateCanvasSubgraph.ts` 复制逻辑，替换：
- `DuplicateFlowNode` → `DuplicateCanvasNode`
- `FlowEdge` → `DuplicateCanvasEdge`
- `getGroupChildIds` import 来自 `./groupChildIds`
- `nextDuplicateId` 改为 `options?.createNodeId ?? defaultCreateNodeId`

- [ ] **Step 3: 迁移测试到 shared**

将 `apps/web/src/utils/duplicateCanvasSubgraph.test.ts` 内容迁移到 `packages/shared/src/canvas/duplicateSubgraph.test.ts`，import 路径改为本地模块。

额外新增测试：

```ts
it('uses injected createNodeId', () => {
  const { nodes: out } = duplicateSubgraph(
    [n('a', 'image')],
    [],
    ['a'],
    { createNodeId: (type) => `${type}-agent-1` },
  )
  expect(out[0].id).toBe('image-agent-1')
})
```

- [ ] **Step 4: export**

在 `packages/shared/src/index.ts` 追加：

```ts
export * from './canvas/groupChildIds'
export * from './canvas/duplicateSubgraph'
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @lnkpi/shared test -- duplicateSubgraph`  
Expected: PASS（≥9 tests）

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/canvas packages/shared/src/index.ts
git commit -m "feat(shared): extract canvas duplicateSubgraph as SSOT"
```

---

### Task 2: Web 改 import（零行为变更）

**Files:**
- Modify: `apps/web/src/utils/duplicateCanvasSubgraph.ts`
- Modify: `apps/web/src/composables/useCanvasGrouping.ts`（可选：re-export shared `getGroupChildIds`）

**Interfaces:**
- Consumes: `@lnkpi/shared` duplicate APIs

- [ ] **Step 1: Web util 改为 re-export**

```ts
import type { FlowEdge, FlowNode } from '@/composables/useCanvasActions'
export {
  duplicateSubgraph,
  resolveDuplicateSourceIds,
  sanitizeNodeDataForDuplicate,
  type DuplicateEdgeMode,
  type DuplicateSubgraphOptions,
  type DuplicateSubgraphResult,
} from '@lnkpi/shared'
import { duplicateSubgraph as duplicateSubgraphCore } from '@lnkpi/shared'

export type DuplicateFlowNode = FlowNode & { parentNode?: string; selected?: boolean }

let webDupCounter = 0
export function duplicateSubgraphWeb(...args: Parameters<typeof duplicateSubgraphCore>) {
  const [nodes, edges, sourceIds, options] = args
  return duplicateSubgraphCore(nodes, edges, sourceIds, {
    ...options,
    createNodeId: (type) => `${type}-dup-${Date.now()}-${++webDupCounter}`,
  })
}
```

**更简单方案（推荐）：** 整个文件替换为 type alias + re-export，ID 策略改用 shared 默认（与现网行为微小差异可接受）或保留 wrapper 仅 override `createNodeId`。

- [ ] **Step 2: 更新 `useCanvasGrouping.getGroupChildIds`**

```ts
export { getGroupChildIds } from '@lnkpi/shared'
// 或保留本地实现并加注释「与 shared 同步」——优先 re-export
```

- [ ] **Step 3: Run web tests**

Run: `pnpm --filter @lnkpi/web test -- duplicateCanvasSubgraph && pnpm build`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(web): consume shared duplicateSubgraph"
```

---

### Task 3: Shared — `duplicateResultToCanvasActions`

**Files:**
- Create: `packages/shared/src/canvas/duplicateToCanvasActions.ts`
- Create: `packages/shared/src/canvas/duplicateToCanvasActions.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `DuplicateSubgraphResult`
- Produces: `export function duplicateResultToCanvasActions(result): CanvasAction[]`

- [ ] **Step 1: 实现转换**

```ts
import type { CanvasAction } from '../agentContract'
import type { DuplicateSubgraphResult } from './duplicateSubgraph'

export function duplicateResultToCanvasActions(result: DuplicateSubgraphResult): CanvasAction[] {
  const actions: CanvasAction[] = []
  for (const node of result.nodes) {
    actions.push({
      type: 'add_node',
      payload: {
        id: node.id,
        nodeType: node.type,
        position: node.position,
        data: node.data ?? {},
      },
    })
  }
  for (const edge of result.edges) {
    actions.push({
      type: 'add_edge',
      payload: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
      },
    })
  }
  return actions
}
```

- [ ] **Step 2: 测试 2 节点 1 边 → 3 actions**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(shared): map duplicate subgraph result to CanvasAction list"
```

---

### Task 4: Server — 重写 `duplicateNode`

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`

**Interfaces:**
- Consumes: `duplicateSubgraph`, `resolveDuplicateSourceIds`, `duplicateResultToCanvasActions` from `@lnkpi/shared`
- Produces:
  - `duplicateNode(input): Promise<{ nodeIds: string[]; actions: CanvasAction[]; canvasCommands: [...] }>`
  - Input 扩展：
    ```ts
    {
      sessionId: string
      userId: string
      nodeId?: string          // 单种子（与 nodeIds 二选一）
      nodeIds?: string[]       // 多选子图
      includeUpstream?: boolean // 默认 false；仅单种子时有效
      offset?: { x: number; y: number }
    }
    ```

- [ ] **Step 1: 扩展 DTO**

```ts
class DuplicateNodeDto {
  sessionId!: string
  userId!: string
  @IsOptional() @IsString() nodeId?: string
  @IsOptional() @IsArray() @IsString({ each: true }) nodeIds?: string[]
  @IsOptional() @IsBoolean() includeUpstream?: boolean
  @IsOptional() offset?: { x: number; y: number }
}
```

- [ ] **Step 2: 新增 private `persistCanvasData(sessionId, canvas: CanvasData)`**

仿 `persistLayoutNodes`，但 **同时写入 nodes + edges**：

```ts
private async persistCanvasData(sessionId: string, canvas: CanvasData): Promise<CanvasData> {
  // 同 persistLayoutNodes 的 transaction/staged 检查
  await tx.session.update({
    where: { id: sessionId },
    data: { canvasData: JSON.stringify(canvas) },
  })
}
```

- [ ] **Step 3: 重写 `duplicateNode`**

```ts
async duplicateNode(input: DuplicateNodeInput) {
  await this.loadOwnedSession(input.sessionId, input.userId)
  const { canvas } = await this.loadSession(input.sessionId)
  const seeds = input.nodeIds?.length
    ? input.nodeIds
    : input.nodeId
      ? [input.nodeId]
      : []
  if (!seeds.length) throw new BadRequestException('nodeId 或 nodeIds 必填')

  const contextId = seeds[0]
  const edgeMode = input.includeUpstream && seeds.length === 1 ? 'upstream' : 'internal'
  const sourceIds = resolveDuplicateSourceIds(
    canvas.nodes as DuplicateCanvasNode[],
    canvas.edges,
    contextId,
    seeds.length > 1 ? seeds : [contextId],
    edgeMode,
  )
  const result = duplicateSubgraph(
    canvas.nodes as DuplicateCanvasNode[],
    canvas.edges,
    sourceIds,
    {
      offset: input.offset ?? { x: 48, y: 48 },
      createNodeId: (type) => nextNodeId(type),
    },
  )
  if (!result.nodes.length) throw new BadRequestException('无可复制节点')

  const updated: CanvasData = {
    ...canvas,
    nodes: [...canvas.nodes, ...result.nodes as CanvasNode[]],
    edges: [...canvas.edges, ...result.edges],
  }
  await this.persistCanvasData(input.sessionId, updated)

  const actions = duplicateResultToCanvasActions(result)
  const focusId = result.newRootIds[0] ?? result.nodes[0].id
  return {
    nodeIds: result.nodes.map((n) => n.id),
    actions,
    canvasCommands: [{ type: 'focus_node', nodeId: focusId }],
  }
}
```

- [ ] **Step 4: 更新/新增 server 测试**

替换旧测试 `duplicateNode clones node and focuses copy`：

```ts
it('duplicateNode copies internal subgraph with edges', async () => {
  canvas = {
    nodes: [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: {} },
      { id: 'i1', type: 'image', position: { x: 300, y: 0 }, data: { url: 'u' } },
    ],
    edges: [{ id: 'e-p1-i1', source: 'p1', target: 'i1' }],
  }
  const result = await svc.duplicateNode({ sessionId: 's1', userId: 'u1', nodeIds: ['p1', 'i1'] })
  expect(result.nodeIds).toHaveLength(2)
  expect(canvas.nodes).toHaveLength(4)
  expect(canvas.edges).toHaveLength(2)
  expect(result.actions.some((a) => a.type === 'add_edge')).toBe(true)
})

it('duplicateNode includeUpstream adds direct upstream only', async () => {
  // ref -> img，仅 img + includeUpstream
})

it('duplicateNode clears generationRecordId', async () => {
  // 断言新节点 data 无 generationRecordId
})
```

- [ ] **Step 5: Run server tests**

Run: `pnpm --filter @lnkpi/server test -- agent-canvas-tools.service.test`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(server): align duplicateNode with shared subgraph semantics"
```

---

### Task 5: Agent-runtime tool 契约

**Files:**
- Modify: `services/agent-runtime/app/tools/definitions.py`
- Modify: `services/agent-runtime/app/tools/nest_client.py`（若 POST body 字段变化）
- Test: `services/agent-runtime/tests/test_explore_tools.py`（smoke）

**Interfaces:**
- Consumes: server `POST /agent/internal/duplicate-node` 新 body

- [ ] **Step 1: 扩展 `DuplicateNodeInput`**

```python
class DuplicateNodeInput(BaseModel):
    node_id: str | None = Field(default=None, description="Single seed node id")
    node_ids: list[str] | None = Field(default=None, description="Multi-select subgraph ids")
    include_upstream: bool = Field(
        default=False,
        description="When duplicating a single node, also copy direct upstream nodes and edges (one hop only)",
    )
```

- [ ] **Step 2: 更新 coroutine**

```python
async def duplicate_node(
    node_id: str | None = None,
    node_ids: list[str] | None = None,
    include_upstream: bool = False,
) -> dict:
    return await client.duplicate_node(
        node_id=node_id,
        node_ids=node_ids,
        include_upstream=include_upstream,
    )
```

- [ ] **Step 3: 更新 tool description**

```python
description=(
    "Duplicate canvas node(s) with internal edges preserved. "
    "Use node_ids for a selected subgraph; use node_id alone for a single node. "
    "Set include_upstream=true only for a single node when the upstream prompt/ref chain must be copied (one hop)."
),
```

- [ ] **Step 4: 更新 `nest_client.duplicate_node` POST body**

- [ ] **Step 5: Run agent-runtime tests**

Run: `cd services/agent-runtime && pytest tests/test_explore_tools.py -q`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(agent-runtime): extend duplicate_node tool for subgraph and upstream"
```

---

### Task 6: CI + PR + 部署复测

- [ ] **Step 1:** `pnpm build`
- [ ] **Step 2:** `pnpm --filter @lnkpi/shared test && pnpm --filter @lnkpi/web test -- duplicate && pnpm --filter @lnkpi/server test -- duplicateNode`
- [ ] **Step 3:** `gh pr create` → CI watch → squash merge
- [ ] **Step 4:** 生产 UAT（Agent + 手动对照）

**UAT 清单：**

| # | 操作 | 期望 |
|---|------|------|
| 1 | UI 右键新建副本 | 与 merge 前行为一致（回归） |
| 2 | Agent：`duplicate_node(node_id=img)` | 单节点副本，无 generationRecordId |
| 3 | Agent：`duplicate_node(node_id=img, include_upstream=true)` | Ref+Image+边 |
| 4 | Agent：`duplicate_node(node_ids=[p,i,v])` | 3 节点 + internal 边 |
| 5 | Turn 结束后 `loadSession` | parentNode/group 结构正确 |

---

## Execution tracking

| ID | Task | Status |
|----|------|--------|
| T0 | 分支基线 | `[ ]` |
| T1 | Shared duplicateSubgraph SSOT | `[ ]` |
| T2 | Web re-export | `[ ]` |
| T3 | duplicateResultToCanvasActions | `[ ]` |
| T4 | Server duplicateNode 重写 | `[ ]` |
| T5 | Agent-runtime tool | `[ ]` |
| T6 | CI / PR / UAT | `[ ]` |

## Plan self-review

- [x] Spec P2「Agent action」→ Task 4 + Task 5
- [x] 产品决策「shared 优先」→ Task 1 在 Task 4 之前
- [x] UI/Agent 语义一致（internal / upstream 一层 / offset 48 / sanitize）
- [x] 多选 upstream 不可用（server 仅在 `seeds.length === 1` 时 upstream）
- [x] Group parentNode：server 整图 persist，不依赖 `applyCanvasActions` 的 parentNode 支持
- [x] 无 TBD 步骤

## Out of scope（本 plan 不做）

- P1 可选「含下游」菜单 / tool 参数
- 新增 `duplicate_nodes` CanvasAction type（用 add_node + add_edge 批量即可）
- Agent 编辑进入 Undo 栈（P4）
- `applyActionsToFlow` 流式预览 parentNode（turn complete 后 loadSession 覆盖）
