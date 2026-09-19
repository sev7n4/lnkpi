# Planner Confirm Chip Instantiates Without LLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful `preview_workflow_template`, the exact chip「确认落到画布」must instantiate with that preview's call args without calling the LLM, and must never show「未能更新节点，请提供节点 id」.

**Architecture:** Pure helpers parse the last successful preview from raw LangGraph messages. Explore short-circuits exact confirm/cancel chips before `classify_explore_intent` / `ainvoke`. Nest HTTP 4xx body `userMessage` is recovered so instantiate lint failures reach the sidebar. Successful instantiate forwards `canvasCommands` via existing `extract_canvas_commands`.

**Tech Stack:** Python 3 agent-runtime (pytest, LangChain messages, httpx Nest client). No Vue change.

**Spec:** [docs/superpowers/specs/2026-09-16-planner-confirm-instantiate-gate-design.md](../specs/2026-09-16-planner-confirm-instantiate-gate-design.md)

## Global Constraints

- Chip match is **trim-then-exact** `确认落到画布` / `先不改` only.
- Do **not** handle free-form「把角色三视图落到画布」without the confirm chip.
- Instantiate args come from preview **tool call args** (`parent_id` / `parent_version` / `delta`), never preview response IR.
- Scan **raw** `state["messages"]`, not `compress_recent_turns`.
- Skip failed previews; use the latest **successful** one; zero successes → no write.
- Confirm/cancel turns must not enter `_NODE_WRITE_CLARIFY`.
- Do not change campaign / `await_topo` / promote chips / preview HITL copy.
- C1 supersedes §14.5.1 bind table **only** for these two exact chips.

## File map

| File | Role |
|------|------|
| `services/agent-runtime/app/graph/planner_copy.py` | Chip match, copy constants, `last_successful_preview_args` |
| `services/agent-runtime/tests/test_planner_copy.py` | Parser + chip tests |
| `services/agent-runtime/app/errors.py` | `message_from_http_error_body` |
| `services/agent-runtime/app/tools/nest_client.py` | 4xx uses Nest body message |
| `services/agent-runtime/tests/test_errors.py` | Body parse tests |
| `services/agent-runtime/tests/test_nest_client.py` | HTTP 400 userMessage (if a 4xx fixture exists; else errors tests suffice) |
| `services/agent-runtime/app/graph/nodes/explore.py` | Chip short-circuit before LLM |
| `services/agent-runtime/tests/test_planner_confirm_instantiate.py` | Spec §5 explore tests |

---

### Task 1: Preview args recovery + chip copy

**Files:**
- Modify: `services/agent-runtime/app/graph/planner_copy.py`
- Modify: `services/agent-runtime/tests/test_planner_copy.py`

**Interfaces:**
- Produces:
  - `PLANNER_CONFIRM_CHIP = "确认落到画布"`
  - `PLANNER_CANCEL_CHIP = "先不改"`
  - `PLANNER_NO_PREVIEW_REPLY = "请先规划并确认模板改动，再落到画布。"`
  - `PLANNER_CANCEL_REPLY = "已取消落到画布。"`
  - `PLANNER_INSTANTIATED_REPLY = "已按模板落到画布。"`
  - `def is_planner_confirm_chip(text: str | None) -> bool`
  - `def is_planner_cancel_chip(text: str | None) -> bool`
  - `def last_successful_preview_args(messages: list[Any] | None) -> dict[str, Any] | None`  
    Returns `{"parent_id": str, "parent_version": str, "delta": dict}` or `None`.

- [ ] **Step 1: Write failing tests** (append to `test_planner_copy.py`)

```python
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from app.graph.planner_copy import (
    is_planner_cancel_chip,
    is_planner_confirm_chip,
    last_successful_preview_args,
)


def test_confirm_chip_trim_exact_only():
    assert is_planner_confirm_chip("确认落到画布") is True
    assert is_planner_confirm_chip("  确认落到画布\n") is True
    assert is_planner_confirm_chip("确认落到画布吧") is False
    assert is_planner_cancel_chip("先不改") is True
    assert is_planner_cancel_chip("先不改了") is False


def _preview_turn(call_id: str, args: dict, result: dict) -> list:
    return [
        AIMessage(
            content="",
            tool_calls=[{
                "name": "preview_workflow_template",
                "args": args,
                "id": call_id,
            }],
        ),
        ToolMessage(content=json.dumps(result, ensure_ascii=False), tool_call_id=call_id),
    ]


def test_last_successful_preview_skips_failed_and_keeps_earlier():
    ok = {"parent_id": "model-turnaround", "parent_version": "1.0.0", "delta": {}}
    msgs = [
        HumanMessage(content="规划一个角色三视图工作流"),
        *_preview_turn("p1", ok, {"parentTitle": "角色三视图", "diffLines": []}),
        *_preview_turn(
            "p2",
            {"parent_id": "ecommerce-product-visual", "parent_version": "1.0.0", "delta": {"remove": ["banner"]}},
            {"error": "lint failed"},
        ),
        HumanMessage(content="确认落到画布"),
    ]
    assert last_successful_preview_args(msgs) == {
        "parent_id": "model-turnaround",
        "parent_version": "1.0.0",
        "delta": {},
    }


def test_last_successful_preview_none_when_all_fail():
    msgs = _preview_turn("p1", {"parent_id": "x", "parent_version": "1.0.0"}, {"error": "nope"})
    assert last_successful_preview_args(msgs) is None


def test_last_successful_preview_normalizes_parentId_and_missing_delta():
    msgs = _preview_turn(
        "p1",
        {"parentId": "model-turnaround", "parentVersion": "1.0.0"},
        {"ok": True},
    )
    assert last_successful_preview_args(msgs) == {
        "parent_id": "model-turnaround",
        "parent_version": "1.0.0",
        "delta": {},
    }
```

Add `import json` at top of the test file if missing.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd services/agent-runtime && .venv/bin/python -m pytest tests/test_planner_copy.py -q
```

Expected: FAIL (`last_successful_preview_args` not defined).

- [ ] **Step 3: Implement helpers in `planner_copy.py`**

Walk messages in order. For each `AIMessage.tool_calls` named `preview_workflow_template`, remember `id → args`. For each `ToolMessage`, if `tool_call_id` matches, treat as success unless parsed JSON/dict has truthy `error`. Keep a list of normalized successful args; return the last.

Normalize: `parent_id` from `parent_id` or `parentId`; `parent_version` from `parent_version` or `parentVersion`; `delta` dict or `{}`. If `parent_id` or `parent_version` missing after normalize, skip that call (not success).

- [ ] **Step 4: Re-run tests — expect PASS**

```bash
cd services/agent-runtime && .venv/bin/python -m pytest tests/test_planner_copy.py -q
```

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/planner_copy.py services/agent-runtime/tests/test_planner_copy.py
git commit -m "feat(agent): recover last successful planner preview args from messages"
```

---

### Task 2: Nest 4xx body userMessage

**Files:**
- Modify: `services/agent-runtime/app/errors.py`
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: `services/agent-runtime/tests/test_errors.py`

**Interfaces:**
- Produces: `def message_from_http_error_body(body: Any, fallback: str) -> str`
- Consumes: `nest_client._post` HTTPStatusError branch

- [ ] **Step 1: Failing tests in `test_errors.py`**

```python
from app.errors import message_from_http_error_body

EMPTY = "还有步骤没写提示词，先补上再放到画布。"


def test_message_from_http_error_body_prefers_userMessage():
    assert message_from_http_error_body(
        {"statusCode": 400, "message": {"message": "x", "userMessage": EMPTY}, "error": "Bad Request"},
        "请求参数有误",
    ) == EMPTY


def test_message_from_http_error_body_string_message():
    assert message_from_http_error_body({"message": EMPTY}, "请求参数有误") == EMPTY


def test_message_from_http_error_body_fallback():
    assert message_from_http_error_body("nope", "请求参数有误") == "请求参数有误"
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd services/agent-runtime && .venv/bin/python -m pytest tests/test_errors.py -q
```

- [ ] **Step 3: Implement `message_from_http_error_body`**

Preference order: nested `message.userMessage`, top-level `userMessage`, nested `message.message` if str, top-level `message` if str, first str in `message` list, else `fallback`. Strip; ignore empty.

- [ ] **Step 4: Wire `nest_client._post` HTTPStatusError**

On `httpx.HTTPStatusError`, `err = from_http_status(...)`. Try `exc.response.json()`; if dict, set `err["message"] = message_from_http_error_body(body, err["message"])`. Then raise `AgentToolError(err)` as today.

- [ ] **Step 5: Tests PASS + commit**

```bash
cd services/agent-runtime && .venv/bin/python -m pytest tests/test_errors.py tests/test_nest_client.py -q
git add services/agent-runtime/app/errors.py services/agent-runtime/app/tools/nest_client.py services/agent-runtime/tests/test_errors.py
git commit -m "fix(runtime): surface Nest 4xx userMessage from HTTP body"
```

---

### Task 3: Explore chip short-circuit

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Create: `services/agent-runtime/tests/test_planner_confirm_instantiate.py`

**Interfaces:**
- Consumes: Task 1 helpers; `nest.instantiate_recipe`; `extract_canvas_commands`; `AgentToolError`
- After `last_user_utterance` is set from `pick_planner_slot_utterance`, **before** `classify_explore_intent`:
  - cancel chip → assistant `PLANNER_CANCEL_REPLY`, no LLM, no instantiate
  - confirm chip → if args: `await nest.instantiate_recipe(**args)` (plus existing last_user_utterance/attachments on client); success reply `PLANNER_INSTANTIATED_REPLY` + `canvas_commands`; `AgentToolError` → `error["message"]`; no args → `PLANNER_NO_PREVIEW_REPLY`
- `llm.ainvoke` must not run on these paths.

- [ ] **Step 1: Write `test_planner_confirm_instantiate.py` covering spec §5**

Reuse `_Nest` / patch `build_explore_tools` patterns from `test_planner_copy.py`. Use `AsyncMock` for `instantiate_recipe`.

Cases:
1. Preview success in messages +「确认落到画布」→ `instantiate_recipe` called with same parent/delta; `canvas_commands` from result; reply 已按模板落到画布; `llm.ainvoke` call_count == 0
2. Confirm with no preview → instantiate not called; reply 请先规划并确认模板改动，再落到画布。; content 不含 未能更新节点
3. 「先不改」→ instantiate not called; reply 已取消落到画布。
4. instantiate raises `AgentToolError` with empty-prompt message → that message in reply; 不含 未能更新节点
5. Confirm chip still skipped even if `classify` would be `node_write` (do not mock classify; real classify of「确认落到画布」is node_write — short-circuit must win)

- [ ] **Step 2: Run — expect FAIL** (LLM still invoked / 未能更新节点)

```bash
cd services/agent-runtime && .venv/bin/python -m pytest tests/test_planner_confirm_instantiate.py -q
```

- [ ] **Step 3: Implement short-circuit in `explore()`** after setting `nest.last_user_utterance`, before intent classify. Build the same `out` dict shape as the mandatory-intent early return (`phase=done`, `messages=[AIMessage(...)]`, optional `canvas_commands`). Use `prefix_assistant_reply` like other exits.

Call `nest.instantiate_recipe(parent_id=..., parent_version=..., delta=...)` — client already injects utterance/attachments.

- [ ] **Step 4: Run planner + explore write-gate tests**

```bash
cd services/agent-runtime && .venv/bin/python -m pytest tests/test_planner_confirm_instantiate.py tests/test_planner_copy.py tests/test_explore_write_gate.py tests/test_explore_narrow_bind.py -q
```

Expected: PASS. Existing `test_explore_write_gate` (non-chip node_write) still clarifies.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py services/agent-runtime/tests/test_planner_confirm_instantiate.py
git commit -m "feat(agent): instantiate on confirm chip without LLM"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| C1–C6, C8–C10 | T1 + T3 |
| C7 HTTP body | T2 + T3 case 4 |
| C11 canvas_commands | T3 case 1 |
| §5.1–5.5 | T3 |

## Placeholder scan

None. Commands and test bodies are concrete.
