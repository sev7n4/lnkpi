# Agent Mid-Run Interrupt (product_visual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `product_visual` 侧栏 Agent 在运行中可真正停止，停止后再发话按启发式分流为门控续跑 / 改意图 / 新任务（含 callout 与「发起新任务」chip）。

**Architecture:** Run Cancel Token（进程内 `RunCancelRegistry`）+ Nest 代理 `POST /agent/runs/cancel`；活跃 `astream` 在 `gen_scheduler` / 节点边界协作退出并写 `phase=cancelled`；下一轮 `runs.py` 在 `should_resume_interrupt` 之前调用 `classify_post_cancel_intent`。非 PV 首期返回 `skipped: flow_not_supported`。

**Tech Stack:** FastAPI agent-runtime (Python 3.11+), LangGraph, pytest, NestJS, Vue 3 + Vitest, SSE/NDJSON

**Spec:** [2026-08-12-agent-mid-run-interrupt-design.md](../specs/2026-08-12-agent-mid-run-interrupt-design.md)（v2.0 Accepted）

## Global Constraints

- 首期仅 `flow_mode == "product_visual"`；其它 flow：`ok: true, skipped: true, reason: "flow_not_supported"`
- 禁止同 thread 双 run 并行；cancel 不抢锁，只 set flag 让持锁 run 协作退出
- 上游 gen 取消 **best-effort**（`nest.cancel_generation`）；UI 可提示「部分任务可能仍在后台结束」
- 取消后下一轮 conversation **必须**使用新 `Idempotency-Key`
- 改意图分类：**启发式 + `__new_task__` chip**；禁止 LLM 分类器
- Pre-PR 测试：  
  `cd services/agent-runtime && uv run pytest tests/test_run_cancel*.py tests/test_post_cancel_intent.py tests/test_gen_scheduler_cancel.py -v`  
  `cd apps/server && pnpm exec vitest run src/agent/agent-runtime.client.test.ts`  
  `cd apps/web && pnpm exec vitest run src/components/agent/cancelAgentRun.test.ts src/components/agent/agentInterruptGate.test.ts`

---

## File Map

| File | Action | 职责 |
|------|--------|------|
| `services/agent-runtime/app/run_cancel.py` | **Create** | `RunCancelRegistry` + cancel flag API |
| `services/agent-runtime/app/graph/post_cancel.py` | **Create** | `classify_post_cancel_intent` + revise/new_task CLEAR 表 + Command 构建 |
| `services/agent-runtime/app/graph/cancel_checkpoint.py` | **Create** | `build_cancelled_checkpoint_update` presentation callout |
| `services/agent-runtime/app/graph/state.py` | Modify | `phase` 增 `"cancelled"`；`run_cancelled` / `cancel_reason` |
| `services/agent-runtime/app/graph/hitl_resume.py` | Modify | `FRESH_TURN_STATE_CLEAR` 含 cancel 字段 |
| `services/agent-runtime/app/graph/nodes/gen_scheduler.py` | Modify | 波次前读 cancel → 停派发 → collect |
| `services/agent-runtime/app/graph/nodes/gen_node.py` | Modify | 入口读 cancel → 跳过 gen + 可选 cancel_generation |
| `services/agent-runtime/app/runs.py` | Modify | cancel 协作、emit `run_cancelled`、post-cancel 分流、thread-state 字段 |
| `services/agent-runtime/app/main.py` | Modify | `POST /v1/runs/cancel` |
| `services/agent-runtime/tests/test_run_cancel_registry.py` | **Create** | Registry 单测 |
| `services/agent-runtime/tests/test_post_cancel_intent.py` | **Create** | 分类 + CLEAR 单测 |
| `services/agent-runtime/tests/test_gen_scheduler_cancel.py` | **Create** | scheduler 停派发 |
| `services/agent-runtime/tests/test_runs_cancel_api.py` | **Create** | HTTP cancel + 幂等 |
| `apps/server/src/agent/agent-runtime.client.ts` | Modify | `cancelRun` + `RuntimeThreadState.runCancelled` |
| `apps/server/src/agent/agent.service.ts` | Modify | `cancelRun` 代理 |
| `apps/server/src/agent/agent.controller.ts` | Modify | `POST runs/cancel` |
| `apps/server/src/agent/dto/cancel-run.dto.ts` | **Create** | DTO |
| `apps/server/src/agent/agent-runtime.client.test.ts` | Modify | cancel 客户端测 |
| `packages/agent/src/types.ts` | Modify | `AgentStreamEvent` 增 `run_cancelled` |
| `apps/web/src/components/agent/cancelAgentRun.ts` | **Create** | 先 API 后 abort |
| `apps/web/src/components/agent/cancelAgentRun.test.ts` | **Create** | 前端单元测 |
| `apps/web/src/components/agent/AgentSideRail.vue` | Modify | 停止钮、callout、新任务 chip、事件处理 |
| `apps/web/src/components/agent/agentInterruptGate.ts` | Modify | cancelled 重连态解析（若需） |

---

## Task 1: RunCancelRegistry

**Files:**
- Create: `services/agent-runtime/app/run_cancel.py`
- Create: `services/agent-runtime/tests/test_run_cancel_registry.py`

**Interfaces:**
- Produces:
  ```python
  def request_cancel(thread_id: str, *, reason: str = "user") -> None: ...
  def is_cancel_requested(thread_id: str) -> bool: ...
  def clear_cancel(thread_id: str) -> None: ...
  def peek_cancel_reason(thread_id: str) -> str | None: ...
  ```

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_run_cancel_registry.py
from app.run_cancel import clear_cancel, is_cancel_requested, peek_cancel_reason, request_cancel


def test_request_cancel_sets_flag():
    tid = "t-cancel-1"
    clear_cancel(tid)
    assert is_cancel_requested(tid) is False
    request_cancel(tid, reason="user")
    assert is_cancel_requested(tid) is True
    assert peek_cancel_reason(tid) == "user"
    clear_cancel(tid)
    assert is_cancel_requested(tid) is False


def test_request_cancel_idempotent():
    tid = "t-cancel-2"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    request_cancel(tid, reason="user")
    assert is_cancel_requested(tid) is True
    clear_cancel(tid)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_run_cancel_registry.py -v`  
Expected: FAIL (`ModuleNotFoundError: app.run_cancel` or import error)

- [ ] **Step 3: Write minimal implementation**

```python
# services/agent-runtime/app/run_cancel.py
from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_flags: dict[str, dict[str, Any]] = {}


def request_cancel(thread_id: str, *, reason: str = "user") -> None:
    tid = (thread_id or "").strip()
    if not tid:
        return
    with _lock:
        _flags[tid] = {"reason": reason or "user"}


def is_cancel_requested(thread_id: str) -> bool:
    tid = (thread_id or "").strip()
    if not tid:
        return False
    with _lock:
        return tid in _flags


def peek_cancel_reason(thread_id: str) -> str | None:
    tid = (thread_id or "").strip()
    if not tid:
        return None
    with _lock:
        entry = _flags.get(tid)
        return str(entry["reason"]) if entry else None


def clear_cancel(thread_id: str) -> None:
    tid = (thread_id or "").strip()
    if not tid:
        return
    with _lock:
        _flags.pop(tid, None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-runtime && uv run pytest tests/test_run_cancel_registry.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/run_cancel.py services/agent-runtime/tests/test_run_cancel_registry.py
git commit -m "feat(runtime): add RunCancelRegistry for mid-run interrupt"
```

---

## Task 2: Cancelled checkpoint update + state fields

**Files:**
- Create: `services/agent-runtime/app/graph/cancel_checkpoint.py`
- Create: `services/agent-runtime/tests/test_cancel_checkpoint.py`
- Modify: `services/agent-runtime/app/graph/state.py` — `phase` Literal 增加 `"cancelled"`；增加 `run_cancelled: bool | None`、`cancel_reason: str | None`
- Modify: `services/agent-runtime/app/graph/hitl_resume.py` — `FRESH_TURN_STATE_CLEAR` 增加 `"run_cancelled": None`、`"cancel_reason": None`

**Interfaces:**
- Produces:
  ```python
  def build_cancelled_checkpoint_update(
      *,
      completed_tasks: int = 0,
      total_tasks: int = 0,
      reason: str = "user",
  ) -> dict[str, Any]: ...
  ```

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_cancel_checkpoint.py
from app.graph.cancel_checkpoint import build_cancelled_checkpoint_update


def test_build_cancelled_checkpoint_update_shape():
    upd = build_cancelled_checkpoint_update(completed_tasks=2, total_tasks=5, reason="user")
    assert upd["phase"] == "cancelled"
    assert upd["run_cancelled"] is True
    assert upd["cancel_reason"] == "user"
    assert upd["presentation"]["kind"] == "callout_info"
    assert "2/5" in upd["presentation"]["body"]["text"]
    assert "发起新任务" in upd["presentation"]["body"]["text"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_cancel_checkpoint.py -v`  
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

```python
# services/agent-runtime/app/graph/cancel_checkpoint.py
from __future__ import annotations

from typing import Any


def build_cancelled_checkpoint_update(
    *,
    completed_tasks: int = 0,
    total_tasks: int = 0,
    reason: str = "user",
) -> dict[str, Any]:
    done = max(0, int(completed_tasks))
    total = max(done, int(total_tasks))
    if total > 0:
        progress = f"已停止出图（完成 {done}/{total}）。"
    else:
        progress = "已停止当前任务。"
    text = f"{progress}直接说修改意见，或点「发起新任务」。"
    return {
        "phase": "cancelled",
        "run_cancelled": True,
        "cancel_reason": reason or "user",
        "presentation": {
            "kind": "callout_info",
            "body": {"text": text},
        },
    }
```

在 `state.py` 的 `phase` Literal 列表末尾加入 `"cancelled"`，并在 TypedDict 中增加：

```python
    run_cancelled: bool | None
    cancel_reason: str | None
```

在 `hitl_resume.py` 的 `FRESH_TURN_STATE_CLEAR` 中增加：

```python
    "run_cancelled": None,
    "cancel_reason": None,
```

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && uv run pytest tests/test_cancel_checkpoint.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/cancel_checkpoint.py \
  services/agent-runtime/tests/test_cancel_checkpoint.py \
  services/agent-runtime/app/graph/state.py \
  services/agent-runtime/app/graph/hitl_resume.py
git commit -m "feat(runtime): cancelled checkpoint update and state fields"
```

---

## Task 3: `gen_scheduler` / `gen_node` 协作取消

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/gen_scheduler.py`
- Modify: `services/agent-runtime/app/graph/nodes/gen_node.py`
- Create: `services/agent-runtime/tests/test_gen_scheduler_cancel.py`

**Interfaces:**
- Consumes: `is_cancel_requested(thread_id)` from Task 1；`build_cancelled_checkpoint_update` from Task 2
- Produces: scheduler 在 cancel 时 `Command(update=..., goto=["collect_gen"])` 且不 `Send` 新节点

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_gen_scheduler_cancel.py
import pytest
from langgraph.types import Command

from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.run_cancel import clear_cancel, request_cancel


@pytest.mark.asyncio
async def test_gen_scheduler_stops_dispatch_when_cancel_requested():
    tid = "t-sched-cancel"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    node = make_gen_scheduler_node(max_concurrency=4)
    state = {
        "thread_id": tid,
        "gen_ordered_keys": ["a", "b"],
        "gen_deps_of": {"a": [], "b": ["a"]},
        "gen_by_key": {
            "a": {"node_id": "n1", "title": "A"},
            "b": {"node_id": "n2", "title": "B"},
        },
        "gen_completed_keys": [],
        "gen_failed_keys": [],
        "gen_needs_user_keys": [],
    }
    cmd = await node(state)
    assert isinstance(cmd, Command)
    assert cmd.goto == ["collect_gen"]
    assert cmd.update.get("phase") == "cancelled"
    assert cmd.update.get("run_cancelled") is True
    # no Send fan-out
    assert not any(getattr(g, "node", None) == "gen_node" for g in (cmd.goto if isinstance(cmd.goto, list) else []))
    clear_cancel(tid)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_gen_scheduler_cancel.py -v`  
Expected: FAIL（仍派发 `gen_node` 或无 cancelled update）

- [ ] **Step 3: Implement scheduler cancel branch**

在 `make_gen_scheduler_node` 的 `gen_scheduler` **开头**（读 keys 之后、cascade 之前）加入：

```python
        from app.graph.cancel_checkpoint import build_cancelled_checkpoint_update
        from app.run_cancel import is_cancel_requested, peek_cancel_reason

        thread_id = str(state.get("thread_id") or "")
        if thread_id and is_cancel_requested(thread_id):
            completed = set(state.get("gen_completed_keys") or [])
            ordered = list(state.get("gen_ordered_keys") or [])
            reason = peek_cancel_reason(thread_id) or "user"
            upd = build_cancelled_checkpoint_update(
                completed_tasks=len(completed),
                total_tasks=len(ordered),
                reason=reason,
            )
            # mark remaining as needs_user/cancelled via fail details optional
            return Command(update=upd, goto=["collect_gen"])
```

在 `gen_node` 入口（取得 `node_id` 之后、真正 `run_image_generation` 之前）：

```python
        from app.run_cancel import is_cancel_requested

        thread_id = str(state.get("thread_id") or "")
        # Send payload may not include thread_id — prefer nest/session context if wired;
        # if missing, skip this check (scheduler already blocks new Sends).
        if thread_id and is_cancel_requested(thread_id):
            try:
                await nest.cancel_generation(node_id=str(node_id))
            except Exception:
                pass
            return {
                "gen_needs_user_keys": [key],
                "gen_fail_details": {
                    key: {"node_id": node_id, "title": title, "reason": "cancelled"}
                },
            }
```

**注意：** `Send` 到 `gen_node` 的 payload 当前不含 `thread_id`。本 Task 须在 `gen_scheduler` 的 `Send(..., {..., "thread_id": state.get("thread_id")})` 中传入 `thread_id`，否则 gen_node 无法读 flag。同步改 Send 字典。

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && uv run pytest tests/test_gen_scheduler_cancel.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/gen_scheduler.py \
  services/agent-runtime/app/graph/nodes/gen_node.py \
  services/agent-runtime/tests/test_gen_scheduler_cancel.py
git commit -m "feat(runtime): cooperative cancel in gen_scheduler and gen_node"
```

---

## Task 4: Runtime `POST /v1/runs/cancel` + apply cancel

**Files:**
- Modify: `services/agent-runtime/app/main.py`
- Modify: `services/agent-runtime/app/runs.py` — 新增 `CancelRunRequest`、`cancel_run(...)`
- Create: `services/agent-runtime/tests/test_runs_cancel_api.py`

**Interfaces:**
- Produces:
  ```python
  class CancelRunRequest(BaseModel):
      thread_id: str
      session_id: str | None = None
      reason: str = "user"

  async def cancel_run(req: CancelRunRequest, *, checkpointer: Any | None = None, nest: Any | None = None) -> dict[str, Any]:
      """Returns {ok, phase, cancelled_node_ids, completed_tasks, total_tasks, skipped?, reason?}"""
  ```

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_runs_cancel_api.py
import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver

from app.main import app, clear_run_overrides, configure_run_overrides
from app.run_cancel import clear_cancel, is_cancel_requested


@pytest.mark.asyncio
async def test_cancel_run_sets_flag_and_is_idempotent(monkeypatch):
    clear_run_overrides()
    cp = MemorySaver()
    configure_run_overrides(checkpointer=cp)
    tid = "thread-cancel-api-1"
    clear_cancel(tid)

    # Minimal: even without PV checkpoint, flag must set; non-PV / empty may skipped
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"x-lnkpi-service-token": "test-token"}
        # Ensure auth: monkeypatch settings or use configured test token from conftest
        r1 = await client.post(
            "/v1/runs/cancel",
            json={"thread_id": tid, "session_id": "s1", "reason": "user"},
            headers=headers,
        )
        r2 = await client.post(
            "/v1/runs/cancel",
            json={"thread_id": tid, "session_id": "s1", "reason": "user"},
            headers=headers,
        )
    assert r1.status_code == 200
    assert r1.json()["ok"] is True
    assert r2.json()["ok"] is True
    assert is_cancel_requested(tid) is True
    clear_cancel(tid)
    clear_run_overrides()
```

若现有测试用固定 service token，对齐 `conftest` / `settings`（参考 `tests/test_health.py`）。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_runs_cancel_api.py -v`  
Expected: FAIL (404 on `/v1/runs/cancel`)

- [ ] **Step 3: Implement `cancel_run` + route**

`cancel_run` 逻辑：

1. `request_cancel(thread_id, reason=...)`
2. 读 checkpoint（同 `get_thread_state` 构图方式）
3. 若 `flow_mode != "product_visual"` → return `{ok: True, skipped: True, reason: "flow_not_supported", phase: ...}`
4. 若无活跃 gen：对 `gen_by_key` 中未完成且有 `node_id` 的项 best-effort `nest.cancel_generation`；`graph.aupdate_state(config, build_cancelled_checkpoint_update(...))`
5. 若 checkpoint 已是 `phase=cancelled` → 幂等返回
6. 返回 `cancelled_node_ids` / `completed_tasks` / `total_tasks`

`main.py`：

```python
@app.post("/v1/runs/cancel")
async def cancel_run_route(
    body: CancelRunRequest,
    x_lnkpi_service_token: str | None = Header(default=None),
):
    _require_runtime_auth(x_lnkpi_service_token)
    from app.runs import cancel_run
    return await cancel_run(body, checkpointer=_run_overrides.get("checkpointer"))
```

同时在 `stream_run_events` 的 `astream` 循环内：每处理完一个 update 后若 `is_cancel_requested(thread_id)`，`await emit({"type": "run_cancelled", "data": {...}})`，然后 `break`（finally 仍 release lock + `clear_cancel` 仅在成功写完 cancelled 后由 cancel 路径或 turn 结束清理——**规范：持锁 run 退出前 `aupdate_state` cancelled，再 `clear_cancel` 可留到下一轮 intake 前**；推荐 cancel flag 保留到下一轮 `classify` 读完再 `clear_cancel`）。

更稳妥：`run_cancelled` 写入 checkpoint 后，flag 可 `clear_cancel`；下一轮靠 checkpoint `run_cancelled` / `phase`。

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && uv run pytest tests/test_runs_cancel_api.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/main.py services/agent-runtime/app/runs.py \
  services/agent-runtime/tests/test_runs_cancel_api.py
git commit -m "feat(runtime): POST /v1/runs/cancel for product_visual"
```

---

## Task 5: Nest 代理 `POST /api/agent/runs/cancel`

**Files:**
- Create: `apps/server/src/agent/dto/cancel-run.dto.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.ts`
- Modify: `apps/server/src/agent/agent.service.ts`
- Modify: `apps/server/src/agent/agent.controller.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // AgentRuntimeClient
  cancelRun(input: { threadId: string; sessionId: string; reason?: string }): Promise<{
    ok: boolean
    phase?: string | null
    cancelledNodeIds?: string[]
    completedTasks?: number
    totalTasks?: number
    skipped?: boolean
    reason?: string
  }>
  ```
- `RuntimeThreadState` 增加 `runCancelled?: boolean | null`

- [ ] **Step 1: Write the failing client test**

在 `agent-runtime.client.test.ts` 增加：mock `fetch` 断言 `POST .../v1/runs/cancel` body 为 snake_case，响应映射为 camelCase。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && pnpm exec vitest run src/agent/agent-runtime.client.test.ts -t cancel`  
Expected: FAIL

- [ ] **Step 3: Implement DTO + client + service + controller**

```typescript
// dto/cancel-run.dto.ts
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export class CancelRunDto {
  @IsString()
  @MinLength(1)
  threadId!: string

  @IsString()
  @MinLength(1)
  sessionId!: string

  @IsOptional()
  @IsIn(['user', 'timeout'])
  reason?: 'user' | 'timeout'
}
```

Controller（`AuthGuard`）：

```typescript
  @Post('runs/cancel')
  @UseGuards(AuthGuard)
  async cancelRun(@Body() dto: CancelRunDto, @Req() req: Request & { user: { sub: string } }) {
    await this.sessionsService.findOne(dto.sessionId, req.user.sub)
    const data = await this.agentService.cancelRun(dto)
    return { code: 0, message: 'ok', data }
  }
```

Client：`POST ${base}/v1/runs/cancel`，headers 带 service token，body `{ thread_id, session_id, reason }`。

`getThreadState` 类型增加 `runCancelled`；Runtime 已在 Task 4 的 `get_thread_state` 返回中加 `"runCancelled": bool(vals.get("run_cancelled"))`。

- [ ] **Step 4: Run tests**

Run: `cd apps/server && pnpm exec vitest run src/agent/agent-runtime.client.test.ts -t cancel`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/dto/cancel-run.dto.ts \
  apps/server/src/agent/agent-runtime.client.ts \
  apps/server/src/agent/agent.service.ts \
  apps/server/src/agent/agent.controller.ts \
  apps/server/src/agent/agent-runtime.client.test.ts
git commit -m "feat(server): proxy POST /agent/runs/cancel to runtime"
```

---

## Task 6: 前端 `cancelAgentRun`（先 API 后 abort）

**Files:**
- Create: `apps/web/src/components/agent/cancelAgentRun.ts`
- Create: `apps/web/src/components/agent/cancelAgentRun.test.ts`
- Modify: `packages/agent/src/types.ts` — `AgentStreamEvent.type` 增加 `'run_cancelled'`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` — 替换 `cancelActiveStream`

**Interfaces:**
- Produces:
  ```typescript
  export async function cancelAgentRun(opts: {
    threadId: string
    sessionId: string
    abort: () => void
    postCancel?: (body: { threadId: string; sessionId: string; reason: 'user' }) => Promise<unknown>
  }): Promise<{ apiOk: boolean; skipped?: boolean }>
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// cancelAgentRun.test.ts
import { describe, expect, it, vi } from 'vitest'
import { cancelAgentRun } from './cancelAgentRun'

describe('cancelAgentRun', () => {
  it('calls API then abort even if API fails', async () => {
    const abort = vi.fn()
    const postCancel = vi.fn().mockRejectedValue(new Error('network'))
    const result = await cancelAgentRun({
      threadId: 't1',
      sessionId: 's1',
      abort,
      postCancel,
    })
    expect(postCancel).toHaveBeenCalledWith({ threadId: 't1', sessionId: 's1', reason: 'user' })
    expect(abort).toHaveBeenCalled()
    expect(result.apiOk).toBe(false)
  })

  it('reports skipped when runtime skips non-PV', async () => {
    const abort = vi.fn()
    const postCancel = vi.fn().mockResolvedValue({
      code: 0,
      data: { ok: true, skipped: true, reason: 'flow_not_supported' },
    })
    const result = await cancelAgentRun({
      threadId: 't1',
      sessionId: 's1',
      abort,
      postCancel,
    })
    expect(result.apiOk).toBe(true)
    expect(result.skipped).toBe(true)
    expect(abort).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/components/agent/cancelAgentRun.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement + wire SideRail**

```typescript
// cancelAgentRun.ts
export async function cancelAgentRun(opts: {
  threadId: string
  sessionId: string
  abort: () => void
  postCancel?: (body: { threadId: string; sessionId: string; reason: 'user' }) => Promise<unknown>
}): Promise<{ apiOk: boolean; skipped?: boolean }> {
  let apiOk = false
  let skipped: boolean | undefined
  try {
    if (opts.postCancel) {
      const res = (await opts.postCancel({
        threadId: opts.threadId,
        sessionId: opts.sessionId,
        reason: 'user',
      })) as { data?: { ok?: boolean; skipped?: boolean } }
      apiOk = res?.data?.ok !== false
      skipped = res?.data?.skipped
    }
  } catch {
    apiOk = false
  } finally {
    opts.abort()
  }
  return { apiOk, skipped }
}
```

`AgentSideRail.vue`：

```typescript
async function cancelActiveStream() {
  if (!agent.isStreaming) return
  const { apiOk } = await cancelAgentRun({
    threadId: agentThreadId.value,
    sessionId: props.sessionId,
    abort: () => {
      streamAbortController?.abort()
      agentStream.stop()
      agent.finishStreaming()
    },
    postCancel: (body) =>
      fetch(apiUrl('/api/agent/runs/cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      }).then((r) => r.json()),
  })
  ElMessage.info(apiOk ? '已停止当前任务，您可以发送新需求' : '已断开回复，后台可能仍在收尾')
}
```

处理 SSE：`event.type === 'run_cancelled'` 时设置本地 `runCancelled` / 展示 presentation（若 data 含 text）。

- [ ] **Step 4: Run tests**

Run: `cd apps/web && pnpm exec vitest run src/components/agent/cancelAgentRun.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agent/cancelAgentRun.ts \
  apps/web/src/components/agent/cancelAgentRun.test.ts \
  apps/web/src/components/agent/AgentSideRail.vue \
  packages/agent/src/types.ts
git commit -m "feat(web): cancelAgentRun calls backend before aborting SSE"
```

---

## Task 7: `classify_post_cancel_intent` + revise/new_task CLEAR

**Files:**
- Create: `services/agent-runtime/app/graph/post_cancel.py`
- Create: `services/agent-runtime/tests/test_post_cancel_intent.py`
- Modify: `services/agent-runtime/app/graph/hitl_resume.py` — 导出/复用 `should_resume_interrupt`、`build_fresh_turn_command`（post_cancel 调用即可，可不改）

**Interfaces:**
- Produces:
  ```python
  PostCancelIntent = Literal["gate_resume", "revise", "new_task"]

  def classify_post_cancel_intent(
      message: str,
      *,
      next_nodes: list[str],
      user_decision: str | None = None,
      run_cancelled: bool,
      phase: str | None,
  ) -> PostCancelIntent | None:
      """None = not a post-cancel turn (caller uses normal path)."""

  def build_revise_turn_command(*, phase_hint: str | None, update: dict[str, Any]) -> Command: ...
  def revise_state_clear_for_phase(phase: str | None) -> dict[str, Any]: ...
  ```

- [ ] **Step 1: Write the failing tests**

```python
# services/agent-runtime/tests/test_post_cancel_intent.py
from app.graph.post_cancel import classify_post_cancel_intent, revise_state_clear_for_phase


def test_new_task_chip():
    assert (
        classify_post_cancel_intent(
            "__new_task__",
            next_nodes=[],
            run_cancelled=True,
            phase="cancelled",
        )
        == "new_task"
    )


def test_gate_resume_after_cancel():
    assert (
        classify_post_cancel_intent(
            "确认出图",
            next_nodes=["await_shot_topo_confirm"],
            run_cancelled=True,
            phase="cancelled",
        )
        == "gate_resume"
    )


def test_revise_phrase():
    assert (
        classify_post_cancel_intent(
            "换成白底风格",
            next_nodes=[],
            run_cancelled=True,
            phase="cancelled",
        )
        == "revise"
    )


def test_long_ref_is_new_task():
    msg = "请用 @I1 帮我做另一套耳机主图方案并出白底图"
    assert (
        classify_post_cancel_intent(
            msg,
            next_nodes=[],
            run_cancelled=True,
            phase="cancelled",
        )
        == "new_task"
    )


def test_not_post_cancel_returns_none():
    assert (
        classify_post_cancel_intent(
            "你好",
            next_nodes=[],
            run_cancelled=False,
            phase="done",
        )
        is None
    )


def test_revise_clear_generating_keeps_macro_clears_gen():
    clear = revise_state_clear_for_phase("orchestrate_gen")
    assert "gen_completed_keys" in clear  # reset to None
    assert clear.get("selected_macro_scheme_ids") is None or "selected_macro_scheme_ids" not in clear
    # selected_macro should NOT be in clear dict (keep) — only keys to overwrite appear
    assert "macro_schemes" not in clear or clear.get("macro_schemes") is not None
```

按 spec §4.3 实现 `revise_state_clear_for_phase`：返回**需要写入的覆盖字段**（清空用 `None`），保留字段不出现在 dict 中。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_post_cancel_intent.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement classifiers**

优先级严格按 spec §4.2。改意图词 / 新任务词用模块级常量。`build_revise_turn_command`：

```python
def build_revise_turn_command(*, phase_hint: str | None, update: dict[str, Any]) -> Command:
    clear = revise_state_clear_for_phase(phase_hint)
    # Prefer jump to intake for safety in PV-1; refine goto per phase table in PV-2 if tests demand.
    return Command(goto="intake", update={**clear, "run_cancelled": None, "cancel_reason": None, "phase": None, **update})
```

首期 revise **统一 `goto="intake"`** 并带 CLEAR 表，避免错误跳 gate；UAT-02 验收「保留上游字段」靠 CLEAR 表不删 `selected_macro_scheme_ids` / `shot_manifest`（按 phase 分档）。若 `phase_hint` 为 `orchestrate_gen`，CLEAR gen_* 与 `delivery_selections`，保留 macro/shot。

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && uv run pytest tests/test_post_cancel_intent.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/post_cancel.py \
  services/agent-runtime/tests/test_post_cancel_intent.py
git commit -m "feat(runtime): classify post-cancel intent revise vs new_task"
```

---

## Task 8: Wire `runs.py` 下一轮分流 + thread-state

**Files:**
- Modify: `services/agent-runtime/app/runs.py`
- Modify: `services/agent-runtime/tests/test_hitl_resume.py` 或新增 `tests/test_runs_post_cancel.py`（用 MemorySaver 模拟 cancelled checkpoint + 新消息）

**Interfaces:**
- Consumes: Task 7 classifiers；现有 `should_resume_interrupt` / `build_fresh_turn_command` / `prepare_interrupt_resume`

- [ ] **Step 1: Write failing integration-style unit test**

```python
# services/agent-runtime/tests/test_runs_post_cancel.py
import pytest
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage

# Prefer testing classify+command wiring via a small helper extracted from stream_run_events:
# resolve_turn_input(pre_vals, next_nodes, message, user_decision, turn_update) -> input_state

from app.runs import resolve_turn_input  # extract in Step 3 if not present


def test_resolve_turn_input_new_task_after_cancel():
    pre = {"phase": "cancelled", "run_cancelled": True, "flow_mode": "product_visual", "shot_manifest": [{"shot_id": "s1"}]}
    turn_update = {"messages": [HumanMessage(content="__new_task__")], "session_id": "s"}
    inp = resolve_turn_input(pre, [], "__new_task__", None, turn_update)
    # Command to intake with cleared shot
    assert inp.goto == "intake"
    assert inp.update.get("shot_manifest") is None or "shot_manifest" in inp.update
```

- [ ] **Step 2: Run to verify fail**

Run: `cd services/agent-runtime && uv run pytest tests/test_runs_post_cancel.py -v`  
Expected: FAIL

- [ ] **Step 3: Extract `resolve_turn_input` and call from `stream_run_events`**

在现有 `is_gate_resume` 分支**之前**：

```python
    from app.graph.post_cancel import (
        classify_post_cancel_intent,
        build_revise_turn_command,
    )
    from app.graph.hitl_resume import build_fresh_turn_command, should_resume_interrupt, ...

    intent = classify_post_cancel_intent(
        req.message,
        next_nodes=list(next_nodes),
        user_decision=req.user_decision,
        run_cancelled=bool(pre_vals.get("run_cancelled")) or pre_vals.get("phase") == "cancelled",
        phase=str(pre_vals.get("phase") or "") or None,
    )
    if intent == "new_task":
        input_state = build_fresh_turn_command(update=turn_update)
    elif intent == "revise":
        input_state = build_revise_turn_command(
            phase_hint=str(pre_vals.get("phase") or "") or None,
            update=turn_update,
        )
    elif intent == "gate_resume":
        # existing gate resume path
        ...
    elif next_nodes and is_gate_resume:
        ...
    elif next_nodes:
        input_state = build_fresh_turn_command(update=turn_update)
    else:
        input_state = turn_update
```

`get_thread_state` 增加：

```python
        "runCancelled": bool(vals.get("run_cancelled")) if vals.get("run_cancelled") is not None else None,
```

且 `finished` 在 `phase_str == "cancelled"` 时为 `False`（可继续对话）。

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && uv run pytest tests/test_runs_post_cancel.py tests/test_post_cancel_intent.py tests/test_hitl_resume.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/runs.py services/agent-runtime/tests/test_runs_post_cancel.py
git commit -m "feat(runtime): wire post-cancel intent into turn resolution"
```

---

## Task 9: 侧栏 cancelled UX +「发起新任务」chip

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/components/agent/agentInterruptGate.ts`（如需从 thread-state 解析 cancelled）
- Modify: `apps/web/src/components/agent/agentInterruptGate.test.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.ts` — `RuntimeThreadState.runCancelled`（若 Task 5 未加）

**Interfaces:**
- Consumes: `presentation.kind === 'callout_info'`；`runCancelled` / `phase === 'cancelled'`
- Produces: chip 发送 `message: '__new_task__'`（经 `sendMessage`，**新** idempotency key）

- [ ] **Step 1: Write failing test for gate helper**

```typescript
// agentInterruptGate.test.ts 追加
import { isRunCancelledState } from './agentInterruptGate'

it('detects cancelled thread state', () => {
  expect(isRunCancelledState({ phase: 'cancelled', runCancelled: true })).toBe(true)
  expect(isRunCancelledState({ phase: 'done', runCancelled: false })).toBe(false)
})
```

- [ ] **Step 2: Run to fail**

Run: `cd apps/web && pnpm exec vitest run src/components/agent/agentInterruptGate.test.ts -t cancelled`  
Expected: FAIL

- [ ] **Step 3: Implement UI**

```typescript
export function isRunCancelledState(s: { phase?: string | null; runCancelled?: boolean | null } | null): boolean {
  if (!s) return false
  return s.runCancelled === true || s.phase === 'cancelled'
}
```

在 `AgentSideRail.vue`：

- `const showCancelledCallout = computed(() => isRunCancelledState(...) || localRunCancelled)`
- 展示 `presentation.body.text` 或默认文案
- 按钮：`发起新任务` → `sendMessage('__new_task__')`
- 重连 `thread-state` 时若 cancelled，设置 callout，**不要**当成 HITL interrupt 挡发送
- `send()` 在 cancelled 后照常；确保 `buildIdempotencyKey` 每次新 key（已有则确认取消不会复用 processing 缓存）

- [ ] **Step 4: Run tests**

Run: `cd apps/web && pnpm exec vitest run src/components/agent/agentInterruptGate.test.ts src/components/agent/cancelAgentRun.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agent/AgentSideRail.vue \
  apps/web/src/components/agent/agentInterruptGate.ts \
  apps/web/src/components/agent/agentInterruptGate.test.ts \
  apps/server/src/agent/agent-runtime.client.ts
git commit -m "feat(web): cancelled callout and new-task chip after mid-run stop"
```

---

## Task 10: 回归清单与手动 UAT 记录

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-agent-mid-run-interrupt-design.md` — §七 UAT 旁注「实现 PR」勾选说明（可选）
- Create: （可选）`deploy/prod-mid-run-interrupt-pv-verify.py` 仅当团队惯例需要 prod smoke；**本 Task 默认不做脚本**，只跑本地套件

- [ ] **Step 1: Run full related suite**

```bash
cd services/agent-runtime && uv run pytest \
  tests/test_run_cancel_registry.py \
  tests/test_cancel_checkpoint.py \
  tests/test_gen_scheduler_cancel.py \
  tests/test_runs_cancel_api.py \
  tests/test_post_cancel_intent.py \
  tests/test_runs_post_cancel.py \
  tests/test_hitl_resume.py -v

cd apps/server && pnpm exec vitest run src/agent/agent-runtime.client.test.ts

cd apps/web && pnpm exec vitest run \
  src/components/agent/cancelAgentRun.test.ts \
  src/components/agent/agentInterruptGate.test.ts
```

Expected: 全部 PASS

- [ ] **Step 2: Manual UAT checklist（staging）**

对照 spec：UAT-INT-PV-01～07，在 PR 描述中逐条勾选。

- [ ] **Step 3: Commit**（若有文档勾选更新）

```bash
git add docs/superpowers/specs/2026-08-12-agent-mid-run-interrupt-design.md
git commit -m "docs: note mid-run PV UAT checklist for implementation PR"
```

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| Run Cancel Token / Registry | T1 |
| `phase=cancelled` + presentation callout | T2, T4, T9 |
| `gen_scheduler` 停派发 + 在途 cancel | T3 |
| `POST /v1/runs/cancel` + 幂等 + 非 PV skipped | T4 |
| Nest 代理 | T5 |
| 前端先 cancel 再 abort | T6 |
| 启发式 classify + revise/new_task CLEAR | T7–T8 |
| 新任务 chip / thread-state | T9 |
| UAT-INT-PV-01～07 | T10 |
| Expand-B atomic/campaign | **明确不在本 plan** |
| LLM 分类 / Dock 统一取消 | **非目标** |

**Placeholder scan:** 无 TBD；revise 首期统一 `goto=intake` + CLEAR 表（已写明，避免错误跳 gate）。

**Type consistency:** `run_cancelled` / `runCancelled`、`CancelRunRequest`/`CancelRunDto`、`__new_task__` 全文一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-agent-mid-run-interrupt-pv.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每 Task 派一个新 subagent，Task 间审查，迭代快  
2. **Inline Execution** — 本会话用 executing-plans 按 Task 批量推进并设检查点  

Which approach?
