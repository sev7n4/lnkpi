# Task 7 Report: M3b — `decide_lane` + flags

## Status

**DONE.** `LNKPI_ROUTE_LLM_PRIMARY` / `LNKPI_ROUTE_LLM_SHADOW` land (default off). When primary=1: clarify_resume → hard short-circuit → `decide_lane_llm` → fallback `canvas_agent`. Hard skips LLM; LLM error → `canvas_agent`; confidence `< 0.55` into a graph lane → `clarify_route`. `explore_canvas_signal` not retired (Task 8). CS-4 / Nest unchanged.

## Commit

```
feat(agent-runtime): decide_lane LLM primary behind LNKPI_ROUTE_LLM_PRIMARY
```

On branch `feature/codex-style-tool-plan-harness` (base HEAD was `09194c88`).

## Files Changed

| File | Action |
|------|--------|
| `services/agent-runtime/app/config.py` | Add `route_llm_primary` / `route_llm_shadow` |
| `services/agent-runtime/app/graph/decide_lane.py` | **Create** — structured JSON parse, τ=0.55 postprocess, D7 user block |
| `services/agent-runtime/app/graph/route_decide.py` | Wire pipeline; kwargs `llm` / `messages` / `previous_lane` |
| `services/agent-runtime/tests/test_decide_lane.py` | **Create** — Fake-LLM hard-skip / failure / primary / low-conf |
| `services/agent-runtime/skills/atomic-create/eval-route-set.yaml` | Gold `chat` → `canvas_agent` (Task 4 leftover) |

## Implementation Summary

- Flag off: existing `apply_route_precedence` unchanged (explore rule still production until Task 8).
- Flag on: hard uses Task 6 `apply_hard_shortcircuit`; remaining turns call `decide_lane_llm` with `compress_recent_turns` + `previous_lane` when provided.
- Shadow (primary off): optional sample call only; return value ignored.
- Intake not yet passing live LLM/`messages` — primary=1 without `llm=` kwargs falls back to `canvas_agent` (safe).

## Test Results

```bash
cd services/agent-runtime && python3 -m pytest \
  tests/test_decide_lane.py tests/test_route_hard.py tests/test_eval_route_set.py -v
```

**14 passed** (plus route regression suite 62 passed including precedence/decide).

TDD: flags missing (`AttributeError`) → implement → green.

## Concerns / Notes

- Production primary path needs intake (or caller) to inject `llm` + `messages` for real LLM routing; otherwise fallback agent.
- `route_llm_shadow` is sample-only (no metric sink yet).
- Eval gold chat→canvas_agent fix was required for Task 7 gate; not a behavior change beyond Task 4.
