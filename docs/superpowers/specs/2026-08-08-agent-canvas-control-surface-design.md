# Agent 画布控制面 — Hybrid 设计规格

> 状态：**Accepted**（2026-08-08，v1.2 增补 LangGraph Command 边界）  
> 方案：**A — Hybrid**（延续 ADR-003 / P5）  
> 目标：Agent 可驱动画布 **Tool 级原语 + 原子能力 + 编排**，不将高成本生成 ReAct 化

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.2 |
| 关联 | ADR-003、P5 atomic-orchestration-boundary、2026-08-07 platform-route-skill-boundary |

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **CS-1** | Harness SSOT：`NestCanvasClient` + `/agent/internal/*`；StructuredTool 为可选 LLM 绑定层 |
| **CS-2** | **atomic / campaign / single_node** 保持 LangGraph 确定性子图，不 bind 生成类 tools |
| **CS-3** | 新增 **`explore_canvas` 流**：`bind_tools` 仅 **读 + 轻写 + 生成生命周期** |
| **CS-4** | **禁止** explore 调用 `run_*_generation`、destructive `remove_*`、批量拓扑 |
| **CS-5** | TS `CANVAS_TOOLS` 标记 deprecated；runtime 降级改调 Nest API（P4） |
| **CS-6** | Tool 分层见 §0.4 |
| **CS-7** | **三通道模型**：Harness Tool（改画布数据） / Client Command（改视口与本地 UI） / Graph-only（批量、destructive、gen） |
| **CS-8** | 用户本地 **Undo 栈** 不纳入 Harness；Agent 通过 **`canvas_command` SSE** 或文案说明，不伪造服务端 undo |
| **CS-9** | **LangGraph `Command`** 仅用于 **图内控制流**（动态路由 / Send fan-out）；画布副作用、UI 操作 **不得** 用 Command 承载 |

### 0.2 三种「Command」命名空间（勿混用）

| 名称 | 载体 | 作用域 | 典型 |
|------|------|--------|------|
| **LangGraph `Command`** | Python `langgraph.types.Command` | **Graph 运行时**内部 | `Command(goto=[Send("gen_node", ...)])` |
| **Harness Tool** | Nest `/agent/internal/*` + StructuredTool | **画布/资产/任务数据** | `get_node`, `remove_nodes` |
| **`canvas_command` SSE** | NDJSON `type: canvas_command` | **浏览器 UI** | `focus_node`, `undo` |

---

## 0.3 LangGraph `Command` — 纳入 / 不纳入

> 参考：`hitl_resume.py`（HITL 恢复）、`gen_scheduler.py`（Send fan-out）

LangGraph 有两种 interrupt；本项目 **HITL 用 `interrupt_before`**，恢复走 `aupdate_state` + `ainvoke(None)`，**不是** `Command(resume=...)`。

| LangGraph `Command` 用法 | 是否采用 | 说明 |
|--------------------------|----------|------|
| `Command(goto=[Send(...)])` | ✅ **已用** | `gen_scheduler` 并行 fan-out → `gen_node` |
| `Command(update=..., goto=...)` | ✅ **已用** | scheduler 合并 cascade 状态后路由 |
| `Command(goto=["collect_gen"])` | ✅ **已用** | 生成调度结束 |
| `Command(resume=...)` | ❌ **不用**（HITL） | 仅适用于节点内 `interrupt()`；本项目 gate 用 `interrupt_before` |
| `Command` 驱动 Nest 画布 API | ❌ **禁止** | 副作用走 Tool，保持可测试 / 可追踪 |
| `Command` 驱动前端定位/撤销 | ❌ **禁止** | 走 `canvas_command` SSE |

**应纳入 LangGraph `Command` 的（仅图内控制流）：**

| 场景 | 节点/边 | Wave |
|------|---------|------|
| Campaign 生成并行调度 | `gen_scheduler` → `Send("gen_node")` | 已有 |
| 调度完成收口 | `gen_scheduler` → `collect_gen` | 已有 |
| 未来：多 explore 轮次子图（若从单节点升级为子图） | 可选 `Command(goto="explore_tool_loop")` | 待定 |
| 未来：动态选子图（atomic vs campaign 运行时分支） | 条件边优先；仅 fan-out 用 Command | 非优先 |

**不得纳入 LangGraph `Command` 的（改走 Tool 或 SSE）：**

| 用户/产品能力 | 正确通道 |
|---------------|----------|
| 读任务/节点/资产/布局 | Harness **Tool** |
| 改 prompt、复制、上传、存资产库 | Harness **Tool** |
| 分组、整理布局、批量加节点 | Harness **Tool**（graph_batch；graph 节点内调用） |
| 删除节点 | Harness **Tool**（destructive） |
| 取消生成 / 平台回退 | Harness **Tool**（lifecycle） |
| 定位节点、撤销、打开精修面板 | **`canvas_command` SSE** |
| HITL「确认出图 / 确认拓扑」 | **`interrupt_before` + state 注入**（非 Command） |

**HITL 恢复（易与 Command 混淆）：**

```
用户点「确认」→ Nest 带 user_decision → runs.py
  → prepare_interrupt_resume()  # aupdate_state(messages, user_decision)
  → graph.astream(None)         # 继续 interrupt_before 之后的路径
```

前端注释里的 `Command(resume=...)` 为历史/泛化表述；**生产路径以 `hitl_resume.py` 为准**。

---

### 0.4 Tool 分层

| Tier | 含义 | explore bind | 典型 |
|------|------|--------------|------|
| `read` | 只读查询 | ✅ | summary、layout、任务列表 |
| `write_light` | 单节点/小范围写 | ✅ | set_prompt、duplicate、存资产库 |
| `lifecycle` | 生成任务状态机 | ✅ | cancel、fallback confirm |
| `graph_batch` | 批量拓扑/布局 | ❌ | group、grid layout、add_nodes_batch |
| `gen` | 计费生成 | ❌ | run_*_generation |
| `destructive` | 不可逆删除 | ❌ | remove_nodes |
| `export` | 导出/下载 | ✅（返回 URL） | export_media_package |
| `ui_command` | 前端执行 | N/A（SSE） | focus_node、undo |

---

## 1. 能力矩阵

### 1.1 Tool 层 — explore 可 bind（P0 已落地 + 规划）

| Tool | Tier | Wave | 说明 |
|------|------|------|------|
| `get_canvas_summary` | read | **P0** | 节点 id/type/title/status |
| `get_node` | read | **P0** | 单节点快照 |
| `get_generation_status` | read | **P0** | **单节点**当前生成态（≠ 任务列表） |
| `get_generation_diagnostic` | read | **P0** | 失败/回退诊断 |
| `set_node_prompt` / `set_node_content` | write_light | **P0** | 轻量编辑 |
| `attach_refs` | write_light | **P0** | 参考边 |
| `upsert_prompt_node` | write_light | **P0** | 创建/更新 prompt 节点 |
| `cancel_generation` | lifecycle | **P0** | |
| `confirm_platform_fallback` | lifecycle | **P0** | |
| `cancel_platform_fallback` | lifecycle | **P0** | |
| `list_generation_tasks` | read | P1 | 对应 UI【任务】=`listGenerations(sessionId)` |
| `list_user_assets` / `list_public_assets` | read | P1 | 对应 UI【资产】 |
| `save_node_to_asset_library` | write_light | P1 | 节点「存入资产库」 |
| `apply_asset_to_node` | write_light | P1 | 资产拖入/应用到节点 |
| `apply_sidebar_attachments` | write_light | P1 | 侧栏附件写画布 |
| `introduce_nodes_to_agent` | write_light | P1 | 节点内容引入 Agent 上下文（见 §1.5） |
| `get_canvas_layout` | read | P2 | 含 position/size，小地图语义 |
| `get_node`（扩展） | read | P2 | 返回 `position`、`parentNode` |
| `duplicate_node` | write_light | P2 | 复制节点 |
| `optimize_prompt` | read | P2 | 提示词优化 proxy |
| `upload_media_to_canvas` | write_light | P2 | 上传并创建/更新媒体节点 |
| `export_media_package` | export | P2 | 打包下载（返回 stream-download URL） |
| `group_nodes` / `ungroup_node` | graph_batch | P2 | 分组/解组（explore 不 bind，见 §1.2） |
| `arrange_nodes_grid` | graph_batch | P3 | 整理布局（grid） |
| `run_icon_refine` 等 | gen | P3+ | 图标精修/抠图/inpaint（Graph-only） |
| `get_image_edit_capabilities` | read | P3 | 精修能力探测 |

### 1.2 仅 Graph / campaign（非 explore bind）

| 能力 | Tier | 流 | Wave |
|------|------|-----|------|
| `run_*_generation` 五模态 | gen | atomic / single / campaign | P0 |
| `add_nodes_batch` + atomic parse | graph_batch | atomic_create | P0 |
| `connect_nodes` / topo / stage | graph_batch | campaign | P0 |
| `remove_nodes` / `remove_edges` | destructive | campaign（HITL） | P0 |
| `group_nodes` / `ungroup_node` | graph_batch | campaign 或专用 layout 子图 | P2 |
| `arrange_nodes_grid` | graph_batch | campaign layout 步 | P3 |
| mixed 模态 confirm | — | atomic_create | P1 |
| Scene Composer / video composition | gen | campaign P3 | P3 |

### 1.3 Client Command（SSE `canvas_command`，非 Harness POST）

| Command | 对应 UI | Wave | 说明 |
|---------|---------|------|------|
| `focus_node` | 【任务】定位、输出卡定位 | P1 | `selectOnlyNode` + `fitView` |
| `focus_nodes` | 多选定位 | P1 | |
| `undo` / `redo` | 撤销/重做 | P4 | 转发到 `useCanvasUndoStack`；仅本地会话栈 |
| `set_minimap_state` | 小地图展开 | — | **非目标**（纯 UI 偏好） |
| `open_image_editor` | 精修面板 | P3 | 精修入口，实际改动画布走 Harness |

### 1.4 原子能力完善（Graph）

| 项 | Wave |
|----|------|
| P6 video 参数 atomic 贯通 | P1 |
| platform Seedance catalog | P1 |
| mixed 模态 confirm | P1 |
| material/studio lifecycle 归一 | P1 |

### 1.5 UI 功能 ↔ 能力对照表

| 画布 UI | 现有实现（前端/服务端） | Agent 能力 | Tier | Wave |
|---------|-------------------------|------------|------|------|
| 【任务】列表/排队/进行中 | `studioApi.listGenerations(sessionId)` | `list_generation_tasks` | read | P1 |
| 【任务】单节点状态 | 节点 `data.status` | `get_generation_status(nodeId)` | read | **P0** |
| 【任务】失败诊断 | `getGenerationDiagnostic` | `get_generation_diagnostic` | read | **P0** |
| 【任务】定位 | `handleHistoryLocate` → `focusNodeById` | `focus_node` **Command** + read layout | ui_command | P1 |
| 【资产】我的/公共列表 | `assetsApi.listMine/listPublic` | `list_user_assets` / `list_public_assets` | read | P1 |
| 【资产】应用到节点 | `handleAssetApply` | `apply_asset_to_node` | write_light | P1 |
| 【资产】存入资产库 | `saveAssetToLibrary` | `save_node_to_asset_library` | write_light | P1 |
| 【小地图】节点分布 | `minimapNodeList`（nodes+position） | `get_canvas_layout` | read | P2 |
| 【小地图】点击跳转 | `fitView` | `focus_node` Command | ui_command | P1 |
| 多选 **分组** | `createGroupFromNodes` | `group_nodes` | graph_batch | P2 |
| **解组** | `ungroupNodes` | `ungroup_node` | graph_batch | P2 |
| **整理布局** | `layoutNodesInGrid` | `arrange_nodes_grid` | graph_batch | P3 |
| **上传** | `uploadApi` + 创建节点 | `upload_media_to_canvas` | write_light | P2 |
| **下载** / 打包 | `downloadMediaFile/Package` | `export_media_package` | export | P2 |
| **复制节点** | 右键 duplicate | `duplicate_node` | write_light | P2 |
| **删除节点** | `handleDeleteSelection` | `remove_nodes`（已有 internal） | destructive | P0 graph |
| **撤销** | `useCanvasUndoStack` 本地栈 | `undo` Command 或说明不可远程 undo | ui_command | P4 |
| **节点引入 Agent** | `addFromCanvasNodes` → 侧栏附件 | `introduce_nodes_to_agent` | write_light | P1 |
| 图标/图像 **精修** | `openImageEditor` + apply | `open_image_editor` Command + `run_icon_refine` Graph | gen | P3+ |

#### 1.5.1 【任务】与 `get_generation_status` 的关系

- **`get_generation_status`**：回答「**这个节点现在**什么状态」（generating / completed / url）。
- **`list_generation_tasks`**：回答「**本会话有哪些生成记录**」（历史重试、排队、fallback_pending 全量）。
- 二者互补，不能互相替代。

#### 1.5.2 节点引入 Agent

用户选中节点 →「加入对话」本质是把节点媒体/文本变成 **Agent 侧栏附件**（`SidebarAttachment`，`sourceKind: canvasNode`）。

Harness 路径：

1. **P1** `introduce_nodes_to_agent(nodeIds)` → 内部组装 attachments + 写入 thread 下轮 `sidebar_attachments`（或调用已有 `apply_sidebar_attachments` 的只读变体）。
2. explore 读路径：`get_node` 已可让 Agent 引用内容；引入 Agent 是 **写 Agent 上下文**，不是改画布。

#### 1.5.3 撤销

- Undo 栈在浏览器内存 + `Session.canvasData` 持久化之间：**仅用户编辑**入栈（`persistUserEdit` / `canvasUndo.commitAfterChange`）。
- Agent 通过 Harness 改画布 **不自动**进入用户 Undo 栈（除非 P4 统一「Agent 编辑也 commit 一条 undo snapshot」）。
- **P4 可选**：Agent 编辑后 push 一条 undo 快照；`undo` Command 仍走客户端栈。

#### 1.5.4 删除 vs explore

- `remove_nodes` 已在 Harness（**P0**），归属 **destructive + campaign graph**（需 HITL/confirm）。
- explore **禁止** bind，避免 ReAct 误删。

---

## 2. 路由

```
intake → route_decide
  ├─ atomic_* / single_node → 现有子图
  ├─ skill → campaign
  ├─ explore_canvas → explore 节点 (bind_tools)
  └─ else → chat（纯对话，无 tools）
```

**explore 信号：** 画布/节点/任务/资产/布局 **查询或轻量编辑**，且 **非** atomic_create / single_node / 营销编排。

---

## 3. explore 节点行为

1. 拉取 `get_canvas_summary` 注入 system context  
2. `llm.bind_tools(build_explore_tools(client))`  
3. 有界 tool loop（≤3 轮）  
4. 返回 `AIMessage` + 可选 `explore_summary` SSE  
5. **P1+** 若需定位：SSE 附带 `canvas_command: { type: 'focus_node', nodeId }`

---

## 4. 基础设施

| 项 | Wave |
|----|------|
| `tool_registry.py` tier + explore allowlist | **P0** |
| `trace_tool` 覆盖 explore | P4 |
| `canvas_command` SSE schema（focus/undo/open_editor） | P1 / P4 |
| 错误归一化 `AgentToolError` → 用户文案 | P4 |
| Agent 编辑是否入 Undo 栈（产品决策） | P4 |

---

## 5. 非目标

- Full ReAct 驱动所有画布 mutation  
- 将 atomic_create 拆成 tool 链  
- Agent 远程操作用户 **小地图展开状态**、grid 颜色等 viewport 偏好  
- Skill 市场 UI（R3+）  
- 服务端全局 Undo（替代客户端 Cmd+Z）

---

## 6. 产品演进：精修 / 图标编辑

| 能力 | 建议归属 |
|------|----------|
| 打开精修面板 | Client Command |
| 参数级（crop、尺寸、风格 preset） | explore `write_light` 或 atomic 单步 |
| 单次 inpaint/outpaint/去背景 | **Graph gen** `run_icon_refine`（计费+confirm） |
| 多版迭代 + 排版 | campaign 子图闭环 |

判断：**改数据 → Tool；改视口/面板 → Command；高成本/confirm → Graph。**
