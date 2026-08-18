# 画布节点「新建副本」Design

**Date:** 2026-08-17  
**Status:** Approved for planning (user chose option C)  
**代号:** **CANVAS-DUPLICATE**

---

## Goal

用户在画布上通过右键（及后续快捷键）**新建节点副本**，支持单节点与多选子图复制；默认保留选区**内部连线**，单节点场景额外提供**含上游连线**选项。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 默认连线 | **内部连线（internal）**：两端都在选区内的 edge 一并复制 |
| 单节点扩展 | 右键子项 **「新建副本（含上游）」**：复制该节点 + 所有直接上游节点 + 对应 edge |
| 多选 | 仅 **「新建副本」**（internal）；不提供含上游/下游子项（避免边界歧义） |
| 文案 | 主项 **「新建副本」**；替换现有「复制节点」 |
| 任务 ID | 副本清除 `generationRecordId` / `materialId`；生成态重置 |
| 分组 | 选中 group 时自动纳入子节点；部分选中子节点时不复制 group 框 |
| 落位 | 选区 bbox 整体 offset `(+48, +48)` |
| 选中 | 副本创建后选中新节点并 `persistUserEdit` |

## Non-goals (P0)

- 含下游连线 / 双向扩展
- 跨 session 粘贴、剪贴板
- 副本自动触发再生成
- 远程 media 文件深拷贝（仍引用同一 URL）
- Agent `duplicate_nodes` action（P2）

---

## Problem baseline

| 现状 | 问题 |
|------|------|
| 右键「复制节点」 | 仅单节点、无 edge、浅拷贝含 `generationRecordId` |
| 多选 | 右键仍只复制右键目标 |
| 工作流 | 用户复制 `[Prompt→Image→Video]` 子图需手动重连连线 |

---

## UX

### 右键菜单（节点上）

**单选（`multiSelectedIds.length === 1` 或仅右键节点）：**

```
新建副本
新建副本（含上游）
─────────────
… 其他现有项 …
```

**多选（`multiSelectedIds.length > 1` 且含右键节点）：**

```
新建副本          ← internal edges only
─────────────
…
```

### 行为说明

| 场景 | 新建副本 | 新建副本（含上游） |
|------|----------|-------------------|
| 单 Image 节点 | 1 个 Image 副本，无 edge | Image + 所有 `source→Image` 的上游节点 + 这些 edge |
| Prompt→Image | 2 节点 + 1 edge（若全选） | 同左（上游已在内） |
| Ref→Image，仅选 Image | 1 Image | Ref + Image + Ref→Image |
| 多选 Prompt+Image+Video | 3 节点 + 内部 edges | **不显示**此菜单项 |
| 选中 Group | Group + 全部 child + 内部 edges | 单选 group 时同「新建副本」；含上游对 group 无意义，**隐藏** |

### 含上游定义（P0，已确认）

- 从种子节点 `S` 出发，取所有 `edge.target === S` 的 **直接** source 节点（仅一层，**不递归**）
- 复制集合 = `{S} ∪ upstreamDirect(S)`
- 复制 edge = 集合内 internal edges（含 upstream→S）
- ~~P1 递归上游链~~：**不在路线图中**（用户确认只要直接上游一层）

### 反馈

- Toast：`已创建 N 个节点副本`（N > 1 时）；单节点可省略或简短提示
- 视口：可选 `focusNodeById` 第一个副本根节点

---

## Architecture

### 核心纯函数

路径：`apps/web/src/utils/duplicateCanvasSubgraph.ts`

```ts
export type DuplicateEdgeMode = 'none' | 'internal' | 'upstream'

export interface DuplicateSubgraphOptions {
  offset?: { x: number; y: number }  // default { x: 48, y: 48 }
  edgeMode?: DuplicateEdgeMode         // default 'internal'
  preserveGroups?: boolean           // default true
}

export interface DuplicateSubgraphResult {
  nodes: FlowNode[]
  edges: FlowEdge[]
  idMap: Map<string, string>
  newRootIds: string[]
}

export function duplicateSubgraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  sourceIds: string[],
  options?: DuplicateSubgraphOptions,
): DuplicateSubgraphResult
```

### 选区解析 `resolveDuplicateSourceIds`

1. 输入 `contextNodeId` + `multiSelectedIds`
2. 若 `multiSelectedIds` 含 `contextNodeId` 且 length > 1 → 源 = 多选全集
3. 否则 → 源 = `[contextNodeId]`
4. **Group 闭包**：若源含 `type === 'group'` → union 其 `childIds` / `parentNode === groupId` 的子节点
5. **含 upstream 扩展**（仅 `edgeMode === 'upstream'` 且源为单节点）：
   - `sources = {node} ∪ { e.source | e.target === node }`

### 数据卫生 `sanitizeNodeDataForDuplicate`

| 字段 | 处理 |
|------|------|
| `generationRecordId`, `materialId` | `delete` |
| `status` | `generating`/`pending`/`fallback_pending` → `idle`；有 `url` 的媒体节点 → `completed` |
| `errorMessage`, `errorCode`, `generationStartedAt` | `delete` |
| `uploadProgress` | `delete` |
| `url`, `prompt`, `model`, `label`, `mediaInfo`, 模型参数 | **保留** |
| `childIds`（group） | 在 idMap 建立后 remap |
| `parentNode` | remap |
| `createdAt` | `Date.now()` |

实现：`structuredClone` + 字段表驱动，避免 mutate 原节点。

### Edge 复制

- 新 edge id：`e-dup-${newSource}-${newTarget}` 或 `e-${newSource}-${newTarget}`
- 保留 `animated` / `style`（若有）
- 过滤：`idMap.has(source) && idMap.has(target)`

### 集成点

| 文件 | 变更 |
|------|------|
| `duplicateCanvasSubgraph.ts` | 新建 + unit tests |
| `CanvasContextMenu.vue` | 文案 + 条件显示「含上游」 |
| `CanvasPage.vue` | `handleContextMenuAction('duplicate' \| 'duplicate-upstream')` 调用 util |
| `useCanvasActions.ts` | 复用 `FlowNode` / `FlowEdge` 类型 |

---

## Error handling

| 场景 | 行为 |
|------|------|
| 源节点不存在 | no-op |
| 含上游但无上游 | 等价单节点副本 |
| group 无子节点 | 仅复制空 group |
| 副本后 id 冲突 | 新 id 用 counter + timestamp 后缀 |

---

## Testing

### 单元（vitest）

- 单节点 → 1 新节点，0 edge，`generationRecordId` 清除
- A→B→C 全选 → 3 节点 2 internal edges
- 仅选 B + upstream 模式 → A,B + A→B
- group + 2 children → group 结构 + childIds remap
- 多选不提供 upstream 模式（menu 层测试或 omit）

### 人工 UAT

- [ ] 单 Image 右键「新建副本」→ 偏移副本，无连线，无 generationRecordId
- [ ] Ref→Image，仅选 Image，「含上游」→ Ref 副本 + 连线
- [ ] 框选 Prompt→Image→Video，「新建副本」→ 结构完整
- [ ] 副本后 Dock 再生成 → 新 record，不污染原节点

---

## Phasing

| 阶段 | 交付 |
|------|------|
| **P0** | util + 右键双项 + 多选 internal + 数据卫生 + 单测 |
| **P1** | `Cmd/Ctrl+D`；可选「含下游」子项 |
| **P2** | Agent action |

---

## Spec self-review

- [x] 无 TBD
- [x] 与现有 group/delete 语义一致
- [x] option C 已锁定：默认 internal + 单节点含上游
- [x] P0 范围可一个 plan 完成
