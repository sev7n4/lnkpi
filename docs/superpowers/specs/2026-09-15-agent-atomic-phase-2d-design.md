# Agent Atomic Phase 2d — V6 路由关门（atomic_create 退出竞争）

> 日期：2026-09-15  
> 状态：**已批准方向**（方案 A）；**执行令开至 Phase 2d（本档）**；2d.2 子图删除 / regenerate / single_node 另开  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md) §4.4 / V6 / D9  
> 依赖：Phase 2a–2c.3 已合入且生产冒烟绿（含 #318 E6）  
> 实现 plan：[../plans/2026-09-15-agent-atomic-phase-2d.md](../plans/2026-09-15-agent-atomic-phase-2d.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **2D-D1** | 本档目标 = 父规格 **V6**：路由层不再出现可竞争的 `flow_mode=atomic_create` 主路径 |
| **2D-D2** | **方案 A**：路由关门；**子图物理删除不进本档**（标 **2d.2**） |
| **2D-D3** | **纳入：** `sidebar_img2img`、`ref_backed_generate`、clarify resume 默认、`decide_lane` 去 `atomic_create` |
| **2D-D4** | **不纳入：** `atomic_regenerate`、`single_node`、`campaign` / `product_visual`、删 `atomic_create_gate` 源码 |
| **2D-D5** | 两条 precedence **保留 rule id**（可观测），仅改 `flow_mode` → `canvas_agent` |
| **2D-D6** | Soft 信号（`utterance_suggests_atomic_create` 等）可留，**不得**单独决定 `atomic_create` |
| **2D-D7** | H1/H2 不变：`run_*` 永不进 `model_visible_specs`；确认仍走 2c dock/`generateForNode` |

---

## 1. 背景（已证实残留入口）

生产默认走 precedence 时，仍有活写入点：

1. `_rule_sidebar_img2img` → `flow_mode=atomic_create`  
2. `_rule_ref_backed_generate` → `flow_mode=atomic_create`  
3. clarify resume：`pending_clarify_reply.route` 默认 `atomic_create`  
4. `decide_lane`：`ALLOWED_LANES` 含 `atomic_create`；系统提示仍教模型「生成一张→atomic_create」

2a 已退役 `atomic_generate`；2b/2c 已把裸生成与 HITL 迁到 propose/dock。上述入口若不关，双路径竞争仍在。

---

## 2. 钉死规则（批准时锁定）

1. **`sidebar_img2img`：** match 逻辑不变；决策改为 `flow_mode="canvas_agent"`；`precedence_rule_id` 仍为 `sidebar_img2img`（reason 可保留或加 `_to_agent` 后缀，测里以 rule id + flow 为准）。  
2. **`ref_backed_generate`：** 同上 → `canvas_agent`；`precedence_rule_id` 仍为 `ref_backed_generate`。  
3. **clarify resume（非 campaign）：** 默认 route / flow **不得**为 `atomic_create`；改为 `canvas_agent`（`route_decide` 与 `route_precedence` 两处对齐）。  
4. **`decide_lane`：**  
   - `ALLOWED_LANES` **移除** `atomic_create`；  
   - 系统提示删除「生成一张→atomic_create」，改为偏向 `canvas_agent`；  
   - postprocess：若模型仍吐出 `atomic_create` → **强制映射** `canvas_agent`（打日志）。  
5. **builder：** 本档 **不要求** 卸 `register_atomic_create_gate`；但正常路由 **不得**再产出 `flow_mode=atomic_create`（单测覆盖 F1–F4）。  
6. **非目标：** 删子图文件、改 `atomic_regenerate` / `single_node`、Phase 3、改前端 2c 确认路径。

---

## 3. 验收硬表 §6.0.6（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **F1** | 侧栏/多图 transform 命中原 `sidebar_img2img` 条件 | `flow_mode=="canvas_agent"` 且 `precedence_rule_id=="sidebar_img2img"` |
| **F2** | 有 image/text ref 的生成命中原 `ref_backed_generate` | `flow_mode=="canvas_agent"` 且 `precedence_rule_id=="ref_backed_generate"` |
| **F3** | clarify resume 非 campaign | flow **≠** `atomic_create`（期望 `canvas_agent`） |
| **F4** | `decide_lane` ALLOWED + postprocess | 无存活可返回的 `atomic_create`；非法输出被映射 |
| **F5** | 裸「帮我生成一张…」 | 仍 `canvas_agent`（2a/2b 回归） |
| **F6** | `build_tool_plan().visible_names` | 不含 `run_image_generation` / `run_video_generation` |
| **F7** | 生产冒烟 | 带侧栏图或 ref 的一句生成 → `canvas_agent`；确认前无扣费 gen（可复用 propose 路径） |

**本档明确不验收：** 子图目录删除、`atomic_regenerate` 改写、遗留 checkpoint 自动迁移完成率。

---

## 4. 回滚

- 紧急：将 `sidebar_img2img` / `ref_backed_generate` 的 `flow_mode` 临时改回 `atomic_create`（或 env flag）；clarify / decide_lane 同步可回退。  
- **永不**恢复 `atomic_generate` hard；**永不**把 `run_*` 放进 visible。

---

## 5. 2d.2 路线图（未授权）

- 卸 `register_atomic_create_gate` / 删除或归档子图节点  
- 评估 `atomic_regenerate`、`single_node` 是否映射 agent  
- 遗留 `await_atomic_confirm` checkpoint 迁移策略  

另开 plan + 硬表后再开工。

---

## 6. 与父规格关系

| 父项 | 本文件 |
|------|--------|
| §4.4 Deprecate atomic 主路径 | 本档 = 路由关门切片 |
| V6 | §3 F1–F7 |
| 开放项「子图删除可晚于路由关门」 | **2d.2** |
| D9 执行令 | 开至 **2d**；2d.2/3 另开 |
