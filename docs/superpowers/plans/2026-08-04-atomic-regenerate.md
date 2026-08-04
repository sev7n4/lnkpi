# L1-03 atomic_regenerate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users say「再试一次」on the same thread after an atomic_create run and re-run Studio generation on the existing `atomic_node_id`, skipping parse/create.

**Architecture:** Extend intake routing with `atomic_regenerate_intent()` gated on checkpoint-persisted `atomic_node_id` + `atomic_spec`. New `prepare_atomic_regenerate` node resets error fields and routes to existing `run_atomic_gen`. Video/audio skip confirm on regenerate (user utterance = explicit consent). No new subgraph; one edge from intake into atomic gate tail.

**Tech Stack:** LangGraph (Python 3.11+), pytest (`services/agent-runtime`), existing Nest internal `run_*_generation` Harness, deploy smoke scripts.

**Spec:** `.trae/documents/loop-engineering-product-spec.md` §3.4 LC-5 V2, `.trae/documents/atomic-studio-intent-product-spec.md` §2.2.3

## Global Constraints

- Branch from `main`: `feature/atomic-regenerate` — **never push to main directly**.
- Pre-commit validation: `cd services/agent-runtime && python -m pytest tests/test_atomic*.py tests/test_atomic_regenerate*.py -v` and `pnpm build` before PR.
- `atomic_create_intent`（新建资产句）**优先于** regenerate；有 `focus_node_id` + `single_node_gen_intent` 仍走 P3。
- Regenerate **不得**新建画布节点（`add_nodes_batch` 调用次数不变）。
- Regenerate **不得**经过 `parse_atomic_intent` / `create_atomic_node` / `await_atomic_confirm`。
- 同 thread 无 `atomic_node_id` 时说「再试一次」→ 不进入 regenerate（走 chat）。
- `max_auto_retries()` 内建 retry **不在本 PR**；本 PR 仅用户显式 Adjust 回路。
- Commit per task; squash merge PR.

## File map

| File | Role |
| --- | --- |
| `services/agent-runtime/app/graph/atomic_intent.py` | `atomic_regenerate_intent()` |
| `services/agent-runtime/skills/atomic-create/intent-taxonomy.yaml` | Regenerate hints + route priority |
| `services/agent-runtime/app/graph/nodes/intake.py` | Detect regenerate from checkpoint state |
| `services/agent-runtime/app/graph/nodes/prepare_atomic_regenerate.py` | **NEW** — validate + reset + AIMessage |
| `services/agent-runtime/app/graph/builder.py` | `route_after_intake` → `prepare_atomic_regenerate` |
| `services/agent-runtime/app/graph/subgraphs/atomic_create_gate.py` | Register prepare node + edge → `run_atomic_gen` |
| `services/agent-runtime/app/graph/state.py` | Extend `flow_mode` Literal |
| `services/agent-runtime/tests/test_atomic_regenerate_intent.py` | **NEW** — intent unit tests |
| `services/agent-runtime/tests/test_atomic_regenerate_flow.py` | **NEW** — intake + graph path tests |
| `deploy/prod-atomic-regenerate-verify.py` | **NEW** — prod two-turn smoke |
| `.trae/documents/loop-engineering-product-spec.md` | Mark LC-5 V2 implemented |

---

### Task 1: Regenerate intent classifier

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_intent.py`
- Modify: `services/agent-runtime/skills/atomic-create/intent-taxonomy.yaml`
- Create: `services/agent-runtime/tests/test_atomic_regenerate_intent.py`

**Interfaces:**
- Produces: `atomic_regenerate_intent(text: str) -> bool`
- Produces: module constant `ATOMIC_REGENERATE_HINTS: tuple[str, ...]`

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_atomic_regenerate_intent.py
from app.graph.atomic_intent import (
    atomic_create_intent,
    atomic_regenerate_intent,
)


def test_atomic_regenerate_positive():
    assert atomic_regenerate_intent("再试一次")
    assert atomic_regenerate_intent("重试")
    assert atomic_regenerate_intent("重新生成")
    assert atomic_regenerate_intent("再来一次")


def test_atomic_regenerate_not_new_create():
    assert not atomic_regenerate_intent("帮我生成一个模特人物图")
    assert atomic_create_intent("帮我生成一个模特人物图")


def test_atomic_regenerate_not_campaign():
    assert not atomic_regenerate_intent("帮我做一套天猫蓝牙耳机详情页营销方案")


def test_atomic_regenerate_not_confirm_gate_reply():
    assert not atomic_regenerate_intent("确认生成")
    assert not atomic_regenerate_intent("取消")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_regenerate_intent.py -v`  
Expected: FAIL with `ImportError` or `AttributeError: atomic_regenerate_intent`

- [ ] **Step 3: Write minimal implementation**

In `intent-taxonomy.yaml` append:

```yaml
atomic_regenerate_hints:
  - 再试一次
  - 再试
  - 重试
  - 重新生成
  - 再来一次
  - 再生成一次
  - 再跑一遍
```

In `atomic_intent.py`:

```python
ATOMIC_REGENERATE_HINTS = tuple(_TAXONOMY.get("atomic_regenerate_hints") or (
    "再试一次",
    "再试",
    "重试",
    "重新生成",
    "再来一次",
    "再生成一次",
    "再跑一遍",
))


def atomic_regenerate_intent(text: str) -> bool:
    """True when user wants to re-run gen on existing atomic_node_id."""
    t = (text or "").strip()
    if not t:
        return False
    if _is_campaign_override(t):
        return False
    if atomic_create_intent(t):
        return False
    lowered = t.lower()
    if any(h in lowered or h in t for h in ATOMIC_REGENERATE_HINTS):
        return True
    return lowered in ("retry", "again")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_regenerate_intent.py -v`  
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/atomic_intent.py \
  services/agent-runtime/skills/atomic-create/intent-taxonomy.yaml \
  services/agent-runtime/tests/test_atomic_regenerate_intent.py
git commit -m "feat(agent): add atomic_regenerate intent classifier"
```

---

### Task 2: Intake routing with checkpoint gate

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/tests/test_atomic_create_intent.py` (add one case)

**Interfaces:**
- Consumes: `atomic_regenerate_intent(text: str) -> bool` from Task 1
- Produces: intake sets `flow_mode: "atomic_regenerate"` when checkpoint has `atomic_node_id` + `atomic_spec` and text matches

- [ ] **Step 1: Write the failing test**

Add to `tests/test_atomic_create_intent.py`:

```python
from app.graph.atomic_intent import atomic_regenerate_intent
from app.graph.nodes.intake import make_intake_node
from langchain_core.messages import HumanMessage
import pytest
from pathlib import Path


@pytest.mark.asyncio
async def test_intake_atomic_regenerate_when_prior_node(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({
        "messages": [HumanMessage(content="再试一次")],
        "atomic_node_id": "node-abc",
        "atomic_spec": {"target_type": "image", "title": "模特图", "prompt": "模特人物图"},
    })
    assert out["flow_mode"] == "atomic_regenerate"
    assert atomic_regenerate_intent("再试一次")


@pytest.mark.asyncio
async def test_intake_regenerate_without_prior_node_falls_through(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({
        "messages": [HumanMessage(content="再试一次")],
    })
    assert out.get("flow_mode") != "atomic_regenerate"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_create_intent.py::test_intake_atomic_regenerate_when_prior_node -v`  
Expected: FAIL (`flow_mode` is `"campaign"` or `"atomic_create"` not `"atomic_regenerate"`)

- [ ] **Step 3: Write minimal implementation**

In `state.py` extend flow_mode:

```python
flow_mode: Literal["campaign", "single_node", "atomic_create", "atomic_regenerate"] | None
```

In `intake.py` import `atomic_regenerate_intent` and after single_node block, before atomic_create:

```python
        elif (
            atomic_regenerate_intent(text)
            and str(state.get("atomic_node_id") or "").strip()
            and isinstance(state.get("atomic_spec"), dict)
        ):
            mode = "create"
            proposed_brief = None
            flow_mode = "atomic_regenerate"
            skill_id = None
        elif is_atomic:
            ...
```

And in `resolved_flow`:

```python
        resolved_flow = (
            flow_mode
            if is_single_node or is_atomic or flow_mode == "atomic_regenerate"
            else "campaign"
        )
```

Initialize `flow_mode = "campaign"` at top of intake to avoid UnboundLocalError on chat path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_create_intent.py::test_intake_atomic_regenerate_when_prior_node tests/test_atomic_create_intent.py::test_intake_regenerate_without_prior_node_falls_through -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/state.py \
  services/agent-runtime/app/graph/nodes/intake.py \
  services/agent-runtime/tests/test_atomic_create_intent.py
git commit -m "feat(agent): route atomic_regenerate from intake when checkpoint has node"
```

---

### Task 3: prepare_atomic_regenerate node

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/prepare_atomic_regenerate.py`
- Modify: `services/agent-runtime/app/graph/subgraphs/atomic_create_gate.py`
- Modify: `services/agent-runtime/app/graph/builder.py`

**Interfaces:**
- Consumes: state keys `atomic_node_id: str`, `atomic_spec: dict`
- Produces: `make_prepare_atomic_regenerate_node(*, nest: Any) -> Callable` returning async node that emits:
  ```python
  {
      "phase": "atomic_create",
      "last_error": None,
      "atomic_record_id": None,
      "user_decision": "none",
      "messages": [AIMessage(content=f"正在重新生成「{title}」…")],
  }
  ```
- Produces: `route_after_intake` maps `flow_mode=="atomic_regenerate"` → `"prepare_atomic_regenerate"`

- [ ] **Step 1: Write the failing test**

Create `tests/test_atomic_regenerate_flow.py`:

```python
from __future__ import annotations

from typing import Any

import pytest

from app.graph.builder import route_after_intake
from app.graph.nodes.prepare_atomic_regenerate import make_prepare_atomic_regenerate_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def get_node(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("get_node", node_id))
        return {"id": node_id, "type": "image", "title": "模特图"}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-regen-1"}


def test_route_after_intake_regenerate():
    assert route_after_intake({"flow_mode": "atomic_regenerate"}) == "prepare_atomic_regenerate"


@pytest.mark.asyncio
async def test_prepare_then_regenerate_skips_create():
    nest = FakeNest()
    spec = {"target_type": "image", "title": "模特图", "prompt": "模特人物图", "confirm_gate": False}
    state = {"atomic_node_id": "node-abc", "atomic_spec": spec, "last_error": "tool_timeout"}

    prep = make_prepare_atomic_regenerate_node(nest=nest)
    prepped = await prep(state)
    assert prepped["last_error"] is None
    assert "重新生成" in prepped["messages"][0].content

    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**state, **prepped})
    assert done["phase"] == "done"
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)
    assert ("run_image_generation", "node-abc") in nest.calls
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_regenerate_flow.py -v`  
Expected: FAIL (`prepare_atomic_regenerate` / route not found)

- [ ] **Step 3: Write minimal implementation**

`prepare_atomic_regenerate.py`:

```python
"""L1-03: re-run atomic gen on existing canvas node (skip parse/create)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def make_prepare_atomic_regenerate_node(*, nest: Any) -> Callable:
    async def prepare_atomic_regenerate(state: dict) -> dict:
        node_id = str(state.get("atomic_node_id") or "").strip()
        spec = state.get("atomic_spec") or {}
        title = str(spec.get("title") or spec.get("target_type") or "节点")

        if not node_id:
            return {
                "phase": "error",
                "last_error": "missing atomic_node_id",
                "messages": [AIMessage(content="没有可重新生成的节点，请先描述要创作的内容。")],
            }

        get_node = getattr(nest, "get_node", None)
        if get_node is not None:
            try:
                node = await get_node(node_id)
                if not isinstance(node, dict) or not str(node.get("id") or node_id).strip():
                    return {
                        "phase": "error",
                        "last_error": "atomic node missing",
                        "messages": [AIMessage(content="画布节点已不存在，请重新描述要生成的内容。")],
                    }
            except Exception as exc:  # noqa: BLE001
                return {
                    "phase": "error",
                    "last_error": str(exc),
                    "messages": [AIMessage(content=f"读取节点失败：{exc}")],
                }

        return {
            "phase": "atomic_create",
            "flow_mode": "atomic_regenerate",
            "last_error": None,
            "atomic_record_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=f"正在重新生成「{title}」…")],
        }

    return prepare_atomic_regenerate
```

In `atomic_create_gate.py`:

```python
from app.graph.nodes.prepare_atomic_regenerate import make_prepare_atomic_regenerate_node

def register_atomic_create_gate(graph: StateGraph, *, nest: Any) -> None:
    graph.add_node("prepare_atomic_regenerate", make_prepare_atomic_regenerate_node(nest=nest))
    ...
    graph.add_edge("prepare_atomic_regenerate", "run_atomic_gen")
```

In `builder.py`:

```python
def route_after_intake(state: AgentRuntimeState) -> str:
    if state.get("flow_mode") == "atomic_regenerate":
        return "prepare_atomic_regenerate"
    if state.get("flow_mode") == "single_node":
        ...
```

And add to conditional_edges map:

```python
        {
            "prepare_atomic_regenerate": "prepare_atomic_regenerate",
            "prepare_single_gen": "prepare_single_gen",
            ...
        },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_regenerate_flow.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/prepare_atomic_regenerate.py \
  services/agent-runtime/app/graph/subgraphs/atomic_create_gate.py \
  services/agent-runtime/app/graph/builder.py \
  services/agent-runtime/tests/test_atomic_regenerate_flow.py
git commit -m "feat(agent): prepare_atomic_regenerate skips parse/create"
```

---

### Task 4: Video/audio regenerate + subgraph regression

**Files:**
- Modify: `services/agent-runtime/tests/test_atomic_regenerate_flow.py`
- Modify: `services/agent-runtime/tests/test_atomic_create_subgraph.py`

**Interfaces:**
- Consumes: existing `run_atomic_gen` + confirm_gate spec fields

- [ ] **Step 1: Write the failing tests**

Append to `test_atomic_regenerate_flow.py`:

```python
@pytest.mark.asyncio
async def test_video_regenerate_skips_confirm_gate():
    class VideoNest(FakeNest):
        async def run_video_generation(self, node_id: str) -> dict[str, Any]:
            self.calls.append(("run_video_generation", node_id))
            return {"status": "completed", "url": "https://cdn/v2.mp4"}

    nest = VideoNest()
    spec = {
        "target_type": "video",
        "title": "产品视频",
        "prompt": "15秒展示",
        "confirm_gate": True,
    }
    prep = make_prepare_atomic_regenerate_node(nest=nest)
    prepped = await prep({"atomic_node_id": "vid-1", "atomic_spec": spec})
    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**prepped, "atomic_node_id": "vid-1", "atomic_spec": spec})
    assert done["phase"] == "done"
    assert ("run_video_generation", "vid-1") in nest.calls
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)
```

- [ ] **Step 2: Run test — expect PASS without code change**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_regenerate_flow.py::test_video_regenerate_skips_confirm_gate -v`  
Expected: PASS (documents contract; fix only if fail)

- [ ] **Step 3: Run full atomic test suite**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic*.py -v`  
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add services/agent-runtime/tests/test_atomic_regenerate_flow.py
git commit -m "test(agent): video/audio atomic_regenerate skips confirm gate"
```

---

### Task 5: Production smoke — two-turn regenerate

**Files:**
- Create: `deploy/prod-atomic-regenerate-verify.py`
- Modify: `deploy/prod-p4-full-regression.py` (optional append as Phase C2)

**Interfaces:**
- Consumes: prod API `POST /api/agent/chat/conversation` with same `threadId`

- [ ] **Step 1: Write deploy script**

```python
#!/usr/bin/env python3
"""Prod smoke: atomic_create turn 1 → forced fail mock not available — use image regen path.

Turn 1: 帮我生成一个模特人物图  → node created + gen ok
Turn 2: 再试一次               → same thread, no second node, gen called again

Reuse SSE helpers from prod-atomic-studio-verify.py.
Assert: session node count for title stable; second SSE has「重新生成」or completed again.
"""
```

Implementation notes for engineer:
- Copy `http`, `sse_collect`, auth helpers from `deploy/prod-atomic-studio-verify.py`
- Use fixed `thread_id = f"regen_{uuid.uuid4().hex[:8]}"`
- After turn 1: `GET /api/agent/sessions/{id}` → capture node count + first node id
- Turn 2 message: `再试一次`
- PASS if: node count unchanged; SSE assistant text contains `重新生成` or `生成完成`; no new plan/confirm gate events

- [ ] **Step 2: Run locally against prod (optional)**

Run: `python3 deploy/prod-atomic-regenerate-verify.py`  
Expected: all checks PASS

- [ ] **Step 3: Commit**

```bash
git add deploy/prod-atomic-regenerate-verify.py
git commit -m "test(deploy): prod atomic_regenerate two-turn smoke"
```

---

### Task 6: Spec sync + PR

**Files:**
- Modify: `.trae/documents/loop-engineering-product-spec.md`
- Modify: `.trae/documents/atomic-studio-intent-product-spec.md`

- [ ] **Step 1: Update LC-5 V2 status**

In `loop-engineering-product-spec.md` §3.4 change:

```markdown
**V2（未实现）**：`atomic_regenerate` ...
```

to:

```markdown
**V2（L1-03 ✅）**：`atomic_regenerate` — 同 thread「再试一次」+ checkpoint 有 `atomic_node_id` → `prepare_atomic_regenerate` → `run_atomic_gen`
```

In `atomic-studio-intent-product-spec.md` §2.2.3 append implementation note + link to this plan.

- [ ] **Step 2: Final validation**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic*.py -v`  
Run: `pnpm build`

- [ ] **Step 3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(agent): L1-03 atomic_regenerate loop" --body "$(cat <<'EOF'
## Summary
- Add `atomic_regenerate_intent` and intake routing when checkpoint retains `atomic_node_id`
- New `prepare_atomic_regenerate` node skips parse/create and re-runs Harness gen
- Prod two-turn smoke script

## Test plan
- [x] pytest tests/test_atomic*.py
- [ ] pnpm build
- [ ] deploy/prod-atomic-regenerate-verify.py
- [ ] deploy/prod-p4-full-regression.py

EOF
)"
```

---

## Self-Review (spec coverage)

| Spec requirement | Task |
| --- | --- |
| LC-5 V2 skip parse/create | Task 3 |
| Same thread + atomic_node_id gate | Task 2 |
| L-P5 single round per turn | Task 3 (`run_atomic_gen` once) |
| P3 focus priority | Task 2 (single_node checked first) |
| New create not hijacked | Task 1 (`atomic_create_intent` excludes regenerate) |
| L-A5 atomic done termination | Task 3 reuses `run_atomic_gen` |
| Prod verification | Task 5 |

No placeholders remain. Types consistent: `flow_mode="atomic_regenerate"` used in intake, builder, prepare node.
