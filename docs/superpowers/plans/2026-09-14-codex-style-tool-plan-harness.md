# Codex-Style Tool Plan Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace keyword noun/verb gates and zero-tool `chat` with a Codex-style session harness: hard-feature short-circuit → optional `decide_lane` LLM → `ToolPlan` (core/deferred/`tool_search`) → `canvas_agent` loop with multi-turn context, while keeping CS-4 (no gen/destructive in LLM visible set).

**Architecture:** Extend `tool_registry` with `ToolExposure` and `build_tool_plan`. Evolve explore+chat into `canvas_agent`. Route via appendix-A hard rules first; when `LNKPI_ROUTE_LLM_PRIMARY=1`, remaining ambiguity uses structured `decide_lane`. Delete narrow-bind and (in M4) production `explore_canvas_signal`.

**Tech Stack:** Python 3.11+, pytest, LangGraph/`services/agent-runtime`, pydantic-settings, existing NestCanvasClient tools.

**Spec:** [docs/superpowers/specs/2026-09-14-codex-style-tool-plan-harness-design.md](../specs/2026-09-14-codex-style-tool-plan-harness-design.md)

## Global Constraints

- **CS-4 / H1:** `run_*_generation`, destructive, graph_batch → `exposure=graph_only`; never in `model_visible_specs`.
- **D6:** Do **not** claim colloquial export follow-up (V1) fixed until **Task 5 (M2)** lands.
- **D7:** `canvas_agent` and `decide_lane` must use compressed multi-turn context (not latest Human only).
- **D8:** Hard short-circuit = appendix A only; never treat `explore` / `empty` / `default_chat` as hard.
- **Pinned defaults (spec §9 open items):** `τ = 0.55`; `decide_lane` p95 target ≤ 2s; v1 deferred = `{get_image_edit_capabilities, list_public_assets, introduce_nodes_to_agent}`; keep `MANDATORY_INTENTS` ui/lifecycle/asset unless a later task explicitly removes them.
- **Flags:** `LNKPI_ROUTE_LLM_PRIMARY` (default `false`); optional `LNKPI_ROUTE_LLM_SHADOW` (default `false`, sampling only).
- **Rollback:** M3 flag off → hard + legacy precedence; **never** restore zero-tool `chat` as M1/M2 rollback.
- Prefer TDD: failing test → minimal code → pass → commit per task.
- Branch: `feature/codex-style-tool-plan-harness` (create from latest `main` if needed).
- Do **not** change Nest `/agent/internal/*` contracts.

## File map

| File | Responsibility |
|------|----------------|
| `services/agent-runtime/app/tools/tool_registry.py` | `ToolExposure`, `TOOL_EXPOSURES`, deferred set, helpers |
| `services/agent-runtime/app/tools/tool_plan.py` | **Create** — `ToolPlan`, `build_tool_plan`, catalog |
| `services/agent-runtime/app/tools/tool_search.py` | **Create** — `tool_search` matching + StructuredTool factory |
| `services/agent-runtime/app/tools/definitions.py` | Wire `tool_search`; explore builders use plan |
| `services/agent-runtime/app/graph/recent_turns.py` | **Create** — compress messages → recent_turns text |
| `services/agent-runtime/app/graph/nodes/explore.py` | Agent loop: plan bind, multi-turn, same-turn rebind |
| `services/agent-runtime/app/graph/nodes/chat.py` | Merge away / thin redirect (M2) |
| `services/agent-runtime/app/graph/builder.py` | Route `chat`/`explore_canvas`/`canvas_agent` → same node |
| `services/agent-runtime/app/graph/explore_dispatch.py` | Remove narrow-bind; stop classify-driven bind cull |
| `services/agent-runtime/app/graph/route_hard.py` | **Create** — `HARD_SHORTCIRCUIT_RULE_IDS` + runner |
| `services/agent-runtime/app/graph/decide_lane.py` | **Create** — LLM structured lane |
| `services/agent-runtime/app/graph/route_decide.py` | Wire hard → LLM → fallback `canvas_agent` |
| `services/agent-runtime/app/graph/route_precedence.py` | Keep rules; exclude explore/empty/default from hard path |
| `services/agent-runtime/app/graph/explore_route.py` | M4: retire production signal |
| `services/agent-runtime/app/graph/state.py` | `tool_plan_loaded`, `previous_lane`, `canvas_agent` flow_mode |
| `services/agent-runtime/app/config.py` | Route LLM flags |
| `services/agent-runtime/tests/test_tool_plan*.py` | Plan / exposure / search / I5–I7 |
| `services/agent-runtime/tests/test_canvas_agent_multiturn*.py` | V1-style multi-turn |
| `services/agent-runtime/tests/test_decide_lane*.py` | Hard short-circuit + LLM mock |
| Docs under `docs/superpowers/specs/` | Banners + CS/RU cross-links |

---

### Task 0: M0 — Spec banners + branch

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-sidebar-ref-image-routing-design.md` (top banner)
- Modify: `docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md` (top banner)

- [ ] **Step 1: Create branch**

```bash
cd /Users/4seven/workspace/lnkpi/.worktrees/feature-canvas-workflow-exchange
git fetch origin main && git checkout -b feature/codex-style-tool-plan-harness origin/main
```

- [ ] **Step 2: Add banners**

Insert at top of 2026-08-09 and 2026-08-08 specs (after title):

```markdown
> **L0 修订（2026-09-14）：** 部分条款由 [2026-09-14-codex-style-tool-plan-harness-design.md](./2026-09-14-codex-style-tool-plan-harness-design.md) 修订——L0 允许 `decide_lane` LLM；`explore`/`chat` 合并为 `canvas_agent` + ToolPlan。CS-4（禁止 explore bind gen/destructive）**仍然有效**。
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-09-sidebar-ref-image-routing-design.md \
  docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md \
  docs/superpowers/specs/2026-09-14-codex-style-tool-plan-harness-design.md
git commit -m "$(cat <<'EOF'
docs: approve codex tool-plan harness spec and cross-link banners

EOF
)"
```

---

### Task 1: M1a — `ToolExposure` + `build_tool_plan` + I5–I7

**Files:**
- Modify: `services/agent-runtime/app/tools/tool_registry.py`
- Create: `services/agent-runtime/app/tools/tool_plan.py`
- Create: `services/agent-runtime/tests/test_tool_plan.py`

**Interfaces:**
- Produces: `class ToolExposure(str, Enum): CORE | DEFERRED | GRAPH_ONLY | META`
- Produces: `TOOL_EXPOSURES: dict[str, ToolExposure]`
- Produces: `DEFERRED_TOOL_NAMES: frozenset[str]` (three v1 deferred names)
- Produces: `build_tool_plan(*, loaded: Sequence[str] | None = None) -> ToolPlan` with `visible_names`, `deferred_catalog`, `ordered_visible`
- Consumes: `TOOL_PLACEMENTS`, `ToolPlacement`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_tool_plan.py
from app.tools.tool_plan import build_tool_plan
from app.tools.tool_registry import (
    DEFERRED_TOOL_NAMES,
    TOOL_EXPOSURES,
    TOOL_PLACEMENTS,
    ToolExposure,
)


def test_i5_every_placement_has_exposure():
    assert set(TOOL_EXPOSURES) == set(TOOL_PLACEMENTS)


def test_i6_graph_only_never_visible():
    plan = build_tool_plan(loaded=[])
    for name, exp in TOOL_EXPOSURES.items():
        if exp == ToolExposure.GRAPH_ONLY:
            assert name not in plan.visible_names


def test_i7_deferred_in_catalog():
    plan = build_tool_plan(loaded=[])
    catalog_names = {c["name"] for c in plan.deferred_catalog}
    assert DEFERRED_TOOL_NAMES <= catalog_names
    assert DEFERRED_TOOL_NAMES.isdisjoint(plan.visible_names)


def test_loaded_deferred_enters_visible():
    name = next(iter(DEFERRED_TOOL_NAMES))
    plan = build_tool_plan(loaded=[name])
    assert name in plan.visible_names


def test_stable_order_is_sorted():
    plan = build_tool_plan(loaded=[])
    assert plan.ordered_visible == sorted(plan.ordered_visible)


def test_v6_gen_not_visible():
    plan = build_tool_plan(loaded=[])
    assert "run_image_generation" not in plan.visible_names
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd services/agent-runtime && python -m pytest tests/test_tool_plan.py -v
```

Expected: import errors / missing symbols.

- [ ] **Step 3: Implement minimal registry + plan**

In `tool_registry.py` add `ToolExposure`, `TOOL_EXPOSURES` (explore/ui_command → CORE except three deferred → DEFERRED; graph_node → GRAPH_ONLY), and `DEFERRED_TOOL_NAMES`.

Create `tool_plan.py`:

```python
from __future__ import annotations
from dataclasses import dataclass
from typing import Sequence

from app.tools.tool_registry import DEFERRED_TOOL_NAMES, TOOL_EXPOSURES, ToolExposure

META_TOOL_NAME = "tool_search"


@dataclass(frozen=True)
class ToolPlan:
    visible_names: frozenset[str]
    ordered_visible: list[str]
    deferred_catalog: list[dict]


def build_tool_plan(*, loaded: Sequence[str] | None = None) -> ToolPlan:
    loaded_set = {n for n in (loaded or []) if n in DEFERRED_TOOL_NAMES}
    visible: set[str] = set()
    catalog: list[dict] = []
    for name, exp in TOOL_EXPOSURES.items():
        if exp == ToolExposure.GRAPH_ONLY:
            continue
        if exp == ToolExposure.DEFERRED:
            catalog.append({"name": name, "description": name, "tier": "deferred"})
            if name in loaded_set:
                visible.add(name)
            continue
        if exp in (ToolExposure.CORE, ToolExposure.META):
            visible.add(name)
    ordered = sorted(visible)
    return ToolPlan(frozenset(ordered), ordered, catalog)
```

Do **not** add `tool_search` to placements until Task 2 (keeps I5 = placements ↔ exposures equal).

- [ ] **Step 4: Run — expect PASS**

```bash
python -m pytest tests/test_tool_plan.py tests/test_tool_placement_invariants.py -v
```

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/tools/tool_registry.py \
  services/agent-runtime/app/tools/tool_plan.py \
  services/agent-runtime/tests/test_tool_plan.py
git commit -m "$(cat <<'EOF'
feat(agent-runtime): add ToolExposure and build_tool_plan

EOF
)"
```

---

### Task 2: M1b — `tool_search` + plan bind + remove narrow-bind

**Files:**
- Create: `services/agent-runtime/app/tools/tool_search.py`
- Modify: `services/agent-runtime/app/tools/definitions.py`
- Modify: `services/agent-runtime/app/tools/tool_registry.py`
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py`
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Create: `services/agent-runtime/tests/test_tool_search.py`
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`

**Interfaces:**
- Produces: `match_deferred_tools(query: str, *, limit: int = 5) -> list[str]`
- Produces: `make_tool_search_tool(*, on_loaded: Callable[[list[str]], None]) -> StructuredTool`
- Explore: `build_tool_plan(loaded=...)`; on search, append + **same-turn** `bind_tools` rebuild
- Removes: `select_narrow_write_tools` production path; classify must not shrink bind set

- [ ] **Step 1: Failing tests**

```python
# tests/test_tool_search.py
from app.tools.tool_search import match_deferred_tools
from app.tools.tool_registry import DEFERRED_TOOL_NAMES


def test_match_finds_deferred_by_token():
    hit = match_deferred_tools("image edit capabilities", limit=5)
    assert "get_image_edit_capabilities" in hit
    assert set(hit) <= DEFERRED_TOOL_NAMES


def test_match_never_returns_graph_only():
    hit = match_deferred_tools("run_image_generation generation", limit=10)
    assert "run_image_generation" not in hit
```

```python
# tests/test_explore_narrow_bind.py — replace keyword cull expectations
from app.tools.tool_plan import build_tool_plan


def test_plan_always_includes_import_workflow_in_core():
    plan = build_tool_plan(loaded=[])
    assert "import_workflow" in plan.visible_names
    assert "export_media_package" in plan.visible_names
```

- [ ] **Step 2: Run — expect FAIL**

```bash
python -m pytest tests/test_tool_search.py tests/test_explore_narrow_bind.py -v
```

- [ ] **Step 3: Implement**

- `match_deferred_tools`: token overlap on name + catalog description; never GRAPH_ONLY.
- Register `tool_search`: `TOOL_PLACEMENTS["tool_search"]=EXPLORE`, `TOOL_EXPOSURES["tool_search"]=META`.
- Explore loop: maintain `loaded` list; rebuild plan+bind after successful search in the same turn; return `tool_plan_loaded` in state update.
- Delete `select_narrow_write_tools`; `select_explore_tool_names` → plan visible names (or remove).
- Keep `MANDATORY_INTENTS` path; do not keyword-narrow writes.

- [ ] **Step 4: Run**

```bash
python -m pytest tests/test_tool_search.py tests/test_explore_narrow_bind.py \
  tests/test_tool_plan.py tests/test_explore_tools.py tests/test_tool_placement_invariants.py -v
```

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/tools/tool_search.py \
  services/agent-runtime/app/tools/definitions.py \
  services/agent-runtime/app/tools/tool_registry.py \
  services/agent-runtime/app/graph/explore_dispatch.py \
  services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_tool_search.py \
  services/agent-runtime/tests/test_explore_narrow_bind.py
git commit -m "$(cat <<'EOF'
feat(agent-runtime): tool_search, plan bind, remove keyword narrow-bind

EOF
)"
```

---

### Task 3: M1c — Lock V5 same-turn visibility

**Files:**
- Create: `services/agent-runtime/tests/test_tool_search_rebind.py`

- [ ] **Step 1: Test**

```python
from app.tools.tool_plan import build_tool_plan
from app.tools.tool_search import match_deferred_tools


def test_v5_same_turn_loaded_visible():
    loaded: list[str] = []
    assert "list_public_assets" not in build_tool_plan(loaded=loaded).visible_names
    matched = match_deferred_tools("public assets list", limit=5)
    assert "list_public_assets" in matched
    loaded = sorted(set(loaded) | set(matched))
    assert "list_public_assets" in build_tool_plan(loaded=loaded).visible_names
```

- [ ] **Step 2: Run PASS + commit**

```bash
python -m pytest tests/test_tool_search_rebind.py -v
git add services/agent-runtime/tests/test_tool_search_rebind.py
git commit -m "$(cat <<'EOF'
test(agent-runtime): lock tool_search same-turn visibility (V5)

EOF
)"
```

---

### Task 4: M2a — Merge chat → `canvas_agent` + default lane

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Modify: `services/agent-runtime/app/graph/route_precedence.py`
- Modify: `services/agent-runtime/app/graph/route_decide.py`
- Modify: `services/agent-runtime/app/graph/nodes/chat.py`
- Modify: `services/agent-runtime/tests/test_route_precedence.py`
- Modify: `services/agent-runtime/tests/test_route_decide_explore.py`

**Interfaces:**
- `flow_mode` may be `canvas_agent`; builder maps `chat` | `explore_canvas` | `canvas_agent` → agent node
- State: `tool_plan_loaded: list[str] | None`, `previous_lane: str | None`
- `_rule_empty` / `_rule_default_chat` → `canvas_agent` (not zero-tool chat)

- [ ] **Step 1: Update failing expectations**

For greeting/default cases, assert `flow_mode in ("canvas_agent", "explore_canvas")` and builder does not use zero-tool chat. Prefer canonical `canvas_agent`.

- [ ] **Step 2: Run — expect FAIL on old `== "chat"` asserts**

```bash
python -m pytest tests/test_route_precedence.py tests/test_route_decide_explore.py -v
```

- [ ] **Step 3: Implement**

- `builder.route_after_intake`: `if flow_mode in ("explore_canvas", "chat", "canvas_agent"): return "explore"`.
- Default/empty rules emit `canvas_agent`.
- Extend `RouteFlowMode` / state Literal.
- Leave `chat.py` unused or make it call shared agent helper (prefer unused + graph edge removed).

- [ ] **Step 4: Run + commit**

```bash
python -m pytest tests/test_route_precedence.py tests/test_route_decide_explore.py \
  tests/test_graph_routes.py tests/test_route_decide.py -v
git commit -m "$(cat <<'EOF'
feat(agent-runtime): default lane canvas_agent; retire zero-tool chat

EOF
)"
```

---

### Task 5: M2b — Multi-turn context (D7) + V1 gate

**Files:**
- Create: `services/agent-runtime/app/graph/recent_turns.py`
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Create: `services/agent-runtime/tests/test_recent_turns.py`
- Create: `services/agent-runtime/tests/test_canvas_agent_multiturn_export.py`

**Interfaces:**
- `compress_recent_turns(messages: list, *, max_turns: int = 4) -> str`
- Explore seeds System + compressed history + current user (not latest-only)

- [ ] **Step 1: Failing test**

```python
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from app.graph.recent_turns import compress_recent_turns


def test_compress_includes_prior_tool_name():
    msgs = [
        HumanMessage(content="打包导出全部"),
        AIMessage(
            content="已导出",
            tool_calls=[{"name": "export_media_package", "args": {}, "id": "1"}],
        ),
        ToolMessage(content='{"ok": true}', tool_call_id="1"),
        HumanMessage(content="再导一次，这次也是全部导出。"),
    ]
    text = compress_recent_turns(msgs)
    assert "export_media_package" in text
```

- [ ] **Step 2: Run FAIL**

```bash
python -m pytest tests/test_recent_turns.py -v
```

- [ ] **Step 3: Implement + wire explore system prompt (spec §3.6)**

- [ ] **Step 4: V1 smoke — export always in core plan; compress fixture green**

```python
def test_v1_export_in_core_plan():
    from app.tools.tool_plan import build_tool_plan
    assert "export_media_package" in build_tool_plan(loaded=[]).visible_names
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent-runtime): multi-turn context for canvas_agent (V1 gate)

EOF
)"
```

**Checkpoint:** Spec D6 — V1/V2/V4/V6 acceptance unlocked.

---

### Task 6: M3a — Appendix A hard short-circuit

**Files:**
- Create: `services/agent-runtime/app/graph/route_hard.py`
- Create: `services/agent-runtime/tests/test_route_hard.py`

**Interfaces:**
- `HARD_SHORTCIRCUIT_RULE_IDS: tuple[str, ...]` per spec appendix A
- `apply_hard_shortcircuit(...) -> dict | None`

- [ ] **Step 1: Test**

```python
from app.graph.route_hard import HARD_SHORTCIRCUIT_RULE_IDS


def test_explore_not_in_hard_ids():
    assert "explore" not in HARD_SHORTCIRCUIT_RULE_IDS
    assert "empty" not in HARD_SHORTCIRCUIT_RULE_IDS
    assert "default_chat" not in HARD_SHORTCIRCUIT_RULE_IDS
    assert "atomic_generate" in HARD_SHORTCIRCUIT_RULE_IDS
```

- [ ] **Step 2–4: Implement using existing precedence rule fns filtered by id; pytest; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent-runtime): appendix-A hard shortcircuit rule ids

EOF
)"
```

---

### Task 7: M3b — `decide_lane` + flags

**Files:**
- Modify: `services/agent-runtime/app/config.py`
- Create: `services/agent-runtime/app/graph/decide_lane.py`
- Modify: `services/agent-runtime/app/graph/route_decide.py`
- Create: `services/agent-runtime/tests/test_decide_lane.py`

**Interfaces:**
- `route_llm_primary: bool = False` (`validation_alias="ROUTE_LLM_PRIMARY"` under `LNKPI_` prefix → env `LNKPI_ROUTE_LLM_PRIMARY`)
- `route_llm_shadow: bool = False`
- Pipeline: clarify_resume → hard → (primary? LLM : legacy non-explore default) → fallback `canvas_agent`
- LLM error → `canvas_agent`; confidence `< 0.55` conflict → `clarify_route`

- [ ] **Step 1: Fake-LLM tests** (`test_hard_skips_llm`, `test_llm_failure_falls_back_to_canvas_agent`, `test_primary_uses_llm_when_no_hard`)

- [ ] **Step 2–4: Implement structured JSON parse; wire decide_route; run**

```bash
python -m pytest tests/test_decide_lane.py tests/test_route_hard.py tests/test_eval_route_set.py -v
git commit -m "$(cat <<'EOF'
feat(agent-runtime): decide_lane LLM primary behind LNKPI_ROUTE_LLM_PRIMARY

EOF
)"
```

---

### Task 8: M4 — Retire production `explore_canvas_signal` + docs

**Files:**
- Modify: `services/agent-runtime/app/graph/route_precedence.py` (drop `_rule_explore` from production list)
- Modify: `services/agent-runtime/app/graph/explore_route.py` (mark deprecated / test-only)
- Modify: tests that required explore noun signal
- Docs: Retired notes for Phase 2b narrow-bind

- [ ] **Step 1: Full gate**

```bash
LNKPI_ROUTE_LLM_PRIMARY=1 python -m pytest tests/test_eval_route_set.py \
  tests/test_decide_lane.py tests/test_canvas_agent_multiturn_export.py \
  tests/test_tool_plan.py tests/test_tool_search_rebind.py \
  tests/test_tool_placement_invariants.py -v
```

- [ ] **Step 2: Remove production explore rule; fix tests**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(agent-runtime): retire explore noun-verb production routing

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| ToolExposure / build_tool_plan / I5–I7 | T1 |
| tool_search + same-turn rebind / deferred ≥3 | T2–T3 |
| Remove narrow-bind / classify bind cull | T2 |
| canvas_agent merge / default not zero-tool | T4 |
| Multi-turn D7 / V1 gate | T5 |
| Appendix A hard | T6 |
| decide_lane + flags + fallback agent | T7 |
| Retire explore_canvas_signal / banners | T0, T8 |
| CS-4 never visible gen | T1 I6 / V6 |
| V1 not claimed before M2 | T5 checkpoint |

## Plan self-review

- No TBD placeholders; pins live in Global Constraints.
- Names consistent: `ToolPlan`, `build_tool_plan`, `match_deferred_tools`, `compress_recent_turns`, `apply_hard_shortcircuit`, `decide_lane_llm`.
- Residual churn: many `flow_mode == "chat"` tests in T4 — prefer canonical `canvas_agent` updates; builder may still accept deprecated aliases.
