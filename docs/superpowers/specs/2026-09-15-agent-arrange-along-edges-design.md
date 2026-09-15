# Agent 顺着连线整理 — 设计

> 日期：2026-09-15（**2026-09-16 Hybrid 修订**）  
> 状态：**已审核 + Hybrid 修订待确认**  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 前端对照：`apps/web/src/composables/useCanvasGrouping.ts` 的 `layoutNodesAlongEdges`（人手多选「整理布局」已接）

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **L-D1** | 人手「整理布局」保持前端本地算，不改为打 HTTP |
| **L-D2** | **Hybrid（2026-09-16）**：`import_workflow` / `instantiate_workflow_template`（经同一 Nest `importWorkflow`）落盘成功后，**默认**对 `addedNodeIds` 做顺着连线；`connect_nodes` / `add_nodes_batch` **仍不**暗调。可选 `arrangeAlongEdges: false` 跳过 |
| **L-D3** | 保留专用 tool `arrange_nodes_along_edges`：人手式「整理」、`connect_nodes` 后整理、以及 import 跳过自动排后的补排 |
| **L-D4** | 实现镜像现有网格：服务端移植 `layoutNodesAlongEdges`，不抽 `@lnkpi/shared` |
| **L-D5** | 该 tool placement = `EXPLORE`（CORE）；**不进** `EXPLORE_WRITE_TOOLS`，从而不被 `select_narrow_write_tools` 裁掉，导入 / 规划 / 默认当轮都始终可调 |
| **L-D6** | `apply_layout_ops` 增加 op `arrange_along_edges`；placement 仍为 `GRAPH_NODE`，explore 不暴露 |
| **L-D7** | `arrange_nodes_grid` 保持 `GRAPH_NODE`，不进 explore |
| **L-D8** | Agent tool 的 `node_ids` 范围是 **prompt/tool 契约**，不是服务端校验：Nest 按传入 id 排，**不**拒绝「整布 id」。禁止整布只写在 prompt + description |
| **L-D9** | 算法：按选区内边左→右分层；同层竖排（按原 y）；各列相对最高列垂直居中。无内部边时按当前 x 排成一行、共用同一 Y |
| **L-D10** | Runtime 参数 `node_ids` → Nest DTO `nodeIds`。`TOOL_TIERS["arrange_nodes_along_edges"]=GRAPH_BATCH`（与 `connect_nodes` 同：explore placement + GRAPH_BATCH tier） |
| **L-D11** | **（新增）** import 默认顺连线只动 `addedNodeIds`（`type !== 'group'`）；边取**合并后** session 画布；返回的 `actions` / 持久化坐标均为排后位置；`addedNodeIds` 列表不变 |

---

## 1. 背景

人手多选已有「顺着连线 / 自动网格」。Nest 已有 `layoutNodesAlongEdges` + explore tool `arrange_nodes_along_edges`。初版（L-D2 旧）要求写拓扑后由模型再调 tool；实践上「成功后再调 X」是软义务，工作流落盘常漏排，用户看到堆叠/不可读拓扑。

产品修订：**工作流落盘的完成态 = 节点+边已写且新增块已顺连线**；局部连线仍不自动重排，以免误伤手工位置。

---

## 2. 架构

### 2.1 Agent 显式整理（保留）

```
explore LLM
  → arrange_nodes_along_edges(node_ids, gap?)
  → NestCanvasClient POST /agent/internal/arrange-nodes-along-edges
  → AgentCanvasToolsService.arrangeNodesAlongEdges
  → canvas-layout.util.layoutNodesAlongEdges(nodes, canvas.edges, nodeIds, gap)
  → persistLayoutNodes
```

### 2.2 写盘默认整理（Hybrid）

```
import_workflow | instantiate_recipe
  → AgentCanvasToolsService.importWorkflow
  → merge nodes/edges → layoutNodesAlongEdges(..., addedNodeIds)  // 除非 arrangeAlongEdges===false
  → 单次（或排后覆盖）persistCanvasData
  → 返回 actions 使用排后 position
```

`instantiateRecipe` 已委托 `importWorkflow`，**只改一处**即可覆盖模板落盘。

边来自**当前 session 画布**（合并后），不由 tool 参数传入。只对 `nodeIds` 命中且 `type !== 'group'` 的节点改坐标；未选中（含画布原有节点）不动。

`applyLayoutOps(nodes, ops, edges)` 增加第三参 `edges`（默认 `[]`，无边时 along-edges 退化为按 x 横排）。service 从 session canvas 传入。op 形状：

```ts
{ op: 'arrange_along_edges'; nodeIds: string[]; gap?: number }
```

未知 `op` 仍 throw（现有 exhaustive）。

---

## 3. `node_ids` 范围（硬规则）— Agent tool

Tool / prompt 必须写清。实现按传入 id 排，**不做**服务端「整布」推断，也**不**因 id 数量≈全画布而拒绝。

允许的 id 来源（只传这些，可并集）：

1. `import_workflow` / `instantiate_workflow_template` 返回的 `addedNodeIds`（**通常已排过**；仅在跳过自动排或用户要求再排时再传）
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

本档**不**修改 `select_narrow_write_tools` 的 ≤5 集合，也**不**把 `connect_nodes` 补进默认窄绑定（预存缺口，另开）。

### 4.2 Prompt（Hybrid 修订）

`_EXPLORE_SYSTEM`：

- `import_workflow` / `instantiate_workflow_template` **已在服务端对 addedNodeIds 默认顺连线**；成功后**不要**为同一批 id 再调 `arrange_nodes_along_edges`（除非用户明确要求再整理，或调用时传了跳过自动排）
- `connect_nodes` 成功后，仍须对当轮连线的 `source`/`target`（可并集）调用 `arrange_nodes_along_edges`
- `node_ids` 只用 §3 来源，禁止整张画布

`_PLANNER_SYSTEM`：

- 去掉「instantiate 成功后再调 arrange」的硬义务；改为「落盘已含顺连线；仅当用户要再整理时再调 tool」

工具 description 不变：顺着连线分层、同层竖排、整列垂直居中；不要用 `arrange_nodes_grid` 代替。

---

## 5. Nest 接口

### 5.1 显式整理（已有）

与 `arrange-nodes-grid` 平行：

- DTO：`sessionId`、`userId`、`nodeIds: string[]`、可选 `gap`（默认 40）
- `POST /agent/internal/arrange-nodes-along-edges`
- Service 返回 `{ actions: [] }`（与现有 grid 一致，不发 canvasCommands）
- Runtime `NestCanvasClient.arrange_nodes_along_edges` 打上述 path

### 5.2 import 默认整理（新增）

- `importWorkflow` 入参增加可选 `arrangeAlongEdges?: boolean`（**默认 `true`**；仅显式 `false` 跳过）
- 在 merge 后、返回前：若启用且 `addedNodeIds` 可排目标 ≥2，则  
  `layoutNodesAlongEdges(merged.nodes, merged.edges, addedNodeIds, gap=40)`，再 `persistCanvasData`
- `instantiate-recipe` 无需改 controller（已走 `importWorkflow`）；若 Runtime 要暴露跳过开关，可后续把 flag 传到 import（本修订 P0 可不暴露给 LLM，仅 Nest 默认 true）
- `gap` 固定 40，与 `arrangeNodesAlongEdges` 默认一致；P0 不新增 import 的 gap 参数

算法与测例对齐 web / 现有 server `layoutNodesAlongEdges` 单测。

---

## 6. 验收

| ID | 检查 | 期望 |
|----|------|------|
| **A1** | server `layoutNodesAlongEdges` 链 / 分叉 / 无边 | 与 web 单测同断言（已有） |
| **A2** | `applyLayoutOps([{ op: 'arrange_along_edges', nodeIds }])` | 坐标变化符合 A1；未知 op 仍失败（已有） |
| **A3–A6** | explore 绑定 / prompt 名 / nest_client | 保持；prompt 文案按 §4.2 更新 |
| **A7a** | `connectNodes` / `addNodesBatch` | **不**调用 along-edges（保持） |
| **A7b** | `importWorkflow` 默认 | **会**对 `addedNodeIds` 调用 `layoutNodesAlongEdges`；持久化坐标与返回 `actions` 一致；`arrangeAlongEdges: false` 时不调用 |
| **A7c** | `instantiateRecipe` | 经 import，默认同样排好（集成或源码级：controller 仍只调 import） |
| **A8** | 人手整理 | 前端下拉行为不回退 |
| **A9** | prompt | explore/planner **不再**要求 import/instantiate 后再强制 arrange；仍要求 `connect_nodes` 后 arrange |

---

## 7. 非目标

- 抽 shared、去重 `layoutNodesInGrid`
- `connect_nodes` / `add_nodes_batch` 服务端自动整理
- neo-tv 指定 NxM、行数滑杆、按时间/名称、自定义排序
- explore 暴露 `arrange_nodes_grid` / `apply_layout_ops` / group / move
- 修复默认窄绑定缺少 `connect_nodes` / `upsert_media_node`
- 为 along-edges 新增 canvasCommands 或改 session 同步协议
- Runtime harness「漏调补刀」钩子（Nest 默认排后不再需要；可选后续）

---

## 8. 回滚

- 关闭写盘默认：`importWorkflow` 将默认改为 `false` 或删掉内联 layout 调用  
- Agent tool + placement + prompt 可独立保留/移除；人手前端下拉不受影响  

---

## 9. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-15 | 初版：纯 Agent tool，写路径禁止暗排（旧 L-D2 / A7） |
| 2026-09-16 | Hybrid：import/instantiate 默认 Nest 顺连线；connect/batch 仍不暗排；prompt 去强制二次 arrange |
