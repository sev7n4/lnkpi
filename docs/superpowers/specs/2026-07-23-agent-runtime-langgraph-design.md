# Agent Runtime（LangGraph）技术选型与一期设计

> 状态：**设计待审阅**  
> 日期：2026-07-23  
> 范围：Agent Runtime 技术选型、控制面/数据面边界、一期 Graph/State/Tools/Skills；贯穿场景为**企业营销方案 → 画布资产拆解**  
> 前置：`2026-07-18-node-data-flow-refs-design.md`（RefChip/数据贯通）、现有 `@lnkpi/agent` SSE + `CanvasAction`、Nest `Session.canvasData`  
> 非范围：一期不实现自动级联出图/出视频；不引入 Temporal；不把画布全量镜像进 LangGraph State

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| Runtime 选型 | **方案一**：Python **LangGraph** + Nest 网关 + **自研 Markdown Skills** |
| 画布真相源 | **Nest `Session.canvasData` + 前端 Vue Flow**；LangGraph **不**持有全量画布镜像 |
| 控制流 vs 数据流 | LangGraph 边 = **阶段/逻辑**；画布边 + RefChip = **资产依赖** |
| 一期 HITL | **轻量澄清**（多轮口头确认）；预留 `interrupt()` + checkpointer 演进到生产级 durable |
| Skills | 一期即要：**目录化 `SKILL.md`，可热加载**；企业营销 brainstorm/拆解规则进 Skill，不写死 system prompt |
| 一期验收 | Skill 驱动规划 + 对话确认 + 向画布落 **prompt（方案）** 与下游骨架（text/image/video + 边 + refs/prompt） |
| 自动生成编排 | **二期**；一期在 `split` 后 `done`，用户可手动点 Dock 生成 |
| 现有 `@lnkpi/agent` | 保留为 Nest 侧兼容/工具适配层；新控制面迁到 Python Runtime，不一夜删除 |

**贯穿场景（企业营销）**：用户：「帮我设计一套卫生洁具的营销方案。」→ Agent 规划并征询确认 → 画布落方案节点 → 确认后拆解为下游文/图/视骨架并连线、注入提示词与上游芯片引用。

---

## 1. 目标与非目标

### 1.1 目标

1. 明确 Agent Runtime 技术栈，使「对话 Agent」能驱动无限画布，服务**企业营销内容生产**工作流。
2. 一期跑通闭环：**对话 ↔ Skills ↔ LangGraph ↔ Nest Canvas Tools ↔ 画布节点**。
3. 架构上预留：联网研究 Skill、审批门 HITL、按画布拓扑自动调用文生图/图生图/视频。

### 1.2 非目标（一期）

- 不在 LangGraph State 中同步完整 `nodes/edges` 作为真相源。
- 不实现生产级 durable workflow（跨天恢复、队列重试）；只留接口与演进路径。
- 不自动级联执行全部媒体生成（与既有「手动点生成」产品决策兼容；Agent 自动跑生成属二期显式能力）。
- 不引入 CrewAI/AutoGen 作为 Runtime 内核；不以 Temporal 作为一期依赖。
- 不要求一期上线联网搜索（可作为后续 Skill/Tool）。

---

## 2. 为什么是方案一（对照否决项）

### 2.1 方案一（采用）

```
Vue 画布 / Agent 对话
        ↕ SSE（已有 canvas_action / text_delta）
NestJS（鉴权、会话、canvas 落库、Studio 生成、Agent 网关）
        ↕ HTTP/SSE（或日后队列）
Python Agent Runtime（LangGraph）
        ├─ Skills Loader（SKILL.md）
        ├─ StateGraph（阶段控制）
        └─ Tools → 回调 Nest Canvas/Generation API
```

**选用理由（企业营销场景加固）：**

- 营销方案多轮评审、日后审批门 → LangGraph checkpoint / `interrupt()` 演进清晰。
- 资产量大（主图/详情/Banner/模特/视频）→ 全量进 Graph State 不可接受 → Nest 为画布真相源。
- 品类/品牌规范可沉淀 → Markdown Skills 热加载比硬编码节点函数更贴企业交付。
- 与现有 Vue 3 + NestJS monorepo 边界清晰：Python 只扩「控制面」服务。

### 2.2 明确不采用（本期）

| 备选 | 不采用原因 |
| --- | --- |
| 仅强化 `@lnkpi/agent`（纯 TS） | 一期快，但到 durable HITL 迁移税高；已接受可引入 Python |
| CrewAI / 纯多角色框架 | 偏角色协作，弱于画布原子工具与 Skill 文件模型 |
| LangGraph Platform / Temporal 一期上齐 | 过重；二期按需 |
| 「画布全量 = LangGraph State」 | 双写冲突、State 膨胀、与现有 SSE/落库重复 |

---

## 3. 核心边界：控制面 vs 数据面

### 3.1 铁律

1. **画布是资产与依赖的可视化文件系统**（nodes / edges / refs），真相源在 **Nest**。
2. **LangGraph 是操作员与流水线**，State 只保留对话、阶段、Skill、焦点节点 id、拆解工作单等**控制面**数据。
3. 读写画布一律经 **Tools → Nest**；Nest 负责持久化并向前端推送已有 **`CanvasAction`**。
4. 「芯片」复用现有 **RefChip / `resolveNodeRefs` / `refOrder`**，不在 Graph State 另造一套长文本 `prompt_library` 拷贝。

### 3.2 与既有规格的关系

| 既有能力 | Agent Runtime 如何用 |
| --- | --- |
| RefChip 数据贯通 | `split` 时建边 + `attach_refs`；生成时仍实时解析上游 |
| `prompt` 节点 | **方案正文载体**（短需求 + 长文 `content`）；对外可显示为 T1 |
| Dock 手动生成 | 一期结束后用户仍可点生成；二期 Agent 调同一套生成 API |
| `@lnkpi/agent` tools | Nest 侧适配；逐步对齐 `upsert_prompt_node` 等新工具契约 |

---

## 4. State 字段级设计（一期）

```python
class AgentRuntimeState(TypedDict):
    # 对话
    messages: list  # 对用户可见的规划摘要、澄清、确认话术

    # 控制
    phase: Literal[
        "intake",         # 理解意图、选择 Skill
        "plan",          # 生成企业营销方案
        "await_confirm", # 已输出待确认；等待下一轮用户消息
        "split",         # 拆节点 + 连线 + 注入 prompt/refs
        "done",          # 一期结束
        "error",
    ]
    skill_id: str | None
    thread_id: str          # 日后 checkpoint 键；可与 agent_run_id 对齐
    session_id: str         # Nest 会话；所有 canvas tool 必带

    # 工作记忆（轻量）
    plan_summary: str
    plan_node_id: str | None
    focus_node_ids: list[str]
    split_manifest: list[SplitManifestItem]
    last_error: str | None

    # 一期轻量人机
    awaiting_user: bool
    user_decision: Literal["none", "confirm", "revise"] | None
```

### 4.1 `SplitManifestItem`（工作单，非画布镜像）

| 字段 | 含义 |
| --- | --- |
| `key` | 稳定键，如 `white_bg` / `hero_main` / `scene` / `banner` |
| `title` | 节点标题 |
| `target_type` | `text` \| `image` \| `video` |
| `source_section` | 对应方案中的章节名 |
| `gen_mode` | `t2i` \| `i2i` \| `v_flf` \| `v_ref` 等（二期生成用） |
| `depends_on` | 其他 `key` 列表（指导建边与日后拓扑） |
| `prompt_hint` | 注入下游的提示词草稿 |
| `node_id` | Nest 创建成功后回填 |

**禁止**在 State 中长期存放：方案全文副本、Base64 媒体、完整 edges 列表。方案正文以 `plan_node_id` 指向画布节点为准；需要时 `get_node`。

### 4.2 二期 State 扩展（仅预留，本期不实现）

- checkpointer（Sqlite → Postgres）
- `interrupt()` 载荷替代 `await_confirm` 轮次猜测
- `gen_queue: list[str]`（待生成 `node_id` 拓扑序）

---

## 5. 一期 Graph 拓扑

```text
intake → plan → await_confirm ─┬─ revise → plan
                               └─ confirm → split → done
```

| Graph 节点 | 职责 | 主要副作用 |
| --- | --- | --- |
| `intake` | 识别企业营销意图；加载 Skill；必要时追问品类/渠道/投放位 | 更新 `skill_id` / `messages` |
| `plan` | 按 Skill 生成方案 Markdown；写摘要到对话 | `upsert_prompt_node` → 得到 `plan_node_id` |
| `await_confirm` | 征询确认/修改；`awaiting_user=True` | 无画布写（或仅更新状态文案） |
| `split` | `get_node(plan_node_id)`；生成 `split_manifest`；批量建下游 | `add_*` / `connect_nodes` / `set_node_prompt` / `attach_refs` |
| `done` | 一期收尾话术 | `phase=done` |

**一期不做**独立 `HumanGate` 空节点；确认靠下一轮用户消息解析为 `confirm` | `revise`。  
**二期**可将 `await_confirm` 替换为节点内 `interrupt({plan_node_id, plan_summary})`。

---

## 6. 贯穿场景：企业营销（卫生洁具）

### 6.1 阶段对照表

| 步骤 | 用户 / Agent | Graph | State 要点 | Nest / 画布 |
| --- | --- | --- | --- | --- |
| 1 | 「帮我设计一套卫生洁具的营销方案。」 | `intake` → `plan` | `skill_id=enterprise-marketing-campaign`（示例） | — |
| 2 | Agent 输出方案并请确认 | `plan` → `await_confirm` | `plan_summary`；`plan_node_id`；`awaiting_user=True` | 新建/更新 **prompt 节点**（方案全文，UI 可标 T1） |
| 3a | 「改成更偏天猫详情页」 | → `plan` | `user_decision=revise` | **更新同一** `plan_node_id` |
| 3b | 「确认，按这个拆」 | → `split` | `user_decision=confirm` | — |
| 4 | 拆解资产骨架 | `split` → `done` | `split_manifest` 回填各 `node_id` | 下游 text/image/video + **edges** + **prompt** + **refs** |
| 5（二期） | 自动生成 | `orchestrate_gen` | 拓扑队列 | 调 Studio；URI 写回节点 |

### 6.2 建议的一期 `split_manifest` 键（洁具企业营销示例）

| key | target_type | depends_on | 说明 |
| --- | --- | --- | --- |
| `copy_main` | text | [] | 主文案/卖点（可选） |
| `white_bg` | image | [] | 白底图，文生图 |
| `hero_main` | image | [`white_bg`] | 主图，可图生图 |
| `scene` | image | [] | 场景图 |
| `banner` | image | [] | Banner |
| `brand` | image | [] | 品牌图（可提示上传 logo 到 localRefs） |
| `model` | image | [] | 模特/人景 |
| `detail_cut` | image | [`white_bg`] | 细节/剖面 |
| `show_video` | video | [`hero_main`] | 展示视频（首尾帧/参考，二期） |

具体键集由 **Skill** 定义，不写死在 Graph 节点代码里；上表为验收用默认模板。

### 6.3 画布边与芯片

- 边：`plan_node` → 各下游；以及 `white_bg` → `hero_main` 等 `depends_on` 映射边。
- 芯片：下游 `refOrder` 引用上游节点；**不**把上游全文复制进下游 `data`。
- 若需品牌 logo：在对应节点提示用户上传，写入既有 `localRefs`。

---

## 7. Skills 协议（一期）

### 7.1 布局（建议）

```text
services/agent-runtime/skills/
  enterprise-marketing-campaign/
    SKILL.md          # 名称、描述、何时触发、输出结构、拆解键模板
  ...
```

### 7.2 `SKILL.md` 最低字段（约定）

- 标题与一句话描述（供 `intake` 路由）
- 适用意图（企业营销方案、品类不限）
- 规划输出结构（章节：目标人群、卖点、渠道、视觉资产清单…）
- `split_manifest` 模板（或生成该模板的指令）
- 禁止事项（如一期不直接调用生成 API）

### 7.3 加载

- 进程启动扫描 + 可选 mtime 热加载。
- `intake` / `plan` 将匹配 Skill 正文注入 LLM 上下文；**不**把所有 Skill 全文塞进每轮。

---

## 8. Nest 网关与 Tools 契约（一期最小集）

| Tool | 方向 | 说明 |
| --- | --- | --- |
| `load_skill` | Runtime 本地 | 读 Skill 文件 |
| `upsert_prompt_node` | → Nest | 创建/更新方案 prompt 节点；返回 `node_id` |
| `get_node` | → Nest | 按 id 读节点 data（拆解用） |
| `get_canvas_summary` | → Nest | 可选：节点 id/类型/标题列表，禁止默认拉全量 content |
| `add_nodes_batch` | → Nest | 按 manifest 建 text/image/video 骨架 |
| `connect_nodes` | → Nest | 建数据边 |
| `set_node_prompt` | → Nest | 写下游 `prompt` |
| `attach_refs` | → Nest | 设置 `refOrder` / 保证边存在 |

Nest 在工具成功后：

1. 更新 `Session.canvasData`
2. 经现有 Agent SSE 通道推送 `canvas_action`（或等价事件）供前端合并

**鉴权**：Runtime → Nest 使用服务间凭证 + `session_id` 归属校验；用户 JWT 仍由 Nest 在入口对话 API 校验。

---

## 9. 部署与进程形态（一期）

| 组件 | 建议 |
| --- | --- |
| `services/agent-runtime` | FastAPI（或同等）承载 LangGraph；流式事件回 Nest |
| Nest `AgentGateway` | 现有 `/api/agent/chat/...` 改为转发 Runtime，并合并 canvas 事件 |
| 配置 | 模型 Key、Runtime URL、Skills 路径 |
| 本地开发 | docker-compose 增加 runtime 服务；或本机 uvicorn |

一期 checkpointer：`MemorySaver` 或 Sqlite 即可；**编译 Graph 时保留 checkpointer 插槽**，便于二期 Postgres。

---

## 10. 二期演进（明确路径，不在一期交付）

1. **HITL**：`interrupt()` + 持久 checkpointer；前端「确认方案」按钮 → `Command(resume=…)`。
2. **`orchestrate_gen`**：读 Nest 边做拓扑排序；按节点调用现有 Studio 文生图/图生图/视频；只传 `node_id` 与 URI。
3. **Research Skill**：联网搜索/竞品洞察，结果写入方案节点或独立 research 文本节点。
4. **自动级联策略**：仅在用户/Agent 显式「执行工作流」时启用，避免与历史「不自动级联」产品默认冲突。

---

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 双写画布 | 禁止 Runtime 本地 canvas 镜像；只信 Nest |
| 用户拖拽与 Agent 并发 | Nest 串行化同 session 写；冲突时以版本号/时间戳拒绝或合并策略（一期可会话级锁） |
| Skill 质量不稳 | 默认内置 `enterprise-marketing-campaign` 验收 Skill + 契约测试 |
| 拆解过多节点 | Skill 限制一期最大下游数（如 ≤12）；超出则对话确认子集 |
| Python 运维成本 | 单一 runtime 镜像；接口窄（对话 + tools） |

---

## 12. 一期验收标准

1. 用户输入企业营销类需求（洁具案例），Agent 加载营销 Skill 并输出可评审方案文本。
2. 画布出现方案 **prompt 节点**，内容与对话一致（或对话为摘要、节点为全文）。
3. 用户确认后，自动出现至少一类下游骨架（image 或 text）并与方案节点**连线**，下游含 **prompt** 与**上游 ref 芯片**。
4. LangGraph State 中无完整画布 JSON；通过 Nest 可查询到上述节点。
5. 修改方案走 `revise` 时更新同一 `plan_node_id`，不产生无关联的重复方案节点。

---

## 13. 开放问题（实现计划阶段再拍）

1. Runtime 与 Nest 的事件桥：Nest 聚合 SSE vs Runtime 直推前端（倾向 Nest 聚合，复用鉴权）。
2. `thread_id` 与 `session_id` / `agent_run_id` 是否 1:1。
3. 旧 `@lnkpi/agent` RuleBased 降级路径是否在 Runtime 不可用时回退。

---

## 14. 文档修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-23 | 初稿：方案一拍板 + Nest 真相源 + State/拓扑/Skills/洁具企业营销贯穿场景 |
`)
