# 画布节点「新建副本」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现画布右键「新建副本」与「新建副本（含上游）」，支持多选子图 internal edge 复制，并清除副本上的 generation 任务绑定。

**Architecture:** 纯函数 `duplicateSubgraph` 解析选区、扩展上游（仅直接一层）、remap id、卫生化 data、复制 internal edges；`CanvasPage` 与 `CanvasContextMenu` 接入；Vitest 覆盖核心拓扑与 data 卫生。

**Tech Stack:** Vue 3 + Vue Flow、`useCanvasActions` FlowNode/FlowEdge 类型、Vitest

**Spec:** `docs/superpowers/specs/2026-08-17-canvas-node-duplicate-design.md`

## Global Constraints

- 默认 edge 模式：**internal**（edge 两端均在复制集合内）
- 含上游：**仅直接上游一层**，不递归
- 多选时菜单**不显示**「含上游」
- 副本 offset 默认 **`(+48, +48)`**
- 清除 **`generationRecordId`**、**`materialId`**；生成中状态重置
- 替换菜单文案「复制节点」→「新建副本」
- TDD：先写失败测试再实现；提交前缀 `feat:`

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/utils/duplicateCanvasSubgraph.ts` | 选区解析、拷贝、data 卫生、edge 过滤 |
| `apps/web/src/utils/duplicateCanvasSubgraph.test.ts` | 单测 |
| `apps/web/src/components/canvas/CanvasContextMenu.vue` | 菜单项 + 含上游条件 |
| `apps/web/src/pages/CanvasPage.vue` | 右键 action 接入、选区解析、选中副本 |

---

### Task 0: 分支基线

- [ ] **Step 1:** `git checkout main && git pull origin main`
- [ ] **Step 2:** `git checkout -b feature/canvas-node-duplicate`
- [ ] **Step 3:** `pnpm build` 确认基线绿

---

### Task 1: `duplicateCanvasSubgraph` 核心逻辑

**Files:**
- Create: `apps/web/src/utils/duplicateCanvasSubgraph.ts`
- Create: `apps/web/src/utils/duplicateCanvasSubgraph.test.ts`

**Interfaces:**
- Produces:
  - `export type DuplicateEdgeMode = 'none' | 'internal' | 'upstream'`
  - `export function resolveDuplicateSourceIds(nodes, edges, contextNodeId, multiSelectedIds, edgeMode): string[]`
  - `export function sanitizeNodeDataForDuplicate(type, data): Record<string, unknown>`
  - `export function duplicateSubgraph(nodes, edges, sourceIds, options?): DuplicateSubgraphResult`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  duplicateSubgraph,
  resolveDuplicateSourceIds,
  sanitizeNodeDataForDuplicate,
} from './duplicateCanvasSubgraph'
import type { FlowEdge, FlowNode } from '@/composables/useCanvasActions'

const n = (id: string, type = 'image', extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {},
  ...extra,
})
const e = (source: string, target: string): FlowEdge => ({ id: `e-${source}-${target}`, source, target })

describe('resolveDuplicateSourceIds upstream', () => {
  it('adds only direct upstream nodes for single seed', () => {
    const nodes = [n('ref'), n('img')]
    const edges = [e('ref', 'img')]
    const ids = resolveDuplicateSourceIds(nodes, edges, 'img', ['img'], 'upstream')
    expect(ids.sort()).toEqual(['img', 'ref'])
  })
})

describe('duplicateSubgraph', () => {
  it('clears generationRecordId on copy', () => {
    const nodes = [n('a', 'image', { data: { generationRecordId: 'g1', url: 'u', status: 'completed' } })]
    const { nodes: out } = duplicateSubgraph(nodes, [], ['a'])
    expect(out[0].data.generationRecordId).toBeUndefined()
    expect(out[0].data.url).toBe('u')
  })

  it('copies internal edges for A->B->C selection', () => {
    const nodes = [n('a', 'prompt'), n('b', 'image'), n('c', 'video')]
    const edges = [e('a', 'b'), e('b', 'c'), e('a', 'c')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['a', 'b', 'c'])
    expect(outNodes).toHaveLength(3)
    expect(outEdges).toHaveLength(3)
    for (const edge of outEdges) {
      expect(outNodes.some((x) => x.id === edge.source)).toBe(true)
      expect(outNodes.some((x) => x.id === edge.target)).toBe(true)
    }
  })

  it('upstream mode copies ref->img when only img selected', () => {
    const nodes = [n('ref', 'image'), n('img', 'image')]
    const edges = [e('ref', 'img')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(
      nodes,
      edges,
      ['img'],
      { edgeMode: 'upstream' },
    )
    expect(outNodes).toHaveLength(2)
    expect(outEdges).toHaveLength(1)
  })
})

describe('sanitizeNodeDataForDuplicate', () => {
  it('resets generating status to idle', () => {
    const data = sanitizeNodeDataForDuplicate('image', { status: 'generating', prompt: 'p' })
    expect(data.status).toBe('idle')
    expect(data.prompt).toBe('p')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/duplicateCanvasSubgraph.test.ts`

- [ ] **Step 3: Implement `duplicateCanvasSubgraph.ts`**

要点：
- `resolveDuplicateSourceIds`：多选含 context → 用 multiSelectedIds；group 闭包；upstream 仅 `edges.filter(t=>t.target===seed).map(s=>s.source)`
- 新 id：`${type}-dup-${counter}` 或 `${type}-${Date.now()}-${i}`
- position：bbox min + offset
- group `childIds` / `parentNode` remap
- `sanitizeNodeDataForDuplicate` 字段表

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/duplicateCanvasSubgraph.ts apps/web/src/utils/duplicateCanvasSubgraph.test.ts
git commit -m "feat(web): duplicate canvas subgraph utility with upstream one-hop"
```

---

### Task 2: 右键菜单

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasContextMenu.vue`

**Interfaces:**
- Consumes: props `multiSelectedCount?: number`（或 `showUpstreamDuplicate?: boolean`）
- Emits: `duplicate`, `duplicate-upstream`

- [ ] **Step 1:** 将「复制节点」改为「新建副本」，`emit('duplicate')`
- [ ] **Step 2:** 当 `multiSelectedCount <= 1` 且 `nodeType !== 'group'` 时显示「新建副本（含上游）」→ `emit('duplicate-upstream')`
- [ ] **Step 3:** `CanvasPage` 传入 `multiSelectedIds.length`
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): context menu duplicate and duplicate-upstream entries"
```

---

### Task 3: CanvasPage 接入

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**
- Consumes: `duplicateSubgraph`, `resolveDuplicateSourceIds`

- [ ] **Step 1:** 新增 `handleDuplicateSelection(edgeMode: 'internal' | 'upstream')`
  - 从 `menu.nodeId` + `multiSelectedIds` 解析 sourceIds
  - 调用 `duplicateSubgraph`，append nodes/edges
  - `selectNodes(newRootIds)` + `persistUserEdit()`
  - 可选 `ElMessage.success`
- [ ] **Step 2:** 替换现有 `action === 'duplicate'` 浅拷贝逻辑
- [ ] **Step 3:** 处理 `duplicate-upstream` action
- [ ] **Step 4:** 手动冒烟：单节点、含上游、多选子图
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): wire canvas duplicate subgraph to context menu"
```

---

### Task 4: CI + PR

- [ ] **Step 1:** `pnpm build`
- [ ] **Step 2:** `pnpm --filter @lnkpi/web exec vitest run src/utils/duplicateCanvasSubgraph.test.ts`
- [ ] **Step 3:** `gh pr create` → CI watch → merge

---

## Execution tracking

| ID | Task | Status |
|----|------|--------|
| T0 | 分支基线 | `[ ]` |
| T1 | duplicateSubgraph util + tests | `[ ]` |
| T2 | Context menu | `[ ]` |
| T3 | CanvasPage 接入 | `[ ]` |
| T4 | CI / PR | `[ ]` |

## Plan self-review

- [x] Spec 含上游仅一层已覆盖 Task 1 `resolveDuplicateSourceIds`
- [x] 多选无含上游 → Task 2 条件
- [x] generationRecordId 清除 → Task 1 test + sanitize
- [x] 无 TBD 步骤
