# Task 8 Report: Explore deterministic preview + confirm short-circuit

**Status:** DONE  
**Branch:** `feature/generic-canvas-compose-spec`  
**Commit:** `feat(agent): deterministic composition preview and confirm import`

## What shipped

Explore, **before** LLM / planner instantiate:

1. Cancel chip `先不改` → `COMPOSITION_CANCEL_REPLY` (`已取消落到画布。`), no Nest write.
2. Confirm chip `确认落到画布` → `nest.confirm_composition(dump_hash)` where hash is `state["composition_dump_hash"]` or last AIMessage `additional_kwargs["composition_dump_hash"]`. No hash → `COMPOSITION_NO_PREVIEW_REPLY` (`请先确认构图，再落到画布。`). **Never** `instantiate_recipe`, even if `planner_preview_args` exist. Success → `COMPOSITION_LANDED_REPLY` (`已按构图落到画布。`) and `extract_canvas_commands` forwarded.
3. Structure utterance **or** truthy `composition_pending` → `nest.preview_composition(utterance)`. Success stamps AIMessage kwargs `{kind: composition, composition_dump_hash}` and graph `composition_dump_hash`, clears pending, **does not ainvoke**. `extract_incomplete` 400 → Nest `请指明哪张是模特、哪张是服装。` + non-empty `composition_pending` JSON. Lint/compile 400 → that `userMessage`, no ainvoke.

`NestCanvasClient.preview_composition` / `confirm_composition` POST `/agent/internal/preview-composition` and `/agent/internal/confirm-composition` with `sessionId` + `userId`.

`select_narrow_write_tools`: planner bind (`_is_planner_utterance` / `_PLANNER_CONFIRM` instantiate) removed. Import anchors kept. Structure (GOLD) → `frozenset()`. Confirm chip does not include `instantiate_workflow_template`.

Task 7 leftover: `composition_pending` and `composition_dump_hash` added to `AgentRuntimeState`. Planner copy constants kept; composition constants added beside them.

## TDD evidence

### RED (tests only; explore still instantiated planner recipes)

Command: `cd services/agent-runtime && python3 -m pytest tests/test_composition_confirm_explore.py -q`

```
FAILED test_gold_preview_does_not_call_llm
  AssertionError: Expected preview_composition to have been awaited once. Awaited 0 times.

FAILED test_confirm_chip_imports_composition_not_instantiate
  AssertionError: Expected confirm_composition to have been awaited once. Awaited 0 times.

FAILED test_confirm_without_preview_uses_composition_copy
  AssertionError: assert '请先规划并确认模板改动，再落到画布。' == '请先确认构图，再落到画布。'

FAILED test_gold_structure_binds_no_planner_writes
  Extra items: preview_workflow_template, promote_workflow_template, match_workflow_templates

FAILED test_confirm_chip_does_not_bind_instantiate
  AssertionError: 'instantiate_workflow_template' in planner confirm bind set

5 failed, 1 warning
```

Failure reason: missing Nest composition methods / still using planner instantiate + planner tool bind — not typos.

### GREEN (after Nest methods + explore short-circuit + unbind)

Command: `cd services/agent-runtime && python3 -m pytest tests/test_composition_confirm_explore.py tests/test_explore_narrow_bind.py tests/test_planner_confirm_instantiate.py tests/test_planner_copy.py tests/test_composition_route.py tests/test_composition_l0.py -q`

```
67 passed, 1 warning in 4.91s
```

Related: `tests/test_nest_client.py` composition POSTs + broader explore/planner suite → `199 passed`.

Covered cases:

- GOLD structure → `preview_composition`, no LLM, no instantiate, HITL contains `请确认是否把构图落到画布`, kwargs dump hash
- Confirm chip with stamped hash → `confirm_composition`, canvas_commands forwarded, `已按构图落到画布。`
- Confirm without hash → `请先确认构图，再落到画布。` (not `未能更新节点` / not planner no-preview)
- extract_incomplete sets `composition_pending`; lint fail returns Nest message without pending
- Pending state without structure keywords still previews
- GOLD / confirm chip never bind planner instantiate tools
- Import `import_workflow` / `导入工作流` still exclusive

## Not in this task

- Web confirm chips / Dock `compositionRunGroup` generate (Task 9)
- Deleting unused planner copy constants (kept by spec)

## Concerns

Planner LLM HITL (`preview_workflow_template` + `planner_preview_args`) no longer lands on confirm. Confirm without a composition dump hash always uses composition no-preview copy. Structure utterances that previously went to recipe planner (e.g. `帮我规划一个角色三视图工作流`) now call Nest preview instead.
