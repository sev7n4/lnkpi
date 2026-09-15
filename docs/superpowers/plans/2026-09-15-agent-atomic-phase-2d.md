# Agent Atomic Phase 2d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close competing `flow_mode=atomic_create` routes (V6): remap `sidebar_img2img` / `ref_backed_generate`, clarify default, and `decide_lane` so generation stays on `canvas_agent` + propose/dock.

**Architecture:** Minimal route-layer changes only. Keep rule ids; change `flow_mode` to `canvas_agent`. Postprocess-map any leftover `atomic_create` from decide_lane. Leave atomic subgraph registered but unreachable via normal routing (2d.2 deletes later).

**Tech Stack:** Python agent-runtime (`route_precedence`, `route_decide`, `decide_lane`); pytest.

**Spec:** [docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d-design.md](../specs/2026-09-15-agent-atomic-phase-2d-design.md)  
**Depends on:** Phase 2c.3 (#318) and prior 2a/2b/2c.

## Global Constraints

- H1/H2: `run_*` never visible.
- V6: no competing `atomic_create` main path from precedence / clarify / decide_lane.
- Keep `sidebar_img2img` / `ref_backed_generate` rule ids.
- Do **not** delete subgraph code; do **not** change `atomic_regenerate` / `single_node` / campaign / product_visual.
- Branch: `feature/agent-atomic-phase-2d` from latest `main`.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-15-agent-atomic-phase-2d-design.md` | Authorize 2d + F1–F7 |
| `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md` | D9 / §4.4 / §6.0 → 2d |
| `services/agent-runtime/app/graph/nodes/intake.py` | Clarify fast-path → `canvas_agent` |
| `services/agent-runtime/app/graph/clarify_reply.py` | Non-campaign `route` → `canvas_agent` |
| `services/agent-runtime/app/graph/route_precedence.py` | Remap two rules + clarify resume default |
| `services/agent-runtime/app/graph/route_decide.py` | Clarify resume default align |
| `services/agent-runtime/app/graph/decide_lane.py` | Drop lane + prompt + postprocess map |
| `services/agent-runtime/tests/test_phase_2d_route_close.py` | F1–F4 / F3b dedicated |
| Existing route/2a tests | Flip `atomic_create` expectations → `canvas_agent` |

---

### §6.0.6 hard table

| ID | Expectation |
|----|-------------|
| F1 | sidebar_img2img → canvas_agent |
| F2 | ref_backed_generate → canvas_agent |
| F3 | clarify non-campaign ≠ atomic_create |
| F4 | decide_lane no live atomic_create |
| F5 | bare gen still canvas_agent |
| F6 | no run_* visible |
| F7 | prod smoke |

---

### Task 0: Docs authorize

- [x] Commit this plan + 2d design + parent D9

### Task 1: Failing tests F1–F4 (+ F5/F6 regression hooks)

- [x] Assert sidebar_img2img / ref_backed_generate decisions are `canvas_agent` with same rule ids
- [x] Assert clarify resume non-campaign is not `atomic_create`
- [x] Assert decide_lane rejects/maps `atomic_create`
- [x] Commit failing tests

### Task 2: Implement route remaps

- [x] `_rule_sidebar_img2img` / `_rule_ref_backed_generate` → `flow_mode="canvas_agent"`
- [x] clarify defaults in `route_precedence` + `route_decide` (+ `clarify_reply` if needed)
- [x] `decide_lane`: remove from ALLOWED_LANES; fix prompt; postprocess map
- [x] Tests green; commit

### Task 3: PR + F7 smoke

- [ ] Open PR 2d only
- [ ] After deploy: ref/sidebar utterance → `canvas_agent`; propose path still works

## Done when

- [ ] F1–F6 CI green; F7 prod after deploy
- [ ] 2d.2 not started
