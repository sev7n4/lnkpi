# 画布框选批量生成 — 设计

> 日期：2026-09-17（讨论定稿 2026-09-18；**v2 修订 2026-09-18**；**v3 修订 2026-09-18**，见 §0.0 changelog）  
> 状态：**v3 修订中**——v1 self-approved；v2 通过 review 一审；v3 处理 review 二审的 5 个 Critical（伪代码可编译）+ 6 个 Important（语义/契约）  
> 产品：超创平台（lnkpi）无限画布 / 前端工具栏  
> 代号：**SEL-BATCH**

## 0.0 Changelog

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-09-17 | 初稿；与 Cursor 讨论记录 `docs/feature-bathtaskgeneration-discussion.md` 逐条对齐 |
| v2 | 2026-09-18 | (1) C1 修正 `pending_confirm` 语义；(2) C2 增 §4.5 SSOT 依赖清单；(3) C3 拍板 24 上限真实理由 + 后续调参路径；(4) C4 加硬超时；(5) C5 明确「停止全部」积分语义与归类；(6) I2 增 §13 telemetry；(7) I3 增 SB-D16 feature flag |
| v3 | 2026-09-18 | (1) C2-1 改 `Set<NodeId>` → `Map<NodeId, Promise>` 让 `Promise.allSettled` 能跑；(2) C2-2 全批 30min timer 与 loop 解耦（独立 `setTimeout`，不依赖 inFlight 状态）；(3) C2-3 改 in-flight 节点与其下游 `skip`（理由 `in_flight` / `upstream_in_flight`），**不**参与 Kahn，由用户下一批再跑；(4) C2-4 修 `settleTimeout._timer` undefined leak；(5) C2-5 补 `onNodeSettled` + `waitingMap` 初始化 + stop 路径的显式 `cancelGeneration`；(6) I2-1 进度 5 类别（done/failed/cancelled/timeout/skipped），insufficient_points 计入 failed，timeout 单列；(7) I2-2 `capHit` → `abortReason` 闭合（6 个值含 user_stopped/insufficient_points/node_timeout）；(8) I2-3 `pointsExhausted` 移除 node_settled 字段（仅 batch 级）；(9) I2-4 `creditCost` 加进 completed；(10) I2-5 stop 路径显式调 `cancelGeneration`；(11) I2-6 节点消失的下游走 `ok` 路径释放；(12) I2-7 §6.3 按钮位置措辞修正；(13) I2-8 i18n 推迟到 plan；(14) I2-9 dashboard/告警通道占位标 "plan 阶段定"；(15) M2-7 加 `selection_batch_plan_rejected` 事件 |
| v4 | 2026-09-23 | I4-1 **SB-D16 转正**：V1.2 起 flag 临时 on（配合内网直连验证），经数日线上运行无故障，2026-09-23 拍板**维持默认 on**，「默认 off 分阶梯灰度」不再执行；紧急关停改走远程 kill switch 通道（V2 远程 config 落地前 = 改 flag 一行 + 发版）。§0.1 切片表与 SB-D16 行的「默认 off」表述以本行为准 |

前置：  
- [2026-08-08-agent-canvas-control-surface-design.md](./2026-08-08-agent-canvas-control-surface-design.md) §1.5（多选工具栏现有动作表）
- [2026-08-07-agent-sidebar-m3-explicit-refs-design.md](./2026-08-07-agent-sidebar-m3-explicit-refs-design.md) D-D（"多选仅支持批量显式加入"基线）
- [2026-09-16-canvas-operator-2e-design.md](./2026-09-16-canvas-operator-2e-design.md) **2E-D5**（"不做图级一键跑工作流"——本特性是用户显式点击，**不**与之冲突）
- [2026-07-19-c2-canvas-generation-adapter-design.md](./2026-07-19-c2-canvas-generation-adapter-design.md) §6.3（导演台 batch-generate 是同源但不同入口，**不**合并）

实现 plan：待写 `docs/superpowers/plans/2026-09-17-selection-batch-generate.md`（本文 §0.1 切片 P0）  
范围：**仅前端**。Nest / runtime **不**新增端点；不引入新计费通道。

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **SB-D1** | 触发面：用户在画布**框选 ≥2 个节点** → 多选工具栏出现主按钮「**生成 · N**」，点击后**前端**编排并跑。N = 选区内"缺口可生成节点"数（见 §3.1）。 |
| **SB-D2** | 调度（**Hybrid 拓扑**）：选区内**无边并行**、**有边按拓扑等上游**。Kahn 排序后剩节点（环）追加队尾，**不丢任务不死锁**。 |
| **SB-D3** | 缺口补跑（**只跑未完成的**）：已出图/出视频/有内容 → 静默 skip，仍可作下游引用。`draft` / `error` / `failed` 进队列；`generating` **不打断**；`fallback_pending` 跳过（避免一次性弹 N 个降级确认）。**`pending_confirm` 整批拒绝**（C1 修正：见 §4.3 #2，理由是守住 Agent HITL 门）。 |
| **SB-D4** | 选区外上游：**有结果就引用、没有就不生成它**，对应下游 skip 并写明原因。**允许**这种跨选区引用——讨论已确认。 |
| **SB-D5** | 可生成类型：`image` / `video` / `audio` / `prompt` / `text` / `shot`。`mediaInput` / `sceneComposer` / `videoComposition` / `worldModel` **不进队列**（导演台继续走 `scene-composer/batch-generate`）。 |
| **SB-D6** | **绕开** `compositionGenerateIdsForClick`：本特性显式按"用户选什么就只跑什么"裁切，**禁止**通过它把构图组展开到选区外。执行器调 `generateForNode(node, { asRunGroupMember: true })`（该开关已存在，见 `useNodeGeneration.ts:775`），跳过构图整组展开与"再点 = 取消"逻辑。 |
| **SB-D7** | 并发上限 **3**；单批 `run` 数组上限 **24**（与构图 dump 同阶）。超 24 → **整批拒绝**，提示缩小选区。 |
| **SB-D8** | **不**做积分预扣（与导演台 `batchGenerate` 的差异）。每个节点按现网单节点扣；遇 `insufficient_points` → **停发后续任务**，飞行中跑完，**只弹一次**充值提示。理由：选区是异构 studio 调用，没有统一 quote API。 |
| **SB-D9** | 取消：节点卡片取消仍管单个；工具栏**新增**「**停止全部**」——abort 本批 `AbortController`，**未启动的不改成 `error`**（避免误报）。 |
| **SB-D10** | V1 **不做**"全部重新生成"按钮。空队列（选中的都能生成、却全都已有结果）只显示禁用 + tooltip，不误扣积分。 |
| **SB-D11** | 规划器（纯函数）放 `packages/shared/src/canvas/selectionBatchGenerate.ts`；执行器（Vue composable）放 `apps/web/src/composables/useSelectionGenerate.ts`。**不**继续膨胀 `useNodeGeneration`（已 1447 行）。 |
| **SB-D12** | 这是用户**显式**操作，**不是** Agent 一键跑图——`2E-D5` 仍然成立。本特性**不**对 Agent 暴露任何新工具；不修改 runtime；不修改 `EXPLORE_WRITE_TOOLS`。 |
| **SB-D13** | 不持久化批次状态。刷新页面后未启动的**不会**偷偷开跑；已提交节点靠现网单节点轮询收口。 |
| **SB-D14** | **24 上限的真实理由 = 异构 studio 单批扣分预算兜底**（C3 修正：见 §4.3 #6 + §10）。V1 拍 24；待 `selection_batch_completed` 遥测回灌后，按"p95 单批积分成本 < 用户单次扣分预算 30%"的指标重订。**不**与构图 dump 上限混为一谈。 |
| **SB-D15** | **硬超时双闸**（C4 修正：见 §5.3 / §5.5）：(a) 单节点 `maxWaitPerNode = 600s`（与 Studio 单点超时同阶）；(b) 全批 `maxBatchDurationMs = 30min`。超时走与「停止全部」同路径，不写 errorMessage。 |
| **SB-D16** | **Feature flag `feature.selection_batch_generate`**（I3：见 §13.1）：flag off 时**整按钮不渲染**（不是 disable）。~~上线默认 off → 按灰度阶梯开~~（**v4 转正**：2026-09-23 拍板默认 on，见修订表）；保留**远程 kill switch** 通道（运营 0 代码关停）。 |

### 0.1 切片

| 切片 | 做 | 不做 |
|------|----|------|
| **P0（本文实现）** | 多选工具栏「生成 · N」+ 缺口判定 + 混合拓扑调度 + `AbortController` 取消 + 硬超时 + 飞行中与跳过文案 + `feature.selection_batch_generate` flag 灰度（默认 off）+ §13 全部埋点 | 整批预扣、批次持久化、快捷键、「全部重新生成」、跨会话、Agent 工具、积分预算可视化 |
| **P1（暂不立项）** | 排序选项（沿边 vs 沿时间戳）、选中提示里的积分预估、跨选区上游的悬停可视化 | 跨账号协作、模板化批量 |

---

## 1. 背景与缺口

### 1.1 现状矩阵（讨论已确认）

| 入口 | 是否存在 | 是否覆盖"框选多节点批量" |
|---|---|---|
| 单节点 Dock「生成」 → `generateForNode` | ✅ | ❌ 单节点 |
| 构图组点击展开整组 → 拓扑顺序 | ✅ | ❌ 仅构图组（`compositionGenerateIdsForClick`），**不响应用户框选** |
| 导演台「批量生成」 → `POST /agent/canvas/scene-composer/batch-generate` | ✅ | ❌ 仅 `sceneComposer` 节点下的 shot |
| 多选工具栏「生成视频」 | ✅ | ⚠️ 只识别 `text/prompt + image`，新建一个 video 节点再生成，**不**把选中节点各自跑一遍 |
| Agent 自动开火 | ❌（2E-D5 显式不做） | ❌ |

**用户**心智：**"我把这 5 张图都圈起来，按一下就该全跑完"**——现状无入口。

### 1.2 关键边界（必须避免踩到）

- **`compositionGenerateIdsForClick`**（`apps/web/src/composables/compositionRunGroup.ts:71`）会把构图组节点点击后**展开整组**。本特性**禁止**走这条路径，否则用户框选 1 个构图组成员会跑出整组。
- **导演台 `batchGenerate`**（`apps/server/src/canvas/scene-composer.service.ts:112`）做"整批预扣 + 一次提交"；本特性是异构 studio 调用（image/video/audio/prompt 走不同 provider），**没有统一 quote API**，不应简单复制。
- **多选工具栏现有「生成视频」**（`CanvasPage.vue:1601` `handleGenerateVideoFromSelection`）语义是"text+image → 新建一个 video 节点"，与本特性**语义不同**，**不合并、不替换**。

---

## 2. 目标

| # | 目标 |
|---|------|
| G1 | 框选 N≥2 节点 → 工具栏「**生成 · N**」一键开跑；N 自动从"选区内的缺口可生成节点"算出。 |
| G2 | **混合拓扑**：选区内无边并行、有边等上游；选区外有结果的上游可直接引用。 |
| G3 | **缺口补跑**：已完成的不重跑、不扣分；失败的允许重试；生成中的不打断。 |
| G4 | 失败隔离：单节点失败不取消整批，只阻断其下游连通分量，兄弟分支继续。 |
| G5 | 积分不足时**优雅降级**而不是整批哑火：飞行中跑完、停发后续、只弹一次提示。 |
| G6 | 「**停止全部**」可中止飞行中任务，**未启动不变成 error**。 |
| G7 | 与构图组点击、导演台批量、Agent 一键跑图 全部**互不污染**。 |

---

## 3. 架构

### 3.1 双模块划分

```
┌──────────────────────────────────────────────────────────────────┐
│  packages/shared/src/canvas/selectionBatchGenerate.ts (纯函数)   │
│  ─ planSelectionGenerate({ selectedIds, canvas })               │
│     → { run: NodeId[], skip: SkipReason[], blockedBy: Edge[] }  │
│  ─ 拓扑排序、缺口判定、组展开、24 上限、环回收                  │
└──────────────────────────────────────────────────────────────────┘
                              ↓ plan
┌──────────────────────────────────────────────────────────────────┐
│  apps/web/src/composables/useSelectionGenerate.ts (Vue composable)│
│  ─ 状态：idle / running / stopping / done                        │
│  ─ 队列：并发 3，Kahn 出度入度                                   │
│  ─ 失败 / 缺上游 / insufficient_points / AbortController         │
│  ─ 每个任务调 generateForNode(node, { asRunGroupMember: true })  │
└──────────────────────────────────────────────────────────────────┘
                              ↓ run
┌──────────────────────────────────────────────────────────────────┐
│  apps/web/src/composables/useNodeGeneration.ts (现有, 不动)      │
│  ─ asRunGroupMember 跳过构图整组展开、跳过"再点=取消"           │
│  ─ 现有单节点扣费、轮询、ref 解析全部复用                       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
multiSelectedIds.value
   │
   ▼
planSelectionGenerate({ selectedIds, nodes, edges })
   │  ┌── 选区展开（含 group 子节点、排除 §3.3 类型）
   │  ├── 缺口判定（runGroupMemberHasUsableOutput 反义 + 状态过滤）
   │  ├── Kahn 拓扑（只算选区内、且自身要跑/在跑的边）
   │  ├── 选区外上游：作为引用解析源（已有结果直接用，没有就 skip）
   │  ├── 环：Kahn 剩余追加队尾
   │  └── 24 上限守卫
   ▼
{ run: NodeId[], skip: SkipReason[], blockedBy: Edge[] }
   │  N = run.length
   ▼
MultiSelectToolbar.vue
   │  "生成 · N" / 禁用态 tooltip
   ▼
useSelectionGenerate().start({ plan, canvas })
   │  准备就绪集（入度 0）→ 并发 3 调 generateForNode(asRunGroupMember: true)
   │  成功：释放下游入度
   │  失败：该下游不再启动，写入 error 摘要
   │  insufficient_points：停发后续，飞行中跑完，弹一次
   │  AbortController：未启动不入 error，飞行中走单节点取消
   ▼
节点上现有生成中徽章 + 工具栏"停止全部"
```

---

## 4. 规划器（`packages/shared/src/canvas/selectionBatchGenerate.ts`）

### 4.1 输入

```ts
export interface PlanSelectionGenerateInput {
  selectedIds: string[]
  canvas: {
    nodes: ReadonlyArray<{ id: string; type: string; parentNode?: string; data?: Record<string, unknown> }>
    edges: ReadonlyArray<{ id: string; source: string; target: string }>
  }
  /** 复用 useNodeGeneration 的事实 SSOT；保持调用方传入以避免 shared 依赖 web */
  hasUsableOutput: (node: { type: string; data?: Record<string, unknown> }) => boolean
  isInFlight?: (nodeId: string) => boolean  // 可选；为 true 的不进 run（不打断），但其下游仍等
}
```

### 4.2 输出

```ts
export type SkipReason =
  | { nodeId: string; reason: 'already_done' }
  | { nodeId: string; reason: 'unsupported_type' }
  | { nodeId: string; reason: 'fallback_pending' }
  | { nodeId: string; reason: 'missing_prompt' }       // 兜底；正常应 pre-run 已拦
  | { nodeId: string; reason: 'missing_upstream' }     // 引用了选区外、无可用结果
  | { nodeId: string; reason: 'no_output_yet' }        // 占位：V1 不出现，列以备

export interface PlanSelectionGenerateResult {
  run: string[]                          // Kahn 顺序
  skip: SkipReason[]
  blockedBy: Array<{ source: string; target: string; reason: 'cycle' | 'upstream_missing' }>
  groupExpanded: { groupId: string; childIds: string[] }[]  // 仅用于 UI 文案
}
```

### 4.3 算法

1. **选区展开**：对每个 `selectedId`：
   - 若 `type === 'group'`：并入其 `getGroupChildIds`（与 duplicate 共用 `packages/shared/src/canvas/groupChildIds.ts`）
   - `mediaInput` / `sceneComposer` / `videoComposition` / `worldModel` → `skip unsupported_type`
   - 其余 `image / video / audio / prompt / text / shot` 进入候选集
2. **状态过滤**（C1 修正）：
   - `hasUsableOutput(node) === true` → `skip already_done`（**仍可作下游引用**）
   - `data.status === 'fallback_pending'` → `skip fallback_pending`
   - `data.status === 'pending_confirm'` → **不进 run、不进 skip**，而是**整批拒绝**（抛 `SelectionBatchPendingConfirmError`）。理由：`pending_confirm` 是 Agent `proposeGeneration` 写入的 SSOT（`apps/server/src/agent/agent-canvas-tools.service.ts:612`），代表"Agent 已提议，正在等用户点确认芯片"——本特性**无权隐式 confirm**
   - 选区里**任一**节点 `pending_confirm` → 整批拒绝（UI 提示「选区包含 K 个 Agent 待确认节点，请先在侧栏逐个确认」）
   - `isInFlight === true` → **不进** `run`（不打断），但**仍作为下游阻塞边**
3. **Kahn 拓扑**：
   - 边过滤：只保留 `source ∈ selectedSet` **且** `target ∈ selectedSet` 的边
   - 候选集里"已 done"与"要跑/在跑"分别建图
   - **等待边**：源是"要跑/在跑"的边，目标入度 1
   - **非等待边**：源是"已 done"的边，目标入度 0（直接可起）
4. **环处理**：Kahn 跑完后剩余节点 = 环成员，**追加到 run 末尾**（保留原顺序），**不丢任务不死锁**。
5. **选区外上游**：执行时**不在本规划器判定**——移到执行器（`useSelectionGenerate`）做引用解析；解析失败时**单节点** `skip missing_upstream`，**不污染**兄弟节点。
6. **上限守卫**（C3 修正）：
   - `run.length > 24` → 抛 `SelectionBatchLimitError`（throw 而不是 return 部分结果，避免 UI 误显"跑了 0 个"）
   - **真实理由**（不是"与构图 dump 同阶"的巧合）：24 ≈ 单批异构 studio 扣分预算安全上限（按 8 节点图 + 16 节点视频 ≈ 估算的 p95）。**V1 拍 24**；`selection_batch_completed` 遥测回灌后，按"p95 单批积分成本 < 用户单次操作积分预算 30%"重订
   - 后续调参路径：见 §13.2 与 §10 风险表
   - 24 上限**不**做 soft warn（不"尝试跑 25 个再回滚"）——纯 throw，由 UI 拦截

### 4.4 单元测试清单（先锁行为）

| 场景 | 期望 |
|---|---|
| 5 个独立 image 候选 | `run.length === 5`，Kahn 顺序任意稳定 |
| 链 `prompt→image→video` 全部待跑 | `run === ['prompt','image','video']` |
| 链上 `image` 已 done | 视频仍依赖？**否**——选区内只算"要跑/在跑"作源；`run === ['video']` |
| 候选里有 1 个 `mediaInput` | 进 `skip unsupported_type` |
| 候选里有 1 个 `fallback_pending` | 进 `skip fallback_pending`，**不弹确认框** |
| 选区为 group | 展开子节点；group 本身不跑 |
| 24 + 1 候选 | 抛 `SelectionBatchLimitError` |
| 环 `A→B→A` | `run` 包含 A、B，**位置在 Kahn 之后** |
| 跨选区上游有结果 | 候选节点正常入 `run`（执行时引用） |
| 跨选区上游无结果 | 候选节点执行时 `skip missing_upstream`（**不**在 planner 里标） |
| 选区有 1 个 `pending_confirm` 节点（C1） | 抛 `SelectionBatchPendingConfirmError`（**不**返回部分 plan） |
| 选区有 25 个候选（C3） | 抛 `SelectionBatchLimitError` |

---

### 4.5 SSOT 依赖清单与暴露策略（C2 修正）

`useSelectionGenerate` 与 `planSelectionGenerate` 不重写判定逻辑，全部复用 `useNodeGeneration` 现网 SSOT。**下表拍板每个依赖的暴露策略**，避免实现期"该 export 没 export / 该提到 shared 没提"的脚手架扯皮。

| 依赖 | 现网位置 | 暴露策略 | 备注 |
|---|---|---|---|
| `runGroupMemberHasUsableOutput` | `useNodeGeneration.ts:725`（**当前私有**） | (A) **export 出来** | 加 `export function`，加 4 行注释；最简单，零行为改动 |
| `findNodeById` | `useNodeGeneration.ts:162`（**当前私有**） | (A) **export 出来** | 简单 wrapper，复用 |
| `isNodeBusy` | `useNodeGeneration.ts:256`（**当前私有**） | (A) **export 出来** | 单点 boolean 判定；§I1 节点消失守卫用 |
| `cancelGeneration` | `useNodeGeneration.ts:456`（**当前私有**） | (A) **export 出来** | 飞行中节点 abort 用 |
| `generateForNode(node, { asRunGroupMember: true })` | `useNodeGeneration.ts:775` | **已是 public**（闭包 return） | 通过 `useNodeGeneration` 闭包返回的同名函数调用 |
| `resolveUpstreamContext` | `useNodeGeneration.ts:833`（**当前私有**） | (A) **export 出来** | 选区外上游引用解析用 |
| `parseShortGenerationError` / `extractRefundedPointsFromError` | `utils/generationDiagnostic.ts` / `utils/generationPointsMessage.ts` | **已是 public export** | 直接 import |
| `NODE_GENERATION_STATUS` enum | `constants/dockStudio.ts:40` | **已是 public** | 直接 import；`pending_confirm` 是字符串（**不**在 enum），判定用 `String(data.status) === 'pending_confirm'` |
| `isDockGenerateBusy` | `constants/dockStudio.ts:48` | **已是 public** | 直接 import |
| `hasUsableOutput` 是否要放 shared？ | — | **否** | §4.1 输入形态采用 callback 注入：`hasUsableOutput: (node) => boolean` 由调用方传，避免 shared 依赖 web |
| `getGroupChildIds` | `packages/shared/src/canvas/groupChildIds.ts` | **已是 shared export** | 选区展开直接用 |

**防 drift 措施**：上面 (A) 路径**新 export 的函数**，在 `useNodeGeneration.test.ts` 已有用例之上，本特性**复用**其断言（不重写测试）；若 6 个月内这些函数被重构导致行为漂移，本特性的 planner 单测会**率先失败**——这是 spec 自带的 drift 监测。

**不**重复实现的边界：本特性**不**重写 `hasUsableOutput`、**不**重写 `findNodeById`、**不**重写上游解析。理由：重复实现 = 半年后两条逻辑漂移 = 静默 bug。

---

## 5. 执行器（`apps/web/src/composables/useSelectionGenerate.ts`）

### 5.1 状态机

```
idle ──start(plan)──▶ running ──plan 完成/全部 skip──▶ done
                          │
                          ├──stop()──▶ stopping ──in-flight 收口──▶ done
                          │
                          └──insufficient_points──▶ running（停发新）──▶ done
```

### 5.2 公开 API

```ts
// 节点 settle 的全部 outcome（I2-1 展开为 5 类别）
type SettleKind =
  | 'ok'
  | 'failed'
  | 'insufficient_points'   // 计入 progress.failed
  | 'cancelled'             // 用户主动 stop 引起的
  | 'timeout'               // 单节点 600s 兜底
  | 'in_flight'             // 节点在 batch 启动时已在跑（不进 run）
  | 'upstream_in_flight'    // 节点的上游正在跑（不进 run）
  | 'node_disappeared'      // 节点在 batch 期间被删
  | 'missing_upstream'      // 选区外上游无可用结果
  | 'unsupported_type'      // 类型不在 §4.3 白名单
  | 'fallback_pending'      // 平台回退中，跳过避免弹 N 个降级确认
  | 'already_done'          // 已有可用结果
  | 'user_stopped'          // batch 期间被用户停止（未启动）

type AbortReason =
  | 'none'                  // 自然完成
  | 'pending_confirm'       // 入口拒绝
  | 'limit_24'              // 入口拒绝
  | 'user_stopped'          // 用户点「停止全部」
  | 'insufficient_points'   // 积分耗尽
  | 'batch_timeout'         // 30min 到
  | 'node_timeout'          // 单节点 600s 累积导致（极端）

interface BatchProgress {
  done: number
  failed: number          // 含 insufficient_points
  cancelled: number       // 仅用户主动 stop
  timeout: number         // 仅单节点 600s
  skipped: number         // in_flight + upstream_in_flight + node_disappeared + missing_upstream + unsupported_type + fallback_pending + already_done + user_stopped
  total: number
  abortReason: AbortReason
}

export function useSelectionGenerate(deps: {
  nodes: Ref<EditableFlowNode[]>
  edges: Ref<CanvasEdgeLike[]>
  /** 复用 useNodeGeneration 的核心 */
  generateForNode: (node: EditableFlowNode, opts: { asRunGroupMember: true }) => Promise<void>
  /** 复用 hasUsableOutput 判定（不重写） */
  hasUsableOutput: (node: EditableFlowNode) => boolean
  /** 解析 node 引用的"上游节点 id 列表"——只关心是否存在 + hasUsableOutput */
  resolveUpstreamIds: (node: EditableFlowNode) => string[]
  /** 显式取消一个 in-flight 节点（C2-5 / I2-5：不等 AbortController 自动传播） */
  cancelGeneration: (nodeId: string) => void
  /** 通知层 */
  toast: (msg: string, kind?: 'info' | 'warn' | 'error') => void
}) {
  const state = ref<'idle' | 'running' | 'stopping' | 'done'>('idle')
  // I2-1 修正：5 进度 + abortReason
  const progress = ref<BatchProgress>({
    done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
    abortReason: 'none',
  })
  const abortCtrl = new AbortController()
  // C2-2 修正：timer 独立于 loop；inFlight 不 settle 也能触发超时
  let batchTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  const batchStartTs = Date.now()

  async function start(plan: PlanSelectionGenerateResult): Promise<BatchSummary> { /* §5.3 */ }
  function stop(): void { /* §5.3 stop 路径 */ }

  return { state, progress, start, stop }
}

interface BatchSummary {
  abortReason: AbortReason
  done: number; failed: number; cancelled: number; timeout: number; skipped: number
  durationMs: number
  creditCost: number   // I2-4：本批实际扣分合计
}
```

### 5.3 调度循环

```typescript
// ============================================================================
// C2-1 修正：Map<NodeId, Promise<unknown>> 而非 Set<NodeId>——Promise.allSettled
// 需要 iterable of promises，不是 string ids
// ============================================================================
const runSet = new Set(plan.run)
const inFlight = new Map<NodeId, Promise<unknown>>()  // id → 该节点的实际 promise

// C2-5 补：waitingMap 用 Map<NodeId, NodeId[]>，每个 target 记录剩余上游依赖
const waitingMap = new Map<NodeId, NodeId[]>()

const skipped = new Map<NodeId, SkipReason>()
const semaphore = 3
let pointsExhausted = false
let creditCost = 0  // I2-4：本批实际扣分

// ----------------------------------------------------------------------------
// C2-3 修正：in-flight 节点 + 其下游都不进 run，由用户下一批再跑
// 理由：保持"缺口补跑"语义一致；不要在执行器里订阅 useNodeGeneration 的
// in-flight 完成事件（避免与 useNodeGeneration 内部 polling 状态耦合）
// ----------------------------------------------------------------------------
for (const id of plan.run) {
  const node = findNode(id)
  if (!node) {
    // I2-6：节点消失 → 标记 + 视为 ok 释放下游（避免下游卡死）
    skipped.set(id, { reason: 'node_disappeared' })
    progress.skipped++
    releaseDownstream(id)
    continue
  }

  // 节点在 batch 启动时已在跑 → 跳过本批
  if (deps.isInFlight?.(id) === true) {
    skipped.set(id, { reason: 'in_flight' })
    progress.skipped++
    releaseDownstream(id)
    continue
  }

  // 解析上游
  const upstreamIds = resolveUpstreamIds(node)
  const upstreamInSelection = upstreamIds.filter(uid => runSet.has(uid))
  const upstreamExternal = upstreamIds.filter(uid => !runSet.has(uid))

  // 上游在跑（不在本批 run）→ 跳过
  const inflightUpstream = upstreamExternal.find(uid => deps.isInFlight?.(uid) === true)
  if (inflightUpstream) {
    skipped.set(id, { reason: 'upstream_in_flight', ref: inflightUpstream })
    progress.skipped++
    releaseDownstream(id)
    continue
  }

  // 选区外上游无可用结果 → 跳过 + 写 errorMessage
  const missingUpstream = upstreamExternal.find(uid => !deps.hasUsableOutput(findNode(uid)))
  if (missingUpstream) {
    skipped.set(id, { reason: 'missing_upstream', ref: missingUpstream })
    progress.skipped++
    patchNodeErrorMessage(id, `引用节点 [${missingUpstream}] 无可用结果`)
    releaseDownstream(id)
    continue
  }

  // 入度 0 → 入 queue；否则入 waitingMap
  if (upstreamInSelection.length === 0) {
    queue.push(id)
  } else {
    waitingMap.set(id, upstreamInSelection)
  }
}

progress.total = plan.run.length
state.value = 'running'

// ============================================================================
// C2-2 修正：全批 30min timer 与 loop 解耦
// 即使 inFlight 永远不 settle，timer 也会触发
// ============================================================================
batchTimeoutHandle = setTimeout(() => {
  if (state.value === 'done') return
  abortCtrl.abort('batch_timeout')
  toast('本批超过 30min 已自动停止', 'warn')
}, MAX_BATCH_DURATION_MS)

// ============================================================================
// 主 loop：microtask 循环 + 显式 await inFlight 变化
// ============================================================================
while (true) {
  // abort 路径：未启动全部标 user_stopped；显式取消 in-flight
  if (abortCtrl.signal.aborted) {
    for (const id of queue) {
      skipped.set(id, { reason: abortCtrl.reason as AbortReason })
      progress.skipped++
    }
    queue.length = 0
    waitingMap.clear()
    // I2-5：显式调 cancelGeneration，**不等** AbortController 自动传播
    for (const id of inFlight.keys()) {
      deps.cancelGeneration(id)
    }
    break  // 跳出 loop；inFlight 仍在 settle 中，由外层 Promise.allSettled 收口
  }

  if (queue.length === 0 && inFlight.size === 0) {
    break  // 自然完成
  }

  // 启动能起的任务
  while (semaphore > 0 && queue.length > 0) {
    const id = queue.shift()!
    const node = findNode(id)
    if (!node) {
      skipped.set(id, { reason: 'node_disappeared' })
      progress.skipped++
      releaseDownstream(id)
      continue
    }

    inFlight.set(id, runOneNode(id, node))
    semaphore--
  }

  if (inFlight.size === 0) {
    // queue 空 + inFlight 空已在上面 break；这里不会到达
    break
  }

  // 等待 inFlight 任意一个 settle，**真正的 promise**——C2-1 修复
  await Promise.race([...inFlight.values()])
  // loop 顶部会处理已经 settled 但还在 map 里的（onNodeSettled 已删）
}

// ============================================================================
// 收口：等所有 in-flight 真 settle（自然 settle 或被 cancelGeneration 取消）
// ============================================================================
await Promise.allSettled([...inFlight.values()])
if (batchTimeoutHandle) clearTimeout(batchTimeoutHandle)

state.value = 'done'

// ============================================================================
// runOneNode：单节点启动 + 单点超时 + onNodeSettled 收口
// ============================================================================
async function runOneNode(id: NodeId, node: EditableFlowNode): Promise<void> {
  const nodeStartTs = Date.now()
  let timerHandle: ReturnType<typeof setTimeout> | null = null

  try {
    const settlePromise = deps.generateForNode(node, { asRunGroupMember: true })
      .then(() => 'ok' as SettleKind)
      .catch(err => classifyError(err))

    // C2-4 修正：timer ID 显式存，.finally 里清理——无 timer leak
    const timeoutPromise = new Promise<SettleKind>(resolve => {
      timerHandle = setTimeout(() => resolve('timeout'), MAX_WAIT_PER_NODE_MS)
    })

    const kind = await Promise.race([settlePromise, timeoutPromise])
    onNodeSettled(id, kind, Date.now() - nodeStartTs)
  } finally {
    if (timerHandle) clearTimeout(timerHandle)
  }
}

// ============================================================================
// onNodeSettled：完整定义（C2-5 补）
// ============================================================================
function onNodeSettled(id: NodeId, kind: SettleKind, durationMs: number) {
  inFlight.delete(id)
  semaphore++

  // telemetry：每个节点 settle 都上报
  telemetry('selection_batch_node_settled', { nodeId: id, kind, durationMs })

  // 扣分累计（I2-4；ok / failed 都计，cancel / timeout 不计）
  if (kind === 'ok') {
    progress.done++
    creditCost += 1  // 占位：实际从 useNodeGeneration 回调拿
  } else if (kind === 'failed' || kind === 'insufficient_points') {
    progress.failed++
    if (kind === 'insufficient_points') pointsExhausted = true
  } else if (kind === 'cancelled') {
    progress.cancelled++
  } else if (kind === 'timeout') {
    progress.timeout++
  }
  // 其他 kind（'node_disappeared' 等）已在循环入口计入 progress.skipped

  // 释放下游：waitingMap 里删该 id，看下游入度归零则入 queue
  releaseDownstream(id)
}

function releaseDownstream(sourceId: NodeId) {
  for (const [target, deps] of waitingMap) {
    const remaining = deps.filter(d => d !== sourceId)
    if (remaining.length === 0) {
      waitingMap.delete(target)
      if (!inFlight.has(target) && !skipped.has(target) && !queue.includes(target)) {
        queue.push(target)
      }
    } else {
      waitingMap.set(target, remaining)
    }
  }
}

function classifyError(err: unknown): SettleKind {
  if (err?.code === 'insufficient_points') return 'insufficient_points'
  if (err?.code === 'cancelled' || err?.name === 'AbortError') return 'cancelled'
  return 'failed'
}
```

**为什么不再用 `Promise.allSettled(inFlight)`（C2-1）**：`inFlight` 是 `Map<NodeId, Promise<unknown>>`——直接 `[...inFlight.values()]` 取 promise iterable；`Promise.allSettled` 接收 iterable of promises，得到正确行为。

**为什么 timer 与 loop 解耦（C2-2）**：`batchTimeoutHandle = setTimeout(...)` 在 `start()` 入口启动；timer 不依赖 loop 是否阻塞。即使 `inFlight` 中某个 promise 永不 settle，30min 到点 timer 触发 `abortCtrl.abort('batch_timeout')`，loop 下一轮顶部检测到 abort 走停止路径。

**为什么 in-flight 节点不进 run（C2-3）**：
- v1/v2 的设计"等 in-flight 完成"需要执行器订阅 `useNodeGeneration` 的状态变化，与 polling 状态耦合
- v3 改为"in-flight + 下游全 skip（理由 `in_flight` / `upstream_in_flight`）"，等用户下一批再跑
- 代价：用户需点两次（一次在跑时不能 batch）
- 收益：执行器无外部订阅依赖；逻辑闭环；与"缺口补跑"语义一致

**为什么用 `releaseDownstream` 复用（C2-5）**：`onNodeSettled` 和 `node_disappeared` 都要"释放下游"——抽出共用函数避免逻辑漂移。

### 5.4 错误分类（I2-1 修正：5 进度类别）

```ts
type SettleKind =
  | 'ok'                    // 成功
  | 'failed'                // 节点错误
  | 'insufficient_points'   // 积分不足（计入 failed）
  | 'cancelled'             // 用户主动 stop（计入 cancelled）
  | 'timeout'               // 单节点 600s 兜底（计入 timeout）

function classifyError(err: unknown): SettleKind {
  if (err?.code === 'insufficient_points') return 'insufficient_points'
  if (err?.code === 'cancelled' || err?.name === 'AbortError') return 'cancelled'
  return 'failed'
}
```

**进度 5 类别（I2-1）**：

| kind | 计入 | 备注 |
|---|---|---|
| `ok` | `progress.done++` | 节点 `data.status === 'completed'` + url 有效 |
| `failed` | `progress.failed++` | 节点 `data.status === 'error'`；errorMessage 由单节点错误处理写好 |
| `insufficient_points` | `progress.failed++` + `pointsExhausted = true` | 扣分耗尽，全局标志；不再 push 新任务；只弹一次 toast |
| `cancelled` | `progress.cancelled++` | 用户主动 stop 触发；**不**写 errorMessage |
| `timeout` | `progress.timeout++` | 600s 兜底；**不**写 errorMessage；telemetry 上报 `node_settle_timeout` |

**「停止全部」积分语义（C5 + I2-5 锁定）**：
- I2-5：单节点取消走**两条路径**：
  - 路径 A：`deps.cancelGeneration(id)` 显式调（**不等** AbortController 自动传播）
  - 路径 B：现有 `cancelGeneration` → `studioApi.cancelGeneration(recordId)`（`useNodeGeneration.ts:341`）
- 与现网单节点取消一致：**已扣分不退还**（与 §9 "不为生成任务本身提供 Undo" 一致）
- 飞行中每个节点**都触发**路径 A 调用；spy 验证调用次数 = inFlight.size
- 取消次数作为 telemetry 字段上报，让运营能统计「用户主动停」 vs 「系统超时停」

**收尾 toast 5 列**：「完成 X，失败 Y，取消 C，超时 T，跳过 Z」——超长时折叠（X+Y+C+T+Z > 4 时改「完成 X，失败 Y，其他 N」）

### 5.5 关键不变量

- 同一 nodeId **不重复**入 `inFlight`（C2-1：`inFlight` 是 `Map`，id 天然唯一）
- `queue.shift()` 与 `inFlight` 操作**不并发**（单 microtask 顺序）
- 24 上限在 planner 抛错已拦；执行器**不再**二次判断
- `asRunGroupMember: true` 是**强制**，禁止调用方覆盖（防 `compositionGenerateIdsForClick` 漏底）
- C2-2：`MAX_BATCH_DURATION_MS = 1_800_000`（30min）由 `start()` 入口的 `setTimeout` 独立触发，**不**依赖 inFlight 状态；timer 在 `start()` 收口（自然 done / abort 完成）时 `clearTimeout`
- C2-4：单节点 `MAX_WAIT_PER_NODE_MS = 600_000`；timer ID 显式存，`.finally` 里清理——无 timer leak
- I2-5：stop 路径**显式**调 `deps.cancelGeneration(id)` 对每个 in-flight 节点——不依赖 AbortController 内部传播
- I2-6：节点消失（Agent / 用户并发编辑）是**预期**事件；进 `skipped` 集，reason `node_disappeared`；调 `releaseDownstream(id)` 让下游不卡死
- I2-3：`pointsExhausted` 是**batch 级**全局标志；`selection_batch_completed.pointsExhausted` 字段保留；`selection_batch_node_settled` **不**带此字段

---

## 6. UI（`apps/web/src/components/canvas/MultiSelectToolbar.vue`）

### 6.1 新增 emit

```ts
const emit = defineEmits<{
  // ... 现有
  generateSelection: []    // 新增
  stopSelection: []         // 新增（"停止全部"）
}>()
```

### 6.2 新增 props

```ts
defineProps<{
  // ... 现有
  selectionBatch?: {
    runCount: number         // N
    state: 'idle' | 'running' | 'stopping'
  }
}>()
```

### 6.3 按钮位置（M6 + I2-7 调整）

`生成 · N` 插到**「生成视频」之后、「解组/打组 条件位」之前**，加竖线分隔（不改用户既有视觉习惯）：

```
[生成视频] | [生成 · N] | [解组/打组] | [新建副本/含上游] | [加入 Agent 引用] | [整理布局] | [导出工作流] | [删除]
```

**「解组/打组 条件位」说明（I2-7）**：「打组」和「解组」是**互斥条件**的同一个槽位：
- `解组`：`canUngroup === true && selectedIds.length === 1`
- `打组`：`canUngroup === false && selectedIds.length >= 2`

任何时刻只显示其中一个。`生成 · N` 的位置**不**插入到这个槽位内部，而是插到**这个条件槽位之前**。

理由：现网习惯"生成视频"在最前（已沉淀为用户肌肉记忆）；新按钮**不抢**既有入口位置，但**在视觉上紧邻**（语义相邻：都是「生成」类）。两个按钮在文本+已出图共选时**同时出现**（§6.5）。

| 状态 | 表现 |
|------|------|
| `selectedIds.length < 2` | 隐藏（与现有多选工具栏规则一致） |
| `runCount ≥ 1` 且 `state === 'idle'` | 主按钮可用，文案「**生成 · N**」，accent 色 |
| `runCount === 0` 且 `selectedIds.length ≥ 2` | 主按钮**禁用**，tooltip「所选节点均已有结果或不可生成」 |
| 选区含 `pending_confirm` 节点（C1） | 主按钮**禁用**（accent 变灰），tooltip「选区包含 K 个 Agent 待确认节点，请先在侧栏逐个确认」 |
| 24 超限（C3） | 主按钮**禁用**，tooltip「本批超过 24 个上限，请缩小选区」 |
| `state === 'running'` | 主按钮**变**为「**停止全部**」，danger 色；点 → `emit('stopSelection')` |
| `state === 'stopping'` | 主按钮禁用，文案「停止中…」 |
| 选区有 group 展开 | 主按钮上方一行小字：「将生成 4 个，跳过 2 个（已有结果 1，缺少上游 1）」——文案例 §6.4 |

### 6.4 文案

| 触发 | Toast | 类型 |
|------|-------|------|
| 计划生成时 | 「将生成 N 个，跳过 M 个（已有结果 a，缺少上游 b，不支持类型 c）」 | info |
| 选区含 `pending_confirm` 节点（C1） | 「选区包含 K 个 Agent 待确认节点，请先在侧栏逐个确认」 | warn |
| 24 超限（C3） | 「本批超过 24 个上限（V1 暂定值），请缩小选区」 | error |
| 积分不足 | 「积分不足，飞行中任务跑完后停止后续生成」**只弹一次** | warn |
| 全部完成（C5） | 「完成 X，失败 Y，取消 C，跳过 Z」 | info |
| 主动停止 | 「已停止。完成 X，失败 Y，取消 C，未启动 Z」 | info |
| 全批超时（C4） | 「本批超过 30min 已自动停止」 | warn |

**全部文案走现网 i18n key**（项目如有 `i18n.t('canvas.batch.xxx')` 约定则用 key 调用；否则用中文常量但放入 `apps/web/src/locales/zh-CN.ts` 收口）。

### 6.5 与现有「生成视频」并存

- 文本 + 已出图共选时**两个按钮同时出现**：
  - 「生成 · N」（N 通常 = 2：图 + 文）—— **跑选中节点**
  - 「生成视频」—— **新建 video 节点并生成**
- 两者**不合并**、**不互相禁用**

---

## 7. 与现网的关键边界

| 场景 | 走哪条路径 | 验证 |
|---|---|---|
| 用户框选一个 `composition` 节点 | **本特性**：只跑选中的；**不会**展开整组 | 单测：`useSelectionGenerate` 收到 `composition` 节点时，调用 `generateForNode(asRunGroupMember: true)`，**不**经 `compositionGenerateIdsForClick` |
| 用户在构图组节点上**单击**（非框选） | **现网**：`compositionGenerateIdsForClick` → 展开整组 | 不在本特性范围内；回归测试不破坏 |
| 用户点击 `sceneComposer` 节点的"批量生成" | **现网**：`POST /agent/canvas/scene-composer/batch-generate` | 导演台入口不受影响；`sceneComposer` 节点在 `unsupported_type` 集合里 |
| Agent 在 `canvas_agent` 轮里写一个 prompt 节点 | **现网**：单节点 `propose_generation` | 本特性不修改 `EXPLORE_WRITE_TOOLS`，Agent 路径零变更 |
| 用户按 `Cmd/Ctrl+D` 复制多选 | **现网**：`duplicateSubgraph` | 与本特性**无重叠**；同时按住也只触发复制 |

---

## 8. 测试计划

### 8.1 单元测试（先锁行为再写 UI）

`packages/shared/src/canvas/selectionBatchGenerate.test.ts`：
- 独立并行、链式等待、跳已 done、引用选区外有结果、缺上游标记、组展开、24 上限、环、unsupported 类型、fallback_pending 不入队列

`apps/web/src/composables/useSelectionGenerate.test.ts`：
- `generateForNode` 被调用的 `id` 集合 = `plan.run`
- `asRunGroupMember: true` **每次**都传（用 spy 验证）
- 构图组节点被框选时**不**展开到选区外（mock `compositionGenerateIdsForClick` 验证 0 调用）
- 并发 ≤ 3（用 `vi.useFakeTimers` + 计数）
- 一个失败不取消其它连通分量
- `insufficient_points` 停发后续、飞行中跑完、toast 弹一次
- `stop()` 后未启动的 `node.data.status` **不**变 `error`

`apps/web/src/components/canvas/MultiSelectToolbar.test.ts`：
- N ≥ 1 显示「生成 · N」
- N = 0 禁用
- 与「生成视频」**可同时**出现
- `state === 'running'` 时主按钮变「停止全部」

### 8.2 E2E（手动 + 录制）

- 准备：5 个独立 image 节点（无连线）
- 框选 5 个 → 「生成 · 5」→ 点击 → 全部跑出
- 准备：链 `prompt→image→video`，全部 draft
- 框选全部 → 「生成 · 3」→ 串行跑
- 准备：选 1 个已 done image + 2 个 draft image
- 框选 → 「生成 · 2」（已 done 跳过）→ 跑剩下 2 个
- 准备：跨选区上游 缺结果
- 框选下游 video → 节点上出现 errorMessage "引用节点 [xxx] 无可用结果"，其它节点继续
- 准备：积分不足（模拟或沙盒环境）
- 跑 → 第一个扣分失败 → toast 弹一次 → 后续不启动 → 飞行中完成

### 8.3 回归（必须绿）

- `pnpm --filter @lnkpi/web test -- compositionRunGroup` — 构图组点击展开不变
- `pnpm --filter @lnkpi/web test -- useNodeGeneration` — 单节点生成 / `asRunGroupMember` 路径不变
- `pnpm --filter @lnkpi/server test -- scene-composer` — 导演台批量不变
- `pnpm build` — 不引出 2E-D5 违规
- 部署 H8 verify — 不破坏 canvas_operator V1–V4 金标

---

## 9. 非目标（V1 显式不做）

- **Agent `run_*` / 一键跑整张图**（违反 2E-D5）
- **图级自动按边出图**（与 Agent 一键跑同性质，2E-D5 / 2E §0.4）
- **导演台混进这个按钮**（`sceneComposer` 走自家 `batch-generate`）
- **"全部重新生成" 主按钮**（V1 不做；隐藏菜单/长按暂不立项）
- **批次持久化**（刷新后未启动不偷偷开跑）
- **快捷键**（P1 再议）
- **整批积分预扣 API**（异构 studio 无 quote；新通道不在本特性开）
- **跨账号 / 跨 session** 协作
- **构图整组展开**（绕开 `compositionGenerateIdsForClick`）
- **UI 排序选项 / 沿时间戳跑**（P1）

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 误点"生成 · N"扣一大笔分 | 显式按钮 + 选区摘要 + 缺口补跑（已 done 不重跑）+ feature flag 默认 off（§13.1） |
| 选区外上游被静默跳过造成用户困惑 | 节点 `errorMessage` 写明"引用节点 [xxx] 无可用结果"；选区摘要行也列出 missing_upstream 数 |
| 飞行中节点与用户新操作冲突（用户又单点了同一节点） | `asRunGroupMember: true` 走单节点已有逻辑（`isNodeBusy` / `isDockGenerateBusy` 检查）；并发去重靠 `inFlight` 集合 |
| AbortController 取消后状态不一致 | 未启动不入 error；inFlight 由单节点自身取消路径处理（与现网单节点 cancel 行为一致） |
| 24 上限被绕过 | planner 抛错 → UI 拦截显示；执行器**不**做二次判断（避免分叉） |
| 24 上限拍脑袋（I2 v2 揭示） | 真实理由见 SB-D14 + §4.3 #6；遥测回灌后按 p95 积分成本重订，**不**写死 |
| `generateForNode` silent hang | C4 硬超时双闸（单节点 600s / 全批 30min）；超时走 `cancelled` 路径不写 errorMessage |
| 与多选工具栏的现有 emit 冲突 | 新增 `generateSelection` / `stopSelection` 两个 emit，不修改现有；现有按钮位置不动 |
| 用户期待"框一条链就一路跑到底"被混合拓扑挡 | 混合拓扑**就是**这个语义；UI 选区摘要明示 M 跳过 a/b/c |
| 上线后运营盲飞（I2 v2 揭示） | §13 telemetry 必埋 `selection_batch_completed` 等 4 类事件；后台按 5xx 比例 + 取消率告警 |
| 出 bug 没法 kill switch（I3 v2 揭示） | `feature.selection_batch_generate` flag 灰度上线 + 远程 toggle 通道；flag off 整按钮不渲染 |
| 私有函数 export 扯皮（C2 v2 揭示） | §4.5 SSOT 依赖清单已拍板 (A) export 路径；不重写逻辑，靠现网测试做 drift 监测 |
| `pending_confirm` 被隐式 confirm（C1 v2 揭示） | 整批拒绝 + UI 显式提示；守住 Agent HITL 门，与 2E-D5 一致 |
| Agent 期间 batch 撞上节点消失 | I1 守卫 + `node_disappeared` skip reason；batch 不崩视为预期 |

---

## 11. 验收

1. 框选 5 个独立 image 节点 → 「生成 · 5」→ 全部跑出（5/0 失败/0 跳过）。
2. 框选 `prompt→image→video` 全 draft → 串行完成；video 拿到 image 的 URL。
3. 框选 1 已 done + 2 draft → 「生成 · 2」；已完成 image 仍被 video 引用。
4. 跨选区上游缺结果 → 该下游节点 `errorMessage` 写明原因；兄弟分支继续。
5. 24 + 1 → 整批拒绝，UI 提示缩小选区。
6. 环 `A→B→A` → 全部跑出（Kahn 后追加队尾）。
7. 飞行中点「停止全部」→ 飞行中节点走单节点取消；未启动**不**变 error。
8. 积分不足（沙盒）→ 第一个扣分失败 → toast 弹一次 → 后续停发；飞行中跑完。
9. 框选含 `sceneComposer` → 跳过 + 摘要行 "不支持类型 1"；导演台入口不受影响。
10. 框选一个 `composition` 节点 → 只跑该节点（**不**通过 `compositionGenerateIdsForClick` 展开）；spy 验证 0 调用。
11. 文本 + 已出图共选 → 「生成 · 2」**和**「生成视频」**同时**出现；不互相禁用。
12. `pnpm build` / `pnpm --filter @lnkpi/web test` / `pnpm --filter @lnkpi/agent test` 全绿；H8 不破坏。
13. (C1) 选区含 1 个 `pending_confirm` 节点 → 主按钮禁用 + tooltip「选区包含 1 个 Agent 待确认节点」；点不动；无网络请求
14. (C3) 选区含 25 个候选 → 主按钮禁用 + tooltip「本批超过 24 个上限」；planner 抛 `SelectionBatchLimitError`
15. (C4) mock `generateForNode` 永不 resolve → 600s 后 `progress.cancelled++`；不写 errorMessage；telemetry 上报 `node_settle_timeout`
16. (C4) 飞行中 30min → 工具栏自动变「停止全部」+ toast「本批超过 30min 已自动停止」
17. (C5) 飞行中 5 个 + 点「停止全部」→ `studioApi.cancelGeneration` 被调用 5 次；`progress.cancelled === 5`；收尾 toast「完成 0，失败 0，取消 5，跳过 0」
18. (I2) 完成一批后，telemetry 上报 `selection_batch_completed { total, done, failed, cancelled, skipped, durationMs, pointsExhausted, userStopped, runCountAtStart }`
19. (I3) `feature.selection_batch_generate = false` → 多选工具栏**不渲染**「生成 · N」按钮（DOM 中无该元素）；恢复 on 后立即出现
20. (I1) 启动 batch → 期间 Agent 删 inFlight 节点 → batch 不崩；`progress.skipped++`；reason `node_disappeared`

---

## 12. 实现提示（不属决策；供写 plan 时使用）

| 关注点 | 提示 |
|---|---|
| 选区展开 | 复用 `packages/shared/src/canvas/groupChildIds.ts` 的 `getGroupChildIds` |
| 缺口判定 | 复用 `useNodeGeneration.runGroupMemberHasUsableOutput`（提到 shared 或以 callback 注入，避免 shared 依赖 web） |
| 引用解析 | 复用 `useNodeGeneration.resolveUpstreamContext` / `resolveNodeRefs`；或仅复用其"哪些是上游 id"这一最小子集 |
| 单节点启动 | `generateForNode(node, { asRunGroupMember: true })`（已存在，`useNodeGeneration.ts:775`） |
| 错误捕获 | 复用现有 `parseShortGenerationError` / `extractRefundedPointsFromError` |
| Toast | 现有 `ElMessage` / `notify*` 工具，不新造通道 |
| 单测 fake | 与 `compositionRunGroup.test.ts` / `useNodeGeneration.test.ts` 同套 fake（`goldCanvas()` 等） |

> 写实现 plan 时按 `superpowers:writing-plans` 走，逐 task 拆，文件清单见 §5.1、§6.1、§6.2。`packages/shared` 任务必须先于 `apps/web` 任务提交（planner 单测先绿），与项目历史切片一致。

---

## 13. 可观测性 / 灰度 / 远程 Kill Switch（I2 + I3 增补）

### 13.1 Feature Flag（I3）

| 字段 | 值 |
|---|---|
| Flag key | `feature.selection_batch_generate` |
| 默认值 | `false`（**v1 灰度默认 off**） |
| 灰度路径 | `false → 内部账号 100% → 公开 10% → 50% → 100%`（按周） |
| 远程 toggle 通道 | 沿用项目现网 `useFeatureFlag` / `featureFlags` 配置（**不**新造通道） |
| Fallback | flag off 时 `MultiSelectToolbar.vue` **不渲染**「生成 · N」按钮（DOM 无此元素），其余按钮行为不变 |
| Kill switch | flag → false 后已开批仍走完，不强中断；新批直接拒绝（与 SB-D16 一致） |
| 灰度观察期 | 每个灰度阶梯 ≥ 7 天；观察 §13.2 埋点 |

**为什么默认 off**：避免上线瞬间出现未发现的"24 上限拍脑袋"问题大批量扣分；灰度期内允许线上重订 24 数值。

### 13.2 Telemetry（I2）

**不新造埋点通道**，沿用项目现网 `notify*` / `executionTrace` 管道（参考 `useNodeGeneration.ts` 内的 `notifyGenerationSaveLocalHint`）。

#### 13.2.1 事件清单

| 事件 | 触发时机 | 字段 | 用途 |
|---|---|---|---|
| `selection_batch_started` | 用户点「生成 · N」按钮 | `sessionId, runCount, skipCount, total, triggerSource, flagOn` | 计数 + 灰度验证 |
| `selection_batch_node_settled` | 每个节点 settle（无论 kind） | `sessionId, nodeId, kind, durationMs` | 性能 + 失败分类（**不带** `pointsExhausted`：I2-3 修正，是 batch 级不是 node 级） |
| `selection_batch_plan_rejected` | planner 入口拒绝（M2-7 补：plan 失败也是数据） | `sessionId, reason: 'pending_confirm' \| 'limit_24', candidateCount, blockedCount` | 让 PM 知道「用户被拦了 X 次」 |
| `selection_batch_completed` | 整批收口（done / stop / timeout 任意收口） | `sessionId, total, done, failed, cancelled, timeout, skipped, durationMs, creditCost, creditRefunded?, pointsExhausted, runCountAtStart, abortReason: AbortReason` | 核心指标（I2-2 闭合 abortReason；I2-4 加 creditCost） |

**`triggerSource` 取值**（I2 修正，可扩展）：`'multi_select_toolbar' | 'context_menu' | 'keyboard_shortcut' | 'programmatic'`——v1 仅 `multi_select_toolbar`，后续入口预留。

**`abortReason` 与 `triggerSource` 的关系**：triggerSource 是**入口**；abortReason 是**结果**——两个独立维度。

**移除**（v2 错误设计）：
- ~~`capHit`~~ → 重命名为 `abortReason`，闭合 6 个值（含 `user_stopped` / `insufficient_points` / `node_timeout`）
- ~~`userStopped` 字段~~ → 改为读 `abortReason === 'user_stopped'`
- ~~`selection_batch_aborted` 事件~~ → 与 `_completed.abortReason` 重复；删除
- ~~`node_settled.pointsExhausted`~~ → 是 batch 级（I2-3）

#### 13.2.2 关键派生指标（运营 dashboard）

- `batchCompletionRate = completed.done / completed.total`（健康度）
- `nodeCancelRate = (node_settled.cancelled + node_settled.timeout) / node_settled.total`（用户主动停 + 系统兜底）
- `abortReasonRate` 按 `abortReason` 维度 group by——「`user_stopped` 占比 / `node_timeout` 占比 / `insufficient_points` 占比」——这是重订 SB-D14 24 数值 + 重审 UI 误点风险的关键输入
- `planRejectRate = selection_batch_plan_rejected.total / selection_batch_started.total`（入口拒绝率——看 `pending_confirm` 和 `limit_24` 哪个更频繁）
- `p95BatchDurationMs = percentile(selection_batch_completed.durationMs, 0.95)`
- `p95BatchCreditCost = percentile(selection_batch_completed.creditCost, 0.95)`（**重订 24 阈值的关键输入**）

**Dashboard 平台（I2-9 修正）**：沿用项目现网 X（具体名称 plan 阶段定）。**派生指标必须能在 dashboard 上看到公式 + 数据源**，否则是 theater。

#### 13.2.3 告警规则

| 指标 | 阈值 | 动作 |
|---|---|---|
| `nodeCancelRate` 7 日均值 | > 30% | 通知 PM 评估 UI 误点风险 |
| `abortReasonRate` 7 日均值（`user_stopped`） | > 20% | 通知 PM 评估 SB-D10 "全部重新生成" 是否需要提前到 P1 |
| `abortReasonRate` 7 日均值（`node_timeout`） | > 5% | 通知平台检查后端生成服务（这是后端慢，不是前端 bug） |
| `abortReasonRate` 7 日均值（`limit_24`） | > 5% | 通知 PM 评估 SB-D14 阈值是否过紧 |
| `planRejectRate` 7 日均值（`pending_confirm`） | > 10% | 通知 PM 评估是否要给「生成 · N」加更明显的"先确认"提示 |
| `planRejectRate` 7 日均值（`limit_24`） | > 10% | 通知 PM 评估是否要把 24 拆批 |
| `selection_batch_completed` 上报失败 | > 1% | 通知平台检查 telemetry 管道 |

**通知通道（I2-9 修正）**：
- 沿用项目现网告警通道（具体名称 plan 阶段确定）
- 每个告警**必须**有 owner（PM / 平台 / 后端），无 owner 的告警不上线

### 13.3 远程 Kill Switch 演练

- **演练时机**：v1 上线后第 1 周、第 4 周
- **演练内容**：把 flag 切到 `false`，观察 1 小时内新批归零（dashboard 实时）
- **回滚预案**：flag false 后已开批**不**强中断（按 SB-D16），收尾统计 `selection_batch_completed.userStopped: true`

### 13.4 不埋点的事件（避免噪声）

- 节点单点进度（已由现网 `generationRecordId` polling 覆盖，不重复）
- 节点 reference 解析失败（计入 `selection_batch_node_settled.kind = 'missing_upstream'`，**不**单独再发）

**plan 入口失败埋点**：见 §13.2.1 `selection_batch_plan_rejected`——M2-7 修正，**不**放这里。
