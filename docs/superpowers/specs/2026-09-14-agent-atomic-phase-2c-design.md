# Agent Atomic Phase 2c — HITL 统一 / 节点 SSOT

> 日期：2026-09-14  
> 状态：**已批准方向**（切片节奏 2c.1→2c.2→2c.3）；**2c 执行完毕**；2d 见 [2d 规格](./2026-09-15-agent-atomic-phase-2d-design.md)  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md) §4.3 / D3 / H3  
> 依赖：Phase 2c.1（#314）、2c.2（#316）已合入且生产冒烟绿  
> 实现 plan：**2c.1** [../plans/2026-09-14-agent-atomic-phase-2c1.md](../plans/2026-09-14-agent-atomic-phase-2c1.md)；**2c.2** [../plans/2026-09-14-agent-atomic-phase-2c2.md](../plans/2026-09-14-agent-atomic-phase-2c2.md)；**2c.3** [../plans/2026-09-14-agent-atomic-phase-2c3.md](../plans/2026-09-14-agent-atomic-phase-2c3.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **C-D1** | Phase 2c 分三档：**2c.1 最小 SSOT → 充分验证 → 2c.2 完整 HITL 卡 → 2c.3 弱化旧 atomic 确认 UX**；每档单独硬表 + 生产冒烟 |
| **C-D2** | **2c 执行令已关**（2c.1–2c.3 完成）；2d 见 [2d 规格](./2026-09-15-agent-atomic-phase-2d-design.md)；禁止在 2c PR 顺手做 2d |
| **C-D3** | 确认卡 ≡ dock：确认必须调用与 dock **同一** `generateForNode(nodeId)`（或同一 Nest/studio 入口）；**禁止** `sendPreset('确认生成')` / `flow_mode=atomic_create` 作为主确认路径 |
| **C-D4** | 画布节点 `data.status === 'pending_confirm'` 为断线恢复 SSOT；对话 chip 只是快捷入口 |
| **C-D5** | 取消以 Nest 写回为准（`clearProposeGeneration` → `draft`）；禁止仅本地 patch 作为主路径 |
| **C-D6** | 积分预估：**2c.2 可选**（有则展示 `credits_hint`；无则不挡合入）；**不**强制报价 API |
| **C-D7** | **不**删除 `atomic_create` 子图（2d）；**2c.3** 弱化 atomic 确认 UX 并统一扣费入口；仍保留子图代码 |
| **C-D8** | 2c.2 确认卡展示字段 **只读节点 SSOT**（及 propose summary 的同源字段）；禁止与 dock 冲突的第二套文案真相 |
| **C-D9** | **2c.3：** 有 `pending_confirm` 时 propose 优先于 `await_atomic_confirm`；atomic 芯片确认映射 `generateForNode`；确认后须解除 atomic interrupt，避免双执行 |
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

## 2. Phase 2c.2 — 完整 HITL 卡（本档授权）

### 2.1 目标

在 2c.1 恢复/取消/确认路径之上，提供正式 `generation_propose` presentation：从 **节点 SSOT** 渲染参数摘要；积分预估可选；确认/取消行为不变。

### 2.2 钉死规则

1. **kind** = `generation_propose`（`AgentPresentationEnvelope`）。  
2. **构建源：** `buildGenerationProposePresentation(node)`（或等价）只读 `node.id` / `node.type` / `node.data`（prompt、title、aspect、resolution、model、videoSettings…）；可合并 Nest `proposeGeneration.summary` **仅当**字段与节点一致或为节点缺失的展示回退。  
3. **展示时机：** `chipSet === 'generation_propose'`（含刷新后 SSOT 恢复）时，侧栏在确认按钮上方展示该 presentation。  
4. **积分：** `body.credits_hint` 可选；缺失时卡仍完整可用（不阻塞确认）。  
5. **动作：** primary/chips 仍走 `generateForNode` / Nest clear；**不**用 `primary_action.message` 触发 atomic resume。  
6. **非目标：** 强制报价服务、弱化 atomic interrupt（2c.3）、删子图（2d）。

### 2.3 验收硬表 §6.0.4（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **D1** | `buildGenerationProposePresentation(pendingNode)` | `kind==='generation_propose'`；含 title 或 type；含 prompt 预览（来自节点） |
| **D2** | 节点改 prompt 后重建 presentation | 预览跟随节点（SSOT），不读过期 chat 文案 |
| **D3** | 无 `credits_hint` | presentation 仍合法；不抛错 |
| **D4** | 有 `credits_hint`（节点或 summary） | UI/envelope 带出该字段 |
| **D5** | 确认 | 仍 `generateForNode`；不 `sendPreset('确认生成')`（回归 2c.1 C2） |
| **D6** | 刷新后 pending | 仍出 chip + presentation（回归 2c.1 C1） |
| **D7** | 生产冒烟 | propose → 侧栏见摘要卡 → 确认或取消可用 |

**2c.2 明确不验收：** 强制积分数字、atomic 芯片消失、多 pending 多卡。

---

## 3. Phase 2c.3 — 弱化旧 atomic 确认 UX（本档授权）

### 3.0 设计自审（合入前已钉死）

| 风险 | 处理 |
|------|------|
| 仅改 chip、不解除 LangGraph interrupt → 下次消息仍 resume atomic，可能双执行 | **确认走 dock 后必须解除** `await_atomic_confirm`（清本地 gate + resume `revise`/`取消` 解开 checkpoint；**不**再走 atomic gen） |
| interrupt 载荷无 `nodeId` | 解析顺序：`pending_confirm`（§1.2）→ thread-state `atomicNodeId`（Nest 已有字段，前端补读）→ 选中媒体节点 → 失败才 fallback `sendPreset` |
| 其它 HITL（image_qa / scheme / topo / delivery）被误伤 | **仅**对 `await_atomic_confirm` 改 precedence / 映射；其它 interrupt 不变 |
| 与 2d 边界 | **不删** 子图 / `decide_lane`；fallback 分支保留并测，便于 2d 清零 |

### 3.1 目标

避免 atomic 与 propose 双套确认并存；侧栏「确认生成」尽量统一到 `generateForNode`；遗留 `await_atomic_confirm` 仍可用但不压过 pending propose。

### 3.2 钉死规则

1. **Propose 优先：** 若可解析出 `pending_confirm` 节点（§1.2），`chipSet === 'generation_propose'`，**即使** interrupt phase 为 `await_atomic_confirm`。  
2. **Atomic 芯片窗口：** 仅当 interrupt=`await_atomic_confirm` **且** 无 pending 时，仍显示确认/取消芯片。  
3. **确认映射：** `confirmAtomicGeneration(nodeId?)`：有 nodeId → `generateForNode` + **解除 atomic interrupt**（见 §3.0）；无 nodeId → fallback `sendPreset('确认生成')`（单测钉死；打可观测日志）。  
4. **取消：** 若目标节点为 `pending_confirm` → Nest clear；否则 `sendPreset('取消')`（保留 interrupt 取消语义）。  
5. **节点解析顺序：** pending（§1.2）→ `atomicNodeId`（thread-state）→ `selectedNodeId`（媒体类型）→ null。  
6. **非目标：** 删 atomic 子图、改 hard/precedence 路由、强制积分、多 pending 多卡。

### 3.3 验收硬表 §6.0.5（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **E1** | pending + `await_atomic_confirm` interrupt 同时存在 | `chipSet === 'generation_propose'`（propose 优先） |
| **E2** | atomic 芯片确认且能解析 nodeId | 调 `generateForNode`；**不** `sendPreset('确认生成')`；interrupt gate 被清 / resume revise |
| **E3** | atomic 芯片确认且无法解析 nodeId | 允许 `sendPreset('确认生成')`（显式分支单测） |
| **E4** | 无 atomic interrupt | 2c.1 C1/C2、2c.2 D5/D6 回归绿 |
| **E5** | `build_tool_plan().visible_names` | 仍不含 `run_*_generation` |
| **E6** | 生产冒烟 | propose 路径仍可用；若触发 atomic 芯片且有节点，确认不走纯 sendPreset 主路径（或可观测走 dock） |

**2c.3 明确不验收：** 子图删除、atomic 路由永不命中、强制积分。

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
| 积分预估是否强制 | **2c.2：否（可选）** |
| 双路径并存 | 2c.1–2c.2 接受；**2c.3 弱化 UX + 统一确认入口**；2d 关门 |
