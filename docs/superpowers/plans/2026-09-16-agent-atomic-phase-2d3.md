# Agent Atomic Phase 2d.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear retired `atomic_*` / `single_node` lane literals from types and prompts; rename soft signals away from `atomic_*`; keep a runtime `_LEGACY_LANE_SHIM` to `canvas_agent`; clear dirty `split_manifest` on regen→agent.

**Architecture:** One shared shim for legacy lane strings (decide_lane + intake). Rename soft helpers in place (same files). Do not rename skill directory or `AtomicIntent` / `atomic_intent.py`. Keep G6 string detection for `await_atomic_confirm`.

**Tech Stack:** Python agent-runtime; pytest; intent-taxonomy YAML.

**Spec:** [docs/superpowers/specs/2026-09-16-agent-atomic-phase-2d3-design.md](../specs/2026-09-16-agent-atomic-phase-2d3-design.md)  
**Depends on:** Phase 2d.2 (#337) in prod.

## Global Constraints

- H1/H2: `run_*` never visible; no silent bill on legacy await.
- Public ALLOWED / `RouteFlowMode` / state `flow_mode` Literal: **no** `atomic_create` / `atomic_regenerate` / `single_node`.
- Runtime `_LEGACY_LANE_SHIM`: those three strings → `canvas_agent` + log (not in ALLOWED).
- Soft rename per spec table; delete `atomic_create_intent` public API.
- Do **not** rename `skills/atomic-create/` or `AtomicIntent` / `atomic_intent.py` module path.
- Keep `chat` / `explore_canvas` aliases if still used.
- Branch: `feature/agent-atomic-phase-2d3` from latest `main`.

## File map

| File | Responsibility |
|------|----------------|
| Specs + this plan | Authorize 2d.3 |
| `app/graph/legacy_lane.py` (new) | `_LEGACY_LANE_SHIM` + `map_legacy_lane(lane) -> str` |
| `app/graph/decide_lane.py` | Drop retired from ALLOWED/prompt; use shim |
| `app/graph/route_decide.py` | `RouteFlowMode` drop three |
| `app/graph/state.py` | `flow_mode` Literal drop three |
| `app/graph/nodes/intake.py` | Use shim; H5 clear `split_manifest` on regen/checkpoint_regen |
| `app/graph/atomic_intent.py` + IR + `intent.py` | Rename soft APIs |
| `app/graph/route_features.py` / `route_precedence.py` | `has_regen_checkpoint`; call new names |
| `app/graph/intent_parse_*.py` | Drop retired routes from schema/prompt |
| `skills/**/intent-taxonomy.yaml` | `media_create_hints`; soft-only routes |
| Delete: `classify_atomic_confirm`, `clarify_atomic_intent.py`, dead `step_copy` keys |
| `tests/test_phase_2d3_cleanup.py` | H1–H7 |
| eval/tests flips | Rename imports + gold |
| `deploy/prod-phase-2d3-h8-verify.py` | H8 smoke |

---

### §6.0.8 hard table

| ID | Expectation |
|----|-------------|
| H1 | types/ALLOWED lack three literals |
| H2 | shim maps three → canvas_agent |
| H3 | `rg` old fn names zero in `app/` |
| H4 | taxonomy not SSOT for retired flow |
| H5 | regen→agent clears split_manifest |
| H6 | G6 still safe |
| H7 | no run_* visible |
| H8 | prod smoke |

---

### Task 0: Docs authorize

- [ ] Branch from `origin/main`: `feature/agent-atomic-phase-2d3`
- [ ] Commit specs (2d.3 design + parent D9 / 2d.2 pointer) + this plan:

```bash
git add \
  docs/superpowers/specs/2026-09-16-agent-atomic-phase-2d3-design.md \
  docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md \
  docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d2-design.md \
  docs/superpowers/plans/2026-09-16-agent-atomic-phase-2d3.md
git commit -m "$(cat <<'EOF'
docs(agent): authorize Phase 2d.3 cleanup + legacy lane shim

EOF
)"
```

---

### Task 1: Failing tests H1–H7

**Files:**
- Create: `services/agent-runtime/tests/test_phase_2d3_cleanup.py`

- [ ] **Step 1: Write RED tests** (mirror `test_phase_2d_route_close` / `test_phase_2d2_subgraph_retire` helpers)

```python
"""Phase 2d.3 §6.0.8: literal cleanup + soft rename + shim (H1–H7)."""

from __future__ import annotations

import inspect

from app.graph.decide_lane import ALLOWED_LANES, DecideLaneResult, apply_decide_lane_postprocess, parse_decide_lane_json
from app.graph.route_decide import RouteFlowMode
from app.graph.state import AgentRuntimeState
from typing import get_args, get_origin, Union
import typing


RETIRED = frozenset({"atomic_create", "atomic_regenerate", "single_node"})


def test_h1_allowed_and_types_lack_retired():
    assert RETIRED.isdisjoint(ALLOWED_LANES)
    # RouteFlowMode / AgentRuntimeState.__annotations__["flow_mode"] must not include RETIRED
    # (implementer: extract Literal args the same way other tests do, or use typing.get_args)


def test_h2_shim_maps_retired_lanes_to_canvas_agent():
    for lane in RETIRED:
        mapped = parse_decide_lane_json(
            f'{{"lane":"{lane}","confidence":0.9,"reason":"legacy"}}'
        )
        assert mapped is not None
        assert mapped["lane"] == "canvas_agent"
        post = apply_decide_lane_postprocess(
            DecideLaneResult(lane=lane, confidence=0.9, reason="x", clarify_question=None)
        )
        assert post["lane"] == "canvas_agent"


def test_h3_old_soft_names_absent_from_app():
    # Prefer importing and AttributeError, or subprocess rg:
    # rg pattern in app/ must be empty for old names
    import app.graph.atomic_intent as ai
    assert not hasattr(ai, "utterance_suggests_atomic_create")
    assert not hasattr(ai, "atomic_create_intent")
    assert not hasattr(ai, "atomic_regenerate_intent")
    assert not hasattr(ai, "classify_atomic_confirm")
    assert hasattr(ai, "utterance_suggests_media_create")
    assert hasattr(ai, "regen_intent")


def test_h5_checkpoint_regen_clears_split_manifest():
    # Build state with split_manifest + regen utterance + has_regen_checkpoint fixture
    # Run intake or precedence+intake path; assert out["split_manifest"] == []
    ...


def test_h6_retired_await_still_safe():
    from app.graph.hitl_resume import RETIRED_INTERRUPT_GATES, build_retired_atomic_confirm_command
    assert "await_atomic_confirm" in RETIRED_INTERRUPT_GATES
    cmd = build_retired_atomic_confirm_command(update={})
    # goto must not be run_atomic_gen (node gone); assert parse_sidebar_media or explore
    assert "run_atomic_gen" not in str(cmd)


def test_h7_no_run_tools_visible():
    from app.tools.tool_plan import build_tool_plan
    plan = build_tool_plan()
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names
```

Fill H5 using the same fixture pattern as `test_g1_checkpoint_regen` in `test_phase_2d2_subgraph_retire.py`, then call intake with a non-empty `split_manifest`.

- [ ] **Step 2:** `cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_phase_2d3_cleanup.py -v` → expect FAIL (RED)

- [ ] **Step 3: Commit**

```bash
git add services/agent-runtime/tests/test_phase_2d3_cleanup.py
git commit -m "$(cat <<'EOF'
test(agent): add Phase 2d.3 H1–H7 failing gates

EOF
)"
```

---

### Task 2: Legacy shim + type/ALLOWED cleanup

**Files:**
- Create: `services/agent-runtime/app/graph/legacy_lane.py`
- Modify: `decide_lane.py`, `route_decide.py`, `state.py`, `nodes/intake.py` (use shim instead of inline frozenset)

```python
# legacy_lane.py
LEGACY_LANE_SHIM = frozenset({"atomic_create", "atomic_regenerate", "single_node"})

def map_legacy_lane(lane: str | None) -> str | None:
    if lane in LEGACY_LANE_SHIM:
        return "canvas_agent"
    return lane
```

- [ ] Replace `_RETIRED_LANES_TO_AGENT` with import of `LEGACY_LANE_SHIM` / `map_legacy_lane`
- [ ] Remove three from ALLOWED, RouteFlowMode, state Literal; keep `chat`/`explore_canvas`
- [ ] Update decide_lane system prompt (no teaching old lanes; note they are invalid)
- [ ] GREEN: H1/H2 (and H7 if untouched)
- [ ] Commit: `feat(agent): legacy lane shim + drop retired flow_mode literals`

---

### Task 3: Soft rename + taxonomy + dead code

**Files:** `atomic_intent.py`, `atomic_intent_ir.py`, `intent.py`, `route_features.py`, `route_precedence.py`, `hitl_resume.py` (if imports), taxonomy YAMLs, delete `clarify_atomic_intent.py` / `classify_atomic_confirm`, trim `step_copy.py`

Rename map (verbatim):

| Old | New |
|-----|-----|
| `utterance_suggests_atomic_create` | `utterance_suggests_media_create` |
| `intent_suggests_atomic_create` | `intent_suggests_media_create` |
| `atomic_regenerate_intent` | `regen_intent` |
| `single_node_gen_intent` | `focus_gen_intent` |
| `has_atomic_checkpoint` | `has_regen_checkpoint` |
| taxonomy `atomic_create_hints` | `media_create_hints` |

- [ ] Delete `atomic_create_intent` (callers → media_create)
- [ ] Update all app + test imports
- [ ] Taxonomy: remove intake SSOT rows that set retired `flow_mode`
- [ ] GREEN H3 + related unit tests
- [ ] Commit: `refactor(agent): rename media/regen soft signals for Phase 2d.3`

---

### Task 4: H5 split_manifest on regen

**Files:** `nodes/intake.py` (and tests)

- [ ] When `route_decision.precedence_rule_id == "checkpoint_regen"` **or** decision reason indicates regen-to-agent, set `out["split_manifest"] = []` (same as media_create clear)
- [ ] Optionally also clear when `regen_intent(text)` and `flow_mode==canvas_agent` with prior campaign residue — prefer rule-id based to avoid over-clear
- [ ] GREEN H5
- [ ] Commit: `fix(agent): clear split_manifest on checkpoint_regen to agent`

---

### Task 5: Flip remaining tests / eval + full suite

- [ ] Fix any remaining gold / imports
- [ ] `cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest -q`
- [ ] `pytest tests/test_eval_route_set.py -v` if present
- [ ] Commit: `test(agent): align suite with Phase 2d.3 renames`

---

### Task 6: PR + H8 smoke

- [ ] Open PR (squash merge after CI green)
- [ ] Watch Agent Runtime deploy
- [ ] Run:

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  python3.11 deploy/prod-phase-2d3-h8-verify.py
```

Cases: bare gen → canvas_agent; regen utterance → agent/clarify not atomic steps; no run_*; pending before charge.

---

## Done when

- [ ] H1–H7 CI green; H8 prod PASS
- [ ] 2d.4 / Phase 3 **not** started

## Spec coverage

| Spec | Task |
|------|------|
| D1–D4 types + shim | Task 2 |
| D5 rename | Task 3 |
| D6 H5 | Task 4 |
| D7 feature rename / G6 keep | Task 3 + H6 |
| D8 non-goals | Global |
| H1–H8 | Tasks 1–6 |
