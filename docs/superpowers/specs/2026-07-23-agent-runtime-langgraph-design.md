# Agent Runtime（LangGraph）技术选型与一期设计

> 状态：**设计待审阅**（修订：一期自动出图 + Skill 目录约定）  
> 日期：2026-07-23（修订 2026-07-24）  
> 范围：Agent Runtime 技术选型、控制面/数据面边界、一期 Graph/State/Tools/Skills、**确认后按拓扑自动出图**；贯穿场景为**企业营销方案 → 画布资产拆解 → 出图**  
> 前置：`2026-07-18-node-data-flow-refs-design.md`（RefChip/数据贯通）、现有 `@lnkpi/agent` SSE + `CanvasAction`、Nest `Session.canvasData` / Studio 文生图·图生图  
> 非范围：一期不实现自动出视频；不引入 Temporal；不把画布全量镜像进 LangGraph State；不做生产级 durable HITL（仅预留）

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| Runtime 选型 | **方案一**：Python **LangGraph** + Nest 网关 + **自研 Markdown Skills** |
| 画布真相源 | **Nest `Session.canvasData` + 前端 Vue Flow**；LangGraph **不**持有全量画布镜像 |
| 控制流 vs 数据流 | LangGraph 边 = **阶段/逻辑**；画布边 + RefChip = **资产依赖** |
| 一期 HITL | **轻量澄清**（多轮口头确认）；预留 `interrupt()` + checkpointer 演进到生产级 durable |
| Skills | 一期即要：见 **§7 Skill 目录约定**（`SKILL.md` + YAML frontmatter，可热加载） |
| 一期验收 | Skill 规划 → 确认 → 拆骨架（边/prompt/refs）→ **按拓扑自动出图**（URI 回写节点） |
| 自动生成编排 | **一期包含自动出图**（`orchestrate_gen`）；**自动出视频留二期** |
| 与「不自动级联」关系 | 引用变更仍**不**静默重跑下游；仅在用户确认方案后由 Agent **显式**执行出图工作流 |
| 现有 `@lnkpi/agent` | 保留为 Nest 侧兼容/工具适配层；新控制面迁到 Python Runtime，不一夜删除 |

**贯穿场景（企业营销）**：用户：「帮我设计一套卫生洁具的营销方案。」→ Agent 规划并征询确认 → 画布落方案节点 → 确认后拆解下游文/图骨架并连线、注入提示词与芯片 → **按依赖自动文生图/图生图**，节点缩略图刷新。

---

## 1. 目标与非目标

### 1.1 目标

1. 明确 Agent Runtime 技术栈，使「对话 Agent」能驱动无限画布，服务**企业营销内容生产**工作流。
2. 一期跑通闭环：**对话 ↔ Skills ↔ LangGraph ↔ Nest Canvas Tools ↔ 画布节点 ↔ Studio 出图**。
3. 用户确认后，Agent 按画布边 / `depends_on` **拓扑排序**，自动调用现有文生图、图生图能力，URI 写回 Nest。
4. 架构上预留：联网研究 Skill、审批门 HITL、自动出视频。

### 1.2 非目标（一期）

- 不在 LangGraph State 中同步完整 `nodes/edges` 作为真相源。
- 不实现生产级 durable workflow（跨天恢复、队列重试）；只留 checkpointer 插槽。
- **不自动出视频**（可建 video 骨架节点 + prompt/refs，生成由用户 Dock 手动或二期编排）。
- 不因上游 Ref 变更而静默级联重跑（保持既有产品默认；与 Agent 显式 `orchestrate_gen` 区分）。
- 不引入 CrewAI/AutoGen 作为 Runtime 内核；不以 Temporal 作为一期依赖。
- 不要求一期上线联网搜索（可作为后续 Skill/Tool）。

---

## 2. 为什么是方案一（对照否决项）

### 2.1 方案一（采用）

```
Vue 画布 / Agent 对话
        ↕ SSE（已有 canvas_action / text_delta / 节点状态）
NestJS（鉴权、会话、canvas 落库、Studio 生成、Agent 网关）
        ↕ HTTP/SSE（或日后队列）
Python Agent Runtime（LangGraph）
        ├─ Skills Loader（§7 目录约定）
        ├─ StateGraph（阶段控制含 orchestrate_gen）
        └─ Tools → 回调 Nest Canvas / Studio Generation API
```

**选用理由（企业营销场景加固）：**

- 营销方案多轮评审、日后审批门 → LangGraph checkpoint / `interrupt()` 演进清晰。
- 资产量大（主图/详情/Banner/模特等）→ 全量进 Graph State 不可接受 → Nest 为画布真相源。
- 品类/品牌规范可沉淀 → Markdown Skills 热加载比硬编码节点函数更贴企业交付。
- 出图仍走 Nest Studio（积分、BYOK、轮询已有）→ Runtime 只编排，不另接一套生图栈。

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
2. **LangGraph 是操作员与流水线**，State 只保留对话、阶段、Skill、焦点节点 id、拆解工作单、出图队列等**控制面**数据。
3. 读写画布与触发生成一律经 **Tools → Nest**；Nest 负责持久化、计费/BYOK，并向前端推送 **`CanvasAction`** / 节点状态。
4. 「芯片」复用现有 **RefChip / `resolveNodeRefs` / `refOrder`**，不在 Graph State 另造一套长文本 `prompt_library` 拷贝。
5. Runtime **不**持有图片二进制；只传 `node_id`，结果以 **URL** 写回节点。

### 3.2 与既有规格的关系

| 既有能力 | Agent Runtime 如何用 |
| --- | --- |
| RefChip 数据贯通 | `split` 时建边 + `attach_refs`；出图时 Nest 按既有规则解析上游 |
| `prompt` 节点 | **方案正文载体**（短需求 + 长文 `content`）；对外可显示为 T1 |
| Dock 手动生成 | 仍可用；Agent `orchestrate_gen` 调用**同一套** Studio 生成入口 |
| 不静默级联 | Ref 变更不自动重跑；仅 `confirm` 后的显式编排会出图 |
| `@lnkpi/agent` tools | Nest 侧适配；对齐新工具契约 |

---

## 4. State 字段级设计（一期）

```python
class AgentRuntimeState(TypedDict):
    # 对话
    messages: list  # 对用户可见的规划摘要、澄清、确认、出图进度话术

    # 控制
    phase: Literal[
        "intake",          # 理解意图、选择 Skill
        "plan",            # 生成企业营销方案
        "await_confirm",   # 已输出待确认；等待下一轮用户消息
        "split",           # 拆节点 + 连线 + 注入 prompt/refs
        "orchestrate_gen", # 按拓扑自动出图
        "done",
        "error",
    ]
    skill_id: str | None
    thread_id: str
    session_id: str

    # 工作记忆（轻量）
    plan_summary: str
    plan_node_id: str | None
    focus_node_ids: list[str]
    split_manifest: list[SplitManifestItem]
    gen_queue: list[str]       # 待出图 node_id 拓扑序（仅 image）
    gen_completed: list[str]   # 已成功出图的 node_id
    gen_failed: list[dict]     # {node_id, error}；允许部分失败后 done
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
| `gen_mode` | `t2i` \| `i2i`（一期出图）；`v_*` 仅占位，一期不跑 |
| `auto_generate` | `bool`；一期默认：`image=true`，`text/video=false` |
| `depends_on` | 其他 `key` 列表（建边 + 拓扑） |
| `prompt_hint` | 注入下游的提示词草稿 |
| `node_id` | Nest 创建成功后回填 |

**禁止**在 State 中长期存放：方案全文副本、Base64 媒体、完整 edges 列表。

### 4.2 二期 State 扩展（预留）

- 持久 checkpointer + `interrupt()` 载荷
- `gen_queue` 扩展含 video；失败重试策略字段

---

## 5. 一期 Graph 拓扑

```text
intake → plan → await_confirm ─┬─ revise → plan
                               └─ confirm → split → orchestrate_gen → done
```

| Graph 节点 | 职责 | 主要副作用 |
| --- | --- | --- |
| `intake` | 识别企业营销意图；加载 Skill；必要时追问品类/渠道/投放位 | 更新 `skill_id` / `messages` |
| `plan` | 按 Skill 生成方案 Markdown；写摘要到对话 | `upsert_prompt_node` → `plan_node_id` |
| `await_confirm` | 征询确认/修改；`awaiting_user=True` | 无强制画布写 |
| `split` | 读方案；写 `split_manifest`；批量建下游 | 建节点/边/prompt/refs |
| `orchestrate_gen` | 从 manifest + 边得到 `gen_queue`；逐个/有限并发出图 | `run_image_generation`；进度写入对话 |
| `done` | 汇总成功/失败；提示可手动补跑或改 prompt | `phase=done` |

**出图规则（一期）：**

1. 仅处理 `target_type=image` 且 `auto_generate=true` 的项。
2. 拓扑：`depends_on` 映射为边；依赖未成功出图则跳过下游并记入 `gen_failed`（可配置），不无限等待。
3. `t2i`：依赖文本/方案 refs；`i2i`：上游 image 节点须已有 `url`。
4. 单节点超时/失败不阻断其它无依赖任务；对话中报告部分失败。
5. 并发上限建议 ≤3（可配置），避免打爆 Provider/积分。

**一期不做**独立 `HumanGate` 空节点。  
**二期**可将 `await_confirm` 换成 `interrupt()`；并为 video 扩展同一 `orchestrate_gen`。

---

## 6. 贯穿场景：企业营销（卫生洁具）

### 6.1 阶段对照表

| 步骤 | 用户 / Agent | Graph | State 要点 | Nest / 画布 |
| --- | --- | --- | --- | --- |
| 1 | 「帮我设计一套卫生洁具的营销方案。」 | `intake` → `plan` | `skill_id=enterprise-marketing-campaign` | — |
| 2 | Agent 输出方案并请确认 | `plan` → `await_confirm` | `plan_summary`；`plan_node_id`；`awaiting_user=True` | 新建/更新 **prompt 节点**（T1） |
| 3a | 「改成更偏天猫详情页」 | → `plan` | `user_decision=revise` | **更新同一** `plan_node_id` |
| 3b | 「确认，按这个拆并出图」 | → `split` | `user_decision=confirm` | — |
| 4 | 拆解资产骨架 | `split` | `split_manifest` 回填 `node_id` | 下游 text/image（+可选 video 骨架）+ edges + prompt + refs |
| 5 | 按拓扑自动出图 | `orchestrate_gen` | `gen_queue` / `gen_completed` / `gen_failed` | Studio 文生图/图生图；节点 `url` + 状态 SSE/轮询 |
| 6 | 汇报结果 | `done` | `phase=done` | 用户可手动重跑失败节点或改 prompt |

### 6.2 建议的一期 `split_manifest` 键（洁具企业营销示例）

| key | target_type | auto_generate | depends_on | gen_mode | 说明 |
| --- | --- | --- | --- | --- | --- |
| `copy_main` | text | false | [] | — | 主文案（可选，不出图） |
| `white_bg` | image | **true** | [] | t2i | 白底图 |
| `hero_main` | image | **true** | [`white_bg`] | i2i | 主图 |
| `scene` | image | **true** | [] | t2i | 场景图 |
| `banner` | image | **true** | [] | t2i | Banner |
| `brand` | image | **true** | [] | t2i | 品牌图（可提示上传 logo） |
| `model` | image | **true** | [] | t2i | 模特/人景 |
| `detail_cut` | image | **true** | [`white_bg`] | i2i | 细节/剖面 |
| `show_video` | video | **false** | [`hero_main`] | v_ref | 一期只建骨架，不出片 |

键集与默认 `auto_generate` 由 Skill 的 `manifest.yaml` 定义。

### 6.3 画布边与芯片

- 边：`plan_node` → 各下游；`depends_on` → 数据边（如 `white_bg` → `hero_main`）。
- 芯片：下游 `refOrder` 引用上游；出图时 Nest `resolveNodeRefs`。
- Logo：对话提示上传到 `brand` 等节点的 `localRefs`；若缺失仍可 t2i 降级，并在话术中说明。

---

## 7. Skills 目录约定（一期规范）

### 7.1 根路径与发现

| 项 | 约定 |
| --- | --- |
| 根目录 | `services/agent-runtime/skills/`（可用环境变量 `LNKPI_SKILLS_DIR` 覆盖） |
| 发现规则 | 根下**一层子目录**，且内含 `SKILL.md` 即为一个 Skill |
| skill_id | **目录名**；须 `^[a-z0-9]+(-[a-z0-9]+)*$`，≤64 字符 |
| 热加载 | 启动全量扫描；运行中按 `SKILL.md` mtime 变更重载该 Skill（失败则保留上一份并打日志） |
| 禁用 | 目录名以 `_` 开头，或 frontmatter `enabled: false` → 不参与路由 |

### 7.2 单 Skill 目录布局

```text
services/agent-runtime/skills/
  enterprise-marketing-campaign/
    SKILL.md              # 必需：frontmatter + 正文指令
    manifest.yaml         # 必需（营销类）：默认 split_manifest 模板
    references/           # 可选：长文规范，按需载入，勿默认塞进每轮
      brand-tone.md
      shot-list.md
    examples/             # 可选：少样本
      sanitary-ware.md
    _draft/               # 可选：本地草稿，加载器忽略
```

**规则：**

- 除 `SKILL.md` / `manifest.yaml` 外，其它文件**默认不注入**上下文；仅当 frontmatter `includes` 列出相对路径时才加载。
- 单次注入总 token 预算由 Runtime 配置（超出截断并告警）。

### 7.3 `SKILL.md` 格式

YAML frontmatter + Markdown 正文：

```markdown
---
name: enterprise-marketing-campaign
description: >-
  企业商品营销方案规划与画布资产拆解。在用户要求营销方案、投放物料、
  主图/详情/Banner 等视觉资产时使用。
version: 1
enabled: true
triggers:
  - 营销方案
  - 主图
  - 详情页
  - banner
  - 投放物料
phases: [intake, plan, split, orchestrate_gen]
includes: []
max_downstream: 12
---

# 企业营销方案

## 何时使用
…

## 规划输出结构
（章节：目标人群、卖点、渠道、视觉资产清单…）

## 拆解与出图
- 遵守同目录 `manifest.yaml`
- 确认前只写方案节点；确认后 split + 自动出图
- 不要在 plan 阶段调用 run_image_generation

## 禁止
- 一期不要自动出视频
- 不要把上游全文复制进下游节点 data
```

| Frontmatter 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | 须与目录名 / skill_id 一致 |
| `description` | 是 | ≤1024 字；供 `intake` 路由 |
| `version` | 是 | 整数；便于缓存失效 |
| `enabled` | 否 | 默认 `true` |
| `triggers` | 否 | 关键词辅助路由 |
| `phases` | 否 | 声明参与的阶段 |
| `includes` | 否 | 额外 md 相对路径列表 |
| `max_downstream` | 否 | 覆盖全局默认下游上限 |

### 7.4 `manifest.yaml` 格式（营销拆解）

```yaml
schema_version: 1
defaults:
  auto_generate_image: true
  auto_generate_video: false
items:
  - key: white_bg
    title: 白底图
    target_type: image
    source_section: 视觉资产/白底图
    gen_mode: t2i
    auto_generate: true
    depends_on: []
    prompt_hint_template: "卫浴洁具产品白底图，居中，商业摄影…"
  - key: hero_main
    title: 主图
    target_type: image
    source_section: 视觉资产/主图
    gen_mode: i2i
    auto_generate: true
    depends_on: [white_bg]
    prompt_hint_template: "基于白底主产品，电商主图…"
  - key: show_video
    title: 产品展示视频
    target_type: video
    gen_mode: v_ref
    auto_generate: false
    depends_on: [hero_main]
    prompt_hint_template: "产品旋转展示…"
```

`split`：以 `manifest.yaml` 为骨架，可用 LLM 按方案填充/裁剪 `prompt_hint`，但不得突破 `max_downstream`。

### 7.5 路由与加载

1. `intake`：用各 Skill 的 `name`+`description`（+可选 triggers）选中一个 `skill_id`。
2. 加载：`SKILL.md` 正文 + `includes` + 解析后的 `manifest.yaml` 摘要。
3. **禁止**把 `skills/` 下全部 Skill 全文塞进同一轮上下文。

### 7.6 一期内置 Skill

| skill_id | 用途 |
| --- | --- |
| `enterprise-marketing-campaign` | 验收用默认企业营销 Skill（可含洁具 examples） |

---

## 8. Nest 网关与 Tools 契约（一期最小集）

| Tool | 方向 | 说明 |
| --- | --- | --- |
| `load_skill` | Runtime 本地 | 按 §7 读 Skill + manifest |
| `upsert_prompt_node` | → Nest | 创建/更新方案 prompt 节点 |
| `get_node` | → Nest | 读节点 data（含 image `url` 供 i2i） |
| `get_canvas_summary` | → Nest | id/类型/标题/状态；禁止默认拉全量 content |
| `add_nodes_batch` | → Nest | 按 manifest 建骨架 |
| `connect_nodes` | → Nest | 建数据边 |
| `set_node_prompt` | → Nest | 写下游 `prompt` |
| `attach_refs` | → Nest | `refOrder` / 边 |
| `run_image_generation` | → Nest | 对指定 `node_id` 触发与 Dock 等价的文生图/图生图 |
| `get_generation_status` | → Nest | 查询节点生成状态 / 最终 `url` |

Nest 在工具成功后：更新 `Session.canvasData`；经 Agent SSE 推送 `canvas_action` 与节点状态。

**鉴权**：Runtime → Nest 服务间凭证 + `session_id` 归属；用户 JWT 在 Nest 对话入口校验。出图走既有积分/BYOK。

---

## 9. 部署与进程形态（一期）

| 组件 | 建议 |
| --- | --- |
| `services/agent-runtime` | FastAPI（或同等）+ LangGraph；挂载 `skills/` |
| Nest `AgentGateway` | 转发 Runtime，合并 canvas / 生成状态事件 |
| 配置 | 模型 Key、Runtime URL、`LNKPI_SKILLS_DIR`、出图并发上限 |
| 本地开发 | docker-compose 增加 runtime；Skills 目录挂载便于热更 |

一期 checkpointer：`MemorySaver` 或 Sqlite；**保留插槽**便于二期 Postgres。

---

## 10. 二期演进（不在一期交付）

1. **HITL**：`interrupt()` + 持久 checkpointer；「确认方案」按钮 → `Command(resume=…)`。
2. **自动出视频**：扩展 `orchestrate_gen` 支持 `v_flf` / `v_ref`。
3. **Research Skill**：联网搜索/竞品洞察 → 文本节点或写入方案。
4. **出图失败重试 / 部分重跑**：用户「只重跑失败节点」→ 重建 `gen_queue` 子集。

---

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 双写画布 | Runtime 不镜像全量 canvas |
| 出图耗时长阻塞对话 | Nest 异步任务 + 状态事件；Runtime 等待带超时；对话流式报进度 |
| 积分/BYOK 中断 | 失败写入 `gen_failed`；话术引导处理后重跑 |
| i2i 上游无图 | 拓扑保证；上游失败则跳过下游并记录 |
| Skill 质量不稳 | 内置验收 Skill + manifest 契约测试 |
| 拆解过多 | `max_downstream`（默认 12） |
| 与手动生成竞态 | 同 `node_id` Nest 侧生成锁 |

---

## 12. 一期验收标准

1. 企业营销需求（洁具案例）→ 加载 `enterprise-marketing-campaign` → 输出可评审方案。
2. 画布出现方案 **prompt 节点**（对话可为摘要）。
3. 用户确认后：下游 **image 骨架** + **连线** + **prompt** + **上游 ref 芯片**。
4. **自动出图**：至少 **2** 张图成功回写 `url`（建议含 1×t2i + 1×依赖它的 i2i，如白底→主图），前端可见。
5. 部分失败时会话有明确失败列表，其它成功节点不受影响。
6. LangGraph State 无完整画布 JSON、无 Base64。
7. `revise` 更新同一 `plan_node_id`；Skills 目录符合 §7，缺 `SKILL.md` 的目录不被加载。

---

## 13. 开放问题（实现计划阶段再拍）

1. Runtime↔Nest 事件桥：Nest 聚合 SSE vs Runtime 直推（倾向 Nest 聚合）。
2. `thread_id` 与 `session_id` / `agent_run_id` 是否 1:1。
3. `run_image_generation` 同步等待上限 vs 纯轮询；与现有 `useGenerationPolling` 对齐方式。
4. 旧 `@lnkpi/agent` RuleBased 在 Runtime 不可用时是否回退。

---

## 14. 文档修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-23 | 初稿：方案一 + Nest 真相源 + State/拓扑/Skills 草案 |
| 2026-07-24 | 一期纳入 `orchestrate_gen` 自动出图；视频仍二期；§7 定为 Skill 目录/frontmatter/`manifest.yaml` 正式约定 |
