# 设计规格：Agent 批量确认卡 + 人工/自动双模式（②③）

- 日期：2026-09-21
- 状态：待评审（brainstorming architectural 路径产出）
- 前置：PR #386（批量重新生成）、#387（settle 等待 + 进度卡 + 缺提示词预检 + 图标化）、#388（状态机回 idle）、#389（确认卡 SSOT 优先）已合并上线

## 1. 背景与目标

Agent 一次需求出多张图/视频时，侧栏逐张出【确认生成】卡片，用户需逐张确认；画布侧批量生成能力（选择 → 规划 → 进度卡）已建成但确认链路未复用。两个特性：

- **② 批量确认卡**：人工模式下，≥2 个待确认节点聚合为一张批量卡，支持「全部确认」一次进入画布批量执行。
- **③ 人工/自动双模式**：会话级「自动生成」开关；开启后回合静默时自动确认提案节点（带护栏），无需逐张点卡。

成功标准：

1. 批量卡「全部确认」后走画布批量执行器，进度卡/汇总/停止与手动批量完全一致。
2. 自动模式下不出现确认卡；任何回落（超限/余额不足/关开关）均**可见且有明确指引**。
3. 三个触发源（画布工具栏 / 批量卡 / 自动模式）共用同一执行器，互不踩踏（重入被拒绝且可见）。

## 2. 决策记录（用户已拍板）

| 决策点 | 结论 |
|---|---|
| 自动模式允许的节点类型 | **全类型**（护栏靠数量 + 金额双上限） |
| 单回合节点上限 | **≤ 6**，超出部分回落人工确认卡 |
| 视频类子上限 | **单回合 ≤ 2**（可配常量），不改变类型范围 |
| 批量提案契约形态 | **前端聚合**（runtime `propose_generation` 保持单节点串行，零契约改动） |
| 模式开关层级 | **会话级开关**（侧栏头部，新建对话复位为人工，不持久化） |
| 质量确认门（image_qa 等 interrupt） | **不自动化**，仅自动确认 `generation_propose` |

## 3. 现状与代码事实（2026-09-21 核实）

- **确认链路是纯前端**：`AgentSideRail.confirmProposeGeneration` → `emit('generateNode')` → `CanvasPage.handleAgentGenerateNode`（`apps/web/src/pages/CanvasPage.vue:3082`，本地 `patchNodeData` 清 `pending_confirm` → draft）→ `useNodeGeneration.generateForNode`。无 runtime round-trip。
- **待确认节点真相源（SSOT）**：画布节点 `data.status === 'pending_confirm'`；`resolveProposeChipNodeId`（`agentChipSet.ts:308`，#389）已实现 SSOT 优先。`resolvePendingConfirmNodeId` 提供「选中优先、否则最新 updatedAt」排序。
- **批量执行器**：`useSelectionGenerate.start(plan)`（`useSelectionGenerate.ts:328`），并发 3，`BatchProgress`（done/failed/cancelled/timeout/skipped），`insufficient_points` 中止与 `creditCost` 计数齐备；规划器 `planSelectionGenerate`（`packages/shared/src/canvas/selectionBatchGenerate.ts`）支持 `hasAttemptableInput`（`missing_prompt` 预检）、24 上限、`pending_confirm` 整批拒绝。
- **⚠️ 执行器无重入守卫**：`start()` 无 `state !== 'idle'` 检查，二次调用会重置 `inFlight`/`queue`/计数，静默破坏在飞批次（本规格 §4.1 必修）。
- **特性开关**：`apps/web/src/composables/useFeatureFlag.ts`（本地 Map + `?feature=` 覆盖），可注册新 flag。
- **积分**：`apps/web/src/services/users-api.ts:114 getPoints()`；历史生成 `creditCost` 可作单类型成本估算依据。
- **会话/threadId 生命周期**：`agentThreadId` ref（`AgentSideRail.vue:379` 附近），新建对话重置——自动模式开关跟随该生命周期复位。

## 4. 架构设计

### 4.1 共享执行路径：`confirmBatch(nodeIds)`（必修前置）

新增（建议放在 `useSelectionGenerate` 同层或 CanvasPage 组合层）：

```
confirmBatch(nodeIds: string[]): Promise<BatchSummary | { rejected: reason }>
  1. 重读节点，仅保留此刻仍 status === 'pending_confirm' 的 id（幂等/跨标签页乐观并发）
  2. 对每个 id：patchNodeData(id, { status: 'draft' })（本地，同现单节点确认）
  3. planSelectionGenerate({ selectedIds: ids, ...同画布多选的 hasUsableOutput/hasAttemptableInput/isInFlight })
  4. 若 plan.run 为空或 rejected（limit_24 等）→ 返回原因（调用方 toast + 节点状态恢复 pending）
  5. selectionBatchApi.start(plan)
```

- **single-flight 守卫（执行器内）**：`start()` 首行加 `if (state.value !== 'idle') return { rejected: 'busy' }`（或抛 `BatchBusyError`，两触发器侧 toast「已有批量任务进行中」）。**拒绝必须可见**，禁止静默。
- 规划器返回 `missing_prompt` 跳过的节点：状态保持 draft（与画布多选行为一致），由调用方 toast 点名数量；被跳过节点不再出确认卡（其 prompt 为空本来也无法确认）。

### 4.2 触发源统一

| 触发源 | 入口 | 守卫 |
|---|---|---|
| 画布工具栏 | 现有 `handleSelectionBatchGenerate` | 现有逻辑 + 新 busy 拒绝 |
| ② 批量卡「全部确认」 | `confirmBatch(allPendingIds)` | busy 拒绝 + 弹确认框（成本提示） |
| ③ 自动模式 | 回合静默状态机（§6）自动调 `confirmBatch` | 护栏全量校验 |

### 4.3 幂等与并发

- `confirmBatch` 入口重读节点状态（§4.1 第 1 步），已非 pending 的 id 剔除；部分剔除时按剩余集合执行并如实汇报 `N/M`。
- 多标签页：两页都可能看到 pending；先到先得（状态被清后另一页重读即空），最坏情况是重复 toast，不产生双重扣费（`generateForNode` 只对 status=draft 节点执行一次）。

## 5. ② 批量确认卡

### 5.1 触发与显示

- 条件：人工模式 && flag `agent_batch_confirm` 开 && SSOT pending 节点数 ≥ 2 && `!isStreaming` && 无本回合「逐个挑选」latch && pending 数 ≤ 24（>24 隐藏批量卡，防御性）。
- 单节点（=1）保持现有单卡。批量卡出现时**替代**单卡队列；用户点「逐个挑选」后本回合内回落单卡。

### 5.2 卡片结构（新组件 `GenerationProposeBatchCard.vue`）

- 标题：「批量确认生成」+ 副标题「N 个节点等待确认」。
- 节点行（最新在前，复用 SSOT 排序）：类型图标（复用 #387 图标语言）+ 标题 + prompt 摘要（单行截断）+ **状态标签**：`missing_prompt`（无提示词且无上游可用输出，规划器同口径）→ 行内「缺提示词」灰标签，不计入可执行数；行点击 → 画布定位选中该节点（复用 #387 定位能力）。
- 汇总行：「可执行 X/N · 预估约 Y 积分」（Y 按类型历史均值估算，标注"约"）。
- 主按钮「全部确认 · X」→ 弹确认框（"将批量生成 X 个节点，可能消耗积分"）→ `confirmBatch(allPendingIds)`；`rejected: busy` → toast。
- 次按钮「逐个挑选」→ 设置 turn-scope latch（回合结束/新提案到达时重置评估——以 `lastAssistantMessage.id` 变化为回合标识），回落单卡队列。
- 执行期间：卡片隐藏（`selectionBatchApi.state !== 'idle'`），由画布批量进度卡接管。

### 5.3 与 ③ 的关系

- 自动模式开启 → 批量卡不渲染（自动路径接管）。
- 自动模式回合中关闭 → 剩余 pending 节点按 ② 条件评估，≥2 出批量卡。

## 6. ③ 自动模式

### 6.1 开关与知情同意

- 侧栏头部新增「自动生成」toggle（图标 + 文案 + tooltip「开启后 agent 提案将免确认自动生成」），存 `AgentSideRail` 内 ref（或 `useAgentAutoConfirm` 内）；**`agentThreadId` 重置（新建对话）时复位 off**；不持久化。
- 会话内**首次**开启：`ElMessageBox.confirm` 知情同意——"自动模式将免确认直接生成 agent 提案的节点并消耗积分；每回合最多 6 个节点（视频 ≤ 2）；可随时在进度卡停止。本次对话内有效。" 取消 → 不开启。

### 6.2 触发状态机（`useAgentAutoConfirm.ts`，纯逻辑可单测）

状态：`idle → arming → firing → idle`。

- **arming 触发**：自动模式 on 且 `isStreaming` true→false 边沿。进入 arming 后启动静默窗口定时器（1200ms），期间任一新 pending 节点到达或 `isStreaming` 变 true → 重置定时器/回 idle。
- **firing 前置条件（全部满足才执行）**：`!isStreaming` && `interruptGate === null` && 静默窗口到期 && pending 数 > 0 && flag `agent_auto_confirm` 开。
- **护栏校验（顺序执行，任一不过 → 整批回落人工单卡 + toast 点名原因）**：
  1. 数量：pending ≤ 6（**超出处理**：按最新排序取前 6 个自动，其余保持 pending 出人工卡，toast「已自动确认 6 个，其余 N 个需手动确认」）；
  2. 视频子上限：待确认视频中 ≤ 2 个自动，超出的视频节点回落人工；
  3. 金额：firing 时取积分余额——优先用本回合开始时 `getPoints()` 的缓存（每回合一次），缓存缺失则现查；预估消耗 > 余额 × 30% → 整批回落人工；余额 < 单次最贵类型成本 → 整批回落人工。执行器内既有的 `insufficient_points` 中止仍作为实时兜底。
- **执行**：`confirmBatch(通过的 ids)`；节点写 `data.autoConfirmed = true` + `data.autoBatchId`。
- **失败可见与自断**：批量汇总 `failed > 0` 且含 `insufficient_points` → 自动关闭开关 + toast「积分不足，已切回人工确认」；其他失败仅 toast 点名，**不重试**。
- **QA 门不动**：`interruptGate` 非空时 arming 中止（自然不 fire）；image_qa 等卡片仍人工。

### 6.3 可见性

- 侧栏内联状态行（自动模式执行期间）：「自动生成中 k/N · 已用 X 积分 · 停止」——数据源与画布 `SelectionBatchProgressCard` 同一 `progress` 响应式对象；点击停止 = `selectionBatchApi.stop()`。
- 所有回落原因 toast（`cap` / `video_cap` / `insufficient_points` / `switch_off` / `busy`），**零静默**。

## 7. 遥测

| 事件 | 载荷 |
|---|---|
| `agent_batch_confirm_shown` | nodeCount, executableCount, missingPromptCount |
| `agent_batch_confirm_action` | action: `confirm_all` / `pick_one`, nodeCount |
| `agent_auto_confirmed` | nodeCount, videoCount, estPoints |
| `agent_auto_fallback` | reason: `cap` / `video_cap` / `insufficient_points` / `switch_off` / `busy` / `plan_rejected`, nodeCount |
| `agent_auto_mode_toggled` | on: boolean, firstTime: boolean |

复用 `selectionBatchTelemetry` 通道；`confirmBatch` 触发源标记 `triggerSource: toolbar | batch_card | auto_mode`。

## 8. 特性开关、灰度与回滚

- `agent_batch_confirm`、`agent_auto_confirm` 注册进 `useFeatureFlag.ts`，**默认 off**，URL `?feature=` 灰度；与既有 `selection_batch_generate` 独立。
- 回滚：flag 置 off 即回到现有单卡确认流；执行器 busy 守卫与 `confirmBatch` 抽取保留（对现网行为无影响）。

## 9. 测试计划（TDD，先红后绿）

- **执行器**：`start()` 重入拒绝（busy + 在飞批次计数不被破坏）；`confirmBatch` 幂等（部分节点已非 pending 时按剩余执行并汇报 N/M）。
- **`useAgentAutoConfirm`**：静默窗口重置；interruptGate 存在不 fire；数量上限分流（前 6 自动其余人工）；视频子上限；金额回落（30% / 余额下限）；回合（threadId 重置）复位 off；中途关开关回落；`insufficient_points` 自断。
- **批量卡组件**：≥2 渲染 / =1 不渲染 / missing_prompt 标签与 X/N 如实 / 全部确认 emit（含确认框）/ 逐个挑选 latch / >24 隐藏 / busy 拒绝 toast。
- **回归**：#389 SSOT 优先用例不回归；手动批量路径行为不变。

## 10. 验收清单（手动 E2E）

1. agent 提 3 张图 → 人工模式出 1 张批量卡（3/3 可执行）→ 全部确认 → 画布进度卡 3 项、汇总与真实结果一致。
2. 其中 1 个节点无提示词 → 批量卡显示 2/3 + 缺提示词标签 → 全部确认只生成 2 个且 toast 点名。
3. 开启自动模式（弹知情同意）→ 提 3 张图 → 回合结束约 1.2s 后自动开跑，无确认卡，侧栏状态行实时计数。
4. 一次提 8 张图 → 自动确认 6 个 + toast「其余 2 个需手动确认」，2 张人工卡出现。
5. 批量运行中点画布工具栏批量生成 → toast「已有批量任务进行中」，在飞批次不受影响。
6. 自动运行中切换开关 off → 剩余 pending 节点出现人工卡。
7. 新建对话 → 开关复位 off。
8. 余额不足场景（mock）→ 自动开关自动关闭 + 提示。

## 11. 非目标（YAGNI）

- 不做 runtime `propose_batch` 契约；不做部分勾选（仅全部/逐个两级）；不做持久化偏好与设置页；不自动通过 QA 门；不做"不再提示"记忆。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 三触发源并发踩踏 | §4.1 single-flight 守卫 + busy 可见拒绝（TDD 覆盖） |
| 半批自动确认 | §6.2 静默窗口 + interruptGate 检查 + 幂等重读 |
| 积分意外消耗 | 双护栏（数量 + 金额）+ 知情同意 + 停止入口 + 自断 |
| 批量卡信息过载 | 行内信息单行截断，详情靠行点击定位节点 |
| 文档漂移 | §13 文档同步清单纳入 PR 验收 |

## 13. 需同步更新的文档

- `docs/superpowers/plans/2026-09-14-agent-atomic-phase-2b.md`：propose 确认路径补「批量确认卡 / 自动模式」两条前端触发器说明（runtime 契约不变）。
- `AGENTS.md` 无需改动（协作惯例不变）。

## 14. PR 划分

1. **PR-A（小，先行）**：执行器 single-flight 守卫 + `confirmBatch` 抽取 + `useAgentAutoConfirm`（含护栏与状态机）+ 侧栏 toggle/知情同意/状态行 + 遥测。flag `agent_auto_confirm`。
2. **PR-B（中，跟进）**：`GenerationProposeBatchCard` 组件 + chipSet 显示条件接线（含 missing_prompt 标签、X/N）+ 遥测。flag `agent_batch_confirm`。

PR-B 依赖 PR-A 的 `confirmBatch` 与 autoMode 状态。
