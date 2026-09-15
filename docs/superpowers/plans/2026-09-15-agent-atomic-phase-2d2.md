# Agent Atomic Phase 2d.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unregister atomic/single subgraphs and remap `checkpoint_regen` / `focus_gen` so regenerate and focus-gen never bill without dock confirm; retire dangerous `await_atomic_confirm` resume.

**Architecture:** Route-layer remaps first (keep rule ids → `canvas_agent`), then builder unregister + HITL hard-stop, then delete/archive unreachable gate modules. Do **not** delete shared `start_gen` / `collect_gen`. Literal `RouteFlowMode` values may remain unused.

**Tech Stack:** Python agent-runtime (LangGraph builder, precedence, decide_lane, hitl_resume); pytest; eval-route-set YAML.

**Spec:** [docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d2-design.md](../specs/2026-09-15-agent-atomic-phase-2d2-design.md)  
**Depends on:** Phase 2d (#325) F1–F7 green in prod.

## Global Constraints

- H1: `run_*_generation` never in `build_tool_plan().visible_names`.
- H2: no billable gen before user confirm (dock / propose); especially no `prepare_single_gen` → `start_gen` with `confirm_gen`.
- Keep `checkpoint_regen` / `focus_gen` rule ids; only change `flow_mode`.
- Do **not** modify campaign / product_visual gates.
- Do **not** auto-migrate historical checkpoints.
- Hard acceptance = graph unreachable (G4), not “every atomic_*.py file deleted”.
- Branch: `feature/agent-atomic-phase-2d2` from latest `main`.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d2-design.md` | Authorize 2d.2 + G1–G8 |
| `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md` | D9 / §4.4 / §6.0 → 2d.2 |
| `docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d-design.md` | Mark 2d complete; point to 2d.2 |
| `services/agent-runtime/app/graph/route_precedence.py` | Remap `checkpoint_regen` / `focus_gen` |
| `services/agent-runtime/app/graph/decide_lane.py` | Drop lanes + prompt + postprocess map |
| `services/agent-runtime/app/graph/nodes/intake.py` | Stop writing old flows; legacy → explore |
| `services/agent-runtime/app/graph/builder.py` | Unregister gates; fix `route_after_intake`; drop interrupt |
| `services/agent-runtime/app/graph/hitl_resume.py` | Neutralize `await_atomic_confirm` resume |
| `services/agent-runtime/app/graph/subgraphs/atomic_create_gate.py` | Delete or `archive/` |
| `services/agent-runtime/app/graph/subgraphs/single_node_gate.py` | Delete or `archive/` |
| Orphan node modules listed in Task 4 | Delete/archive if only referenced by those gates |
| `services/agent-runtime/tests/test_phase_2d2_subgraph_retire.py` | G1–G7 dedicated |
| Existing atomic/single/route tests + `eval-route-set.yaml` | Flip gold / skip unreachable subgraph unit tests |
| `deploy/prod-phase-2d2-g8-verify.py` | G8 prod smoke |

---

### §6.0.7 hard table

| ID | Expectation |
|----|-------------|
| G1 | checkpoint_regen → canvas_agent |
| G2 | focus_gen → canvas_agent |
| G3 | legacy flow_mode → explore |
| G4 | forbidden nodes absent; start_gen may remain |
| G5 | decide_lane maps retired lanes |
| G6 | await_atomic_confirm resume cannot bill |
| G7 | no run_* visible |
| G8 | prod smoke |

---

### Task 0: Docs authorize (already drafted locally)

**Files:**
- Modify/Create: specs listed in File map + this plan

- [ ] **Step 1: Ensure branch from latest main**

```bash
git fetch origin main
git checkout -b feature/agent-atomic-phase-2d2 origin/main
# cherry-pick or re-apply local spec/plan docs if needed
```

- [ ] **Step 2: Commit docs only**

```bash
git add \
  docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d2-design.md \
  docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md \
  docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d-design.md \
  docs/superpowers/plans/2026-09-15-agent-atomic-phase-2d2.md
git commit -m "$(cat <<'EOF'
docs(agent): authorize Phase 2d.2 subgraph retire + regen/single remap

EOF
)"
```

---

### Task 1: Failing tests G1–G5 / G7

**Files:**
- Create: `services/agent-runtime/tests/test_phase_2d2_subgraph_retire.py`
- Test: same

**Interfaces:**
- Consumes: `apply_route_precedence`, `assemble_route_context`, `resolve_atomic_intent`, `extract_route_features`, `decide_lane` helpers, `build_agent_graph`, `build_tool_plan` (or existing tool-plan test helper)
- Produces: red tests encoding G1–G5 / G7

- [ ] **Step 1: Write failing tests**

Create `services/agent-runtime/tests/test_phase_2d2_subgraph_retire.py`:

```python
"""Phase 2d.2 §6.0.7: retire atomic/single subgraphs (G1–G5, G7)."""

from __future__ import annotations

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.builder import build_agent_graph, route_after_intake
from app.graph.decide_lane import (
    ALLOWED_LANES,
    DecideLaneResult,
    apply_decide_lane_postprocess,
    parse_decide_lane_json,
)
from app.graph.route_context import assemble_route_context
from app.graph.route_features import extract_route_features
from app.graph.route_precedence import apply_route_precedence

FORBIDDEN_NODES = frozenset({
    "parse_atomic_intent",
    "create_atomic_node",
    "await_atomic_confirm",
    "run_atomic_gen",
    "prepare_atomic_regenerate",
    "adjust_atomic_regenerate",
    "prepare_single_gen",
})


def _precedence(state: dict):
    ctx = assemble_route_context(state)
    intent = resolve_atomic_intent(
        ctx["utterance"],
        mentioned_keys=list(ctx.get("mentioned_keys") or []),
    )
    features = extract_route_features(ctx, intent)
    return apply_route_precedence(intent, features, ctx)


def test_g1_checkpoint_regen_routes_canvas_agent():
    d = _precedence(
        {
            "messages": [{"role": "user", "content": "重新生成一张"}],
            "atomic_node_id": "image-1",
            "atomic_spec": {"target_type": "image", "prompt": "x"},
        }
    )
    # has_atomic_checkpoint must be true via features; if fixture needs extra
    # keys, mirror test_atomic_regenerate_* / route_features helpers.
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "checkpoint_regen"


def test_g2_focus_gen_routes_canvas_agent():
    d = _precedence(
        {
            "messages": [{"role": "user", "content": "生成这个节点"}],
            "focus_node_id": "image-99",
        }
    )
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "focus_gen"


def test_g3_legacy_flow_modes_route_to_explore():
    for mode in ("atomic_create", "atomic_regenerate", "single_node"):
        assert route_after_intake({"flow_mode": mode}) == "explore"


def test_g4_compiled_graph_lacks_atomic_single_nodes():
    class _Nest:
        pass

    g = build_agent_graph(nest=_Nest(), llm=None, skills_dir="services/agent-runtime/skills")
    names = set(g.get_graph().nodes)
    missing = FORBIDDEN_NODES & names
    assert not missing, f"still registered: {sorted(missing)}"
    # Shared topo node may remain:
    # assert "start_gen" in names  # soft; only if always registered


def test_g5_decide_lane_maps_retired_lanes():
    assert "atomic_regenerate" not in ALLOWED_LANES
    assert "single_node" not in ALLOWED_LANES
    assert "atomic_create" not in ALLOWED_LANES
    for lane in ("atomic_create", "atomic_regenerate", "single_node"):
        mapped = parse_decide_lane_json(
            f'{{"lane":"{lane}","confidence":0.9,"reason":"legacy_llm"}}'
        )
        assert mapped is not None
        assert mapped["lane"] == "canvas_agent"
        post = apply_decide_lane_postprocess(
            DecideLaneResult(
                lane=lane, confidence=0.9, reason="x", clarify_question=None
            )
        )
        assert post["lane"] == "canvas_agent"


def test_g7_no_run_tools_visible():
    from app.tools.tool_plan import build_tool_plan

    plan = build_tool_plan()
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names
```

**Note:** Align G1/G2 fixture keys with existing `test_route_precedence` / `test_atomic_regenerate_*` so those rules actually fire. `build_agent_graph` args must match `builder.py` signature on `main`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_phase_2d2_subgraph_retire.py -v
```

Expected: G1/G2 fail on `flow_mode` still `atomic_regenerate`/`single_node`; G3/G4 fail while gates registered; G5 fail while lanes allowed.

- [ ] **Step 3: Commit failing tests**

```bash
git add services/agent-runtime/tests/test_phase_2d2_subgraph_retire.py
git commit -m "$(cat <<'EOF'
test(agent): add Phase 2d.2 G1–G5/G7 failing gates

EOF
)"
```

---

### Task 2: Remap precedence + decide_lane (+ intake)

**Files:**
- Modify: `services/agent-runtime/app/graph/route_precedence.py` (`_rule_checkpoint_regen`, `_rule_focus_gen`)
- Modify: `services/agent-runtime/app/graph/decide_lane.py`
- Modify: `services/agent-runtime/app/graph/nodes/intake.py` (any branch that still sets `atomic_regenerate` / `single_node` / `atomic_create` as live flow)

**Interfaces:**
- Produces: G1/G2/G5 green even before unregister (G3/G4 still red until Task 3)

- [ ] **Step 1: Remap rules**

In `route_precedence.py`:

```python
# _rule_checkpoint_regen
flow_mode="canvas_agent",
# keep precedence_rule_id="checkpoint_regen"
# reason may stay "atomic_regenerate_checkpoint" or become "..._to_agent"

# _rule_focus_gen
flow_mode="canvas_agent",
# keep precedence_rule_id="focus_gen"
```

- [ ] **Step 2: decide_lane**

```python
ALLOWED_LANES = (
    "canvas_agent",
    "campaign",
    "product_visual",
    "clarify_route",
    # no atomic_create / atomic_regenerate / single_node
)
```

- Update system prompt: remove teachings that map regen/focus → old lanes.
- Extend postprocess map (same pattern as Phase 2d `atomic_create` → `canvas_agent`) for `atomic_regenerate` and `single_node`.

- [ ] **Step 3: intake**

- Any fast-path that assigns `flow_mode` to `atomic_regenerate` / `single_node` / `atomic_create` must instead assign `canvas_agent` (or omit and let precedence decide).
- Soft intent helpers may remain.

- [ ] **Step 4: Re-run Task 1 tests**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_phase_2d2_subgraph_retire.py -v
```

Expected: G1/G2/G5/G7 pass; G3/G4 still fail.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/route_precedence.py \
  services/agent-runtime/app/graph/decide_lane.py \
  services/agent-runtime/app/graph/nodes/intake.py
git commit -m "$(cat <<'EOF'
feat(agent): remap checkpoint_regen/focus_gen to canvas_agent

EOF
)"
```

---

### Task 3: Builder unregister + route_after_intake + interrupt

**Files:**
- Modify: `services/agent-runtime/app/graph/builder.py`

- [ ] **Step 1: Unregister**

Remove imports and calls:

```python
# delete
from app.graph.subgraphs.atomic_create_gate import register_atomic_create_gate
from app.graph.subgraphs.single_node_gate import register_single_node_gate
# ...
register_single_node_gate(...)
register_atomic_create_gate(...)
```

- [ ] **Step 2: route_after_intake**

```python
def route_after_intake(state: AgentRuntimeState) -> str:
    if state.get("route_clarify") and state.get("phase") == "clarify":
        return "clarify_gate"
    if state.get("phase") == "clarify" and state.get("clarify_question"):
        return "clarify_gate"
    # REMOVED: atomic_regenerate / single_node / atomic_create branches
    if state.get("flow_mode") == "product_visual":
        return "image_qa_check"
    if state.get("skill_id"):
        return "decide_plan_mode"
    if state.get("flow_mode") in _AGENT_FLOW_MODES:
        return "explore"
    return "explore"
```

Also remove conditional-edge map keys: `prepare_atomic_regenerate`, `prepare_single_gen`, `parse_atomic_intent`.

- [ ] **Step 3: interrupt_before**

Remove `"await_atomic_confirm"` from the `interrupt_before=[...]` list. Keep campaign/PV interrupts.

- [ ] **Step 4: Tests**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_phase_2d2_subgraph_retire.py -v
```

Expected: G1–G5 / G7 green (G4 must pass).

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/builder.py
git commit -m "$(cat <<'EOF'
feat(agent): unregister atomic_create and single_node gates

EOF
)"
```

---

### Task 4: HITL G6 + delete/archive unreachable modules

**Files:**
- Modify: `services/agent-runtime/app/graph/hitl_resume.py`
- Modify: `services/agent-runtime/tests/test_hitl_resume.py` (add/adjust G6)
- Delete or move to `services/agent-runtime/app/graph/archive/` (plan default: **delete** if CI-clean):
  - `subgraphs/atomic_create_gate.py`
  - `subgraphs/single_node_gate.py`
  - nodes only referenced by those gates:  
    `nodes/atomic_parse.py`, `nodes/atomic_create_node.py`, `nodes/await_atomic_confirm.py`, `nodes/run_atomic_gen.py`, `nodes/prepare_atomic_regenerate.py`, `nodes/adjust_atomic_regenerate.py`  
    (and `prepare_single_gen` living inside `single_node_gate.py`)
- Keep: soft-signal modules (`atomic_intent.py`, IR helpers, etc.) unless they import deleted nodes.

- [ ] **Step 1: Neutralize resume**

In `hitl_resume.py`:

```python
GATE_RESUME_COMMAND_GOTO = frozenset()  # was {"await_atomic_confirm"}
# Remove await_atomic_confirm from GATE_RESUME_AS_NODE
# In should_resume / gate handlers: if gate == "await_atomic_confirm":
#   clear atomic_* fields; return safe end / agent guidance; NEVER goto run_atomic_gen
```

Add test asserting resume path does not schedule `run_atomic_gen` / billable nest call (mirror existing `test_hitl_resume` patterns).

- [ ] **Step 2: Delete/archive gate modules after `rg` shows no imports**

```bash
rg -n "register_atomic_create_gate|register_single_node_gate|prepare_atomic_regenerate|await_atomic_confirm|prepare_single_gen" services/agent-runtime
```

Fix remaining references (tests → flip/skip; step_copy labels ok to leave or delete).

- [ ] **Step 3: Run focused + broader suite**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_phase_2d2_subgraph_retire.py tests/test_hitl_resume.py tests/test_phase_2d_route_close.py -v
python3.11 -m pytest tests/test_route_precedence.py tests/test_decide_lane.py tests/test_builder*.py -v
```

- [ ] **Step 4: Commit**

```bash
git add -A services/agent-runtime/app/graph services/agent-runtime/tests
git commit -m "$(cat <<'EOF'
feat(agent): neutralize atomic confirm resume and remove retired gates

EOF
)"
```

---

### Task 5: Flip remaining gold / subgraph unit tests

**Files:**
- Modify: `services/agent-runtime/skills/*/eval-route-set.yaml` (regen / single_node gold → `canvas_agent`)
- Modify: tests that assert old flows or import deleted nodes (`test_atomic_create_subgraph.py`, `test_atomic_regenerate_flow.py`, `test_single_node_subgraph.py`, `test_atomic_thread_isolation.py`, …)

Strategy:
- Route/precedence expectations → `canvas_agent` + preserved rule id where applicable.
- Pure unit tests of deleted node functions: **delete or skip** with reason `phase-2d2-retired` (prefer delete if file only tested removed subgraph).
- Soft-intent unit tests (`atomic_regenerate_intent(...)`) may remain.

- [ ] **Step 1: Flip YAMLs + tests until green**

```bash
cd services/agent-runtime
python3.11 -m pytest -q
# also run contract eval if CI uses it:
python3.11 -m pytest tests/test_eval_route_set*.py -v
```

- [ ] **Step 2: Commit**

```bash
git add services/agent-runtime/skills services/agent-runtime/tests
git commit -m "$(cat <<'EOF'
test(agent): flip regen/single_node gold for Phase 2d.2

EOF
)"
```

---

### Task 6: PR + G8 prod smoke

**Files:**
- Create: `deploy/prod-phase-2d2-g8-verify.py` (optional; can adapt `deploy/prod-phase-2d-f7-verify.py`)

- [ ] **Step 1: Open PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(agent): Phase 2d.2 retire atomic/single subgraphs" --body "$(cat <<'EOF'
## Summary
- Unregister `atomic_create_gate` / `single_node_gate`; remap `checkpoint_regen` / `focus_gen` → `canvas_agent`
- Neutralize legacy `await_atomic_confirm` resume (no silent bill)
- Hard table G1–G8

## Test plan
- [ ] `pytest` agent-runtime (incl. `test_phase_2d2_subgraph_retire.py`)
- [ ] CI Verify agent-runtime contract
- [ ] After deploy: G8 smoke

EOF
)"
```

- [ ] **Step 2: CI green → squash merge → watch Agent Runtime deploy**

- [ ] **Step 3: G8 smoke**

Cases:
1. Utterance like「重新生成一张」with prior atomic-ish canvas context → `flow_mode=canvas_agent`; no `run_atomic_gen` / `prepare_atomic_regenerate` steps.
2. Focus-node gen utterance → `canvas_agent`; no `prepare_single_gen` / no auto `start_gen` bill before confirm.
3. Regression: bare「帮我生成一张…」still propose/`pending_confirm`, no `run_*` tools.

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  python3.11 deploy/prod-phase-2d2-g8-verify.py
```

---

## Done when

- [ ] G1–G7 CI green
- [ ] G8 prod PASS
- [ ] Phase 3 **not** started
- [ ] Type-literal cleanup deferred to 2d.3

## Spec coverage (self-check)

| Spec | Task |
|------|------|
| 2D2-D1–D5 route/decide | Task 2–3 |
| 2D2-D6 / G6 HITL | Task 4 |
| 2D2-D7 / G4 delete | Task 3–4 |
| 2D2-D9 single_node H2 | Task 2–3 (focus_gen + unregister) |
| G1–G5 / G7 | Task 1–3 |
| G8 | Task 6 |
| No campaign/PV / no auto-migrate | Global Constraints |
