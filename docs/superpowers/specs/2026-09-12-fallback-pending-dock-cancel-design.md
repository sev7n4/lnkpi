# fallback_pending：Dock 按钮语义 + 取消写回 Design

**Date:** 2026-09-12  
**Status:** Approved for planning (pending user review of this file)  
**Trigger:** 生产任务 `cmtx2mg8d0059pe01ai6im03g`（Agnes keyframes 参考图超限 → `fallback_pending`；Dock 仍显示进行中；取消后 DB/节点不同步）

## Goal

让 `fallback_pending`（BYOK 失败后待确认平台回退）在 Dock 上**不再伪装成「生成中」**；任意取消路径都能把 DB 与画布节点一并落到明确终态，消除「任务已失败/已取消但按钮还在转」的误导。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Dock 按钮在 `fallback_pending` | **A**：显示生成箭头（非停止方块）；待确认靠 FailureChip + 既有确认弹窗 |
| 取消 `fallback_pending` | 走 `cancelPlatformFallback` / material 等价 API，成功后节点 → `error` |
| `isNodeGenerating` | **拆语义**：Dock 的 spinning/`generating` prop **不含** `fallback_pending`；面板只读锁编辑可继续把 pending 当 busy |
| 半残态 | 禁止 `status=fallback_pending` 且 `errorMessage=已取消`（或其它取消文案）长期并存 |

## Non-goals

- 不改 BYOK → 平台回退产品流程本身（确认继续 / 取消回退弹窗保留）
- 不改 Agnes `keyframes` 参考图上限（≤3）或上游报错文案（可另开）
- 不引入 Dock 第三态专用按钮 UI
- 不做管理员全局任务后台

## Problem (current)

1. `isNodeGenerating` 将 `fallback_pending` 与 `generating` 同等对待。
2. `CanvasPage.selectedNodeGenerating` = `isNodeBusy || isNodeGenerating(status)` → Dock `DockGenerateButton` 显示停止方块。
3. `cancelGeneration` 本地写 `draft` +「已取消」，但服务端 `cancelGeneration` **仅允许** `status === 'generating'`；对 `fallback_pending` 失败并被 `.catch` 吞掉 → DB 仍 `fallback_pending`。
4. 轮询/刷新再次 `patchNodeData({ status: fallback_pending })`，留下 `fallback_pending` + `errorMessage=已取消`。

## Target behavior

### Dock 生成按钮

| 节点状态 | 按钮外观 | 点击 |
|----------|----------|------|
| `generating` 或 HTTP busy | 停止方块 | 取消进行中的生成（现有 `cancelGeneration`） |
| `fallback_pending` | **箭头** | 视为新一轮生成入口（可触发 `generateForNode`；若弹窗/队列仍挂着确认，沿用现有确认流，不强制本迭代改弹窗） |
| `error` / `failed` / `draft` / `completed` | 箭头（失败时 chip 可见） | 生成 / 重试 |

待确认文案仍由 `DockFailureChip`（缺省「平台回退待确认」）与 `requestFallbackConfirm` 弹窗表达。

### 取消写回

当用户对节点执行取消（Dock 停止、角标取消、`cancelGeneration(nodeId)`）：

1. 若节点 `status === fallback_pending` 且存在 `generationRecordId` → `studioApi.cancelPlatformFallback(id)`。
2. 若 shot/material 路径 `status === fallback_pending` 且存在 `materialId` → `cancelMaterialPlatformFallback`（或现有等价）。
3. 成功后本地：`status: error`，`errorMessage` 为「已取消平台回退」或服务端 `userMessage`（含退款信息时沿用既有积分文案工具）。
4. 非 pending 的进行中取消：保持现有 `cancelGeneration` / `cancelMaterial` 行为。
5. 远程失败不得静默留下「本地已取消、DB 仍 pending」；至少把节点标 `error` 并保留可复制 taskId（与失败诊断一致）。

### Helper 拆分（建议命名）

- `isNodeGenerating(status)` — **可保留**含 `fallback_pending`，供面板 `readonly`、禁止精修入口等「不可编辑」场景。
- 新增 `isDockGenerateBusy(status)` 或等价：`status === generating` **仅此**（不含 pending）；`selectedNodeGenerating` / 传入各 `*DockPanel` 的 `generating` 改用 busy ∪ 该函数 ∪ `isNodeBusy`。

实现时以「Dock spinning 与 edit-lock 分离」为准，命名可随现有 `dockStudio.ts` 风格微调。

### 轮询

- 用户已成功取消回退（DB `failed`）后，poll 按既有终态写 `error`，不得写回 `fallback_pending`。
- 若本地已是 `error`/`draft` 且 record 仍短暂为 pending（竞态），`shouldApplyGenerationPoll` / `acceptsGenerationWrite` 须拒绝把终态用户意图覆盖回 pending；优先尊重用户取消后的本地终态（与现有 draft gate 对齐：取消后不可被旧 poll 复活）。

## Data flow (cancel pending)

```text
用户点取消
  → cancelGeneration(nodeId)
  → 检测 fallback_pending + recordId/materialId
  → cancelPlatformFallback / cancelMaterialPlatformFallback
  → DB status=failed + metadata(cancelled, userMessage, …)
  → patchNodeData(status=error, errorMessage=…)
  → saveCanvas
```

## Testing

- 单元：`fallback_pending` 时 Dock `generating===false`（或 helper 断言）。
- 单元：`cancelGeneration` 在 pending 时调用 `cancelPlatformFallback`，节点变为 `error`，文案正确。
- 单元：取消后 poll 带仍为 pending 的旧响应时不覆盖本地 `error`/`draft`（若改 gate）。
- 回归：现有 `requestFallbackConfirm` confirm/cancel 用例保持绿。
- 手动/可选：选中 `fallback_pending` 节点 → 箭头 + chip；确认弹窗仍可用。

## Out of scope follow-ups

- Agnes keyframes 前端预检（参考图 >3 时拦截或降级接线）。
- 任务历史「进行中」集合是否剔除 `fallback_pending`（历史已有「待确认」标签；本迭代可不改，除非与 Dock 强不一致）。

## Success criteria

1. `fallback_pending` 节点 Dock 不再显示停止方块。  
2. 取消 pending 后 DB 与节点均为失败/取消终态，刷新不回弹 pending。  
3. 确认平台回退的 happy path 行为不变。  
