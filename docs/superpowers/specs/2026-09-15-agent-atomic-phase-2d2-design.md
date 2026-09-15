# Agent Atomic Phase 2d.2 — 子图清尸 + regenerate/single_node 路由关门

> 日期：2026-09-15  
> 状态：**已批准**（方案 B + 审核补丁）；**执行令开至 Phase 2d.2（本档）**；Phase 3 / 字面量清零另开  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md) §4.4 / 开放项「子图删除」/ D9  
> 前置：[2026-09-15-agent-atomic-phase-2d-design.md](./2026-09-15-agent-atomic-phase-2d-design.md)（V6 路由关门；F1–F7 已合入生产）  
> 实现 plan：[../plans/2026-09-15-agent-atomic-phase-2d2.md](../plans/2026-09-15-agent-atomic-phase-2d2.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **2D2-D1** | 目标：图上**不可达** `atomic_create` / `atomic_regenerate` / `single_node` 子图主路径；出图/改图只走 `canvas_agent` + 2c propose/dock |
| **2D2-D2** | 卸 `register_atomic_create_gate`；同步卸挂在其上的 regenerate 节点入口；`route_after_intake` 不再分发到 `parse_atomic_intent` / `prepare_atomic_regenerate` |
| **2D2-D3** | 卸 `register_single_node_gate`（intake 永不进 `prepare_single_gen`）；`focus_gen` **保留 rule id**，`flow_mode` → `canvas_agent` |
| **2D2-D4** | `checkpoint_regen` **保留 rule id**，`flow_mode` → `canvas_agent`（不再 `atomic_regenerate`） |
| **2D2-D5** | `decide_lane`：从 ALLOWED 去掉 `atomic_regenerate` / `single_node`；残留输出（含历史 `atomic_create`）强制映射 `canvas_agent` |
| **2D2-D6** | **不做自动 checkpoint 迁移**；命中旧 `await_atomic_confirm` resume → 安全结束/转 agent，**禁止**静默 `run_atomic_gen` 扣费 |
| **2D2-D7** | 源码：本 PR **可归档/删除** create+regen 子图节点与 `atomic_create_gate.py` / `single_node_gate.py`；`RouteFlowMode` 等字面量**可暂留**（跟进清），禁止生产路径再写入 |
| **2D2-D8** | **不纳入：** campaign / PV、Phase 3、前端大改、自动迁历史 thread、类型字面量清零 |
| **2D2-D9** | **`single_node` 是 H2 硬修复**：`prepare_single_gen` 设 `user_decision=confirm_gen` + `auto_generate` 并直连共享 `start_gen`，可跳过确认扣费；remap 非「顺便」 |

---

## 1. 背景（2d 关门后仍存活）

2d 已使正常路由不再产出可竞争的 `atomic_create`，但：

1. **Builder 仍注册** `register_atomic_create_gate`（含 `parse_atomic_intent` / `await_atomic_confirm` / `run_atomic_gen` / `prepare_atomic_regenerate` / …）与 `register_single_node_gate`（`prepare_single_gen` → **`start_gen`**）。
2. **Precedence 仍写旧 flow：**
   - `_rule_checkpoint_regen` → `flow_mode=atomic_regenerate`
   - `_rule_focus_gen` → `flow_mode=single_node`
3. **`decide_lane` ALLOWED** 仍含 `atomic_regenerate` / `single_node`。
4. **旧 thread** 可能卡在 `await_atomic_confirm`；`hitl_resume` / `GATE_RESUME_COMMAND_GOTO` / `interrupt_before` 仍特殊对待该 gate。
5. **`has_atomic_checkpoint`** 对旧会话可为 true——特征可留，但不得再定 `atomic_regenerate` flow。

若不关，用户仍可能进入第二套确认/扣费路径；其中 **single_node 捷径直接威胁 H2**。

---

## 2. 钉死规则（批准时锁定）

1. **Builder 卸门**
   - 删除对 `register_atomic_create_gate` / `register_single_node_gate` 的调用。
   - `route_after_intake`：**禁止**再返回 `parse_atomic_intent` / `prepare_atomic_regenerate` / `prepare_single_gen`；若 state 仍带旧 `flow_mode∈{atomic_create,atomic_regenerate,single_node}`，一律落到 `explore`（`canvas_agent`）。
   - `interrupt_before` **去掉** `await_atomic_confirm`（campaign / PV 等其它 gate 不动）。

2. **Precedence remap（保 rule id）**
   - `_rule_checkpoint_regen`：`flow_mode="canvas_agent"`，`precedence_rule_id` 仍为 `checkpoint_regen`。
   - `_rule_focus_gen`：`flow_mode="canvas_agent"`，`precedence_rule_id` 仍为 `focus_gen`。
   - Soft 信号（`atomic_regenerate_intent` / `single_node_gen_intent` / `has_atomic_checkpoint`）可留，**不得**单独定旧 flow。
   - `regen_no_checkpoint` → `clarify_route`：**本档可不改**。

3. **decide_lane**
   - `ALLOWED_LANES` 移除 `atomic_regenerate`、`single_node`（`atomic_create` 已在 2d 去掉）。
   - Prompt 不再教「再试一次→atomic_regenerate / 焦点生成→single_node」。
   - Postprocess：若模型仍吐出 `atomic_create` / `atomic_regenerate` / `single_node` → 强制 `canvas_agent` + 日志。

4. **HITL / checkpoint（D6；写全残留入口）**
   - `hitl_resume` 若 gate=`await_atomic_confirm`：
     - **不得** `Command(goto=run_atomic_gen)` / 不得触发计费 gen；
     - 清相关 atomic 断点字段；回复引导「请在画布节点确认生成」或转 `canvas_agent` 新回合。
   - 从 `GATE_RESUME_COMMAND_GOTO`、gate→`as_node` 映射等处**移除**对 `await_atomic_confirm` 的特殊 resume 捷径。
   - **不做** DB/thread 批量迁移。

5. **源码处置与 G4 边界（防误删共享节点）**
   - 删除或移至 `archive/`：`atomic_create_gate.py`、`single_node_gate.py`，及**仅被其引用**的节点（如 `parse_atomic_intent` / `create_atomic_node` / `await_atomic_confirm` / `run_atomic_gen` / `prepare_atomic_regenerate` / `adjust_atomic_regenerate` / `prepare_single_gen` 实现）。
   - **显式保留** topo/confirm 共享节点：`start_gen` / `collect_gen` 等；**不得**因 2d.2 删除。
   - 硬验收以「图上不可达」为准；物理删 vs `archive/` 由 implementation plan 二选一。
   - `RouteFlowMode` 等字面量可暂留并注释指向后续清扫；禁止生产路径再写入。

6. **金标 / 测试**
   - 凡断言 `atomic_regenerate` / `single_node` / `atomic_create` 子图 step 的用例，同 PR 改为 `canvas_agent`（或明确「图上无该节点」）。
   - `eval-route-set` 中 regenerate / single_node gold 翻为 `canvas_agent`（可保留 reason/rule 观测字段若有）。

7. **非目标**
   - campaign / product_visual、Phase 3、前端 2c 确认路径大改、历史 checkpoint 自动迁移完成率、类型字面量清零。

---

## 3. 验收硬表 §6.0.7（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **G1** | `checkpoint_regen` 命中条件 | `flow_mode=="canvas_agent"` 且 `precedence_rule_id=="checkpoint_regen"` |
| **G2** | `focus_gen` 命中条件 | `flow_mode=="canvas_agent"` 且 `precedence_rule_id=="focus_gen"` |
| **G3** | `route_after_intake` 对旧 `flow_mode∈{atomic_create,atomic_regenerate,single_node}` | 落到 `explore`，不进 parse/prepare_* |
| **G4** | 编译图节点集合 | **不含** `parse_atomic_intent` / `create_atomic_node` / `await_atomic_confirm` / `run_atomic_gen` / `prepare_atomic_regenerate` / `adjust_atomic_regenerate` / `prepare_single_gen`；**允许保留** `start_gen` / `collect_gen` 等共享编排节点 |
| **G5** | `decide_lane` ALLOWED + postprocess | 无存活可返回的 `atomic_create` / `atomic_regenerate` / `single_node` |
| **G6** | 旧 `await_atomic_confirm` resume 夹具 | 无计费 gen；无 goto `run_atomic_gen`；相关特殊 resume 捷径已移除 |
| **G7** | `build_tool_plan().visible_names` | 仍不含 `run_image_generation` / `run_video_generation` |
| **G8** | 生产冒烟 | 「再试一次/重新生成」类 + 焦点生成口语 → `canvas_agent`；无 atomic/single 子图 step；确认前无扣费 |

**本档明确不验收：** 历史 checkpoint 自动迁移完成率、campaign/PV 改造、类型字面量清零、`regen_no_checkpoint` 改写。

---

## 4. 回滚

- 紧急：恢复 `register_atomic_create_gate` / `register_single_node_gate` + 两条 precedence 的旧 `flow_mode`（env flag 可选）；同步恢复 `interrupt_before` / resume 映射。
- **永不**恢复 `run_*` 进 visible；**永不**静默对旧 `await_atomic_confirm` 扣费；**永不**恢复「零工具 chat」回退。

---

## 5. 后续（未授权）

- **2d.3 / 清扫：** `RouteFlowMode` 等字面量删除；残余 soft 信号与文档金标再收敛。
- **Phase 3：** campaign / product_visual 工具化（单独规格 + plan + H6 门禁）。

---

## 6. 与父规格 / 2d 关系

| 项 | 本文件 |
|----|--------|
| 父 §4.4「2d.2 子图物理删除」 | 本档交付 |
| 父开放项「旧 atomic 子图代码删除时间表」 | 本档关闭（以 G4 为准） |
| 2d §5 路线图 | 由本档承接并授权 |
| D9 执行令 | 开至 **2d.2**；Phase 3 另开 |
| H1 / H2 | G7 + G6/G8 + 2D2-D9 |
| 审核补丁（已并入） | (1) single_node H2 动机 (2) G4 不删 `start_gen` (3) HITL 残留入口写全 |

---

## 7. 自检（写档时）

- [x] 无 TBD/占位未决项阻塞合入门禁  
- [x] 与 2d「不删子图」不矛盾：2d 已完成；本档为下一切片  
- [x] G4 与「保留共享 `start_gen`」无自相矛盾  
- [x] 范围未滑入 Phase 3 / campaign / PV  
