# Task 8 Report: M4 — Retire production `explore_canvas_signal` + docs

## Status

**DONE.** Production `_rule_explore` removed from `PRECEDENCE_RULES`. `explore_canvas_signal` marked deprecated / test-only. Former explore noun utterances fall through to `canvas_agent` (`default_chat`) under flag=off; hard short-circuit + gen lanes unchanged. Docs: Phase 2b narrow-bind / explore noun **Retired**; CS-3 updated to `canvas_agent` + ToolPlan. Merge does **not** require `LNKPI_ROUTE_LLM_PRIMARY=1`.

## Commit

```
refactor(agent-runtime): retire explore noun-verb production routing
```

Hash: `52e51cf6` — on `feature/codex-style-tool-plan-harness` (base HEAD was `2a44b02e`).

## Files Changed

| File | Action |
|------|--------|
| `services/agent-runtime/app/graph/route_precedence.py` | Drop `_rule_explore` / `_explore_match` from production list |
| `services/agent-runtime/app/graph/explore_route.py` | Deprecate `explore_canvas_signal` (test/fixture only) |
| `services/agent-runtime/app/graph/route_decide.py` | Comment: explore retired → canvas_agent |
| `services/agent-runtime/skills/atomic-create/eval-route-set.yaml` | rt-explore-* gold → `canvas_agent` |
| `services/agent-runtime/tests/test_route_precedence.py` | Explore → canvas_agent assertion |
| `services/agent-runtime/tests/test_route_decide_explore.py` | Soft canvas ops → `canvas_agent` |
| `services/agent-runtime/tests/test_explore_route.py` | Fixture-only note on signal tests |
| `docs/.../2026-08-08-agent-canvas-control-surface-design.md` | CS-3 → canvas_agent + ToolPlan |
| `docs/.../2026-08-09-explore-tool-reliability-phase2-design.md` | Phase 2b narrow-bind **Retired** |
| `docs/.../2026-09-13-explore-import-workflow-placement-design.md` | explore_canvas_signal production gate **Retired** |
| `docs/.../2026-09-14-codex-style-tool-plan-harness-design.md` | §7 Retired status for noun gate / narrow-bind |

## Test Results

```bash
# Gate (brief) — primary=1; soft paths fall back to canvas_agent without live LLM
LNKPI_ROUTE_LLM_PRIMARY=1 python -m pytest tests/test_eval_route_set.py \
  tests/test_decide_lane.py tests/test_canvas_agent_multiturn_export.py \
  tests/test_tool_plan.py tests/test_tool_search_rebind.py \
  tests/test_tool_placement_invariants.py -v
# → 22 passed

# Default flag=off regression
python -m pytest tests/test_route_precedence.py tests/test_route_decide_explore.py \
  tests/test_explore_route.py tests/test_route_hard.py tests/test_eval_route_set.py \
  tests/test_graph_routes.py tests/test_decide_lane.py -v
# → 82 passed
```

(Used main-repo `.venv` at `lnkpi/services/agent-runtime/.venv`.)

## Concerns / Notes

1. **~~False-positive `media_create_high`~~ (fixed follow-up):** bare `文案` in `text_default_keywords` / `TEXT_DEFAULT_KEYWORDS` forced `utterance_suggests_atomic_create` → `atomic_generate`. Removed bare keyword; added longer create hints (`生成文案` / `写一段文案` / `输出文案`). Canvas edits like `看看画布文案节点` / `查询 text-40 文案节点…` → `canvas_agent`. Did **not** re-add `_rule_explore`. IR modality may still see `文案` for create classification.
2. **`explore_explicit_intent` / node-id helpers** remain for explore dispatch / features — only the production precedence rule + noun∧verb gate were retired.
3. Default `LNKPI_ROUTE_LLM_PRIMARY=0` is OK for merge: hard + `canvas_agent` default work without explore noun gate; primary-on is optional and does not need live LLM for this gate (fallback = agent).

## Follow-up fix (bare 文案)

**Commit:** `fix(agent-runtime): stop bare 文案 hint forcing atomic after explore retirement`

| File | Change |
|------|--------|
| `skills/atomic-create/intent-taxonomy.yaml` | Drop bare `文案` from `text_default_keywords`; add longer create hints |
| `app/graph/atomic_intent.py` | Align fallbacks with taxonomy |
| `tests/test_route_decide_explore.py` | Regression: canvas 文案节点 → canvas_agent; 生成文案 still create-ish |
| `tests/test_route_precedence.py` | Same via `apply_route_precedence` |

```bash
python -m pytest tests/test_route_decide_explore.py tests/test_route_precedence.py \
  tests/test_route_hard.py tests/test_decide_lane.py -v
# → 60 passed
```

Explore contract utterances containing `文案` (`set_node_prompt`, `set_node_content`) route to `canvas_agent`.
