# Task 7 Report: Agent taxonomy hooks

**Status:** DONE  
**Branch:** `feature/image-prompting-guide-catalog-spec`  
**Commit:** (see git log) — `feat(runtime): image prompting guide taxonomy hooks`

## What landed

### Taxonomy YAML (parallel copies)
- `packages/agent/src/prompt-modes/image-prompting-guide-taxonomy.yaml`
- `services/agent-runtime/skills/atomic-create/assets/image-prompting-guide-taxonomy.yaml`
- P0 ids: `g3_exact_text`, `g1_style_lighting`, `e3_identity_clothing`, `e4_combine_refs`, `e5_transparent_cutout`

### Runtime resolver
- `services/agent-runtime/app/tools/guide_taxonomy.py`
  - `resolve_guide_scene` / `resolve_guide_edit_intent`
  - `apply_guide_taxonomy_to_items` — if both match, prefer edit intent (换装/抠图/合成); never clears `prompt_mode`

### Parse hook
- `atomic_parse.py`: `_apply_taxonomies_to_result` (prompt_mode then guide) on LLM/clarify paths
- `parse_outcome_to_state(..., utterance=)` stamps guide ids on rule/LLM outcomes
- Schema + intent normalize preserve `guideSceneId` / `guideEditIntentId`

### Node persistence
- `atomic_create_node._atomic_batch_items` forwards `promptMode` / guide ids
- `addNodesBatch` (controller DTO + service) writes them onto draft nodes
- `runPromptGeneration` finish + turnaround expand re-persist guide ids alongside `promptMode`

## TDD evidence

| Step | Result |
|------|--------|
| RED | `ModuleNotFoundError: app.tools.guide_taxonomy` |
| GREEN | `tests/test_guide_taxonomy.py` 4 pass; `test_prompt_mode_taxonomy.py` 4 pass |

```text
.venv/bin/python -m pytest tests/test_guide_taxonomy.py tests/test_prompt_mode_taxonomy.py -v
7+1 passed
```

## Self-review

- Hooks only — no multi-turn edit pipeline auto-run
- No Image 2.5 models
- `prompt_mode` still applied; guide stamps do not clear it

## Concerns

- Guide resolve on rule path depends on `utterance=` passed into `parse_outcome_to_state`; call sites outside `atomic_parse` omit it (existing tests OK)
- Nest `addNodesBatch` previously did not persist `promptMode`; now does when provided (behavior additive)
