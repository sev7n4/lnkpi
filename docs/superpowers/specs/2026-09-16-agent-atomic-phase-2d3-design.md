# Agent Atomic Phase 2d.3 — 激进清扫（字面量 / soft 改名 / 兼容垫片）

> 日期：2026-09-16  
> 状态：**已批准**（方案 C + 审核补丁）；**执行令开至 Phase 2d.3（本档）**；垫片删除标 2d.4；Phase 3 另开  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md)  
> 前置：[2026-09-15-agent-atomic-phase-2d2-design.md](./2026-09-15-agent-atomic-phase-2d2-design.md)（子图清尸；G1–G8 已合入生产）  
> 实现 plan：[../plans/2026-09-16-agent-atomic-phase-2d3.md](../plans/2026-09-16-agent-atomic-phase-2d3.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **2D3-D1** | 目标：类型 / ALLOWED / prompt **不再出现**可写入的退役 `flow_mode`/`lane` 字面量；soft 信号**改名去 atomic 前缀**，语义保留 |
| **2D3-D2** | 删除死代码：`classify_atomic_confirm`、`clarify_atomic_intent.py`、仅服务旧 gate 的 `step_copy` 条目 |
| **2D3-D3** | `RouteFlowMode`、`AgentRuntimeState.flow_mode` Literal、`intent_parse_*` 路由集合、decide_lane prompt：**去掉** `atomic_create` / `atomic_regenerate` / `single_node` |
| **2D3-D4（双层）** | **公开面清零**（D3）；**运行时兼容垫片** `_LEGACY_LANE_SHIM`：若输入仍为三旧字面量 → 映射 `canvas_agent` + 日志；**不**进 ALLOWED、**不**进类型。垫片删除标 **2d.4** |
| **2D3-D5** | Soft 信号改名（行为不变）；见 §0 改名表。`atomic_create_intent` **删除对外 API**，唯一入口 `utterance_suggests_media_create` |
| **2D3-D6** | regen / `checkpoint_regen` 进 `canvas_agent` 时清脏 `split_manifest`（复用 intake 已有清空模式） |
| **2D3-D7** | `has_atomic_checkpoint` → `has_regen_checkpoint`；保留 `atomic_node_id` / `atomic_spec`（或本档同步改名为 `regen_*` 字段别名——**优先改 feature 名，字段可暂留并注释**）；HITL 仍识别 legacy `await_atomic_confirm` **字符串**作 G6 安全出口 |
| **2D3-D8** | **不纳入：** campaign/PV 工具化、技能目录 `skills/atomic-create/` 改名、`AtomicIntent` / `atomic_intent.py` 整包改名、前端、Phase 3、自动迁 checkpoint 内容 |

### 改名表（钉死）

| 旧 | 新 |
|----|-----|
| `utterance_suggests_atomic_create` | `utterance_suggests_media_create` |
| `intent_suggests_atomic_create` | `intent_suggests_media_create` |
| `atomic_create_intent` | **删除**（调用方改走 media_create） |
| `atomic_regenerate_intent` | `regen_intent` |
| `single_node_gen_intent` | `focus_gen_intent`（允许短暂 deprecate 别名，同 PR 删对外） |
| taxonomy `atomic_create_hints` | `media_create_hints` |
| taxonomy routes 中 atomic/single 的 `flow_mode` | **删除或标 soft-only**，不得当路由 SSOT |
| feature `has_atomic_checkpoint` | `has_regen_checkpoint` |

---

## 1. 背景

2d.2 已使子图不可达，但残留：

1. 类型与 LLM schema 仍列出退役 lane（易被模型「合法输出」）。  
2. Soft 信号仍带 `atomic_*` 命名，与终局 B 叙事冲突。  
3. `_RETIRED_LANES_TO_AGENT` 与公开 ALLOWED 混在一起，边界不清。  
4. regen→agent 不清 `split_manifest`，mixed-canvas 可能脏上下文。  
5. 死代码：`classify_atomic_confirm`、clarify 薄包装、step 文案。

父规格允许 soft 保留；本档选择 **改名 + 类型清零 + 垫片**，强于「仅删死代码」的 B。

---

## 2. 钉死规则

1. **类型清零**  
   - `RouteFlowMode` / `state.flow_mode` Literal 仅保留存活模式（至少含 `canvas_agent`、`campaign`、`product_visual`、`clarify_route` 及现网仍用的其它非退役值）。  
   - `intent_parse_schema` / `intent_parse_llm` 提示与 ALLOWED route 集合同步去掉三字面量。

2. **兼容垫片（D4）**  
   - 在 `decide_lane` parse/postprocess（及任何仍接受外部 lane 字符串处）：三旧名 → `canvas_agent` + info 日志。  
   - 垫片**不是** ALLOWED 成员；测试断言「旧字符串输入 → agent」，并断言 ALLOWED 不含旧名。  
   - **禁止**恢复子图分发。

3. **Soft 改名**  
   - 按改名表全仓更新 app + tests + skills YAML（hints）。  
   - 合入门禁：`rg` 在 `services/agent-runtime` 禁止旧函数名（允许 `docs/` 与历史设计文；测试字符串若必须出现旧 lane 仅用于垫片夹具）。

4. **taxonomy**  
   - `intake_priority` 中指向 atomic/single 的 route 行删除或改为注释性 soft；**不得**被代码当 SSOT 写 `flow_mode`。  
   - `media_create_hints` 替换 `atomic_create_hints` 键；加载处同步。

5. **split_manifest 卫生**  
   - 当 precedence 命中 `checkpoint_regen`（或等价 regen→`canvas_agent`）时，intake/决策后清空 `split_manifest`（及与 2d 裸生成清空同级的 campaign 脏字段，若已有模式则复用）。  
   - 不自动改写用户画布节点。

6. **死代码**  
   - 删除 `classify_atomic_confirm`、`nodes/clarify_atomic_intent.py`、`step_copy` 中旧节点文案键。  
   - G6：`RETIRED_INTERRUPT_GATES` / `await_atomic_confirm` **字符串检测保留**。

7. **非目标**  
   - 不改名 `skills/atomic-create/`、`atomic_intent.py`、`AtomicIntent`。  
   - 不删 campaign/PV；不开 Phase 3。

8. **回滚**  
   - 紧急：恢复垫片已足够（默认就有）；类型字面量可临时加回 TypedDict（不恢复子图）。  
   - **永不**把 `run_*` 放进 visible；**永不**静默对旧 await 扣费。

---

## 3. 验收硬表 §6.0.8（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **H1** | `ALLOWED_LANES` / `RouteFlowMode` / state `flow_mode` Literal | **不含**三退役字面量 |
| **H2** | 垫片：输入 lane=`atomic_create`/`atomic_regenerate`/`single_node` | 输出 **`canvas_agent`**（日志可观测） |
| **H3** | `rg` 旧函数名（`utterance_suggests_atomic_create`、`atomic_regenerate_intent`、`atomic_create_intent`、`classify_atomic_confirm` 等）于 `app/` | **零命中** |
| **H4** | taxonomy：无 intake SSOT 再写退役 `flow_mode` | 加载路径不产出退役 flow |
| **H5** | regen / `checkpoint_regen` → agent | `split_manifest` 为空（或等价已清） |
| **H6** | G6 回归：legacy `await_atomic_confirm` | 仍无计费 goto |
| **H7** | `build_tool_plan().visible_names` | 仍无 `run_image_generation` / `run_video_generation` |
| **H8** | 生产冒烟 | 裸生成 / regen 口语 → `canvas_agent`（或 clarify）；无 atomic 子图 step；确认前无扣费 |

**本档明确不验收：** 技能目录改名、IR 文件改名、垫片删除、campaign/PV 改造、历史 checkpoint 内容迁移率。

---

## 4. 回滚

- 保留垫片即可吸收旧模型输出。  
- 类型字面量紧急加回不恢复子图注册。  
- **永不**恢复 `run_*` visible / 静默扣费。

---

## 5. 后续（未授权）

- **2d.4：** 删除 `_LEGACY_LANE_SHIM`（确认生产日志无旧 lane 一段时间后）。  
- **Phase 3：** campaign / product_visual 工具化。

---

## 6. 与父规格 / 2d.2 关系

| 项 | 本文件 |
|----|--------|
| 父 soft 信号可留 | 本档 **改名保留语义** |
| 2d.2 G4 子图不可达 | 不变；本档清类型与命名 |
| 2d.2 记账的 split_manifest | H5 |
| D9 执行令 | 开至 **2d.3**；Phase 3 / 2d.4 另开 |
| 审核补丁 | (1) D4 双层垫片 (2) State 字段边界 (3) 改名不做目录级 |

---

## 7. 自检（写档时）

- [x] 无 TBD 阻塞合入门禁  
- [x] D4 与「去掉映射」的纯 C 已用垫片消解矛盾  
- [x] 未滑入 Phase 3 / 技能目录改名  
- [x] G6 安全出口明确保留  
