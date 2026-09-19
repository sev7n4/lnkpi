# Task 7 Report: L0 composition_confirm + composition_structure

**Status:** DONE  
**Branch:** `feature/generic-canvas-compose-spec`  
**Commit:** `feat(agent): route composition structure intent before img2img`

## What shipped

Detectors in `services/agent-runtime/app/graph/composition_route.py`:

- `GOLD_COMPOSE_1` / `GOLD_COMPOSE_2` (verbatim Task 1 TS strings)
- `is_composition_structure_utterance` — same keyword pairs as `packages/shared/src/canvas/compositionExtract.ts`:
  - `(设计|规划|编排|做一段|做一套|做一个|搭一套)` AND `(工作流|流水线)`
  - OR `(连线|连好线)` AND `(写入画布|落到画布|写到画布)`
- `is_composition_confirm_chip` — true iff planner confirm **or** cancel chip (exact trim: `确认落到画布` / `先不改`). `确认落到画布吧` is False.

L0 rules in `PRECEDENCE_RULES` **immediately after** `regen_no_checkpoint` and **before** `sidebar_img2img`:

1. `composition_confirm` → `flow_mode=canvas_agent`
2. `composition_structure` → `flow_mode=canvas_agent` when structure utterance **or** truthy `ctx["composition_pending"]` (non-empty string/JSON)

Same two ids inserted in `HARD_SHORTCIRCUIT_RULE_IDS` (`app/graph/route_hard.py`) and `_APPENDIX_A_HARD_IDS` (`tests/test_route_hard.py`) so `route_llm_primary` still beats `sidebar_img2img`.

`assemble_route_context` copies `composition_pending` from graph state when the key is present. No Nest session fetch, no explore preview/confirm HTTP.

## TDD evidence

### RED (tests only; `composition_route` missing; hard ids not inserted)

Command: `cd services/agent-runtime && python3 -m pytest tests/test_composition_route.py tests/test_composition_l0.py -q`

```
ERROR collecting tests/test_composition_route.py
E   ModuleNotFoundError: No module named 'app.graph.composition_route'
ERROR collecting tests/test_composition_l0.py
E   ModuleNotFoundError: No module named 'app.graph.composition_route'
Interrupted: 2 errors during collection
```

Hard-id expectation (tests updated first):

```
FAILED tests/test_route_hard.py::test_hard_ids_match_appendix_a_order
AssertionError: At index 2 diff: 'sidebar_img2img' != 'composition_confirm'
```

Failure reason: missing module / missing L0 rules, not typos.

### GREEN (after detectors + rule insert + pending copy)

Command: `cd services/agent-runtime && python3 -m pytest tests/test_composition_route.py tests/test_composition_l0.py tests/test_route_hard.py tests/test_route_precedence.py -q`

```
59 passed, 1 warning in 1.17s
```

Related regression: `tests/test_route_decide.py tests/test_route_features.py tests/test_phase_2a_atomic_retire.py` → `31 passed`.

Covered cases:

- Gold 1 structure detector true; `换装` / `生图生视频` false
- Gold 2 structure detector true
- `确认落到画布` / `先不改` → `composition_confirm`; `确认落到画布吧` False
- Gold 1 + mentioned_keys I1 I2 I3 + `has_multi_image_ref` → `composition_structure`, `canvas_agent` (not img2img / product_visual / ref-gen / orch)
- Same gold via `apply_hard_shortcircuit` and `decide_route(route_llm_primary=True)`
- 请 + three images, no structure keywords → `sidebar_img2img`
- Truthy `composition_pending` without structure keywords → `composition_structure`
- Confirm chip wins over pending (confirm registered before structure)

## Not in this task

- Explore deterministic preview / confirm HTTP (`nest_client`, explore short-circuit) — Task 8
- Unbinding planner tools — Task 8
- Nest `Session.compositionPending` fetch — pending is only copied from graph state when already set

## Concerns

None that block L0 routing. Pending resume only works once a later task stamps `composition_pending` on graph state.
