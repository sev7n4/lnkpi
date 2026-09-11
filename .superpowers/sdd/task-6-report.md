# Task 6 Report: Refine edit intent chips + gates

**Status:** DONE  
**Branch:** `feature/image-prompting-guide-catalog-spec`  
**Commit:** `531a184` — `feat(web): Refine edit intent chips with capability gates`

## What landed

### Helper
- `guideEditIntentApply.ts`: `editIntentDisabledReason` (E5 without transparent → 中文/transparent reason) + `applyGuideEditIntent` via `resolveGuideRequest` + `changePreserveTemplate`
- Vitest: E5 disable, E3 fill, E5 block, minRefImages fail

### Refine UI
- `RefineSidePanel`: chips from `listEditIntents()` beside stain preset; E5 disabled + tooltip from image2 `capabilities.transparentBackground: false`
- Click fills prompt like stain preset; `runRefine` guards if active intent still capability-blocked

## TDD evidence

| Step | Result |
|------|--------|
| RED | import `./guideEditIntentApply` unresolved |
| GREEN | `guideEditIntentApply.test.ts` 6 pass |

## Self-review

- No Agent taxonomy (Task 7); no Image 2.5 models; no fake transparent backgrounds.
- Capabilities from `resolveImageEditProfile()` (image2 defaults).

## Concerns

- ~~Chip click uses `Math.max(1, minRefImages)` so E3/E4 templates fill despite Refine still being single-image; submit guard only checks capability disable (not min refs).~~ **Fixed below.**
- Active intent id is local panel state only (not persisted on node).

---

## Review fix (Critical / Important)

**Status:** FIXED  
**Findings addressed:**
1. Stop faking `refImageCount` on chip fill — pass real `refineRefImageCount` (1).
2. Fill path still writes `changePreserveTemplate` when only `minRefImages` fails; capability failures (E5 transparent) still blocked.
3. `runRefine` submit gate calls `applyGuideEditIntent(..., mode: 'submit')` with real ref count; blocks on min refs or capability and does not send edit.

### Changes
- `guideEditIntentApply.ts`: `mode: 'fill' | 'submit'` — fill allows template when refs insufficient; submit fails closed.
- `RefineSidePanel.vue`: chip fill uses real ref count + `mode: 'fill'`; `runRefine` uses `mode: 'submit'` gate.
- Tests: fill-with-insufficient-refs, submit minRef/capability gates.

### Test evidence

```text
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/guideEditIntentApply.test.ts
✓ guideEditIntentApply.test.ts (9 tests) 8ms
Test Files  1 passed (1)
Tests  9 passed (9)
```
