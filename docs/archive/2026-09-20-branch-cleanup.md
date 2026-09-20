# 分支清理留痕（2026-09-20）

## 背景

仓库累积了 99 个本地分支 / 77 个远端分支 / 31 条 worktree 记录。其中大量分支的改动早已随 squash merge 进入 `main`，
但分支本身没有回收，导致 `gh pr merge --delete-branch` 无法切回 main、分支切换被 prunable worktree 阻塞等问题。
本次按「只清理可证明已交付的分支」原则执行，**任何含未合并内容的分支一律保留**。

| 项 | 清理前 | 清理后 |
|---|---|---|
| 本地分支 | 99 | 18（含 main） |
| 远端分支 | 77 | 13（不含 main） |
| worktree 记录 | 31 | 3 |

## 执行分两阶段

**阶段一 · 可证明已交付的分支**：按下面的 A/B 规则删除本地 70 个、远端 63 个，并 `git worktree prune` 清掉 25 条目录已不存在的 worktree 记录
（`main` 曾被其中一条 prunable 记录占用，清理后才能正常切回）。

**阶段二 · 本 PR 合并后执行**：
1. 本 PR 记录的 7 个纯设计文档分支 + `cursor/gitignore-local-tool-dirs` 删除（文档内容已在 main，差异见附录 C）。
2. 移除 `/private/tmp` 下 3 个干净（无未提交改动）的 worktree —— `feature-flag-url`、`feature-sbg`、`fix-data-undefined`，
   并删除其对应分支 `feature/feature-flag-url-toggle`、`feature/selection-batch-generate`、`fix/vite-optimizedeps-shared`
   （三者内容均已交付 main；其中两个远端分支已随阶段一删除）。
3. `/private/tmp/build-main`（detached HEAD，有 5 个未提交文件）与 `/private/tmp/dev-server`（`fix/vercel-proxy-default-8888`，有 OPEN PR #374）**保留不动**。

## 判定规则

只有满足以下两类之一才算「已交付」，才允许删除：

1. **A 类 · 内容已完全进 main**：`git merge-tree --write-tree origin/main <branch>` 的结果树与 `origin/main` 的树完全相同，
   即把该分支合并进 main 不会改变任何文件。
2. **B 类 · 分支 tip 与已合并 PR 的 head 完全一致**：`gh pr list --json headRefOid` 中该分支某条 `MERGED` 记录的
   `headRefOid` 等于分支当前 tip，即分支上的一切都已随该 PR 交付。

两类均不丢失任何独有内容。`main`、有 OPEN PR 的分支、以及 `git log origin/main..<branch>` 仍有独有提交的分支，全部保留。

## 保留的分支与原因

### 有 OPEN PR（4 个）

| 分支 | PR | 说明 |
|---|---|---|
| `fix/vercel-proxy-default-8888` | #374 | 远端 + 本地均存在 |
| `feature/account-chrome-profile-ia` | #319 | 开着 5 天 |
| `fix/scene-composer-h3-credits` | #303 | 开着 6 天 |
| `docs/explore-phase2-impl-plan` | #190 | 远端存在、本地无；开着 42 天，建议推进或关闭 |

### 含未合并代码（13 个，待人工评估）

| 分支 | 独有提交 | 改动文件 | 其中代码 | PR |
|---|---|---|---|---|
| `fix/journey-trace-executiontrace-import` | 9 | 9 | 6 | #371 已合并，但分支另有 5 个 09-20 的 spec 提交 |
| `pr-342-check` | 10 | 31 | 28 | 无 PR |
| `docs/points-stats-personal-center` | 10 | 14 | 11 | 无 PR（含 MediaPipe 点选分割 refine 实现） |
| `feature/p2-02-prompt-version` | 2 | 25 | 25 | 无 PR |
| `feature/p2-01-context-snapshot` | 1 | 16 | 16 | 无 PR |
| `feature/workflow-recipe-planner-gaps` | 15 | 44 | 39 | #326 已关闭未合并 |
| `feature/agent-ux-followup-batch` | 1 | 24 | 18 | #230 已关闭未合并 |
| `feature/remove-implicit-marketing-route` | 1 | 22 | 19 | #198 已关闭未合并 |
| `enhancement/macro-scheme-count-flex` | 3 | 17 | 16 | #232 已关闭未合并 |
| `feature/p4-01-atomic-create-adr` | 1 | 4 | 3 | #115 已关闭未合并 |
| `chore/vision-qa-diagnostics` | 1 | 7 | 6 | #231 已关闭未合并 |
| `feature/video-composition-c2-c3` | 1 | 5 | 4 | 无 PR |
| `pr-63-head` | 1 | 3 | 3 | 无 PR（疑似临时验证分支） |

> 远端另有 3 个无本地对应分支的未合并分支，同样保留：
> `origin/feature/agent-execution-trace-p1-p2`（#153 已关闭）、
> `origin/fix/atomic-context-thread-contract`（#133 已关闭）、
> `origin/fix/canvas-multi-select-data-undefined`（#375 已关闭）。

## 已删除分支

### 本地（70 个）

见文末「附录 A · 本地删除清单」。

### 远端（63 个）

见文末「附录 B · 远端删除清单」。

### 另删除（内容已等价存在于 main）

- `cursor/gitignore-local-tool-dirs`：其改动（向 `.gitignore` 追加 `.worktrees/`、`.superpowers/`）已在 main 的 `.gitignore` 中。
- 以下 7 个「纯设计文档」分支：文档文件在 main 中**均存在且为更新更完整的版本**（main 行数均不少于分支），
  分支侧只剩旧状态行与旧措辞。差异已在下节完整留痕：
  - `feature/agent-sidebar-vision-provider-context`
  - `docs/workflow-import-placement`
  - `docs/chat-sink-sidebar-l1`
  - `docs/agent-mid-run-interrupt-pv-spec`
  - `docs/cx-image-edit-sam-point-select`
  - `docs/cx-image-edit-sidepanel`
  - `docs/cx-image-edit-toolchain`

## 附录 C · 7 个文档分支相对 main 的差异留痕

以下为完整 diff（`+` 为分支独有行，`-` 为 main 独有行），供需要时回溯。

### feature/agent-sidebar-vision-provider-context

```diff
--- docs/superpowers/specs/2026-09-16-agent-sidebar-vision-provider-context-design.md
+++ docs/superpowers/specs/2026-09-16-agent-sidebar-vision-provider-context-design.md (分支版本)
@@ -1,6 +1,6 @@
 # Agent 侧栏识图 Provider 契约对齐（BYOK 同一真相）— 设计规格
 
-> 状态：**已定稿 / 实现完成（P0+P1）**；**P0.5 重试/预算/错误包收敛见同日计划**（2026-09-16）  
+> 状态：**待审阅**（2026-09-16）  
 > 首发范围：**P0 + P1**；**P2 写入本规格、单独排期**  
 > 架构方案：**方案 2 — ProviderContext 直传**（Nest 启 run 唯一 resolve；`run-vision-qa` 禁止二次猜渠道）
 
@@ -242,8 +242,7 @@ Nest agent.service 启 run
 
 - JSON 字段命名（camelCase vs snake_case）随现有 Nest/Runtime 惯例。  
 - Runtime 侧 Python `supports_vision_model` 必须与 Nest `@lnkpi/agent` `supportsVisionTextModel` 继续对齐（侧栏解析 D-5）。  
-- 单次 attempt 超时仍归 `VISION_TIMEOUT`；与 `#334` 单次 httpx 120s 叠加时遵守 **D-BUDGET**：墙钟总预算 **180s**（含重试），耗尽即失败，即使尚未用满 3 次 attempt。  
-- **P0.5：** 重试权威在 Runtime（最多 3 attempt）；Nest 识图路径 `generateVisionQaJson({ maxRetries: 0 })`，禁止 Runtime×Nest 双重 429。`nest_client.run_vision_qa` HTTP timeout 为 `min(120, remaining_budget)`。空 LLM content 视为格式异常，立即失败不重试。Nest catch 必须回 `errorClass` + 中性中文 reason。
+- 单次 attempt 超时仍归 `VISION_TIMEOUT`；与 `#334` 单次 httpx 120s 叠加时遵守 **D-BUDGET**：墙钟总预算 **180s**（含重试），耗尽即失败，即使尚未用满 3 次 attempt。
 
 ---
 
```

### docs/workflow-import-placement

```diff
--- docs/superpowers/plans/2026-09-12-workflow-import-placement.md
+++ docs/superpowers/plans/2026-09-12-workflow-import-placement.md (分支版本)
@@ -70,7 +70,7 @@ export function computeImportTranslation(input: {
 }): Point // { x: dx, y: dy }
 ```
 
-- [x] **Step 1: Write failing tests**
+- [ ] **Step 1: Write failing tests**
 
 ```typescript
 import { describe, expect, it } from 'vitest'
@@ -119,17 +119,17 @@ describe('workflowImportPlacement', () => {
 })
 ```
 
-- [x] **Step 2: Run — expect FAIL**
+- [ ] **Step 2: Run — expect FAIL**
 
 ```bash
 pnpm --filter @lnkpi/web exec vitest run src/composables/workflowImportPlacement.test.ts
 ```
 
-- [x] **Step 3: Implement `workflowImportPlacement.ts`** per spec §3 (candidate order: viewport-right interior → below → step → viewport exterior right → canvas bottom-right fallback).
+- [ ] **Step 3: Implement `workflowImportPlacement.ts`** per spec §3 (candidate order: viewport-right interior → below → step → viewport exterior right → canvas bottom-right fallback).
 
-- [x] **Step 4: Run — expect PASS**
+- [ ] **Step 4: Run — expect PASS**
 
-- [x] **Step 5: Commit**
+- [ ] **Step 5: Commit**
 
 ```bash
 git add apps/web/src/composables/workflowImportPlacement.ts apps/web/src/composables/workflowImportPlacement.test.ts
@@ -156,20 +156,20 @@ export interface ImportWorkflowPackageContext {
 }
 ```
 
-- [x] **Step 1: Failing / extend import tests**
+- [ ] **Step 1: Failing / extend import tests**
 
 - Seed canvas node at `(0,0)`; import json with root at `(0,0)` → `applyMerge` nodes’ root positions must not overlap seed bbox (± margin).
 - Parent+child import: child `position` unchanged relative to file; parent shifted by same dx/dy as translation.
 - `fitImportedNodes` mock called with remapped ids after merge.
 
-- [x] **Step 2: Implement**
+- [ ] **Step 2: Implement**
 
 1. Delete `IMPORT_POSITION_OFFSET`-only path (or keep unused constant removed).
 2. After remap + media upload, `const { x: dx, y: dy } = computeImportTranslation({ importNodes: remapped.graph.nodes, canvasNodes: ctx.nodes, viewport: ctx.getViewport?.(), containerSize: ctx.getContainerSize?.() })`.
 3. `toMergeNodes(doc, { dx, dy })` applies translation to roots only.
 4. `await ctx.applyMerge(...)` then `await ctx.fitImportedNodes?.(mergeNodes.map(n => n.id))`.
 
-- [x] **Step 3: CanvasPage**
+- [ ] **Step 3: CanvasPage**
 
 In `onWorkflowImportSelected`, add:
 
@@ -187,13 +187,13 @@ fitImportedNodes: async (ids) => {
 
 (Match existing `fitView` call sites around `CanvasPage.vue` ~1181/1194.)
 
-- [x] **Step 4: Tests PASS**
+- [ ] **Step 4: Tests PASS**
 
 ```bash
 pnpm --filter @lnkpi/web exec vitest run src/composables/workflowImportPlacement.test.ts src/composables/useWorkflowExchange.test.ts
 ```
 
-- [x] **Step 5: Commit**
+- [ ] **Step 5: Commit**
 
 ```bash
 git commit -m "feat(web): place workflow imports in blank space and fit view"
@@ -214,11 +214,3 @@ git commit -m "feat(web): place workflow imports in blank space and fit view"
 
 **Placeholders:** none.  
 **Handoff:** After plan commit, execute via Subagent-Driven (recommended) or Inline.
-
----
-
-## Status (2026-09-12)
-
-- Merged: PR #287 (placement + viewport free-axis clamp), PR #291 (`fitImportedViewport` / fitBounds fallback).
-- Prod verified by user: import places in blank space and viewport fits imported nodes.
-- Spec closed for implementation tasks; remaining polish is YAGNI (empty-canvas center-right, deeper candidate-path tests).
--- docs/superpowers/specs/2026-09-12-workflow-import-placement-design.md
+++ docs/superpowers/specs/2026-09-12-workflow-import-placement-design.md (分支版本)
@@ -1,7 +1,7 @@
 # 工作流导入落点（空白区 + 视口对准）设计
 
 > 日期：2026-09-12  
-> 状态：**已交付**（方案 C；PR #287 / #291）  
+> 状态：已批准（对话确认方案 **C**）  
 > 产品：超创平台（lnkpi）无限画布  
 > 上级规格：[2026-09-12-canvas-workflow-exchange-design.md](./2026-09-12-canvas-workflow-exchange-design.md)  
 > 背景：W1 导入合并仅对根节点做固定 `(+80,+80)`，易与当前画布/视口重叠遮挡  
@@ -97,4 +97,3 @@ flowH = containerHeight / zoom
 | 日期 | 变更 |
 |------|------|
 | 2026-09-12 | 初稿：对话选定方案 C 后入库 |
-| 2026-09-12 | 实现合并：PR #287（落点）+ PR #291（导入后 fitView/fitBounds）；验收通过；状态→已交付 |
```

### docs/chat-sink-sidebar-l1

```diff
--- docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md
+++ docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md (分支版本)
@@ -1,8 +1,7 @@
 # 画布媒体信息外置底栏 Design
 
 **Date:** 2026-08-21  
-**Status:** Implemented on `feature/cx-media-info-footer`; plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
-
+**Status:** Approved, plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
 **代号:** **CX-MEDIA-INFO-FOOTER**  
 **Related:**
 - `2026-08-15-media-inspector-design.md` — L0 摘要与 `mediaInfo` / `probeMedia`；本文件修正画布节点 L0 放置与覆盖范围
--- docs/superpowers/specs/2026-09-06-chat-sink-sidebar-l1-design.md
+++ docs/superpowers/specs/2026-09-06-chat-sink-sidebar-l1-design.md (分支版本)
@@ -1,6 +1,6 @@
 # Chat Sink 治理与侧栏媒体参与 L1 — 设计规格
 
-> 状态：**Implemented P0–P1**（Tasks 1–8 done，2026-09-06）
+> 状态：**Proposed**（2026-09-06）  
 > 范围：**Chat 能力诚实 + 禁止疑似媒体意图静默落入 `default_chat` + 侧栏媒体信号参与 L0 feature/precedence + Agent≡Dock `GenerationRequest` 契约对齐（实现分 P0/P1）**  
 > 前置：  
 > - [2026-08-09-sidebar-ref-image-routing-design.md](./2026-08-09-sidebar-ref-image-routing-design.md) §9 Route Unification ADR（RU-3/6/7/9）  
```

### docs/agent-mid-run-interrupt-pv-spec

```diff
--- docs/superpowers/specs/2026-08-12-agent-mid-run-interrupt-design.md
+++ docs/superpowers/specs/2026-08-12-agent-mid-run-interrupt-design.md (分支版本)
@@ -141,7 +141,7 @@ classify_post_cancel_intent → gate_resume | revise | new_task
 取消收口写：
 
 - `phase: "cancelled"`
-- `run_cancelled: true`、`cancel_reason: "user"`、`cancelled_from_phase: <取消前阶段>`（供 §4.3 revise 分档）
+- `run_cancelled: true`、`cancel_reason: "user"`
 - `presentation: callout_info`（人话）
 - gen 通道：未派发标 cancelled；在途 best-effort cancel
 - **不**清画布节点 / 本会话附件 SSOT
@@ -179,16 +179,12 @@ classify_post_cancel_intent → gate_resume | revise | new_task
 
 原则：**改意图不丢已确认的上游门控结果；下游未确认产物可作废。**
 
-分档依据是 `cancelled_from_phase`（`phase` 已被覆写成 `cancelled`，不能用作依据）；缺失时退化为最保守的 QA 及下游全清。
-
-**gate_resume** → 清 `run_cancelled` / `cancel_reason` / `cancelled_from_phase`，并把 `phase` 恢复为 `cancelled_from_phase`，其余一律保留。
-
 ### 4.4 侧栏 UX
 
 | 状态 | 生成钮 | Composer | 提示 |
 |------|--------|----------|------|
 | streaming（含 generating） | ⏹ 停止 | disabled | 现有 banner |
-| cancelled | ↑ 发送 | enabled | callout +「发起新任务」chip；若仍有 pending 门控，门控 chips 同时保留在 callout 下方 |
+| cancelled | ↑ 发送 | enabled | callout +「发起新任务」chip |
 | await_* 门控 | ↑ / 确认 chips | enabled | 现有 HITL；未 new_task 时可继续确认 |
 
 ---
@@ -215,7 +211,6 @@ Nest → Runtime：`POST /v1/runs/cancel`（`thread_id` / `session_id` / `reason
 
 - 幂等：重复 cancel → `ok: true`
 - 无活跃 run：仍 `ok: true`
-- 无活跃 run 且停在 `interrupt_before` 门控：**不写** cancelled checkpoint（否则 `next` 被抹掉、门控再也答不了），返回 `ok: true, gate_preserved: true, next_nodes: [...]`，`phase` 为当前门控；callout 由前端本地状态渲染，门控 chips 继续可用（UAT-INT-PV-05）
 - 非 PV 首期：可 `ok: true, skipped: true, reason: "flow_not_supported"`（Expand-B 再接）
 
 ### 5.2 Runtime cancel 步骤
@@ -289,15 +284,6 @@ PV-1 / PV-2 可同一实现 PR 串行，验收按 §七分项勾选。
 | UAT-INT-PV-06 | 停止后重连 thread-state | `runCancelled` + callout；composer 可用 |
 | UAT-INT-PV-07 | 重复停止 / cancel 幂等 | 两次 `ok: true`，无异常 |
 
-**实现 PR 手动验收清单（staging，由人工执行）：**
-- [ ] UAT-INT-PV-01
-- [ ] UAT-INT-PV-02
-- [ ] UAT-INT-PV-03
-- [ ] UAT-INT-PV-04
-- [ ] UAT-INT-PV-05
-- [ ] UAT-INT-PV-06
-- [ ] UAT-INT-PV-07
-
 ---
 
 ## 八、风险与缓解
--- docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md
+++ docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md (分支版本)
@@ -1,8 +1,7 @@
 # 画布媒体信息外置底栏 Design
 
 **Date:** 2026-08-21  
-**Status:** Implemented on `feature/cx-media-info-footer`; plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
-
+**Status:** Approved, plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
 **代号:** **CX-MEDIA-INFO-FOOTER**  
 **Related:**
 - `2026-08-15-media-inspector-design.md` — L0 摘要与 `mediaInfo` / `probeMedia`；本文件修正画布节点 L0 放置与覆盖范围
```

### docs/cx-image-edit-sam-point-select

```diff
--- docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md
+++ docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md (分支版本)
@@ -1,8 +1,7 @@
 # 画布媒体信息外置底栏 Design
 
 **Date:** 2026-08-21  
-**Status:** Implemented on `feature/cx-media-info-footer`; plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
-
+**Status:** Approved, plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
 **代号:** **CX-MEDIA-INFO-FOOTER**  
 **Related:**
 - `2026-08-15-media-inspector-design.md` — L0 摘要与 `mediaInfo` / `probeMedia`；本文件修正画布节点 L0 放置与覆盖范围
--- docs/superpowers/specs/2026-08-31-cx-image-edit-sam-point-select-design.md
+++ docs/superpowers/specs/2026-08-31-cx-image-edit-sam-point-select-design.md (分支版本)
@@ -1,7 +1,7 @@
 # 画布精修选区：SAM 点击选主体 Design
 
 **Date:** 2026-08-31  
-**Status:** Implemented on `feature/cx-image-edit-sam-point-select`; Approved, plan in `docs/superpowers/plans/2026-08-31-cx-image-edit-sam-point-select.md`  
+**Status:** Approved, plan in `docs/superpowers/plans/2026-08-31-cx-image-edit-sam-point-select.md`  
 **代号:** **CX-IMAGE-EDIT-SAM-POINT**  
 **Related:**
 - `2026-08-18-cx-image-edit-design.md` — 精修作业、积分、EditProvider、版本链
```

### docs/cx-image-edit-sidepanel

```diff
--- docs/superpowers/specs/2026-08-18-cx-image-edit-design.md
+++ docs/superpowers/specs/2026-08-18-cx-image-edit-design.md (分支版本)
@@ -348,8 +348,8 @@ Material 表本轮不扩列。画布节点不依赖 `Material` 版本。
 | Phase | 本规格 | 内容 |
 |-------|--------|------|
 | **P1** | **本文件** | 手动画 mask + 指令 + 左右对照 + 同节点版本链 + EditProvider Image2 + 服务端合成 + 替换旧编辑弹窗 + 修正 capabilities |
-| P2 | 后续 spec | 智能选区（第一刀见 toolchain：魔棒；SAM/文本指代更后）；工作室「最近生成」上的精修入口；编辑模型可选。Wipe 已在 chrome |
-| P3 | 后续 spec | 抠图 / 透明底（toolchain 本轮仅禁用槽，不接上游） |
+| P2 | 后续 spec | 智能选区；Wipe 滑杆；工作室「最近生成」上的精修入口；编辑模型可选 |
+| P3 | 后续 spec | 抠图 / 透明底工具槽 |
 | P4 | 后续 spec | 强度、Agent 自动 apply、局部超分 |
 
 P1 实施可再拆任务（mask 编辑器、API、Dock 接入、版本链、合成、Agent 文案），但不拆成多个产品规格。
--- docs/superpowers/specs/2026-08-19-cx-image-edit-sidepanel-design.md
+++ docs/superpowers/specs/2026-08-19-cx-image-edit-sidepanel-design.md (分支版本)
@@ -24,8 +24,7 @@
 | 与 Agent | **停靠互斥**：精修停靠时 Agent 收为 56px 图标轨。浮动精修可与 Agent 停靠并存 |
 | 与 ⓘ | 打开精修则关掉 Inspector。打开 Inspector 时：精修未 busy 则关掉精修；busy 则保持精修、不打开 Inspector |
 | 底部生成 Dock | 精修打开期间 **隐藏**。关掉精修后若仍选中该节点，生成 Dock 回来 |
-| 选区 | 打开后左侧 **工作视口**（contain 对齐、可缩放平移）画 mask；**不在节点上**选区。对照最大化只看 Before/After，不画选区 |
-| 放大镜 | 对照/工作图可开放大镜，指针下圆形或矩形局部放大 |
+| 选区 | 打开后 `fitView` 该节点；mask overlay **叠在节点原图上**，跟节点 transform |
 | 应用前节点 | 一直显示 **Before**。After 只出现在对照（迷你 + 最大化） |
 | 对照 | 默认 **左右**；可切 **重叠（竖向滑竿）**。左 = Before，右 = After |
 | 最大化 | 全屏对照，可左右或重叠；同步缩放/平移；不改 mask、不扣分 |
@@ -104,20 +103,16 @@
 
 ## 3. 对照
 
-对照是**编辑模式公共能力**：左右 / 重叠 / 放大镜 / 工作图↔对照切换，不绑死在「已出 After」。后续抠图、局部重绘等编辑工具复用同一套对照壳，不另起一套。对照**只比对**，不承担选区。
+对照**只比对**，不承担选区。
 
 ### 迷你（抽屉内）
 
-未出图：After 暂用 Before（空占位观感仍可后续加强）。出图后左右缩略图区分 N | N+1。标题旁模式：`左右` | `重叠`，**始终可切换**。无独立 After 时重叠两层都是 Before，用来预览滑竿，不禁用。
+未出图：After 空占位。出图后默认 **左右** 缩略图。标题旁模式：`左右` | `重叠`；无 After 时重叠禁用。
 
 按住「原图」：左右模式下右栏改显示 Before；重叠模式下滑竿收到最左（整幅 Before），松开恢复。
 
 应用成功后对照为 N | N+1；节点此时才换成新 url。
 
-放大镜：默认只显示放大镜开关。点开后才出现圆形 / 矩形镜片和倍数，作为放大镜下一级，不与对照模式并列常驻。
-
-画笔：默认只显示画笔开关。点开后才出现橡皮、矩形选区、颜色、粗细、清除。
-
 ### 重叠（本轮要做）
 
 同一画框叠 Before / After，竖向分界线 + 圆钮可拖：
@@ -127,9 +122,9 @@
 - 拖的是分界，不带动画布平移
 - 单击分界不切换左右/重叠模式
 
-### 最大化 / 工作图
+### 最大化
 
-「最大化对照」把**左侧工作区**切到对照（铺满工作视口，**不盖住右侧精修栏**）。再点同一按钮、点「工作图」、Esc 或关闭，回到编辑精修：左侧只显示 Before 工作图 + 选区。共用 `compareMode` 与 `wipeRatio`。最大化内不改 mask、不发起精修、不应用。
+「最大化对照」打开全屏层（在精修面板之上）。左右 / 重叠共用精修 session 的 `compareMode` 与 `wipeRatio`。滚轮同步缩放两张图，拖空白平移视口。Esc 或关闭回到精修面板，**保留模式和滑竿位置**。最大化内不改 mask、不发起精修、不应用。
 
 ### 版本条
 
```

### docs/cx-image-edit-toolchain

```diff
--- docs/superpowers/specs/2026-08-19-cx-image-edit-toolchain-design.md
+++ docs/superpowers/specs/2026-08-19-cx-image-edit-toolchain-design.md (分支版本)
@@ -156,9 +156,8 @@ mask + 指令 → `POST /studio/image/edit` → After → 合成保真 → 应
 
 | 刀 | 内容 |
 |----|------|
-| 选区 2 | 多边形套索 + 魔棒减选 — 见 `2026-08-21-cx-image-edit-selection-tools-design.md` |
-| 选区 3 | SAM / 点击主体；再后文本指代 |
-| 作业 2 | CutoutProvider + 真透明底（搁置）；capabilities 才加 `remove_bg` |
+| 选区 2 | SAM / 点击主体；再后文本指代 |
+| 作业 2 | CutoutProvider + 真透明底；capabilities 才加 `remove_bg` |
 | 壳 | 上下擦除 / 溶解 / 闪光 |
 
 ---
```

## 附录 A · 本地删除清单

```
docs/agent-sidebar-media-parse
docs/compose-p05-generate-ssot
docs/composition-land-gaps
docs/cx-image-edit-selection-tools
docs/minimax-h3-p0-plan
docs/node-failure-diagnostics-spec
enhancement/agent-sidebar-media-parse
enhancement/agnes-25-flash
enhancement/drop-optimize-prompt-stub
enhancement/prompt-node-image-refs
enhancement/video-dock-capability-layout
feat/points-dock-node-ux
feat/points-stats-neowow-adoption
feat/points-stats-personal-center
feature/a1-image-upscale
feature/a1-sts-direct-upload
feature/agent-atomic-phase-2c1
feature/agent-atomic-phase-2d3
feature/agent-atomic-phase-2d3-intent-parse
feature/agent-bare-gen-propose-bind
feature/agent-consistency-chains
feature/agent-sidebar-media-propose-bind
feature/agent-task-progress-card
feature/agent-topology-preview-hitl
feature/apimart-platform-routing
feature/canvas-operator-2e
feature/canvas-operator-2e3
feature/captcha-richer-bg-pool
feature/chat-sink-sidebar-l1
feature/compose-p05-pending-hitl
feature/composition-source-bind
feature/dock-guide-scene-label
feature/fal-h3-max-video-min
feature/generic-canvas-compose-spec
feature/image-grid-slice
feature/import-default-along-edges
feature/login-fullscreen-block-captcha
feature/login-neotv-polish-captcha-pool
feature/login-register-invite-legal
feature/login-slider-captcha-video-carousel
feature/minimax-h3-p0-video
feature/node-failure-diagnostics
feature/recipe-planner-copy-sanitize
feature/recipe-planner-gaps
feature/recipe-planner-hitl-diff-ssot
feature/recipe-planner-slot-chip-utterance
feature/recipe-planner-spec-close
feature/recipe-planner-ux
feature/sse-tool-call-emit
feature/usage-page-polish
fix/agent-disable-deepseek-thinking
fix/agent-sidebar-vision-provider-context
fix/atomic-variant-new-node
fix/canvas-membership-modal-clicks
fix/canvas-multi-select-data-undefined
fix/compose-hitl-generate-ssot
fix/dock-ref-chip-mention
fix/generate-zhi-tiger-routing
fix/h8-no-charge-assert
fix/journey-trace-important-issues
fix/minimax-h3-byok-openai-v1
fix/platform-provider-opts
fix/refine-guide-picker-portal-clip
fix/selection-batch-http-crypto
fix/sidebar-single-edit-routing
fix/sidebar-vision-parse-timeout
fix/text-thinking-timeouts
fix/turnaround-four-panel-prompts
fix/vision-retry-budget-errorclass
fix/write-copy-bg-orchestrate
```

## 附录 B · 远端删除清单

```
docs/composition-land-gaps
docs/minimax-h3-p0-plan
docs/node-failure-diagnostics-spec
enhancement/agnes-25-flash
enhancement/deepseek-flash-vision
enhancement/prompt-node-image-refs
enhancement/video-dock-capability-layout
feat/heartbeat-idempotency
feat/points-dock-node-ux
feat/points-stats-neowow-adoption
feat/points-stats-personal-center
feat/seedance-agnes-video-adapter
feature/a1-image-upscale
feature/a1-sts-direct-upload
feature/agent-atomic-phase-2c1
feature/agent-atomic-phase-2d3
feature/agent-atomic-phase-2d3-intent-parse
feature/agent-bare-gen-propose-bind
feature/agent-consistency-chains
feature/agent-sidebar-media-propose-bind
feature/agent-task-progress-card
feature/agent-topology-preview-hitl
feature/canvas-operator-2e
feature/canvas-operator-2e3
feature/compose-p05-pending-hitl
feature/composition-source-bind
feature/dock-guide-scene-label
feature/fal-h3-max-video-min
feature/feature-flag-url-toggle
feature/generic-canvas-compose-spec
feature/i2v-capability-productization
feature/image-grid-slice
feature/image-prompting-guide-catalog-spec
feature/login-fullscreen-block-captcha
feature/login-register-invite-legal
feature/minimax-h3-p0-video
feature/node-failure-diagnostics
feature/recipe-planner-copy-sanitize
feature/recipe-planner-hitl-diff-ssot
feature/recipe-planner-slot-chip-utterance
feature/recipe-planner-spec-close
feature/recipe-planner-ux
feature/selection-batch-generate
feature/sse-tool-call-emit
fix/agent-disable-deepseek-thinking
fix/agent-sidebar-vision-provider-context
fix/canvas-auth-session-restore
fix/canvas-membership-modal-clicks
fix/compose-hitl-generate-ssot
fix/dock-ref-chip-mention
fix/h8-no-charge-assert
fix/journey-trace-executiontrace-import
fix/journey-trace-important-issues
fix/merge-refs-chat-model-fallback
fix/minimax-h3-byok-openai-v1
fix/node-l0-media-summary
fix/refine-guide-picker-portal-clip
fix/sidebar-vision-parse-timeout
fix/text-thinking-timeouts
fix/usage-sqlite-unixepoch
fix/vision-retry-budget-errorclass
fix/vite-optimizedeps-shared
fix/write-copy-bg-orchestrate
```
