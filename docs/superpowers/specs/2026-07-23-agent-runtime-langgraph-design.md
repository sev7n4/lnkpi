# Agent Runtime（LangGraph）技术选型与一期设计

> 状态：**已确认**（2026-07-24）；实现计划见 `docs/superpowers/plans/2026-07-24-agent-runtime-langgraph.md`  
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
| Skills | 一期即要：见 **§7**，目录与 `SKILL.md` **对齐 [Agent Skills](https://agentskills.io/specification) 开放标准**，可兼容 skills 市场生态；lnkpi 扩展仅放 `metadata` / `assets/` |
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
        ├─ Skills Loader（agentskills.io 兼容）
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

键集与默认 `auto_generate` 由 Skill 的 `assets/canvas-manifest.yaml`（lnkpi 扩展资源）定义。

### 6.3 画布边与芯片

- 边：`plan_node` → 各下游；`depends_on` → 数据边（如 `white_bg` → `hero_main`）。
- 芯片：下游 `refOrder` 引用上游；出图时 Nest `resolveNodeRefs`。
- Logo：对话提示上传到 `brand` 等节点的 `localRefs`；若缺失仍可 t2i 降级，并在话术中说明。

---

## 7. Skills 目录约定（对齐 Agent Skills 开放标准）

> **规范源：** [agentskills.io/specification](https://agentskills.io/specification)（Anthropic 发布的 Agent Skills 开放标准；Cursor / Claude Code / Codex 等共用同一 `SKILL.md` 包格式）。  
> **原则：** 包结构与 frontmatter **只使用标准字段**；lnkpi 画布/出图专用配置放在 `metadata` 与 `assets/`，保证可从 skills 市场安装、也可对外分发。

### 7.1 标准包结构（与市场生态一致）

每个 Skill 是一个目录，**至少**包含 `SKILL.md`：

```text
enterprise-marketing-campaign/
  SKILL.md                 # 必需：YAML frontmatter + Markdown 指令
  scripts/                 # 可选：可执行脚本（按需调用，源码默认不进上下文）
  references/              # 可选：长文档，按需加载
    brand-tone.md
    shot-list.md
  assets/                  # 可选：模板与结构化资源（市场包常用）
    canvas-manifest.yaml   # lnkpi 扩展：画布拆解/出图工作单（非标准必需文件）
    examples/
      sanitary-ware.md
```

| 路径 | 标准角色 | lnkpi 用法 |
| --- | --- | --- |
| `SKILL.md` | 必需 | 规划/拆解/出图流程指令 |
| `scripts/` | 可选 | 校验 manifest、后处理等（一期可空） |
| `references/` | 可选 | 品牌语气、镜头规范等，progressive disclosure |
| `assets/` | 可选 | 模板与数据；**画布 manifest 放这里** |

**禁止**把 lnkpi 专有必需文件放在包根（例如根级 `manifest.yaml`），以免与市场包约定冲突、安装器误判。

### 7.2 安装根目录与发现

| 项 | 约定 |
| --- | --- |
| 运行时技能根 | `services/agent-runtime/skills/`（`LNKPI_SKILLS_DIR` 可覆盖） |
| 发现规则 | 根下**一层子目录**且含 `SKILL.md` → 一个 Skill（与标准一致） |
| 目录名 = `name` | 须匹配 frontmatter `name`；`^[a-z0-9]+(-[a-z0-9]+)*$`，≤64，首尾非 `-` |
| 市场安装 | 支持将 agentskills / skills.sh 等生态的 Skill 包**解压/链接**到技能根；无 `assets/canvas-manifest.yaml` 的通用 Skill 仍可作纯指令 Skill 使用 |
| 热加载 | 扫描 `SKILL.md` mtime；重载失败保留上一份 |
| 本地草稿 | 目录名以 `_` 开头 → 发现器跳过（加载器约定，非标准字段） |

### 7.3 `SKILL.md` frontmatter（仅标准字段）

按 Agent Skills 规范，frontmatter **必需**仅 `name`、`description`；其余为规范已定义的可选字段。

```markdown
---
name: enterprise-marketing-campaign
description: >-
  Plans enterprise product marketing campaigns and splits deliverables onto
  an infinite canvas (copy, hero, scene, banner). Use when the user asks for
  营销方案, 主图, 详情页, Banner, or campaign visual assets.
license: Apache-2.0
compatibility: >-
  Designed for lnkpi agent-runtime with Nest canvas tools and image generation.
metadata:
  author: lnkpi
  lnkpi.canvas_manifest: assets/canvas-manifest.yaml
  lnkpi.max_downstream: "12"
allowed-tools: upsert_prompt_node add_nodes_batch connect_nodes set_node_prompt attach_refs run_image_generation get_generation_status
---

# Enterprise marketing campaign

## Instructions
…

## Split and image generation
- Follow `assets/canvas-manifest.yaml` when splitting the canvas.
- Do not call `run_image_generation` during plan; only after user confirm → split → orchestrate_gen.
- Phase-1: do not auto-generate video nodes.

## Progressive disclosure
- Keep this file concise; put long brand rules in `references/`.
```

| 字段 | 标准 | 约束 / 用法 |
| --- | --- | --- |
| `name` | **必需** | ≤64；小写字母/数字/连字符；与目录名一致 |
| `description` | **必需** | ≤1024；写清 **做什么 + 何时用**（含触发关键词）；第三人称 |
| `license` | 可选 | 许可证名或包内 LICENSE 引用；便于市场上架 |
| `compatibility` | 可选 | ≤500；环境/产品依赖说明 |
| `metadata` | 可选 | 任意键值；**lnkpi 扩展只放这里**（见下） |
| `allowed-tools` | 可选（实验） | 空格分隔的预授权工具名 |

**不得**在 frontmatter 顶层发明非标准键（如 `version` / `enabled` / `triggers` / `phases` / `includes` / `max_downstream`），以免校验器/市场工具拒收或忽略行为不一致。

**lnkpi `metadata` 扩展（约定前缀 `lnkpi.`）：**

| 键 | 说明 |
| --- | --- |
| `lnkpi.canvas_manifest` | 相对 Skill 根的路径，默认 `assets/canvas-manifest.yaml` |
| `lnkpi.max_downstream` | 字符串数字，下游节点上限（默认 `"12"`） |

未识别的 `metadata` 键忽略，保证第三方 Skill 可加载。

### 7.4 Progressive disclosure（与标准一致）

1. **Metadata（~100 tokens/Skill）**：启动只索引全部 Skill 的 `name` + `description`。  
2. **Instructions**：命中后再加载完整 `SKILL.md` 正文（建议 < 5000 tokens / < 500 行）。  
3. **Resources**：仅当指令需要时再读 `references/`、`assets/`、执行 `scripts/`（脚本**输出**可进上下文，源码默认不进）。

**禁止**把技能根下所有 Skill 全文塞进同一轮上下文。

### 7.5 `assets/canvas-manifest.yaml`（lnkpi 扩展，非标准必需）

营销画布拆解专用；通用市场 Skill 可无此文件。

```yaml
# assets/canvas-manifest.yaml
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

`split`：以该文件为骨架；可用 LLM 填充/裁剪 `prompt_hint`；受 `lnkpi.max_downstream` 约束。若文件缺失：仅执行 `SKILL.md` 文本流程，**不**自动批量建营销画布（或对话降级为手写少量节点）。

### 7.6 市场生态兼容性

| 能力 | 一期做法 |
| --- | --- |
| 安装第三方 Skill | 将标准包放入技能根即可被发现；无 canvas-manifest 则当通用指令 Skill |
| 导出本产品 Skill | 包结构符合 agentskills.io，可提交市场；`compatibility` 声明 lnkpi 依赖 |
| 校验 | Loader 按标准校验 `name`/`description`；额外用可选 schema 校验 `assets/canvas-manifest.yaml` |
| Cursor 联调 | 同一包可复制到 `.cursor/skills/` 做编辑期预览（路径不同，包内结构相同） |

### 7.7 一期内置 Skill

| skill_id（目录名） | 用途 |
| --- | --- |
| `enterprise-marketing-campaign` | 验收用企业营销 Skill（含 `assets/canvas-manifest.yaml`，可选 `references/` / `assets/examples/`） |

---

## 8. Nest 网关与 Tools 契约（一期最小集）

| Tool | 方向 | 说明 |
| --- | --- | --- |
| `load_skill` | Runtime 本地 | 按 agentskills 标准发现/加载；按需读 `assets/canvas-manifest.yaml` |
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
| Skill 质量不稳 | 内置验收 Skill + 标准 frontmatter 校验 + `assets/canvas-manifest.yaml` 契约测试 |
| 拆解过多 | `metadata.lnkpi.max_downstream`（默认 12） |
| 与手动生成竞态 | 同 `node_id` Nest 侧生成锁 |

---

## 12. 一期验收标准

1. 企业营销需求（洁具案例）→ 加载 `enterprise-marketing-campaign` → 输出可评审方案。
2. 画布出现方案 **prompt 节点**（对话可为摘要）。
3. 用户确认后：下游 **image 骨架** + **连线** + **prompt** + **上游 ref 芯片**。
4. **自动出图**：至少 **2** 张图成功回写 `url`（建议含 1×t2i + 1×依赖它的 i2i，如白底→主图），前端可见。
5. 部分失败时会话有明确失败列表，其它成功节点不受影响。
6. LangGraph State 无完整画布 JSON、无 Base64。
7. `revise` 更新同一 `plan_node_id`；Skills 包符合 agentskills.io（`SKILL.md` + 可选 `scripts/`/`references/`/`assets/`）；缺 `SKILL.md` 的目录不被加载；顶层无非标准 frontmatter 也能被索引。

---

## 13. 开放问题（已在实现计划锁定）

| # | 问题 | 锁定结论 |
| --- | --- | --- |
| 1 | Runtime↔Nest 事件桥 | **Nest 聚合 SSE**：Runtime 回传事件给 Nest，Nest 写库并 `res.write` 给前端 |
| 2 | `thread_id` 关系 | 一期：`thread_id === session_id`；二期可拆 `agent_run_id` |
| 3 | 出图等待 | Nest tool `run_image_generation`：**启动 Studio 任务 + 服务端轮询至完成/超时**（默认 180s）；中间可推 `node_status` 事件 |
| 4 | Runtime 不可用 | `AGENT_RUNTIME_URL` 未配置或健康检查失败 → **回退**现有 `@lnkpi/agent` `CanvasAgent` |

---

## 14. 文档修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-23 | 初稿：方案一 + Nest 真相源 + State/拓扑/Skills 草案 |
| 2026-07-24 | 一期纳入 `orchestrate_gen` 自动出图；视频仍二期；Skills 目录初稿 |
| 2026-07-24 | §7 对齐 agentskills.io：标准 `SKILL.md`/`scripts`/`references`/`assets`；画布清单迁入 `assets/canvas-manifest.yaml`；扩展仅 `metadata.lnkpi.*` |
| 2026-07-24 | 规格确认；§13 开放问题锁定；进入实现计划 |
