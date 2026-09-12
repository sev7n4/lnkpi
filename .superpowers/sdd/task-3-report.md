# Task 3 Report: Browser import — merge into current canvas

**Status:** DONE  
**Branch:** `feature/canvas-workflow-exchange`  
**Commit:** `f13ecefd` — `feat(web): import workflow package into current canvas`

## Summary

Round-trip import: parse `.zip` / `.json` → `validateWorkflow` → `remapWorkflowIds` → upload zip `media/` → offset (+80,+80) → `applyMerge` into current canvas + `persistUserEdit`. Top-right chrome「导入工作流」+ hidden file input.

## Files Changed

| File | Action |
|------|--------|
| `apps/web/src/composables/useWorkflowExchange.ts` | Add `importWorkflowPackage` |
| `apps/web/src/composables/useWorkflowExchange.test.ts` | Import merge / invalid / lightweight tests |
| `apps/web/src/pages/CanvasPage.vue` | Wire file picker, merge, persist |

## TDD Evidence

### RED

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useWorkflowExchange.test.ts
```

```
 FAIL  src/composables/useWorkflowExchange.test.ts
 × importWorkflowPackage > merges remapped zip nodes/edges without colliding with seed canvas ids
   → importWorkflowPackage is not a function
 × importWorkflowPackage > rejects invalid format without calling applyMerge
   → importWorkflowPackage is not a function
 × importWorkflowPackage > lightweight json keeps existing urls without re-upload
   → importWorkflowPackage is not a function
 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
```

### GREEN

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useWorkflowExchange.test.ts
```

```
 ✓ src/composables/useWorkflowExchange.test.ts (6 tests) 62ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Implementation Notes

- Zip: `JSZip.loadAsync` → `workflow.json` + `media/*`; JSON: parse text.
- Always remaps IDs via `remapWorkflowIds` (`createId` from CanvasPage `nodeCounter` style).
- Zip media with `mediaIndex.path` → upload via `persistMediaUrl` (injectable `uploadMedia` in tests) → set remapped `data.url`.
- Lightweight JSON: keep existing URLs; no re-upload.
- Positions: root nodes only offset +80/+80; group children keep relative coords and get `extent: 'parent'` + `expandParent: true`.
- `applyMerge` appends nodes/edges (including parent constraints) then `persistUserEdit`.
- Invalid format: error toast「工作流格式无效，无法导入」, no `applyMerge`.

## Self-review

- No Task 4/5 Agent/Nest work.
- Shared schema reused (`validateWorkflow` / `remapWorkflowIds`); no second schema.
- Import entry is canvas chrome (always available); multi-select export menu unchanged.

## Concerns

None blocking. Media upload requires auth token for server URL; unauthenticated falls back to blob URL via `persistMediaUrl`.

## Review Fix (Important): group child offset + constraints

**Commit:** (see git log) `fix(web): import group children without absolute offset`

### Fixes

1. `toMergeNodes`: apply `(+80,+80)` only when node has no `parentNode` / remapped parent; children keep original relative position.
2. Children with `parentNode` also set `extent: 'parent'` and `expandParent: true` (match `useCanvasGrouping`); `CanvasPage` `applyMerge` passes these through.

### Test command + output

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useWorkflowExchange.test.ts
```

```
 ✓ src/composables/useWorkflowExchange.test.ts (7 tests) 67ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  09:46:19
   Duration  4.70s (transform 604ms, setup 0ms, collect 902ms, tests 67ms, environment 2.19s, prepare 183ms)
```
