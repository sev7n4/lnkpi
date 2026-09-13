# Explore 接通 `import_workflow` + 工具入册 / 孤儿约束

> 日期：2026-09-13  
> 状态：已批准（对话确认方案 **2** + §1–§4）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 相关：[2026-09-12-agent-import-workflow-design.md](./2026-09-12-agent-import-workflow-design.md)  
> 上级：Hybrid A（explore LLM 白名单 vs graph 确定性路径）

## 1. 背景与问题

Nest + runtime 已交付 `import_workflow`（校验 / remap / 落点 / persist / 写库），生产上 **NestCanvasClient 可调通**。但 Agent **对话**路径调不到：

| 层 | `export_media_package` | `import_workflow` |
|----|------------------------|-------------------|
| 进 `explore_canvas` | 「导出」在 mutate 动词表；配「画布」等名词 → explore | 「导入」不在动词表 → 常落 `chat`（零工具） |
| 工具可绑 | 在 `EXPLORE_TOOL_NAMES` | `GRAPH_BATCH`，explore **刻意排除** |
| 结果 | LLM 可真正调工具 → `export_pack` | 闲聊否认「没法调用」 |

根因不是「模型不认识 import」，而是：

1. **产品不对称**：导出/导入同属工作流交换，架构上却一进 explore、一进 graph-only。  
2. **孤儿工具**：`import_workflow` 已注册 StructuredTool + Nest client，但 **无 LLM bind、也无确定性 graph 节点调用** → 能力悬空。  
3. **chat 死胡同**：路由失手进闲聊后零工具，体验像 Agent「不会」。

本规格按架构债治理：**接通 import 到 explore**，并补 **工具入册 + 孤儿不变量**，避免再出现同类悬空。

## 2. 目标与边界

### 2.1 目标

1. 对话能真正调用 `import_workflow`（进 explore、被 bind、SSE 出 `actions` / `focus_nodes`）。  
2. 每个 StructuredTool 必须有 `placement`；CI 禁止孤儿（有定义但对话与 graph 都调不到）。

### 2.2 非目标（本轮）

- 新建 `workflow_io` flow_mode / 大改 Hybrid A  
- chat 绑定全套画布工具  
- zip 导入、有 JSON 时强制跳过 LLM 的 mandatory dispatch  
- 修改 Nest `POST /agent/internal/import-workflow` 契约  
- 本轮不改造 chat 兜底文案（后续可另开）

## 3. 方案选择

对话确认 **方案 2**：

- 接线：路由词 + `import_workflow` 进 explore 白名单 + 导入类话术窄绑定。  
- 入册：registry 声明 `placement`；CI 测 I1–I4。

不选方案 1（只接线、防再犯弱）或方案 3（新 flow_mode，面过大）。

## 4. 对话接通 `import_workflow`

### 4.1 路由进 explore

在 `explore_route` / `explore_dispatch` 的 mutate / 相关词表中增加（与「导出」对称）：

- `导入`、`工作流`、`workflow`、`lnkpi.workflow`

含上述词且指向画布 / 工作流交换时，应触发 `explore_canvas_signal`，避免落到零工具 `chat`。

与原子出图路由的互斥保持现状；优先工作流关键词 + 现有 explore precedence。

### 4.2 白名单与 tier

- 将 `import_workflow` 加入 `EXPLORE_TOOL_NAMES`（`build_explore_tools` 包含之）。  
- 仍 **排除** 通用 `add_nodes_batch` 及 gen / destructive 批量工具进 explore。  
- Tier：新增或归入清晰的工作流 IO 语义（如 `WORKFLOW_IO`，或与 `EXPORT` 并列的显式 placement）；**禁止**把「任意 GRAPH_BATCH」整批放进 explore。

### 4.3 窄绑定

- 话术命中导入类关键词时，`select_narrow_write_tools` / `select_explore_tool_names` 本轮绑定须包含 `import_workflow`（可另加 `get_canvas_summary`），遵守 ≤5 工具规则。  
- 因工作流词进入的 `open_query`：绑定子集也须包含 `import_workflow`，否则 LLM 仍调不到。

### 4.4 执行与契约

- Nest 契约、`actions` / `focus_nodes`、媒体 persist-or-keep **不变**。  
- explore 仅负责 bind + 经现有 NestEventProxy 转发 `actions` / canvas commands。  
- 非法 JSON 仍由 Nest `validateWorkflow` 拒包。

## 5. 工具入册 + 孤儿约束

### 5.1 Placement SSOT

在 `tool_registry`（或紧邻模块）为每个 tool 声明：

```text
placement: explore | graph_node | ui_command
```

含义：

| placement | 归宿 |
|-----------|------|
| `explore` | 可出现在 `EXPLORE_TOOL_NAMES` / `build_explore_tools` |
| `graph_node` | 由 `graph/nodes/**`（或已登记封装）确定性调用，不依赖 explore LLM bind |
| `ui_command` | 前端 / canvas command 类（如 focus/undo），按现有约定 |

### 5.2 CI / 单测不变量

| # | 规则 |
|---|------|
| **I1** | `_all_tool_specs` 每个 name ∈ registry，且有 `placement` |
| **I2** | `placement=explore` ⇔ 在 `EXPLORE_TOOL_NAMES`（与 `build_explore_tools` 一致） |
| **I3** | `placement=graph_node` → `graph/nodes/**`（或登记表 `GRAPH_NODE_CALL_SITES`）中有对该 Nest/client 方法名的引用；否则失败 |
| **I4** | 禁止「有 StructuredTool、placement 缺失或两边都够不着」的孤儿 |

扫描假阳性/假阴性：允许显式 `GRAPH_NODE_CALL_SITES` 登记表作补充。

### 5.3 本轮迁移

| 工具 | placement |
|------|-----------|
| 现有 explore 工具（含 `export_media_package`） | `explore` |
| `add_nodes_batch` / gen / destructive 等 | `graph_node`（须已有或补登记调用点） |
| **`import_workflow`** | **`explore`**（接通后满足 I2） |

更新 `test_explore_tools`：explore **包含** `import_workflow`；仍排除 `add_nodes_batch` / gen。

## 6. 测试与验收

### 6.1 单测（agent-runtime）

1. 路由：含「导入工作流 / lnkpi.workflow / import_workflow」→ `explore_canvas_signal` 为 true。  
2. 绑定：导入类话术下 `select_explore_tool_names`（或窄绑定）包含 `import_workflow`。  
3. 白名单：`build_explore_tools` 含 `import_workflow`；不含 `add_nodes_batch` / gen。  
4. 不变量 I1–I4。  
5. 回归：nest_client `import_workflow` 契约、既有 explore 测试更新后仍绿。

### 6.2 手工 / 生产验收

1. 带用户 `defaultTextModel` 对话：请用 `import_workflow` 合并合法 minimal `lnkpi.workflow` JSON → SSE 出现 `canvas_action` / `focus_nodes`，画布可见新节点。  
2. 导出仍可用：`export_media_package` → `export_pack` + `full_package`。  
3. 无导入意图的闲聊不误绑大批量拓扑工具。

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 误调 import（空/乱 JSON） | Nest `validateWorkflow` 拒包；tool description 写清须合法 document |
| 大 JSON 撑爆对话 | 沿用 Nest/body 大小上限；优先 `workflow_url` |
| placement 扫描不准 | `GRAPH_NODE_CALL_SITES` 显式登记 |
| 「导入」误伤原子出图 | 工作流关键词 + 现有 explore precedence；互斥规则保持 |
| chat 仍是死胡同 | 本轮靠路由进 explore；chat 兜底另开 |

## 8. 实现切片（供 plan）

1. Registry：`placement` + 迁移表；`import_workflow` → explore。  
2. 路由词表 + 窄绑定。  
3. 更新 / 新增 explore 与 orphan 不变量测试。  
4. 文档：本规格 + 上级 agent-import 规格交叉引用「对话路径已接通 explore」。  
5. 生产：带 `defaultTextModel` 的对话复测导入 + 导出回归。

---

**状态（2026-09-13）：** T1–T3 已实现（registry / route / narrow-bind）；T4 文档交叉引用 + pytest 门禁；生产对话复测见 task-4-report。
