# Agent 顺着连线整理 — 设计

> 日期：2026-09-15  
> 状态：**已审核**（实现前锁定）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 前端对照：`apps/web/src/composables/useCanvasGrouping.ts` 的 `layoutNodesAlongEdges`（人手多选「整理布局」已接）

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **L-D1** | 人手「整理布局」保持前端本地算，不改为打 HTTP |
| **L-D2** | 不自动整理：`connect_nodes` / `import_workflow` / `instantiate_workflow_template` / `add_nodes_batch` 成功后都不暗调布局 |
| **L-D3** | Agent 用专用 tool `arrange_nodes_along_edges` 决定何时调用（选项 C） |
| **L-D4** | 实现镜像现有网格：服务端移植 `layoutNodesAlongEdges`，不抽 `@lnkpi/shared` |
| **L-D5** | 该 tool placement = `EXPLORE`（CORE）；**不进** `EXPLORE_WRITE_TOOLS`，从而不被 `select_narrow_write_tools` 裁掉，导入 / 规划 / 默认当轮都始终可调 |
| **L-D6** | `apply_layout_ops` 增加 op `arrange_along_edges`；placement 仍为 `GRAPH_NODE`，explore 不暴露 |
| **L-D7** | `arrange_nodes_grid` 保持 `GRAPH_NODE`，不进 explore |
| **L-D8** | `node_ids` 范围是 **prompt/tool 契约**，不是服务端校验：Nest 按传入 id 排，**不**拒绝「整布 id」。禁止整布只写在 prompt + description |
| **L-D9** | 算法：按选区内边左→右分层；同层竖排（按原 y）；各列相对最高列垂直居中。无内部边时按当前 x 排成一行、共用同一 Y |
| **L-D10** | Runtime 参数 `node_ids` → Nest DTO `nodeIds`。`TOOL_TIERS["arrange_nodes_along_edges"]=GRAPH_BATCH`（与 `connect_nodes` 同：explore placement + GRAPH_BATCH tier） |

---

## 1. 背景

人手多选已有「顺着连线 / 自动网格」。Nest 仅有 `layoutNodesInGrid` + `arrange_nodes_grid`。`connectNodes`、`importWorkflow`、recipe instantiate 写完拓扑不整理。`arrange_nodes_grid` / `apply_layout_ops` 是 `GRAPH_NODE` 且无图节点调用，explore 调不到。

用户选择：不自动重排；补服务端顺着连线；explore 可调；`apply_layout_ops` 支持同 op；prompt 写明写完拓扑应整理。

---

## 2. 架构

```
explore LLM
  → arrange_nodes_along_edges(node_ids, gap?)
  → NestCanvasClient POST /agent/internal/arrange-nodes-along-edges
  → AgentCanvasToolsService.arrangeNodesAlongEdges
  → canvas-layout.util.layoutNodesAlongEdges(nodes, canvas.edges, nodeIds, gap)
  → persistLayoutNodes
```

边来自**当前 session 画布**，不由 tool 参数传入。只对 `nodeIds` 命中且 `type !== 'group'` 的节点改坐标；未选中节点不动。

`applyLayoutOps(nodes, ops, edges)` 增加第三参 `edges`（默认 `[]`，无边时 along-edges 退化为按 x 横排）。service 从 session canvas 传入。op 形状：

```ts
{ op: 'arrange_along_edges'; nodeIds: string[]; gap?: number }
```

未知 `op` 仍 throw（现有 exhaustive）。

---

## 3. `node_ids` 范围（硬规则）

Tool / prompt 必须写清。实现按传入 id 排，**不做**服务端「整布」推断，也**不**因 id 数量≈全画布而拒绝。

允许的 id 来源（只传这些，可并集）：

1. `import_workflow` / `instantiate_workflow_template` 返回的 `addedNodeIds`
2. 当轮 `connect_nodes` 参数里出现过的 `source` 与 `target`
3. 当轮 `upsert_media_node` / `add_nodes_batch`（若该当轮 explore 能调到）返回的新节点 id

禁止：

- 省略 `node_ids` 或传空数组当「全部节点」（空或可排目标少于 2 个 → **noop**，不抛，与网格不足 2 个行为一致）
- 把 `get_canvas_summary` 里所有 id 原样传入

找不到的 id 跳过。有 pending staged actions 时与 `arrangeNodesGrid` 相同：`ConflictException`。

---

## 4. Explore 绑定与 prompt

### 4.1 绑定

| 项 | 值 |
|---|---|
| `TOOL_PLACEMENTS["arrange_nodes_along_edges"]` | `EXPLORE` |
| `TOOL_EXPOSURES` | CORE（非 GRAPH_ONLY、非 DEFERRED） |
| `EXPLORE_WRITE_TOOLS` | **不加入** |
| `build_explore_tools` | **包含** |
| `build_graph_only_tools` | **不包含** 该专用 tool |
| `DEFERRED_GRAPH_NODE_TOOLS` | 不把该专用 tool 放进去（它不是 GRAPH_NODE） |
| `TOOL_TIERS` | `GRAPH_BATCH` |

`_bind_plan_tools`：因不在 `EXPLORE_WRITE_TOOLS`，走「非 write → 始终 visible」，与 `get_canvas_layout` 相同。

本档**不**修改 `select_narrow_write_tools` 的 ≤5 集合，也**不**把 `connect_nodes` 补进默认窄绑定（预存缺口，另开）。后果：部分默认话术当轮仍调不到 `connect_nodes`；只要当轮能连线或刚导入，`arrange_nodes_along_edges` 一定在列表里。

单独调用本 tool **不算** `EXPLORE_WRITE_TOOLS` 命中；`node_write` 且未调任何 write 时仍可能走「请提供节点 id」澄清。用户说「整理布局」不依赖这条 write 判定。

### 4.2 Prompt

`_EXPLORE_SYSTEM` 新增一条（紧接现有「多节点 + connect_nodes」）：

- 写完拓扑（`connect_nodes` / `import_workflow` / `instantiate_workflow_template` 成功）后，必须对当轮新节点调用 `arrange_nodes_along_edges`
- `node_ids` 只用 §3 来源，禁止整张画布

`_PLANNER_SYSTEM` 增加：`instantiate_workflow_template` 成功后对返回的 `addedNodeIds` 调用一次。

工具 description（中英任一，须含）：顺着连线分层、同层竖排、整列垂直居中；`node_ids` 为要排的节点；不要用 `arrange_nodes_grid` 代替（explore 也调不到网格）。

---

## 5. Nest 接口

与 `arrange-nodes-grid` 平行：

- DTO：`sessionId`、`userId`、`nodeIds: string[]`、可选 `gap`（默认 40）
- `POST /agent/internal/arrange-nodes-along-edges`
- Service 返回 `{ actions: [] }`（与现有 grid 一致，不发 canvasCommands）
- Runtime `NestCanvasClient.arrange_nodes_along_edges` 打上述 path

算法移植自 web：`layoutNodesAlongEdges` + rank 赋值；跳过 `group`；parent 内节点用绝对坐标换算相对坐标。服务端测例与 `useCanvasGrouping.layoutAlongEdges.test.ts` 对齐：不足 2 个原样返回；无边一对水平同 Y；`A→B→C` 同 Y 且间距 `width+gap`；一源两目标同 rank 竖向堆叠。

---

## 6. 验收

| ID | 检查 | 期望 |
|----|------|------|
| **A1** | server `layoutNodesAlongEdges` 链 / 分叉 / 无边 | 与 web 单测同断言 |
| **A2** | `applyLayoutOps([{ op: 'arrange_along_edges', nodeIds }])` | 坐标变化符合 A1；未知 op 仍失败 |
| **A3** | `build_explore_tools` | 含 `arrange_nodes_along_edges`；不含 `apply_layout_ops` / `arrange_nodes_grid` |
| **A4** | `_bind_plan_tools`：导入话术、规划话术、默认话术 | 三轮都绑定 `arrange_nodes_along_edges` |
| **A5** | `_EXPLORE_SYSTEM`（`chat._SYSTEM` 再导出）/ `_PLANNER_SYSTEM` | 含 tool 名 + 「当轮新节点 / addedNodeIds」+ 禁止整布 |
| **A6** | nest_client | POST `.../arrange-nodes-along-edges` 带 `nodeIds` |
| **A7** | `connectNodes` / `importWorkflow` / instantiate | **不**调用 along-edges（回归：无自动排） |
| **A8** | 人手整理 | 前端下拉行为不回退 |

---

## 7. 非目标

- 抽 shared、去重 `layoutNodesInGrid`
- 导入/连线后服务端自动整理
- neo-tv 指定 NxM、行数滑杆、按时间/名称、自定义排序
- explore 暴露 `arrange_nodes_grid` / `apply_layout_ops` / group / move
- 修复默认窄绑定缺少 `connect_nodes` / `upsert_media_node`
- 为 along-edges 新增 canvasCommands 或改 session 同步协议

---

## 8. 回滚

去掉 explore tool + placement + prompt 句即可停用 Agent 整理；人手前端下拉不受影响。Nest 端点可留作内部 no-op 调用方删除。
