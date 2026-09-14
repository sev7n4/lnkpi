# Agent Atomic Phase 2c — HITL 统一 / 节点 SSOT

> 日期：2026-09-14  
> 状态：**已批准方向**（切片节奏 2c.1→2c.2→2c.3）；**执行令仅开至 Phase 2c.1**  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md) §4.3 / D3 / H3  
> 依赖：Phase 2a / 2b 已合入生产（#311 / #312）；2b 多场景门禁已绿  
> 实现 plan（本档）：[../plans/2026-09-14-agent-atomic-phase-2c1.md](../plans/2026-09-14-agent-atomic-phase-2c1.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **C-D1** | Phase 2c 分三档：**2c.1 最小 SSOT → 充分验证 → 2c.2 完整 HITL 卡 → 2c.3 弱化旧 atomic 确认 UX**；每档单独硬表 + 生产冒烟 |
| **C-D2** | **本批准只授权 2c.1**；2c.2 / 2c.3 另开 plan，禁止同 PR 顺手做完 |
| **C-D3** | 确认卡 ≡ dock：确认必须调用与 dock **同一** `generateForNode(nodeId)`（或同一 Nest/studio 入口）；**禁止** `sendPreset('确认生成')` / `flow_mode=atomic_create` |
| **C-D4** | 画布节点 `data.status === 'pending_confirm'` 为断线恢复 SSOT；对话 chip 只是快捷入口 |
| **C-D5** | 取消以 Nest 写回为准（`clearProposeGeneration` → `draft`）；禁止仅本地 patch 作为主路径 |
| **C-D6** | 积分预估：**2c.1 不做硬门禁**（留给 2c.2 可选） |
| **C-D7** | **不**删除 `atomic_create` 子图（2d）；2c.1 **不**改变 interrupt 优先于 propose 的过渡态 |

### 0.1 相对 2b 的缺口（已证实）

1. 确认 chip 依赖本轮 assistant `toolCalls`；刷新/重进会话后即使节点仍为 `pending_confirm` 也会丢卡。  
2. 取消多为本地 `patchNodeData` + `persistUserEdit`，与 Nest Session.canvasData 易漂移。  
3. dock 直接生成时未必清 `pending_confirm`（与卡路径不一致）。

---

## 1. Phase 2c.1 — 最小 SSOT（本档）

### 1.1 目标

刷新或重载画布后，仍能从节点 `pending_confirm` 恢复侧栏确认/取消；确认走 dock 同入口；取消走 Nest 权威写回。

### 1.2 钉死规则（批准时锁定）

1. **多 pending 选谁：** 优先 **当前选中节点**（若其 `pending_confirm`）→ 否则画布上 **最近创建/更新** 的一个 `pending_confirm` 节点；其余仅靠 dock，侧栏不堆多卡。  
2. **chip vs interrupt：** `chipSetFromInterrupt`（含 `await_atomic_confirm`）**仍可压过** propose 恢复；2c.1 不「修正」优先级（留给 2c.3）。  
3. **C2 可测断言：** 确认处理器调用 **`generateForNode`**（或测试中 spy 的同一导出函数）；断言 **不**调用 `sendPreset('确认生成')`；不进入 `atomic_create` 路由。  
4. **生成开始清 pending：** dock 与确认卡共用路径在 **开始生成** 时将节点 `pending_confirm` → 生成中态（由现有 `generateForNode` 状态机负责；若未清则在入口显式清）。  
5. **取消：** `POST /agent/internal/clear-propose-generation`（名称可微调，语义固定）输入 `{ sessionId, userId, nodeId }` → 校验节点存在且（建议）当前为 `pending_confirm` → `status: 'draft'` → 返回 actions；前端成功后再刷新/乐观更新。

### 1.3 非目标（2c.1）

- 正式 `generation_propose` presentation envelope / 积分预估 UI  
- 弱化或删除 `await_atomic_confirm` 芯片  
- 删除 atomic 子图 / 改 `decide_lane`  
- Phase 3 campaign/PV

### 1.4 验收硬表 §6.0.3（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **C1** | 画布存在 `pending_confirm` 且无本轮 propose toolCalls（模拟刷新） | 侧栏仍显示 `generation_propose` 确认/取消（按 §1.2 选节点规则） |
| **C2** | 点确认 | 调用 `generateForNode(nodeId)`（spy/单测）；**不** `sendPreset('确认生成')` |
| **C3** | 点取消 | Nest `clearProposeGeneration` 被调用；重载后该节点 **非** `pending_confirm` |
| **C4** | `build_tool_plan().visible_names` | 仍不含 `run_image_generation` / `run_video_generation` |
| **C5** | 路由回归 | 「帮我生成一张…」/ WORKFLOW 仍 `flow_mode=canvas_agent`（复用 2a/2b 测） |
| **C6** | 生产冒烟（合入后） | propose → 刷新页面 → 仍可确认或取消；取消后 pending 消失 |

**2c.1 明确不验收：** presentation 美化、积分预估、atomic 芯片消失、多 pending 同时出多卡。

---

## 2. Phase 2c.2 — 完整 HITL 卡（路线图；未授权）

- 正式 SSE/presentation `kind: generation_propose`（摘要；积分预估可选）  
- 卡与 dock 参数展示一致（读节点 SSOT）  
- 另开 plan + 硬表后再开工

## 3. Phase 2c.3 — 弱化旧 atomic 确认 UX（路线图；未授权）

- 弱化/映射 `await_atomic_confirm` 芯片，避免双套确认并存  
- **仍不删** atomic 子图代码（2d）  
- 另开 plan + 硬表后再开工

---

## 4. 回滚

- 前端恢复「仅 toolCalls 出卡」flag（紧急）  
- 取消可临时回退本地 patch（需注明 SoT 弱）  
- **永不**把 `run_*` 放进 visible；**永不**在 2c 恢复 `atomic_generate` hard

---

## 5. 与父规格关系

| 父项 | 本文件 |
|------|--------|
| §4.3 HITL 统一 | 拆为 2c.1/2c.2/2c.3 |
| V4 确认≡dock | 2c.1 C2 起宣称；完整卡在 2c.2 |
| 积分预估是否强制 | **2c.1：否**；2c.2 再议 |
| 双路径并存 | 2c.1–2c.2 接受；2c.3 弱化 UX；2d 关门 |
