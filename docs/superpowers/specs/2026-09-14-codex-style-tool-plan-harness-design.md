# Codex 风格会话 Tool Plan Harness（方案 1 / R1）

> **出图路径修订（2026-09-14 Phase 2a）：** 「出图 / `media_create_high` → atomic 子图主路径」及本文件 **V7** 硬约束，由 [2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md) **废止并替换**：默认 `canvas_agent` 摆盘；计费 `run_*` 仍禁止 bind。`atomic_generate` 退出 hard/precedence 竞争。

> 日期：2026-09-14  
> 状态：**已批准**（2026-09-14；方案 1 / R1；终审通过，开 implementation plan）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 上级：Hybrid A / CS（[2026-08-08-agent-canvas-control-surface-design.md](./2026-08-08-agent-canvas-control-surface-design.md)）  
> 相关：[2026-09-13-explore-import-workflow-placement-design.md](./2026-09-13-explore-import-workflow-placement-design.md)、[2026-08-09-sidebar-ref-image-routing-design.md](./2026-08-09-sidebar-ref-image-routing-design.md)、[2026-08-05-intent-planning-guard-design.md](./2026-08-05-intent-planning-guard-design.md)  
> **修订声明：** 本文件 §0.1 **修订** 2026-08-09 RU 中「LLM as Parser, Not Router」作 L0 铁律的条款；旧文应在 M0/M4 加 banner 交叉引用，避免两份 Accepted 并行矛盾。

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **D1** | 目标态为 **Codex 式会话 harness**：Route 定 lane → ToolPlan 定可见工具 → AgentLoop 选型执行；**不**用名词/动词表当「理解器」 |
| **D2** | **方案 1**：`chat` + `explore_canvas` 合并为 `canvas_agent`；关键词路由主路径退役；`decide_lane` LLM 为 L0 主路径（**ADR=R1**） |
| **D3** | **保留 CS-4 / Hybrid 能力分层**：gen / destructive / graph_batch **永不**进入 `model_visible_specs` |
| **D4** | 目标态一次定义；**交付按 M0–M4 分 PR**。M3 可用 flag 做路由切换；**禁止**把「零工具 chat」当作回滚默认 |
| **D5** | Hard feature **短路优先于** `decide_lane`（防出图误进 agent）；LLM/guard 失败默认 **`canvas_agent`（有工具）**，永不默认零工具 |
| **D6** | **V1（口语 follow-up 导出）验收闸门 = M2**：终局默认 lane 必须已是有工具的 `canvas_agent`；单独的 M1 不宣称修生产口语导出 |
| **D7** | `canvas_agent` / `decide_lane` **必须**使用压缩多轮上下文（不得只喂最新一句 Human） |
| **D8** | Hard 短路集合 **形式化**为有序 `HARD_SHORTCIRCUIT_RULE_IDS`（附录 A）；`explore` / `empty` / `default_chat` **不得**列入 |

### 0.1 ADR 修订（R1）— 相对 2026-08-09 RU

| 原 RU | 本规格 |
|-------|--------|
| **「LLM as Parser, Not Router」**：L0 不用自由文本选路；仅 feature + `apply_route_precedence` | **修订**：L0 **允许** LLM `decide_lane` 为主路径；precedence **退化为** hard-feature 短路 + planning_guard 否决 + shadow/eval |
| RU-2：`decide_route` 瘦身为 precedence 执行器 | **修订**：`decide_route` = hard 短路 →（可选）LLM `decide_lane` → guard 后处理；precedence 表不再单独决定 explore vs chat |
| RU-3：Feature 化，非 Label 化 | **保留精神**：禁止 `keyword in text → flow_mode=chat` / IO 门闩；`RouteFeatures` 提取器可保留 substring，但只产 **feature**，不直接贴零工具 lane |
| RU-6：Context-First | **保留**：UI/skill/checkpoint/refs 等硬信号 **override** 低置信 LLM |
| RU-8：eval-route-set CI | **保留并扩展**（见 §6） |
| intent-planning-guard Phase C「L1 → LLM route」 | **收束为本规格的 `decide_lane`**，避免两套 LLM 路由并行 |
| RU「small action space」 | **张力承认**：LLM 仅在 **hard 短路之后的剩余歧义** 上选粗 lane（≤7）；高成本 graph 分支优先由附录 A 切走；campaign vs PV vs atomic 混淆用 eval 约束 |

> 一句话：理解交给模型；护栏交给 feature/guard；可见工具交给 ToolPlan——不再用「画布+导出」话术词典决定能不能用工具。

---

## 1. 背景与问题

生产复测已证明：技术提示词下 import/export 可通；口语 follow-up（「再导一次，这次也是全部导出。」）因 **缺名词 → `chat` 零工具** 失败。根因不是模型不懂，而是：

1. **关键词门槛在 LLM 之前**关掉工具（`explore_canvas_signal` 的 noun∧verb、默认 `chat`）。  
2. **narrow-bind** 再用关键词裁可见集（≤5），进一步放大话术脆弱性。  
3. Codex / Cursor 主流 harness 是 **裁剪可见集 + 模型选型 + 运行时护栏**，不是名词表当理解器。

`#299` 已接通 `import_workflow` 入 explore + placement 不变量；本规格治理的是 **路由/绑定哲学**，不是再补词表。

---

## 2. 目标、非目标与硬不变量

### 2.1 目标

1. **会话级 tool plan**：每 `canvas_agent` turn 计算 `model_visible_specs`（core ∪ 已加载 deferred ∪ meta）。  
2. **可选 `tool_search`**：deferred 工具按 query 加载，写入 thread state。  
3. **关键词路由退役（主路径）**：删除生产路径上的 `explore_canvas_signal` 名词动词门槛、关键词 `select_narrow_write_tools`、以及「缺名词 → 零工具 chat」。  
4. **统一控制面**：`explore_canvas` + `chat` → **`canvas_agent`**（闲聊 = 有工具、可不调）。  
5. **编排仍确定性**：出图 / campaign / HITL 仍走现有 LangGraph 子图；**如何进入**由 hard feature + `decide_lane` + guard 决定。

### 2.2 非目标

- 将 `run_*_generation` / destructive / 大批量拓扑 **开放给 LLM bind**（违反 CS-4）  
- 用 LangGraph `Command` 承载画布副作用（CS-9）  
- 重写 Nest `/agent/internal/*` 或前端 undo 栈  
- 照搬 Codex 源码结构 / Responses API 专有字段（只借 plan / registry / deferred / search 心智）  
- 一次重做全部 skill / campaign 文案产品设计  

### 2.3 硬不变量

| ID | 规则 |
|----|------|
| **H1** | `exposure=graph_only`（gen / destructive / graph_batch）**永不**进入 `model_visible_specs` |
| **H2** | 计费生成、HITL、campaign 拓扑 **只**经确定性子图执行 |
| **H3** | 每个 StructuredTool 有 `placement` + `exposure`；孤儿不变量 I1–I4 保留，并扩展 I5–I7 |
| **H4** | 副作用走 NestCanvasClient / `canvas_command` SSE，不走图内 Command |
| **H5** | 本轮不放宽 CS-4；高风险写若未来放宽须显式 approval |
| **H6** | 出图类 hard feature **不得**被默认/`decide_lane` 单独改写为 `canvas_agent` 而无 guard 记录（误路由代价见 §2.4） |

### 2.4 误路由代价（不对称）

| 误判 | 体验 | 政策 |
|------|------|------|
| 该 atomic/campaign → 误进 `canvas_agent` | 看不见 gen，只能口头教，**比旧零工具 chat 更糟** | Hard feature **短路优先**；金标出图 case 禁止默认进 agent |
| 该 agent → 误进 atomic | 可能多余 clarify / 误创作 | 低置信 → `clarify_route`；默认偏向 agent **仅当**无出图 hard feature |
| LLM/基础设施失败 | — | Fallback = **`canvas_agent`（有工具）**，**禁止**回落零工具 chat |

### 2.5 成功标准

- 「再导一次 / 也是全部导出」多轮下能调 `export_media_package`，**不依赖**本句含「画布/工作流」。  
  - **验收闸门：M2 及以后**（见 D6）；金标须为 **多轮 fixture**（上轮 export 成功），单句不够。  
- 「你好」→ `canvas_agent`，允许 0 tool。  
- 「帮我生成一张…图」→ graph lane；visible **无** gen tools。  
- 新增工具必须声明 exposure；CI 禁止不可达。  
- `decide_lane`：hard 短路可跳过；有调用时 p95 预算见 **§4.4**；失败不进零工具 chat。  
- `eval-route-set`（及控制面用例）含 §6 **V1–V7**；删 `explore_canvas_signal` 生产路径前金标全绿。  
- AgentLoop 与 `decide_lane` 均使用压缩多轮上下文（D7）。

---

## 3. 架构：Route × Tool Plan × Agent Loop × Graph

### 3.1 一句话

**Route 只回答走哪条执行轨；ToolPlan 只回答本回合模型能看见哪些工具；AgentLoop 负责理解与选型；Graph 子图负责计费/HITL/批量副作用。**

### 3.2 四层

```text
User turn
    │
    ▼
┌─────────────────────┐
│ 1. RouteDecide      │  hard-feature 短路 → decide_lane(LLM) → guard
│    → lane           │  graph_* | canvas_agent | clarify_route
└─────────┬───────────┘
          │
     graph_* ──► 现有 LangGraph 子图（不 bind gen tools）
          │
     canvas_agent
          │
          ▼
┌─────────────────────┐
│ 2. ToolPlan         │  exposure → visible + deferred_catalog + registry
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 3. AgentLoop        │  bind(visible) ↔ tools（含 tool_search）
└─────────────────────┘
```

| 层 | 决定什么 | 不决定什么 |
|----|----------|------------|
| RouteDecide | graph vs `canvas_agent` vs clarify | 具体调哪个画布 tool |
| ToolPlan | 可见 schema、deferred、是否允许 search | 用户意图语义 |
| AgentLoop | 是否调工具、哪个、参数 | 是否允许 gen（已由 plan 裁掉） |
| Graph 子图 | 出图编排、HITL、batch | 口语理解（lane 已定） |

### 3.3 Lane 模型

| Lane | 含义 | 后继 |
|------|------|------|
| `canvas_agent` | 默认控制面（原 explore + chat） | ToolPlan → AgentLoop |
| `atomic_create` / `atomic_regenerate` / `single_node` | 原子创作 / 再生成 | 现有子图 |
| `campaign` / `product_visual` | 营销 / 商详 | 现有子图 |
| `clarify_route` | 编排歧义 | clarify 节点 |

**兼容期（P2）：** `flow_mode` 字段可暂留；取值上 `chat` ≡ `explore_canvas` ≡ `canvas_agent`。  
**删除期：** M4 后代码/文档仅保留 `canvas_agent`；测试别名可留一个版本。

**删除作为产品语义的零工具 `chat` lane**（实现上合并，不保留「无工具闲聊通道」）。

### 3.4 RouteDecide（R1：LLM 主路径 + hard 短路）

**流水线（顺序固定）：**

1. **Hard-feature 短路**（确定性，跳过 LLM）— 仅匹配附录 A `HARD_SHORTCIRCUIT_RULE_IDS` 中的规则（由现网 `PRECEDENCE_RULES` 派生，**排除** `explore` / `empty` / `default_chat`）。  
2. 否则调用 **`decide_lane` LLM**（结构化输出）。  
3. **`planning_guard` / 后处理**：可否决；`confidence < τ`（建议 0.55）且与 hard 冲突 → `clarify_route`。  
4. 默认：**无 graph hard 时偏向 `canvas_agent`**（含原 `empty` / 未识别口语）。

**`decide_lane` 输入：** `utterance`、**压缩 `recent_turns`（必填，含上轮 lane / 关键 tool 名）**、`route_features`、`allowed_lanes`、`previous_lane`（来自 `RouteContext` / state）。  

**输出 schema：**

```json
{
  "lane": "canvas_agent | atomic_create | atomic_regenerate | single_node | campaign | product_visual | clarify_route",
  "confidence": 0.0,
  "reason": "short",
  "clarify_question": null
}
```

映射进现有 `RouteDecision`（`flow_mode` 兼容别名见上）。

**与 RU small action space：** LLM 只处理 hard 未切走的剩余歧义；附录 A 负责高成本 graph 分支。campaign / product_visual / atomic 混淆用 eval 金标约束，不靠再堆名词表。

**关键词角色变更：**

| 旧 | 新 |
|----|----|
| `explore_canvas_signal` 定 explore vs chat | **删除生产路径**（可留 test fixture） |
| mutate 动词 ∧ 名词作门闩 | **禁止** |
| `select_narrow_*` 关键词 | **删除** |
| `classify_explore_intent` 词表分类 | **退役或降为可选 heuristic**；默认 `open_query` + 全 visible（见 §7） |
| `RouteFeatures` / L0 hard | **保留为短路与 guard 输入**（附录 A） |
| planning 动词表 | **仅 guard / eval**，不决定「有没有工具」 |

**诚实边界：** Feature 提取器内部仍可能用 substring；反模式是 **keyword → 零工具 / keyword → IO 能否调用**，不是「代码里禁止任何中文字符串」。

### 3.5 ToolPlan

见 §4。

### 3.6 AgentLoop

- 由 `explore` + `chat` 演进为 **`canvas_agent`**（文件名可暂留别名）。  
- **多轮上下文（D7，强制）：** 不得只注入最新一条 Human。须包含压缩 `recent_turns`（至少：上轮用户话、上轮 assistant 摘要、上轮已调用 tool 名与关键结果摘要）。V1 依赖此条。  
- **统一 system prompt：**  
  - 用工具完成读写，禁止假装已执行；  
  - **禁止**声称正在/已经出图；用户要生成时引导清晰创作表述（或依赖下轮 Route 进 graph）；  
  - 不得引导第三方作图工具；  
  - 去掉「本轮只允许下列关键词工具」类约束。  
- 删除关键词 narrow-bind；`bind_tools(plan.visible)`。  
- **`classify_explore_intent`：** 不再作为绑定裁剪依据；默认按 `open_query` + plan.visible 行为（词表分类见 §7 退役）。  
- Mandatory dispatch：现网 `MANDATORY_INTENTS = {ui_command, lifecycle, asset_read}` 为 **结构/UI 快路径**，可另开评估保留；**不是** import/export 词表 mandatory。Import/export 靠 core 可见 + 模型选型。  
- `tool_search` 同 turn 行为见 §4.3。

### 3.7 接线

```text
START → intake(RouteDecide)
          ├─ clarify_*     → clarify → resume
          ├─ graph lanes   → 现有 builder 边
          └─ canvas_agent  → tool_plan → agent_loop → done
```

Graph 子图 **不**走 ToolPlan；继续直接 Nest。

### 3.8 边界表

| 场景 | 正确路径 |
|------|----------|
| 「再导一次」 | `canvas_agent` → `export_media_package` |
| 「生成一张主图」 | hard/LLM → atomic 子图；visible 无 gen |
| Agent 想出图 | 引导 / 下轮 Route；**不** bind gen |
| 批量加节点 / 删节点 | `graph_only`；仅子图或未来 HITL |

---

## 4. ToolPlan / exposure / `tool_search`

### 4.1 `ToolExposure`

| Exposure | 含义 | 进 visible？ |
|----------|------|--------------|
| `core` | 每回合默认可见 | 是 |
| `deferred` | 目录可搜，search 后可见 | 默认否；加载后是 |
| `graph_only` | 仅确定性子图 | 永不 |
| `meta` | harness（`tool_search`） | 是 |

映射：今日 `explore|ui_command` → 默认 `core`（含 import/export）；`graph_node` → `graph_only`；新增 `tool_search` → **`exposure=meta`**，且 **`placement=explore`**（计入 explore/agent 构建与 I2，避免「有 meta、无 placement」孤儿）。

**CI（I5–I7）：**

| # | 规则 |
|---|------|
| **I5** | 每个 registry 名有且仅有一个 exposure |
| **I6** | `graph_only` ⊄ visible；`meta` ⊆ core visible |
| **I7** | `deferred` 必须出现在 search 目录且有描述 |

`tool_search`：同时满足 I2（在 EXPLORE/agent 名集合内）与 I5–I6。

### 4.2 `build_tool_plan`

```text
ToolPlan {
  visible: ToolSpec[]
  deferred_catalog: {name, description, tier}[]
  registry: handlers  # 含 graph_only，不广告
}
```

1. `visible = core ∪ state.tool_plan_loaded ∪ {tool_search}`  
2. 剔除任何 `graph_only` / 未声明 exposure，打 metric  
3. **稳定排序**（利于 cache）  
4. **禁止**关键词 ≤5 窄绑  

**v1 策略（P1）：** 现有 explore 工具默认 **core**；同时落地 **最小 deferred 集合（≥3）**，避免 `tool_search` 空转。建议候选（实现时可微调，须满足 I7）：

- `get_image_edit_capabilities`  
- `list_public_assets`  
- `introduce_nodes_to_agent`  

（若实测 schema/token 压力大，再把更多资产类迁 deferred——用 search，不回退名词窄绑。）

### 4.3 `tool_search`

```text
tool_search(query: string, limit: int = 5) -> {
  loaded: string[],
  candidates: {name, score, description}[]
}
```

- 只搜 `deferred`；永不返回 `graph_only`。  
- 命中写入 **`state.tool_plan_loaded: list[str]`**（LangGraph thread/checkpoint；M2 起写入 `AgentRuntimeState`）；**新会话清空**。  
- **同 turn re-bind（强制）：** search 成功 → 更新 `tool_plan_loaded` → **立即重建 `plan.visible` 并 `bind_tools` 后继续本轮 loop**，使模型当轮即可调用新加载工具（禁止「仅下轮生效」作为 v1 行为）。  
- 无命中：空列表 + 短提示。  
- 首版匹配：描述 token 重叠即可；不强制向量服务。  
- 每 turn 调用上限（建议 ≤3）。

### 4.4 延迟与成本（P1）

| 项 | 政策 |
|----|------|
| Hard 短路 | 跳过 `decide_lane`，省一次 LLM |
| `decide_lane` 预算 | 写入实现计划的数值门禁（建议 p95 ≤ 2s；以 eval/shadow 校准） |
| 控制面 | Route（若调用）+ AgentLoop ≥ 1–2 次 LLM；用 flash 级模型做 `decide_lane` 可配置 |
| 失败 | Fallback `canvas_agent` + 全 core plan，不进零工具 |

---

## 5. 迁移（目标态一次，交付分 PR）

| 阶段 | 内容 | 闸 |
|------|------|-----|
| **M0** | 本规格；旧 RU/CS **banner 交叉引用**；gold/eval 用例扩展（含多轮 V1） | 评审通过 |
| **M1** | ToolExposure + `build_tool_plan` + `tool_search` + 最小 deferred；explore→plan bind；**删 narrow-bind**；弱化/旁路 `classify_explore_intent` 对 bind 的裁剪 | I5–I7；explore 回归。**不宣称 V1 生产修复** |
| **M2** | `chat`→`canvas_agent`；builder 合并；统一 system prompt + **多轮上下文**；`default_chat`/`empty` 终局 → `canvas_agent`；扩展 state：`canvas_agent` / `tool_plan_loaded` / `previous_lane` | **V1–V2–V4–V6 可验收**；寒暄可空调工具；零工具 chat 下线 |
| **M3** | `decide_lane` LLM 主路径；precedence → 附录 A 短路 + LLM；`ROUTE_LLM_PRIMARY` flag | shadow/eval；**出图金标零回归**（V3/V7）。Shadow **仅采样或 staging**；生产 primary=1 后停双跑 |
| **M4** | 删 `explore_canvas_signal` 生产路径；更新 CS/RU 正文；兼容别名进入删除期 | eval 全绿（V1–V7） |

**回滚：** M3 可 `ROUTE_LLM_PRIMARY=0` 回 hard+旧 precedence（shadow 对照）。  
**明确禁止：** 以恢复零工具 `chat` 作为 M1/M2 回滚默认。

**V1 时间线（D6）：** M1 不足以修「再导一次」；须 M2（有工具默认 lane + 多轮上下文）。M3/M4 改善选路质量与删词表，不是 V1 的最早闸门。

---

## 6. 验收用例

| # | 输入 | 期望 | 最早闸门 |
|---|------|------|----------|
| **V1** | 「再导一次，这次也是全部导出。」（**多轮**：上轮已导出） | `canvas_agent` + `export_media_package` | **M2** |
| **V2** | 「你好」 | `canvas_agent`，0 tool 也可 | M2 |
| **V3** | 「帮我生成一张主图…」 | graph atomic（或等价）；visible 无 gen | M3（hard 短路在 M1–M2 仍可由旧 precedence 保） |
| **V4** | workflow JSON +「弄到画布上」 | `import_workflow`（无名词表依赖） | M2（须已进 agent；M1 仅当已 explore） |
| **V5** | `tool_search` 指向 deferred；**同 turn** 可调 | 加载并当轮可调 | M1 |
| **V6** | 任意 `canvas_agent` turn | `run_image_generation` ∉ visible | M1 |
| **V7** | hard `media_create_high`（或附录 A 等价） | **不经** LLM 改写为 agent；或 shadow 记录短路 | M3 |

`eval-route-set`（及 explore/agent 测试）必须覆盖 V1–V7；**先绿再删** `explore_canvas_signal` 生产路径。

---

## 7. 退役清单（关键词 / 窄绑 / 零工具）

| 项 | 动作 | 阶段 |
|----|------|------|
| `explore_canvas_signal` 名词∧动词门槛 | **Retired** — 生产路径已删（可留 test fixture） | M4 |
| `select_narrow_write_tools` / ≤5 关键词窄绑（含 import 词绑） | **Retired** | M1 |
| `test_explore_narrow_bind` 等词表单测 | 改为 plan/exposure / 同 turn search 测 | M1 |
| `classify_explore_intent` 作为 **bind 裁剪** 的词表路径 | 退役；默认全 visible / open_query | M1 |
| 零工具 `chat` 节点语义 | 合并入 `canvas_agent` | M2 |
| `default_chat` / `empty` 终局 → 零工具 | 改为 `canvas_agent` | M2 |
| `MANDATORY_INTENTS`（ui/lifecycle/asset） | **不**因本规格强制删除；另开评估是否保留结构快路径 | 可选 |
| 文档中「LLM as Parser, Not Router」作 L0 铁律 | banner + 本 ADR；M4 正文修订 | M0/M4 |

---

## 8. 文档与命名债（P2）

- 更新 CS-3：`explore_canvas` → `canvas_agent` + ToolPlan；**CS-4 不变**。  
- 标注 Phase 2b narrow-bind / explore noun 表为 **Retired**（已落地 M1/M4）。  
- `flow_mode` 三名合一：兼容期（M2–M4）→ 删除期（M4+1 版本可清别名）。  
- `AgentRuntimeState`：补 `canvas_agent`（及过渡别名）、`tool_plan_loaded`、`previous_lane`（或等价 RouteContext 字段）。  
- 与 intent-planning-guard Phase C：**`decide_lane` = L1 主路径落地**，关闭「另一套 LLM 路由」分叉。  
- 2026-08-09 / CS 文首加「部分 L0 条款由 2026-09-14 修订」banner。

---

## 9. 风险与开放问题

| 风险 | 缓解 |
|------|------|
| 出图误进 agent | H6 + 附录 A + V3/V7 |
| `decide_lane` 延迟/费用 | 短路跳过；flash 模型；p95 门禁 |
| visible 工具过多 | 最小 deferred + search；监控 token |
| 与旧 precedence 行为漂移 | M3 shadow（采样）+ eval-route-set |
| 两套叙事（RU vs Phase C） | 本文件 ADR + 旧文 banner |
| M1 被误认为已修 V1 | D6 + §5 时间线 |
| Agent 无多轮导致 V1 空转 | D7 + §3.6 |
| Shadow 双跑成本 | 仅采样/staging；primary 后停 |

**开放（实现计划阶段再钉死数值）：** `τ`、p95 具体阈值、`decide_lane` 模型 id、deferred 最终名单微调、mandatory 三件套去留。

**可知会（P2，plan 细化）：** `decide_lane` 与 Agent 可不同模型；`empty_utterance` 合并后短回复策略；`RouteContext.previous_lane` 注入细节。

---

## 10. Spec 自检

- [x] 无 TBD 充数（开放项集中在 §9）  
- [x] R1 ADR + small action space 张力已写明  
- [x] P0：V1=M2、多轮强制、附录 A、同 turn re-bind  
- [x] P1：引用笔误、classify/mandatory 澄清、meta placement、shadow、state、旧文 banner  
- [x] CS-4 / H1 一致  
- [x] 第二轮审核补丁已并入  

---

## 11. 下一步

1. ~~用户批准本文件~~ **已批准**  
2. Implementation plan：`docs/superpowers/plans/2026-09-14-codex-style-tool-plan-harness.md`  
3. 实现从 M1 起；**V1 验收不早于 M2**；M3 flag；M4 删词表生产路径。

---

## 附录 A — `HARD_SHORTCIRCUIT_RULE_IDS`（有序）

派生自现网 `PRECEDENCE_RULES`（`route_precedence.py`）。**列入 = 可跳过 `decide_lane` 的确定性短路**（命中即采用该规则原 `flow_mode`）。实现时以常量表 + 单测锁定顺序；增删须 eval-route-set。

| 顺序 | rule_id | 保留为 hard？ | 说明 |
|------|---------|---------------|------|
| 1 | `modify_existing_plan` | ✅ | |
| 2 | `regen_no_checkpoint` | ✅ | |
| 3 | `sidebar_img2img` | ✅ | |
| 4 | `checkpoint_regen` | ✅ | |
| 5 | `product_visual_explicit` | ✅ | |
| 6 | `product_visual_intent` | ✅ | |
| 7 | `ref_backed_generate` | ✅ | |
| 8 | `focus_gen` | ✅ | |
| 9 | `explicit_skill_orch` | ✅ | |
| 10 | `orch_ambiguous` | ✅ | → clarify |
| — | **`explore`** | ❌ | 名词/explore 信号；**不得** hard；改由默认 agent / LLM |
| 11 | `atomic_generate` | ✅ | 含 `media_create_high` 等 |
| 12 | `suspected_vision_clarify` | ✅ | → clarify |
| 13 | `suspected_media_clarify` | ✅ | → clarify |
| 14 | `sidebar_media_question` | ✅ | 现网常 clarify/agent 边界；实现时保持原 flow，但 **不**经 explore 词表 |
| — | **`empty`** | ❌ | 改为 `canvas_agent`（M2） |
| — | **`default_chat`** | ❌ | 改为 `canvas_agent`（M2）；M3+ 可由 LLM 覆盖 |

`clarify_resume`（pending clarify 回复）保持 intake 前置特殊路径，不纳入上表竞争，但 **优先于** `decide_lane`。

**禁止：** 将 `_rule_explore` / `explore_canvas_signal` 重新标成 hard「快捷通道」——那会把名词门闩变相保留。