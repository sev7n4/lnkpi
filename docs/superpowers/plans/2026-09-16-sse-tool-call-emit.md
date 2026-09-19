# SSE tool_call emit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explore LLM tool loops and mandatory `_invoke_tool` emit SSE `tool_call` / `tool_result` so V2 P7 can see `upsert_media_node` then `propose_generation` without changing bind, H8, or the smoke script.

**Architecture:** Add `maybe_emit_tool_sse` + `cap_tool_sse_payload` in `tool_sse.py`. Call them from the explore LLM loop and `_invoke_tool` via `sink._emit`. Do not wrap `NestEventProxy._call_inner`. Do not add a third argument to `make_explore_node`.

**Tech Stack:** Python agent-runtime; pytest; existing Nest NDJSON SSE (`type` + `data.name`).

**Spec:** [docs/superpowers/specs/2026-09-16-sse-tool-call-emit-design.md](../specs/2026-09-16-sse-tool-call-emit-design.md)

## Global Constraints

- Gold utterance (verbatim): `帮我生成一张蓝色天空产品主图` (classifies as `open_query` → LLM path, not mandatory)
- Payload: `{"type":"tool_call","data":{"name":...,"arguments":...}}` before `ainvoke`; `{"type":"tool_result","data":{"name":...,"result":...}}` after
- `cap_tool_sse_payload(value, *, kind: "arguments" | "result")`; `TOOL_SSE_MAX_JSON_BYTES = 2048`; returned object re-`json.dumps` utf-8 length ≤ 2048
- Result allowlist keys only: `ok`, `error`, `error_type`, `status`, `userMessage`, `node_id`, `nodeId`, `retry_hint`; clip `userMessage`/`error` to 200 chars
- `maybe_emit_tool_sse` uses `getattr(sink, "_emit", None)` only; await iff `inspect.isawaitable`; swallow all emit exceptions
- Do **not** modify `NestEventProxy._call_inner` / `__getattr__`; no public `emit_tool_call`
- Do **not** modify `deploy/prod-phase-2d3-h8-verify.py` or `deploy/prod-phase-v2-bare-gen-verify.py`
- Do **not** change bind / narrow write / system prompt / frontend / `make_explore_node(llm, nest)` signature
- No `run_*` name filter; no 2d.4; no Phase 3; no prompt/model slice; no mandatory gen dispatch
- Emit failure must not break tool `ainvoke`
- Branch: `feature/sse-tool-call-emit` (already created; do not branch from stale `origin/main` without bind)

---

## File map

| File | Responsibility |
|------|----------------|
| Spec + this plan | Authorize T1–T5 + unchanged P7 script |
| `app/graph/tool_sse.py` | `maybe_emit_tool_sse`, `cap_tool_sse_payload`, `TOOL_SSE_MAX_JSON_BYTES` |
| `app/graph/nodes/explore.py` | LLM loop emit; pass `event_sink=nest` into mandatory |
| `app/graph/explore_dispatch.py` | `event_sink` on `_invoke_tool` + mandatory helpers |
| `tests/test_tool_sse.py` | T4 helper + T5 cap |
| `tests/test_explore_tool_sse.py` | T1 + T2 |
| `tests/test_explore_mandatory.py` | T3 append; existing tests remain T4 |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-sse-tool-call-emit-design.md` (header `实现 plan` line only)
- Create: this plan file (already in the same commit if written together)

**Interfaces:**
- Consumes: spec TC-D1–TC-D7
- Produces: spec header links here

- [ ] **Step 1:** Replace the spec header line

From:

```
> 实现 plan：批准本档后另写 `docs/superpowers/plans/2026-09-16-sse-tool-call-emit.md`
```

To:

```
> 实现 plan：[../plans/2026-09-16-sse-tool-call-emit.md](../plans/2026-09-16-sse-tool-call-emit.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-sse-tool-call-emit-design.md \
  docs/superpowers/plans/2026-09-16-sse-tool-call-emit.md
git commit -m "$(cat <<'EOF'
docs(agent): plan SSE tool_call emit from explore tool loops

EOF
)"
```

If this plan is already in that commit, skip a second docs-only commit.

---

### Task 1: Helper T4/T5 (RED then GREEN)

**Files:**
- Create: `services/agent-runtime/app/graph/tool_sse.py`
- Test: `services/agent-runtime/tests/test_tool_sse.py`

**Interfaces:**
- Produces: `TOOL_SSE_MAX_JSON_BYTES: int = 2048`
- Produces: `cap_tool_sse_payload(value: Any, *, kind: Literal["arguments", "result"]) -> Any`
- Produces: `async def maybe_emit_tool_sse(sink: Any, event: dict[str, Any]) -> None`

- [ ] **Step 1: Write RED tests**

Create `services/agent-runtime/tests/test_tool_sse.py`:

```python
"""SSE tool_call/tool_result emit helper (cap + maybe_emit)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.graph.tool_sse import (
    TOOL_SSE_MAX_JSON_BYTES,
    cap_tool_sse_payload,
    maybe_emit_tool_sse,
)


def _dumps_bytes(obj: object) -> int:
    return len(json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"))


def test_cap_result_allowlist_drops_actions():
    out = cap_tool_sse_payload(
        {"ok": True, "nodeId": "n1", "actions": [{"type": "add_node"}]},
        kind="result",
    )
    assert out["ok"] is True
    assert out["nodeId"] == "n1"
    assert "actions" not in out
    assert _dumps_bytes(out) <= TOOL_SSE_MAX_JSON_BYTES


def test_cap_result_clips_error_to_200():
    out = cap_tool_sse_payload({"error": "e" * 500}, kind="result")
    assert out["error"] == "e" * 200


def test_cap_arguments_non_dict_becomes_empty():
    assert cap_tool_sse_payload("nope", kind="arguments") == {}


def test_t5_cap_result_oversized_truncated():
    out = cap_tool_sse_payload({"retry_hint": "x" * 5000}, kind="result")
    assert _dumps_bytes(out) <= TOOL_SSE_MAX_JSON_BYTES
    assert out.get("_truncated") is True


def test_t5_cap_arguments_oversized_truncated():
    value = {f"k{i}": "x" * 200 for i in range(50)}
    out = cap_tool_sse_payload(value, kind="arguments")
    assert _dumps_bytes(out) <= TOOL_SSE_MAX_JSON_BYTES
    assert out.get("_truncated") is True


@pytest.mark.asyncio
async def test_maybe_emit_magicmock_sink_does_not_raise():
    await maybe_emit_tool_sse(MagicMock(), {"type": "tool_call", "data": {"name": "undo"}})


@pytest.mark.asyncio
async def test_maybe_emit_missing_emit_noop():
    await maybe_emit_tool_sse(object(), {"type": "tool_call", "data": {"name": "undo"}})


@pytest.mark.asyncio
async def test_maybe_emit_non_awaitable_callable():
    seen: list[dict] = []

    class Sink:
        def _emit(self, event: dict) -> None:
            seen.append(event)

    await maybe_emit_tool_sse(Sink(), {"type": "tool_call", "data": {"name": "undo"}})
    assert seen[0]["data"]["name"] == "undo"


@pytest.mark.asyncio
async def test_maybe_emit_awaitable_and_swallows_errors():
    seen: list[dict] = []

    class Ok:
        async def _emit(self, event: dict) -> None:
            seen.append(event)

    class Boom:
        async def _emit(self, event: dict) -> None:
            raise RuntimeError("sse down")

    await maybe_emit_tool_sse(Ok(), {"type": "tool_call", "data": {"name": "a"}})
    await maybe_emit_tool_sse(Boom(), {"type": "tool_call", "data": {"name": "b"}})
    assert [e["data"]["name"] for e in seen] == ["a"]
```

- [ ] **Step 2: Run RED**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_tool_sse.py -v
```

Expected: FAIL with `ModuleNotFoundError: app.graph.tool_sse` (or import error for the three names).

- [ ] **Step 3: Minimal implementation**

Create `services/agent-runtime/app/graph/tool_sse.py`:

```python
"""Best-effort SSE emit for explore/mandatory tool loops."""

from __future__ import annotations

import inspect
import json
import logging
from typing import Any, Literal

logger = logging.getLogger(__name__)

TOOL_SSE_MAX_JSON_BYTES = 2048
_RESULT_KEYS = (
    "ok",
    "error",
    "error_type",
    "status",
    "userMessage",
    "node_id",
    "nodeId",
    "retry_hint",
)
_STR_CLIP = 200
Kind = Literal["arguments", "result"]


def cap_tool_sse_payload(value: Any, *, kind: Kind) -> Any:
    if kind == "arguments":
        obj: Any = value if isinstance(value, dict) else {}
    elif isinstance(value, dict):
        obj = {}
        for key in _RESULT_KEYS:
            if key not in value:
                continue
            item = value[key]
            if key in ("userMessage", "error") and isinstance(item, str):
                obj[key] = item[:_STR_CLIP]
            else:
                obj[key] = item
    else:
        obj = {"repr": str(value)[:_STR_CLIP]}
    return _fit_json(obj)


def _fit_json(obj: Any) -> Any:
    dumped = json.dumps(obj, ensure_ascii=False, default=str)
    if len(dumped.encode("utf-8")) <= TOOL_SSE_MAX_JSON_BYTES:
        return obj
    preview = dumped
    while True:
        wrapped = {"_truncated": True, "preview": preview}
        out = json.dumps(wrapped, ensure_ascii=False, default=str)
        encoded = out.encode("utf-8")
        if len(encoded) <= TOOL_SSE_MAX_JSON_BYTES:
            return wrapped
        raw = preview.encode("utf-8")
        if not raw:
            return {"_truncated": True, "preview": ""}
        preview = raw[: max(0, len(raw) - 64)].decode("utf-8", "ignore")


async def maybe_emit_tool_sse(sink: Any, event: dict[str, Any]) -> None:
    emit = getattr(sink, "_emit", None)
    if not callable(emit):
        return
    try:
        out = emit(event)
        if inspect.isawaitable(out):
            await out
    except Exception:
        logger.debug("tool_sse_emit_failed", exc_info=True)
```

- [ ] **Step 4: Run GREEN**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_tool_sse.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/tool_sse.py \
  services/agent-runtime/tests/test_tool_sse.py
git commit -m "$(cat <<'EOF'
feat(agent): add capped SSE helper for explore tool_call events

EOF
)"
```

---

### Task 2: Explore LLM loop T1/T2

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Test: `services/agent-runtime/tests/test_explore_tool_sse.py`

**Interfaces:**
- Consumes: `maybe_emit_tool_sse`, `cap_tool_sse_payload` from Task 1
- Consumes: existing `make_explore_node(*, llm, nest)`
- Produces: each LLM `tool_calls` entry emits `tool_call` then `tool_result` on `nest._emit`
- Note: gold utterance is `open_query` (not mandatory). T1 **must not** use 撤销/定位 sentences.

- [ ] **Step 1: Write RED tests**

Create `services/agent-runtime/tests/test_explore_tool_sse.py`:

```python
"""Explore LLM loop emits tool_call/tool_result; canvas summary does not."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.explore import make_explore_node

GOLD = "帮我生成一张蓝色天空产品主图"


@pytest.mark.asyncio
async def test_t1_t2_gold_emits_upsert_then_propose_not_summary():
    events: list[dict] = []

    async def capture(event: dict) -> None:
        events.append(event)

    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(
        side_effect=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "upsert_media_node",
                        "args": {"target_type": "image", "prompt": "蓝色天空产品主图"},
                        "id": "1",
                    },
                    {
                        "name": "propose_generation",
                        "args": {"node_id": "image-1"},
                        "id": "2",
                    },
                ],
            ),
            AIMessage(content="已提交待确认。"),
        ]
    )

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})
    nest._emit = capture

    upsert = MagicMock()
    upsert.name = "upsert_media_node"
    upsert.ainvoke = AsyncMock(return_value={"ok": True, "nodeId": "image-1"})
    propose = MagicMock()
    propose.name = "propose_generation"
    propose.ainvoke = AsyncMock(return_value={"ok": True, "status": "pending_confirm"})

    import app.graph.nodes.explore as explore_mod

    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [upsert, propose]
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore({"messages": [HumanMessage(content=GOLD)]})
    finally:
        explore_mod.build_explore_tools = original

    assert "已提交待确认" in result["messages"][0].content
    names = [
        str((e.get("data") or {}).get("name") or "")
        for e in events
        if e.get("type") == "tool_call"
    ]
    assert names == ["upsert_media_node", "propose_generation"]
    results = [
        str((e.get("data") or {}).get("name") or "")
        for e in events
        if e.get("type") == "tool_result"
    ]
    assert results == ["upsert_media_node", "propose_generation"]
    assert "get_canvas_summary" not in names
    nest.get_canvas_summary.assert_awaited()
```

- [ ] **Step 2: Run RED**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_tool_sse.py -v
```

Expected: FAIL (`names == []` or assertion on `names == [...]`).

- [ ] **Step 3: Emit in the LLM loop**

In `services/agent-runtime/app/graph/nodes/explore.py`:

1. Add import next to the other `app.graph` imports:

```python
from app.graph.tool_sse import cap_tool_sse_payload, maybe_emit_tool_sse
```

2. Inside `for tc in tool_calls:`, **immediately after** the `args = ...` line and **before** `tool = tools_by_name.get(name)`, insert the tool_call emit. **Immediately after** the `if tool is None` / `else` try/except block (after `result` is assigned, **before** `extract_canvas_commands`), insert the tool_result emit.

The loop must become:

```python
            for tc in tool_calls:
                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
                tool_call_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", "")
                await maybe_emit_tool_sse(
                    nest,
                    {
                        "type": "tool_call",
                        "data": {
                            "name": str(name),
                            "arguments": cap_tool_sse_payload(args or {}, kind="arguments"),
                        },
                    },
                )
                tool = tools_by_name.get(name)
                called_tools.add(str(name))
                if tool is None:
                    result: Any = {"error": f"unknown tool: {name}"}
                else:
                    try:
                        result = await tool.ainvoke(args or {})
                    except AgentToolError as exc:
                        err = exc.error
                        result = {
                            "error": err["message"],
                            "error_type": err["error_type"],
                            "retry_hint": err.get("retry_hint"),
                        }
                    except Exception as exc:
                        err = from_exception(str(name), exc)
                        result = {
                            "error": err["message"],
                            "error_type": err["error_type"],
                            "retry_hint": err.get("retry_hint"),
                        }
                await maybe_emit_tool_sse(
                    nest,
                    {
                        "type": "tool_result",
                        "data": {
                            "name": str(name),
                            "result": cap_tool_sse_payload(result, kind="result"),
                        },
                    },
                )
                for cmd in extract_canvas_commands(result):
                    if cmd not in canvas_commands:
                        canvas_commands.append(cmd)
```

Do not change `get_canvas_summary`, `_bind_plan_tools`, or system prompt. Do not wrap `NestEventProxy`.

- [ ] **Step 4: Run GREEN**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_tool_sse.py tests/test_explore_write_gate.py tests/test_explore_tool_search_rebind.py -v
```

Expected: all PASS (`MagicMock` nest tests stay green because `_emit` is non-awaitable).

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_explore_tool_sse.py
git commit -m "$(cat <<'EOF'
feat(agent): emit SSE tool_call from explore LLM tool loop

EOF
)"
```

---

### Task 3: Mandatory `_invoke_tool` T3/T4

**Files:**
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py`
- Modify: `services/agent-runtime/app/graph/nodes/explore.py` (mandatory call site only)
- Test: `services/agent-runtime/tests/test_explore_mandatory.py` (append)

**Interfaces:**
- Consumes: `maybe_emit_tool_sse`, `cap_tool_sse_payload`
- Produces: `run_mandatory_explore(..., event_sink: Any | None = None)`
- Produces: `_invoke_tool(..., event_sink: Any | None = None)` emits when sink has `_emit`
- Existing `run_mandatory_explore(...)` callers without `event_sink` remain valid (T4)

- [ ] **Step 1: Write RED test** (append to `test_explore_mandatory.py`; keep every existing test)

```python
@pytest.mark.asyncio
async def test_t3_mandatory_undo_emits_tool_call():
    events: list[dict] = []

    class Sink:
        async def _emit(self, event: dict) -> None:
            events.append(event)

    tools = {
        "undo": FakeTool("undo", {"ok": True, "canvasCommands": [{"type": "undo"}]}),
    }
    out = await run_mandatory_explore(
        "ui_command",
        "查询画布，撤销上一步画布编辑操作",
        summary=SUMMARY,
        tools_by_name=tools,
        event_sink=Sink(),
    )
    assert out.tools_called == ["undo"]
    names = [
        str((e.get("data") or {}).get("name") or "")
        for e in events
        if e.get("type") == "tool_call"
    ]
    assert names == ["undo"]
```

- [ ] **Step 2: Run RED**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_mandatory.py::test_t3_mandatory_undo_emits_tool_call -v
```

Expected: FAIL (`TypeError: unexpected keyword argument 'event_sink'` or `names == []`).

- [ ] **Step 3: Implement sink plumbing + emit**

In `explore_dispatch.py`:

1. Add import:

```python
from app.graph.tool_sse import cap_tool_sse_payload, maybe_emit_tool_sse
```

2. Replace `_invoke_tool` with:

```python
async def _invoke_tool(
    tools_by_name: dict[str, Any],
    name: str,
    args: dict[str, Any],
    *,
    canvas_commands: list[dict[str, Any]],
    tool_results: list[Any],
    tools_called: list[str],
    event_sink: Any | None = None,
) -> Any:
    await maybe_emit_tool_sse(
        event_sink,
        {
            "type": "tool_call",
            "data": {
                "name": str(name),
                "arguments": cap_tool_sse_payload(args or {}, kind="arguments"),
            },
        },
    )
    tool = tools_by_name.get(name)
    if tool is None:
        result: Any = {"error": f"unknown tool: {name}"}
    else:
        try:
            result = await tool.ainvoke(args)
        except AgentToolError as exc:
            err = exc.error
            result = {
                "error": err["message"],
                "error_type": err["error_type"],
                "retry_hint": err.get("retry_hint"),
            }
    await maybe_emit_tool_sse(
        event_sink,
        {
            "type": "tool_result",
            "data": {
                "name": str(name),
                "result": cap_tool_sse_payload(result, kind="result"),
            },
        },
    )
    tools_called.append(name)
    tool_results.append(result)
    for cmd in extract_canvas_commands(result):
        if cmd not in canvas_commands:
            canvas_commands.append(cmd)
    return result
```

3. Add `event_sink: Any | None = None` to `run_mandatory_explore` and pass it into `_mandatory_ui` / `_mandatory_lifecycle` / `_mandatory_asset`:

```python
async def run_mandatory_explore(
    intent: ExploreIntent,
    user_text: str,
    *,
    summary: dict,
    tools_by_name: dict[str, Any],
    event_sink: Any | None = None,
) -> MandatoryExploreResult:
    """Direct tool dispatch without LLM (UI / lifecycle / asset_read)."""
    canvas_commands: list[dict[str, Any]] = []
    tool_results: list[Any] = []
    tools_called: list[str] = []

    if intent == "ui_command":
        return await _mandatory_ui(
            user_text,
            summary=summary,
            tools_by_name=tools_by_name,
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
            event_sink=event_sink,
        )

    if intent == "lifecycle":
        return await _mandatory_lifecycle(
            user_text,
            summary=summary,
            tools_by_name=tools_by_name,
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
            event_sink=event_sink,
        )

    if intent == "asset_read":
        return await _mandatory_asset(
            user_text,
            tools_by_name=tools_by_name,
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
            event_sink=event_sink,
        )

    return MandatoryExploreResult(
        reply_text="内部错误：非 mandatory intent",
        canvas_commands=canvas_commands,
        tool_results=tool_results,
        tools_called=tools_called,
    )
```

4. Add `event_sink: Any | None = None` to `_mandatory_ui`, `_mandatory_lifecycle`, and `_mandatory_asset` keyword-only args. Add `event_sink=event_sink` to **every** existing `_invoke_tool(` call in those three functions (redo, undo, open_image_editor, introduce_nodes_to_agent, focus_node, focus_nodes, lifecycle tool, list_*_assets). Do not change reply strings or tool names.

5. In `explore.py`, change the mandatory call to:

```python
            mandatory = await run_mandatory_explore(
                intent,
                user_text,
                summary=summary if isinstance(summary, dict) else {},
                tools_by_name=tools_by_name,
                event_sink=nest,
            )
```

- [ ] **Step 4: Run GREEN**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_mandatory.py tests/test_explore_28_contract.py tests/test_explore_mandatory_wiring.py tests/test_explore_tool_sse.py tests/test_tool_sse.py -v
```

Expected: all PASS, including new T3 and old tests that omit `event_sink`.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/explore_dispatch.py \
  services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_explore_mandatory.py
git commit -m "$(cat <<'EOF'
feat(agent): emit SSE tool_call from mandatory explore dispatch

EOF
)"
```

---

### Task 4: Regression gate (no smoke-script edits)

**Files:**
- Verify only (do not modify): `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: local pytest evidence; P7 remains a **post-deploy** production run of the unchanged V2 script

- [ ] **Step 1: Confirm smoke scripts are untouched**

```bash
git diff -- deploy/prod-phase-v2-bare-gen-verify.py deploy/prod-phase-2d3-h8-verify.py
```

Expected: empty.

- [ ] **Step 2: Broader runtime tests**

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_tool_sse.py tests/test_explore_tool_sse.py tests/test_explore_mandatory.py tests/test_explore_28_contract.py tests/test_explore_write_gate.py tests/test_explore_narrow_bind.py tests/test_nest_event_proxy.py tests/test_chat_system_prompt.py tests/test_phase_2b_propose_tools.py -v
```

Expected: all PASS.

- [ ] **Step 3:** If Step 2 required any fix, commit that fix separately. If clean, no extra commit.

P7 (`deploy/prod-phase-v2-bare-gen-verify.py`) runs **after** this branch is merged and Runtime is deployed. Do not weaken P7. Do not start prompt/model slice in this PR.

---

## Self-review (plan vs spec)

| Spec | Task |
|------|------|
| TC-D1 / TC-D2 helper + loops | Task 1–3 |
| TC-D3 no `_call_inner` wrap | Global + Task 2/3 never touch `runs.py` NestEventProxy |
| TC-D4 payload order + no name filter | Task 2/3 emit code |
| TC-D5 cap + swallow + MagicMock | Task 1 |
| TC-D6 no H8/P7/bind/frontend/signature | Task 4 + constraints |
| TC-D7 no model slice | Task 4 note |
| T1 T2 | Task 2 |
| T3 T4 | Task 3 + Task 1 MagicMock |
| T5 | Task 1 `retry_hint` / huge arguments |
| P7 unchanged script | Task 4 |
