# Product Visual 九步旅程 · 执行记录一体化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 product_visual v2 九步 Stepper 与 Agent 执行记录合并为可持久化的 `JourneyTraceSnapshot`，Live 动态展示、历史对话可回放（含宏观方案可选/已选）。

**Architecture:** Runtime 在 phase 变迁时构建 `JourneyTraceSnapshot` 并通过 SSE `journey_update` 下发；前端 `executionTraceReducer.applyJourneyUpdate` 同步九步骨架 + 操作明细；Nest `finalizeTurn` 将 `journeyTrace` + `executionTrace` 写入 `AgentMessage.metadata`；SideRail 门控 Stepper 与 Trace 共用 thread 级快照。

**Tech Stack:** LangGraph (Python 3.11+), pytest, Vue 3 + Vitest, NestJS + Prisma, `@lnkpi/shared` 类型

**Spec:** [2026-08-13-product-visual-journey-trace-design.md](../specs/2026-08-13-product-visual-journey-trace-design.md)

## Global Constraints

- 适用范围：`flow_mode: product_visual` + `product_visual_scheme_v2=true`
- **禁止** machine payload 出现在 assistant 可见正文或 journey summary：`__macro_scheme_decision__`、`__delivery_decision__`
- **禁止** 内部 phase 名（`await_*`）出现在用户可见 journey label/summary
- P0 旅程锚点：**thread 级单快照**（最后一次 `journey_update` 覆盖）
- 历史 macro 回放：**summary + 只读卡片**（`snapshot.kind === 'macro_select'`）
- snapshot prose ≤200 字；macro schemes ≤3 套
- 延续 [侧栏文案规范 v1](../specs/2026-08-06-agent-sidebar-copy-design.md)：主气泡仍只显示最终 `text_replace`
- Pre-PR 测试：
  - `cd services/agent-runtime && uv run pytest tests/test_journey_trace*.py tests/test_presentation_envelope.py -v`
  - `cd apps/web && pnpm exec vitest run src/components/agent/executionTraceReducer.test.ts src/components/agent/journeyTrace*.test.ts`
  - `cd apps/server && pnpm exec vitest run src/agent/agent.service.journey-trace.test.ts`

---

## 交付阶段总览

| 阶段 | 里程碑 | 可独立验收 |
|------|--------|------------|
| **T1** | 共享类型 + Runtime snapshot 构建 + 单测 | pytest `test_journey_trace_snapshot.py` Pass |
| **T2** | SSE `journey_update` + thread-state 扩展 | interrupt/done 事件含 snapshot |
| **T3** | Prisma metadata + Nest 持久化 | getMessages 返回 metadata |
| **T4** | 前端 reducer + Trace UI 九步骨架 | Vitest + 本地 Live 可见 |
| **T5** | SideRail 集成 + 历史恢复 + macro 回放 | AC-JT-01～05 |
| **T6** | E2E audit v5 + UAT 条目 | AC-JT-08 |

**建议 PR 切分：** T1–T2 → PR#1（Runtime）；T3 → PR#2（Nest/DB）；T4–T5 → PR#3（Web）；T6 → 随 PR#3 或 deploy 验证

---

## File Map

| File | Action | 职责 |
|------|--------|------|
| `packages/shared/src/journeyTrace.ts` | **Create** | `JourneyTraceSnapshot` / `AgentMessageMetadata` SSOT 类型 |
| `packages/shared/src/index.ts` | Modify | export journey trace 类型 |
| `services/agent-runtime/app/graph/product_visual_v2/journey_trace.py` | **Create** | `build_journey_trace_snapshot(state, phase)` |
| `services/agent-runtime/app/graph/product_visual_v2/presentation.py` | Modify | 调用 journey_trace；macro 确认 summary |
| `services/agent-runtime/app/graph/nodes/macro_scheme_select_gate.py` | Modify | 确认后写入 macro snapshot |
| `services/agent-runtime/app/graph/state.py` | Modify | `journey_trace: dict \| None` |
| `services/agent-runtime/app/runs.py` | Modify | emit `journey_update`；thread-state 新字段 |
| `services/agent-runtime/app/graph/hitl_resume.py` | Modify | interrupt 时附带 journey snapshot |
| `services/agent-runtime/tests/test_journey_trace_snapshot.py` | **Create** | snapshot 构建单测 |
| `apps/server/prisma/schema.prisma` | Modify | `AgentMessage.metadata String?` |
| `apps/server/prisma/migrations/*_agent_message_metadata/` | **Create** | 迁移 |
| `packages/agent/src/types.ts` | Modify | `AgentStreamEvent` 增加 `journey_update` |
| `apps/server/src/agent/agent.service.ts` | Modify | 累积 journey/execution trace → metadata |
| `apps/server/src/agent/agent.service.journey-trace.test.ts` | **Create** | finalizeTurn metadata 单测 |
| `apps/web/src/components/agent/journeyTraceTypes.ts` | **Create** | 复用 shared 类型 + UI helpers |
| `apps/web/src/components/agent/executionTraceReducer.ts` | Modify | `workflow_step` + `applyJourneyUpdate` |
| `apps/web/src/components/agent/executionTraceReducer.test.ts` | Modify | journey update 测试 |
| `apps/web/src/components/agent/AgentExecutionTrace.vue` | Modify | 九步骨架 section + 操作明细 section |
| `apps/web/src/components/agent/AgentJourneyStepList.vue` | **Create** | 九步列表（含 summary + macro 只读卡） |
| `apps/web/src/components/agent/journeyTrace.test.ts` | **Create** | 组件单测 |
| `apps/web/src/stores/agent.ts` | Modify | loadHistory 恢复 metadata |
| `apps/web/src/components/agent/AgentSideRail.vue` | Modify | SSE handler、thread 级 journey ref、Stepper 同源 |
| `deploy/prod-crab-listing-e2e-audit.py` | Modify | 断言 `journeyTrace.steps.length === 9` |

---

## Task 1: 共享类型 SSOT

**Files:**
- Create: `packages/shared/src/journeyTrace.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces — Produces:**

```typescript
// packages/shared/src/journeyTrace.ts
export type JourneyStepId =
  | 'image_qa' | 'scheme_draft' | 'macro_select' | 'ssot_persist'
  | 'shot_plan' | 'topo_preview' | 'generating' | 'delivery' | 'done'

export type JourneyStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface JourneyStepRecord {
  id: JourneyStepId
  label: string
  status: JourneyStepStatus
  enteredAt?: string
  completedAt?: string
  ms?: number
  summary?: string
  snapshot?: Record<string, unknown>
}

export interface JourneyTraceSnapshot {
  version: 1
  flowMode: 'product_visual'
  steps: JourneyStepRecord[]
  current: JourneyStepId
  startedAt: string
  updatedAt: string
  finishedAt?: string
  totalMs?: number
}

export interface AgentMessageMetadata {
  journeyTrace?: JourneyTraceSnapshot
  executionTrace?: Record<string, unknown>
}

export const JOURNEY_STEP_LABELS: Record<JourneyStepId, string> = {
  image_qa: '检查产品图',
  scheme_draft: '理解需求 · 出方案',
  macro_select: '选宏观风格',
  ssot_persist: '方案落盘',
  shot_plan: '定构图清单',
  topo_preview: '预览出图计划',
  generating: '出图中',
  delivery: '选定稿',
  done: '交付完成',
}
```

- [ ] **Step 1:** 创建 `journeyTrace.ts` 并 export
- [ ] **Step 2:** 在 `index.ts` 追加 export
- [ ] **Step 3:** `cd packages/shared && pnpm build` — 无 TS 错误

---

## Task 2: Runtime `build_journey_trace_snapshot`

**Files:**
- Create: `services/agent-runtime/app/graph/product_visual_v2/journey_trace.py`
- Create: `services/agent-runtime/tests/test_journey_trace_snapshot.py`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/presentation.py`

**Interfaces — Produces:**

```python
# journey_trace.py
JOURNEY_STEP_ORDER: list[str]  # mirrors STEPPER_ORDER

def build_journey_trace_snapshot(
    state: dict[str, Any],
    *,
    phase: str,
    now: datetime | None = None,
) -> dict[str, Any]: ...

def merge_journey_trace(
    prev: dict[str, Any] | None,
    state: dict[str, Any],
    *,
    phase: str,
) -> dict[str, Any]: ...
```

**Logic rules:**
- 从 `phase_to_stepper(phase)` 得 `current`；`completed = STEPPER_ORDER[:idx]`
- 每步 `label` 来自固定中文表（与 `PRESENTATION_STEPS` 一致）
- `prev` 存在时保留已 completed 步的 `enteredAt`/`completedAt`/`summary`/`snapshot`
- `macro_select` 完成：读 `selected_macro_scheme_ids` + `macro_schemes` 生成 summary「已选：{labels}」
- 单方案 skip：`macro_select.status = 'skipped'`，summary「仅一套方案，已自动选定」
- `phase == 'done'`：全部 9 步 `done`，写 `finishedAt`/`totalMs`

- [ ] **Step 1: Write failing test**

```python
# test_journey_trace_snapshot.py
def test_build_snapshot_macro_select_running():
    snap = build_journey_trace_snapshot(
        {"macro_schemes": [{"id": "A", "label": "湖鲜原境风"}]},
        phase="await_macro_scheme_select",
    )
    assert snap["current"] == "macro_select"
    assert snap["steps"][2]["status"] == "running"
    assert snap["steps"][0]["status"] == "done"

def test_macro_confirm_summary():
    state = {
        "macro_schemes": [
            {"id": "A", "label": "湖鲜原境风"},
            {"id": "B", "label": "礼盒臻享风"},
        ],
        "selected_macro_scheme_ids": ["A", "B"],
    }
    snap = merge_journey_trace(None, state, phase="canvas_ssot_commit")
    macro = next(s for s in snap["steps"] if s["id"] == "macro_select")
    assert macro["status"] == "done"
    assert "湖鲜原境风" in macro["summary"]
    assert macro["snapshot"]["selectedIds"] == ["A", "B"]
```

- [ ] **Step 2:** Run `uv run pytest tests/test_journey_trace_snapshot.py -v` — FAIL

- [ ] **Step 3:** 实现 `journey_trace.py` + 在 `build_presentation_envelope` 末尾调用 `merge_journey_trace` 写入 `state['journey_trace']`

- [ ] **Step 4:** Run pytest — PASS

- [ ] **Step 5:** Commit

```bash
git add services/agent-runtime/app/graph/product_visual_v2/journey_trace.py \
  services/agent-runtime/tests/test_journey_trace_snapshot.py \
  services/agent-runtime/app/graph/product_visual_v2/presentation.py \
  packages/shared/src/journeyTrace.ts packages/shared/src/index.ts
git commit -m "feat(runtime): build journey trace snapshot for product_visual v2"
```

---

## Task 3: SSE `journey_update` + thread-state

**Files:**
- Modify: `services/agent-runtime/app/runs.py`
- Modify: `services/agent-runtime/app/graph/hitl_resume.py`
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `packages/agent/src/types.ts`
- Modify: `services/agent-runtime/tests/test_thread_state.py`

**Interfaces — Produces:**

```python
# runs.py — emit helper
async def emit_journey_update(emit, state: dict) -> None:
    snap = state.get("journey_trace")
    if isinstance(snap, dict) and snap.get("flowMode") == "product_visual":
        await emit({"type": "journey_update", "data": {"snapshot": snap}})
```

```typescript
// packages/agent/src/types.ts
export interface AgentStreamEvent {
  type: /* ... */ | 'journey_update'
}
```

**Emit 时机（在现有 presentation emit 旁）：**
- `interrupt` 事件前
- 每个含 `presentation` 的 `text_replace` 后
- `done` payload 前（终局 snapshot）

**thread-state 新增：**

```python
return {
    # ...existing...
    "selectedMacroSchemeIds": vals.get("selected_macro_scheme_ids"),
    "journeyTrace": vals.get("journey_trace"),
}
```

- [ ] **Step 1:** 扩展 `AgentStreamEvent` 类型
- [ ] **Step 2:** 写 test：`test_get_thread_state_includes_journey_trace`
- [ ] **Step 3:** 实现 emit + thread-state 字段
- [ ] **Step 4:** `uv run pytest tests/test_thread_state.py tests/test_journey_trace_snapshot.py -v` — PASS
- [ ] **Step 5:** Commit

---

## Task 4: Prisma metadata 迁移

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: migration via `pnpm prisma migrate dev --name agent_message_metadata`

```prisma
model AgentMessage {
  // ...
  metadata String? // JSON: AgentMessageMetadata
}
```

- [ ] **Step 1:** 修改 schema
- [ ] **Step 2:** 生成并应用 migration（dev 环境）
- [ ] **Step 3:** 确认 `getMessages` 返回 `metadata` 字段（Prisma 默认全字段）
- [ ] **Step 4:** Commit migration + schema

---

## Task 5: Nest 持久化 journey + execution trace

**Files:**
- Modify: `apps/server/src/agent/agent.service.ts`
- Create: `apps/server/src/agent/agent.service.journey-trace.test.ts`
- Modify: `packages/shared/src/index.ts` — `AgentChatMessage` 增加 `metadata?: string`

**Interfaces — Consumes:** SSE `journey_update` snapshot；Pinia-compatible `executionTrace` object

**Interfaces — Produces:**

```typescript
// streamFromRuntime 内累积
let journeyTrace: JourneyTraceSnapshot | undefined
let executionTrace: Record<string, unknown> | undefined

// finalizeTurn 签名扩展
private async finalizeTurn(..., opts: {
  rewriteCanvasData: boolean
  linkedOutputs?: LinkedCanvasOutput[]
  metadata?: AgentMessageMetadata
})
```

**写入规则：**
- 每轮 assistant 消息 create 时：`metadata: JSON.stringify({ journeyTrace, executionTrace })`
- 若 `assistantText` 为空但有 `journeyTrace`：仍 create assistant 占位消息（content=`''` 或 `' '` — 用 `' '` 避免 skip；SideRail 过滤空泡）
- thread 级：每次覆盖完整 snapshot（非 merge）

- [ ] **Step 1: Write failing test**

```typescript
it('persists journeyTrace in assistant message metadata on finalizeTurn', async () => {
  // mock stream yielding journey_update + done
  // assert agentMessage.create called with metadata containing journeyTrace.steps.length === 9
})
```

- [ ] **Step 2:** Run vitest — FAIL
- [ ] **Step 3:** 实现 SSE 累积 + finalizeTurn 写入
- [ ] **Step 4:** vitest PASS
- [ ] **Step 5:** Commit

---

## Task 6: 前端 reducer — `applyJourneyUpdate`

**Files:**
- Modify: `apps/web/src/components/agent/executionTraceReducer.ts`
- Modify: `apps/web/src/components/agent/executionTraceReducer.test.ts`
- Create: `apps/web/src/components/agent/journeyTraceTypes.ts`

**Interfaces — Produces:**

```typescript
export type ExecutionStepKind = /* ... */ | 'workflow_step'

export interface ExecutionStep {
  // ...
  parentStepId?: string
  journeyStepId?: JourneyStepId
}

export function applyJourneyUpdate(
  trace: ExecutionTraceState,
  snapshot: JourneyTraceSnapshot,
): void

export function workflowStepsFromSnapshot(
  snapshot: JourneyTraceSnapshot,
): ExecutionStep[]
```

**Logic:**
- 为 snapshot 中 9 步各创建/更新 `kind: 'workflow_step'` 的 ExecutionStep
- 映射 status：`done`→done, `running`→running, `pending`→pending, `failed`→failed, `skipped`→skipped
- 后续 `text_stage`/`canvas`/`task` 步骤自动 `parentStepId` = 当前 `running` workflow step 的 id
- `snapshot.summary` → workflow step 的 `detail`

- [ ] **Step 1:** 写 failing test — macro_select running + 子步骤挂载
- [ ] **Step 2:** 实现 `applyJourneyUpdate`
- [ ] **Step 3:** vitest PASS
- [ ] **Step 4:** Commit

---

## Task 7: `AgentJourneyStepList` + `AgentExecutionTrace` 双 section

**Files:**
- Create: `apps/web/src/components/agent/AgentJourneyStepList.vue`
- Create: `apps/web/src/components/agent/journeyTrace.test.ts`
- Modify: `apps/web/src/components/agent/AgentExecutionTrace.vue`

**UI 行为:**
- Section 1「工作流进度」：`AgentJourneyStepList` — 九步，done 步 `line-through`
- macro snapshot：只读 `AgentMacroSchemeCards`（`:disabled="true"`，`:selected-ids="snapshot.selectedIds"`）
- Section 2「操作明细」：现有 steps 过滤 `kind !== 'workflow_step'`
- Streaming 标题：`执行过程（进行中… · 第 ${n}/9 步）` — n = current step index + 1

- [ ] **Step 1:** 组件 test — 渲染 9 步 + macro summary
- [ ] **Step 2:** 实现组件
- [ ] **Step 3:** 修改 `AgentExecutionTrace.vue` 集成
- [ ] **Step 4:** vitest PASS
- [ ] **Step 5:** Commit

---

## Task 8: SideRail 集成 + 历史恢复

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/stores/agent.ts`
- Modify: `apps/web/src/components/agent/presentation/AgentPresentationHost.vue`（Stepper 读 thread journey）

**SideRail changes:**

```typescript
const threadJourneyTrace = ref<JourneyTraceSnapshot | null>(null)

// SSE handler
if (event.type === 'journey_update') {
  const snap = (event.data as { snapshot: JourneyTraceSnapshot }).snapshot
  threadJourneyTrace.value = snap
  const last = agent.lastAssistant()
  if (last?.executionTrace) applyJourneyUpdate(last.executionTrace, snap)
}

// loadHistory
function extractThreadJourney(messages: PersistedAgentMessage[]): JourneyTraceSnapshot | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.metadata) continue
    try {
      const meta = JSON.parse(m.metadata) as AgentMessageMetadata
      if (meta.journeyTrace) return meta.journeyTrace
    } catch { /* ignore */ }
  }
  return null
}
```

**Stepper 同源：**
- `AgentPresentationHost` 的 `AgentStepper` 优先读 `threadJourneyTrace`（`:current` / `:completed` 从 snapshot 派生）
- fallback：`presentation.stepper`

**macro 历史回放：**
- `refreshThreadCheckpoint` 读 `selectedMacroSchemeIds` 同步 `macroSelections`
- 底部或最后一轮 assistant 下展示 journey（即使非 interrupted）

- [ ] **Step 1:** 扩展 `loadHistory` 恢复 `executionTrace` + `threadJourneyTrace`
- [ ] **Step 2:** SSE `journey_update` handler
- [ ] **Step 3:** Stepper 同源改造
- [ ] **Step 4:** 手动验证：Live macro 门控 AC-JT-01；刷新 AC-JT-04
- [ ] **Step 5:** Commit

---

## Task 9: macro 确认 snapshot（Runtime 细化）

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/macro_scheme_select_gate.py`
- Modify: `services/agent-runtime/app/graph/nodes/dialog_draft.py`（单方案 skip）

**在 `apply_macro_scheme_decision` confirm/auto 分支：**

```python
from app.graph.product_visual_v2.journey_trace import patch_macro_select_step

result = apply_macro_scheme_decision(...)
if result.get("macro_scheme_decision") in ("confirm", "auto"):
    result["journey_trace"] = patch_macro_select_step(
        state.get("journey_trace"),
        schemes=state.get("macro_schemes") or [],
        selected_ids=result.get("selected_macro_scheme_ids") or [],
    )
```

- [ ] **Step 1:** test — confirm 后 snapshot 含 schemes + selectedIds
- [ ] **Step 2:** 实现 `patch_macro_select_step`
- [ ] **Step 3:** pytest PASS
- [ ] **Step 4:** Commit

---

## Task 10: E2E audit v5

**Files:**
- Modify: `deploy/prod-crab-listing-e2e-audit.py`

**追加断言：**

```python
def assert_journey_trace(audit: dict) -> None:
    jt = audit.get("journeyTrace") or audit.get("finalThreadState", {}).get("journeyTrace")
    assert jt, "missing journeyTrace"
    assert len(jt.get("steps", [])) == 9
    assert jt.get("current") == "done"
    macro = next(s for s in jt["steps"] if s["id"] == "macro_select")
    assert macro.get("status") in ("done", "skipped")
    assert macro.get("summary")
```

- [ ] **Step 1:** 扩展 audit 脚本收集最后 `journey_update` / thread-state `journeyTrace`
- [ ] **Step 2:** 本地 dry-run（mock 或 staging）
- [ ] **Step 3:** 部署后 `AUDIT_OUT=deploy/prod-crab-listing-audit-v5.json python3 deploy/prod-crab-listing-e2e-audit.py`
- [ ] **Step 4:** Commit

---

## Task 11: UAT 条目更新

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-product-visual-phase2-scheme-ssot-uat.md`

追加 §10.10：

| ID | 场景 | 预期 |
|----|------|------|
| UAT-JT-01 | Live 全流程 | Trace 展开见九步骨架，当前步高亮 |
| UAT-JT-02 | 宏观确认 A+B | 第 3 步 summary + 只读卡片 |
| UAT-JT-03 | 刷新/切 thread | 九步旅程可回放 |
| UAT-JT-04 | E2E v5 audit | `journeyTrace.steps.length === 9` |

- [ ] **Step 1:** 更新 UAT 文档
- [ ] **Step 2:** Commit

---

## Spec Coverage Checklist

| AC | Task |
|----|------|
| AC-JT-01 | T7, T8 |
| AC-JT-02 | T2, T9, T7 |
| AC-JT-03 | T2, T10 |
| AC-JT-04 | T5, T8 |
| AC-JT-05 | T8 |
| AC-JT-06 | T2, T9 |
| AC-JT-07 | 既有 sidebar_copy 测试不回退 |
| AC-JT-08 | T10 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-product-visual-journey-trace.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每个 Task 派独立 subagent，Task 间 review
2. **Inline Execution** — 本会话按 Task 1→11 连续实现，每 Task 末 checkpoint

**Which approach?**
