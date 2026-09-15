# Agent 原子创作工具化（Canvas Operator + Propose/Confirm）

> 日期：2026-09-14  
> 状态：**已批准**（2026-09-14；终局 B；执行令开至 **Phase 2c.3**；2d/3 另开 plan 门禁）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 上级：Hybrid A / CS（[2026-08-08-agent-canvas-control-surface-design.md](./2026-08-08-agent-canvas-control-surface-design.md)）  
> 相关：[2026-09-14-codex-style-tool-plan-harness-design.md](./2026-09-14-codex-style-tool-plan-harness-design.md)、[2026-08-09-sidebar-ref-image-routing-design.md](./2026-08-09-sidebar-ref-image-routing-design.md)  
> **修订声明：** 本规格将 **终局** 定为「原子创作由 `canvas_agent` 工具完成（Propose/Confirm）」，**修订** 2026-09-14 harness 中「出图只经 atomic 子图主路径 / hard `atomic_generate` 必短路」的交付假设；**不**开放模型直接调用计费 `run_*_generation`。

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **D1** | **终局选 B**：单点图/视频/文案/音频创作，不再以 `flow_mode=atomic_create` LangGraph 子图为主路径；改由 **`canvas_agent` 语义理解 + 画布工具** 完成摆盘与待确认提交 |
| **D2** | **保留 HITL**：agent 只能「创建/填参/连线/`propose_generation`」；**真正扣积分的 `run_*_generation` 永不进 `model_visible_specs`**，须用户确认（对话卡或节点 dock）后由 Nest 执行 |
| **D3** | **画布节点为 SSOT**；对话确认卡只是快捷入口，确认后 **等同** 点节点生成（同一 Nest 执行路径） |
| **D4** | **规格覆盖 Phase 2 + Phase 3**；**实施门禁：先完成 Phase 2 并测稳，再开 Phase 3** |
| **D5** | Phase 2 战术节奏：**2a → 2b → 2c → 2d**（先拆 hard/precedence 假阳性，再工具化，再统一确认执行，最后 deprecate atomic 主路径）；禁止一步删子图 |
| **D6** | Phase 3（规格原则）：`campaign` / `product_visual` 等大编排逐步工具化 / skill 多步任务；本文件 **不** 钉死 Phase 3 工具 API |
| **D7** | 不回到 A 终局（永久保留 atomic 子图与 agent 双宇宙）；A 仅可作为 2a 过渡形态 |
| **D8** | 相对 harness：**修订 CS-4 表述**——禁止的是 **计费执行工具**（`run_*` / destructive），允许 **propose / 画布突变** 工具进 visible |
| **D9** | **执行令：** Phase 2a/2b/2c.1/2c.2 **已完成**；**Phase 2c.3 已授权**（[2c 规格](./2026-09-14-agent-atomic-phase-2c-design.md) §3 + [2c.3 plan](../plans/2026-09-14-agent-atomic-phase-2c3.md)）。2d/3 另开 plan |

### 0.1 与 2026-09-14 Tool Plan Harness 的关系

| Harness 原假设 | 本规格 |
|----------------|--------|
| 出图 → hard / atomic 子图；visible 无 gen | **修订终局**：出图意图 → `canvas_agent` 摆盘 + `propose_generation`；visible 仍无 `run_*` |
| H1/H2：计费生成只经确定性子图 | **收窄**：计费 **执行** 仍只经 Nest 确定性路径；**进入** 该路径的提议可由 agent 工具发起 |
| 附录 A / precedence `atomic_generate` | **Phase 2a：整条退出** hard 与默认 precedence 竞争（例外表默认为 **空**） |
| harness **V7**（`media_create_high` 不得改写为 agent） | **本规格废止 V7 作为出图主路径约束**；2a PR 必须给 harness 加 banner |
| `decide_lane` 可选 `atomic_create` | Phase 2d 起：**删除或恒映射到 `canvas_agent`**，禁止第三扇门 |

> 一句话：理解与摆盘交给 agent；扣积分执行交给用户确认后的 Nest；hard/词表不再冒充理解器。

### 0.2 Phase 2a 钉死项（批准时锁定）

1. **`atomic_generate` 整条退出** `HARD_SHORTCIRCUIT_RULE_IDS` **且** 不再作为 `apply_route_precedence` 可命中规则（生产默认 `ROUTE_LLM_PRIMARY=0` 也走 precedence）。  
2. **例外表默认为空**；新增例外必须单独金标 + 变更单，禁止在 2a 顺手加回词表。  
3. **`media_create_high` / `utterance_suggests_atomic_create` 可保留为 soft feature**（供日后 tool_plan 提示），**不得**单独决定 `flow_mode=atomic_create`。  
4. **2a 必须审计兄弟规则**：凡依赖上述 soft 信号或「裸媒介词」的 hard/precedence 规则（如 `ref_backed_generate`、`focus_gen`、`sidebar_img2img`、`suspected_media_clarify`）——记录是否仍误切工作流口语；2a 只改导致假阳性的规则，不扩大到 Phase 3 范围。  
5. **子阶段金标**见 §6.0 / **§6.0.1 硬表**；不得用 2b 标准宣称 2a 完成。

---

## 1. 背景与问题

生产对话（deepseek-v4-pro 偏好生效后）仍出现：

> 「我期望…骨架连接好直接生图生视频，提示词自动填入到 dock」  
> → precedence/hard `atomic_generate`（`media_create_high`，因裸词「视频」等）  
> → 单节点原子视频「基于引用内容生成视频」+ `await_atomic_confirm`

根因：

1. `utterance_suggests_atomic_create` / `VIDEO_KEYWORDS` 等把 **讨论视频能力/工作流** 当成 **立即原子创作**。  
2. Hard/precedence 排在语义理解之前，模型 **没有机会** 解读意图。  
3. 生产默认 `LNKPI_ROUTE_LLM_PRIMARY=0` 走全量 precedence——**仅改 HARD 列表不够**，必须同时拿掉 precedence 竞争。

用户产品意图是 **Canvas Operator**（多节点骨架、连线、dock 填参、再确认生成），不是对话内嵌的原子生视频流水线。

专家结论（已确认）：**终局坚持 B 合理**；战术必须分阶段；本批准只执行 2a。

---

## 2. 目标、非目标与硬不变量

### 2.1 目标

1. 歧义/工作流/编排口语默认进 **`canvas_agent`**，由模型选型工具。  
2. 单点「帮我生成一张…」也走 agent：**建节点 → 填参 → propose**，不再进 atomic 子图主路径（Phase 2d 后）。  
3. 统一 HITL：确认卡 ≡ 节点生成；计费只发生在确认之后。  
4. 消灭「裸媒介词 → atomic」假阳性。  
5. 规格预留 Phase 3：大编排子图工具化（实施后置）。

### 2.2 非目标

- 模型直接调用 `run_image_generation` / `run_video_generation`（或任何扣积分 gen）  
- 用更大动词/名词表「修补」裸「视频」  
- Phase 2 未稳即改 campaign / product_visual 主路径  
- 本规格内重写前端 undo 栈或计费账本  
- 在 2a 中实现 `propose_generation` 或删除 atomic 子图代码  

### 2.3 硬不变量

| ID | 规则 |
|----|------|
| **H1** | `run_*_generation`、destructive、未审批的 graph_batch **永不**进入 `model_visible_specs` |
| **H2** | 扣积分只发生在用户确认（卡或 dock）之后，经 Nest 执行路径 |
| **H3** | 画布节点为生成意图与参数的 SSOT；确认卡不得持有与节点冲突的第二套真相 |
| **H4** | 副作用仍走 NestCanvasClient / `canvas_command` SSE（CS-9） |
| **H5** | Phase 2 完成前，不得删除 Nest 计费/生成 API；只改 **谁发起 propose** |
| **H6** | Phase 3 开工前，Phase 2 金标（§6.1）必须全绿且生产复测通过 |

### 2.4 误路由代价（指导收紧 hard）

| 失败模式 | 代价 | 策略 |
|----------|------|------|
| 工作流口语 → 原子单节点 | 高（产品错形态） | 2a 拆 `atomic_generate`；金标锁定 |
| 明确出图 → 只闲聊不摆盘 | 中 | 2b+ eval + tool 描述；2a 接受暂进 `canvas_agent` |
| propose 后模型空转求 `run_*` | 中 | 2b+ 工具描述；propose 成功后倾向收束 |
| 双路径（atomic 与 agent 并存） | 高（不可解释） | 2d 关掉 `atomic_create` 主路径竞争 |

---

## 3. 目标架构

```
User utterance
    │
    ▼
RouteDecide（收紧后）
    ├─ 极窄 hard（附录 A'；2a 起无 atomic_generate）──► campaign/PV 等（Phase 2 期间暂留）
    └─ 默认 canvas_agent
            │
            ▼
     ToolPlan（core ∪ deferred ∪ meta）
            │  2b+：节点 CRUD / 填 dock / 连线 / propose_generation
            │  不含：run_*_generation
            ▼
     AgentLoop（语义选型）
            │
            ├─ 摆盘工具 ──► 画布 SSOT 更新
            └─ propose_generation(node_id) ──► 节点待生成态 + 对话确认卡
                        │
                        ▼（用户确认）
                 Nest 同一执行路径（≡ 节点 dock 生成）──► run_* / 扣积分
```

### 3.1 工具暴露（修订后的能力分层）

| Exposure | 含义 | 进 visible？ | 例 |
|----------|------|--------------|-----|
| `core` / `deferred` | 画布突变与提议 | 是（deferred 可搜） | upsert 图/视频节点、填 prompt、连线、`propose_generation` |
| `meta` | 元工具 | 是 | `tool_search` |
| `graph_only` | 计费执行 / 破坏性 | **否** | `run_image_generation`、`run_video_generation`、destructive |

### 3.2 `propose_generation` 契约（原则；**2b 钉死细节**）

- 输入：已存在的 `node_id`（可批量，Phase 2 至少支持单节点）。  
- 前置：节点具备可生成的最小参数（模态、prompt/引用策略、模型偏好可回退 default）。  
- 效果：节点进入「待用户确认生成」；SSE/事件发出 **确认卡**（参数摘要 + 积分预估若可得）。  
- **不**调用 `run_*`。  
- 用户确认或 dock 生成 → 同一 Nest handler。

实现可将现有 atomic 创建/确认逻辑 **降为工具后端**，避免平行实现两套建节点代码。

---

## 4. Phase 2 实施节奏（强制顺序）

### 4.1 Phase 2a — 拆 `atomic_generate` 假阳性（**本批准可执行**）

- `atomic_generate` 退出 HARD **与** 默认 precedence 竞争；例外表空。  
- Soft feature 可保留，不驱动 `flow_mode=atomic_create`。  
- 审计兄弟规则；只修工作流口语假阳性所需最小集。  
- Harness / CS 文档 banner。  
- **验收：** §6.0 的 2a 金标（不是完整 V1 多节点）。

### 4.2 Phase 2b — Canvas Operator 工具面（另开 plan）

- 补齐摆盘工具 + `propose_generation`（名称/批量语义在 2b plan 钉死）。  
- System/tool 文案：不可 `run_*`；工作流应多节点。

### 4.3 Phase 2c — HITL 统一（切片；详见 2c 规格）

- 确认卡 ≡ 节点 dock 生成；同一 Nest 路径；节点态为断线恢复 SSOT。  
- **切片：** [2c 规格](./2026-09-14-agent-atomic-phase-2c-design.md) — **2c.1** 最小 SSOT（已授权）→ 2c.2 完整卡 → 2c.3 弱化 atomic UX；硬表见该文 §6.0.3 / 各子 plan。

### 4.4 Phase 2d — Deprecate atomic 主路径（另开 plan）

- `flow_mode=atomic_create` / `await_atomic_confirm` 退出路由竞争。  
- `decide_lane` 的 `atomic_create` 删除或映射 `canvas_agent`。

**回滚：** 2a 可用 flag/`atomic_generate` 临时加回 precedence（仅紧急）；禁止回滚到「零工具 chat」。

---

## 5. Phase 3（规格原则，实施后置）

| 项 | 原则 |
|----|------|
| 范围 | `campaign` / `product_visual` 等大编排：由 skill + agent 多步任务驱动，逐步退出「hard → 专用子图」为主路径 |
| HITL | 贵操作与方案选择仍要确认；节点 SSOT |
| 计费 | 仍禁模型直接 `run_*` |
| 开工门禁 | Phase 2 §6.1 金标全绿 + 生产复测通过 + 单独 implementation plan |
| 本文件 | **不**规定 Phase 3 工具名单与状态机细节 |

---

## 6. 验收金标

### 6.0 按子阶段拆分（强制）

| 子阶段 | 最低金标 |
|--------|----------|
| **2a** | 见下方 **§6.0.1 硬表**（无 `or`、无「迹象」） |
| **2b+** | 见 **§6.0.2**（本阶段合入门禁）；完整 V1–V4 在 2b+2c 后宣称 |
| **2c.1** | 见 [2c 规格 §6.0.3](./2026-09-14-agent-atomic-phase-2c-design.md)（pending SSOT 恢复 / Nest 取消） |
| **2c.2** | 见 [2c 规格 §6.0.4](./2026-09-14-agent-atomic-phase-2c-design.md)（generation_propose presentation；积分可选） |
| **2d** | V6 双路径关门 |

#### 6.0.2 Phase 2b 验收硬表（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **B1** | `build_tool_plan().visible_names` | 含 `propose_generation`、`upsert_media_node`；**不含** `run_image_generation` / `run_video_generation` |
| **B2** | `connect_nodes` | agent-visible（CORE）；单次 ≤20 edges |
| **B3** | `propose_generation`（单测/mock） | 节点进入 pending；**零** `run_*` 调用 |
| **B4** | `upsert_media_node` | 返回 `nodeId`；图像/视频节点可建 |
| **B5** | tool/system 文案 | 禁止模型调 `run_*`；先 propose 再等人确认 |
| **B6** | 路由回归 | WORKFLOW / 「帮我生成一张…」仍 `canvas_agent` |
| **B7** | 确认执行 | 确认卡触发与 **dock 相同** Nest 生成入口（按 `nodeId`），不走 `atomic_create` 路由 |
| **B8** | 无 prompt propose | 报错；不 pending；不 run_* |
| **B9** | 生产冒烟 | 显式出图句 → agent 摆盘/propose 证据；无原子「基于引用内容…」卡 |

**2b 钉死项：** 工具名 `propose_generation`；单 `node_id`；`upsert_media_node`；`connect_nodes` 可见且封顶 20；积分预估可选。

#### 6.0.1 Phase 2a 验收硬表（合入门禁）

固定金标句 `WORKFLOW`：

> 我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock

| ID | 检查 | 唯一期望 | 断言层 |
|----|------|----------|--------|
| **A1** | `"atomic_generate" in HARD_SHORTCIRCUIT_RULE_IDS` | **False** | 单测 |
| **A2** | `apply_hard_shortcircuit(WORKFLOW)` | **`None`** | 单测 |
| **A3** | `apply_route_precedence(WORKFLOW)["flow_mode"]` | **`canvas_agent`** | 单测 |
| **A4** | `apply_route_precedence(WORKFLOW)["precedence_rule_id"]` | **`default_chat`**（或其它非 atomic 的 sink；**禁止** `atomic_generate` / 任一 `flow_mode=atomic_create`） | 单测 |
| **A5** | `decide_route(WORKFLOW, route_llm_primary=False)["flow_mode"]` | **`canvas_agent`** | 单测（生产默认路径） |
| **A6** | `decide_route("帮我生成一张蓝色天空主图", route_llm_primary=False)["flow_mode"]` | **`canvas_agent`** | 单测（2a **不要求** propose/建节点） |
| **A7** | `apply_route_precedence("@T1 请基于文案生成视频", mentioned_keys=["T1"])["precedence_rule_id"]` | **`ref_backed_generate`** | 单测（兄弟 KEEP） |
| **A8** | `decide_route("你好", route_llm_primary=False)["flow_mode"]` | **`canvas_agent`** | 单测 |
| **A9** | 任意 `build_tool_plan` / explore bind | `run_image_generation` / `run_video_generation` **∉** visible | 已有 harness 测可复用；2a 不改暴露则回归即可 |
| **A10** | 生产冒烟：`WORKFLOW` + 用户 `defaultTextModel` 作 `model` | SSE `route_decision.flow_mode=canvas_agent`；**无**「基于引用内容生成视频」原子确认卡；**无** `await_atomic_confirm` 步骤文案 | 人工/脚本；合入后 |

**2a 明确不验收：** 多节点骨架、连线、dock 填参、`propose_generation`、确认卡≡dock、删除 atomic 子图代码。

**A4 收紧说明：** 实现后若 sink 不是 `default_chat` 而是其它非 atomic id，允许改期望 id，但 PR 必须写明；**不得**用 `flow_mode != atomic_create` 单独充当 A3/A5 的唯一断言（必须正向断言 `canvas_agent`）。

### 6.1 Phase 2 全量（2d 完成后）

| ID | 用例 | 期望 |
|----|------|------|
| **V1** | 「搭节点骨架，生图生视频，提示词自动填入 dock」 | `canvas_agent`；多节点/连线/填参迹象；**不**进原子单节点视频确认流水线 |
| **V2** | 「帮我生成一张蓝色天空产品主图」 | agent 建图节点 + propose（或等价待确认）；确认前无扣积分 gen |
| **V3** | 任意 `canvas_agent` turn | `run_image_generation` / `run_video_generation` ∉ visible |
| **V4** | 确认卡确认 ≡ dock 生成 | 同一 Nest 执行路径（单测或集成断言） |
| **V5** | 「你好」 | 仍 `canvas_agent`，非 atomic |
| **V6** | Phase 2d 后 | 路由层不再出现可竞争的 `atomic_create` 主路径 |

### 6.2 Phase 3（后置，占位）

- 大编排口语不误进单点 atomic（在 2 已保证基础上）。  
- Skill 多步任务可完成方案级摆盘 + 分段 HITL（细则另开 plan）。

---

## 7. 附录 A' — Hard 短路（Phase 2a 后）

| rule | Phase 2a 态度 |
|------|----------------|
| **`atomic_generate`** | **退出 HARD 与 precedence 竞争**；例外表 **空** |
| `product_visual_*` / `explicit_skill_orch` / campaign 相关 | **暂留**（Phase 3） |
| `ref_backed_generate` / `focus_gen` / `sidebar_img2img` | **审计**；无工作流假阳性则暂留；有则最小修复并写测 |
| `suspected_media_clarify` / `suspected_vision_clarify` | 保持 clarify，不升为 atomic |
| `explore` / `empty` / `default_chat` | 仍 **不得** hard |

**禁止**把 `VIDEO_KEYWORDS` 整表恢复为 hard/precedence 出图门闩。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 仅改 HARD、生产 primary=0 仍走 precedence | 2a **同时**拆 precedence 竞争（D9/§0.2） |
| Agent 仍只建单视频节点 | 2b+ V1；2a 只要求不进 atomic |
| HITL 迁移丢状态 | 2c；2a 不碰 |
| 双路径并存 | 2d 关门；2a–2c 接受过渡态 |
| 明确出图暂无 propose | 2a 接受进 canvas_agent；2b 补齐 |
| Phase 3 范围膨胀 | 本规格只写原则 |

---

## 9. 文档与 ADR 后续

- **2a PR 必做：** harness 规格 banner：出图主路径终局见本文件；**废止 V7 作为硬约束**；H1 收窄为「禁 run_* visible」。  
- CS-4 控制面：2a banner「计费 run_* 仍禁 bind；摆盘/propose 见本规格（2b+）」。  
- `intent-taxonomy` / `utterance_suggests_atomic_create`：降为 soft；2a 起不得驱动 `flow_mode=atomic_create`。

---

## 10. 开放项

| 项 | 何时钉 |
|----|--------|
| `propose_generation` 最终工具名与批量语义 | **2b plan 前** |
| 积分预估是否强制出现在确认卡 | 2b/2c plan |
| 旧 atomic 子图代码删除时间表 | 2d 后可晚于路由关门 |
| Phase 3 生产流量门槛 | Phase 3 plan |
| 2a 兄弟规则审计结论 | **2a 实现中记录；若需改规则则同 PR** |

---

## 11. 批准记录

| 项 | 内容 |
|----|------|
| 批准日 | 2026-09-14 |
| 终局 | B（Canvas Operator + Propose/Confirm） |
| HITL | 保留；确认卡 ≡ 节点生成 |
| 规格范围 | Phase 2 + Phase 3 原则 |
| **执行令** | **仅 Phase 2a**（[2026-09-14-agent-atomic-phase-2a.md](../plans/2026-09-14-agent-atomic-phase-2a.md)） |
| 专家审核 | 有条件批准意见已吸收（§0.2 / §6.0 / 兄弟规则审计 / harness banner） |
