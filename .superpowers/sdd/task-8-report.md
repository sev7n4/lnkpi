# Task 8 Report: End-to-end verification + PR

**Branch:** `feature/image-prompting-guide-catalog-spec`  
**Date:** 2026-09-11  
**Status:** Automated verification PASS; PR opened; Manual Dock checklist deferred

---

## Step 1: Verification matrix

### 1. `pnpm --filter @lnkpi/shared test`

```
Test Files  23 passed (23)
Tests       135 passed (135)
Duration    18.58s
Exit code   0
```

Includes guide-related: `imagePromptingGuide/resolveGuideRequest.test.ts` (4), `imagePromptingGuide/catalog.test.ts` (5).

### 2. `pnpm --filter @lnkpi/agent test`

```
Test Files  21 passed (21)
Tests       130 passed (130)
Duration    18.70s
Exit code   0
```

Includes `prompt-modes/generate-guide-overlay.test.ts` (2).

### 3. Web guide unit tests

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/components/canvas/dock-studio/panels/guideSceneApply.test.ts \
  src/components/canvas/refine/guideEditIntentApply.test.ts
```

```
Test Files  2 passed (2)
Tests       12 passed (12)
Duration    7.76s
Exit code   0
```

- `guideSceneApply.test.ts`: 3 passed  
- `guideEditIntentApply.test.ts`: 9 passed  

### 4. `python -m pytest tests/test_guide_taxonomy.py -v`

Used venv: `services/agent-runtime/.venv/bin/python` (system `python` / `python3` lacked pytest).

```
collected 4 items
test_g3_exact_text PASSED
test_e5_cutout PASSED
test_no_false_positive_on_hello PASSED
test_prefer_edit_intent_when_both_match PASSED
4 passed, 1 warning in 0.60s
Exit code   0
```

Warning: Pydantic V2 `class Config` deprecation in `app/config.py` (pre-existing, unrelated).

### 5. `pnpm build`

```
Scope: 4 of 5 workspace projects
packages/shared build: Done
packages/agent build: Done
apps/web build: Done (vue-tsc -b && vite build; ~58.83s)
apps/server build: Done
Exit code   0
```

Vite noted Rollup `#__PURE__` annotation warnings from `@vueuse/core` and chunk-size warnings (>500 kB) — pre-existing / non-blocking.

**Automated matrix result: ALL PASS**

---

## Step 2: Manual checklist

| Item | Result |
|------|--------|
| Prompt Dock G3/G1: empty prefill; non-empty keep text | **Manual follow-up** — no browser UI available in this verification session |
| Refine E3/E4 templates; E5 disabled tooltip | **Manual follow-up** |
| Stain preset still works | **Manual follow-up** |
| Prompt generate works without `guideSceneId` | Covered by unit tests (`generate-guide-overlay`); UI path still **manual follow-up** |

Unit coverage already asserts empty vs non-empty Dock prefill and Refine intent/E5 gating; interactive Dock/Refine UX still needs a human pass in the running app.

---

## Step 3: PR

- Pushed `feature/image-prompting-guide-catalog-spec` to origin (via `gh` token HTTPS; plain HTTPS hit HTTP2/connect failures)  
- **PR:** https://github.com/sev7n4/lnkpi/pull/278  
- Body adapted: automated test-plan items checked; Manual Dock checklist left unchecked

---

## Commits on branch (vs main)

```
ef22a5a feat(runtime): image prompting guide taxonomy hooks
436c61d fix(web): gate refine guide intents on real ref count
531a184 feat(web): Refine edit intent chips with capability gates
7abd824 feat(web): Prompt/Image Dock guide scene chips
a0dc0ae feat(agent): overlay guide scene rules on prompt generate
8b9243a feat(shared): add P0 image prompting guide scenes and intents
0274460 feat(shared): resolveGuideRequest and profile capabilities
6c23e14 feat(shared): scaffold imagePromptingGuide catalog types
2b28e61 docs: add Image Prompting Guide Catalog implementation plan
7e63a13 docs: add Image Prompting Guide Catalog design
```

---

## Concerns / follow-ups

1. **Manual Dock + Refine checklist** not executed in-browser — please verify before merge.  
2. Image 2.5 model wiring remains deferred (design appendix A) — intentional.  
3. Unrelated local dirty files (`.pnpm-store/`, deploy scripts, task-3/7 report edits) were **not** included in the PR.

---

## Final review fixes

**Date:** 2026-09-11  
**Status:** Done — one fix pass for whole-branch review findings

### Changes

1. **Chinese refine gate messages** — `resolveGuideRequest` blocked reasons are now Chinese and include missing ref roles when present (e.g. `需要至少 2 张参考图：人物 + 服装`; E5: `当前模型不支持透明背景`).
2. **`refRoles` hints in RefineSidePanel** — when an edit intent chip is active, show `参考图：{hints}` under the chip row.
3. **Non-empty scene apply feedback** — Prompt Dock + Image Dock toast when `didPrefill === false`: `已套用「…」场景约束（未改写现有提示词）`.
4. **`preferredParams` P0** — Image Dock maps unambiguous `size` (e.g. `1024x1536` → `2:3`) via `mapPreferredSizeToAspect`; resolution/quality/background not mapped. Code comment + PR note: full merge deferred to Image 2.5 specialty.
5. **Manual checklist** — Browser spot-check **not run** (no local/dev app tab or authenticated preview available in this session). Covered by unit tests instead:
   - empty vs non-empty prefill (`guideSceneApply.test.ts`)
   - E5 disabled Chinese tooltip (`guideEditIntentApply.test.ts` / `editIntentDisabledReason`)
   - Chinese min-ref block with roles (`resolveGuideRequest.test.ts`)

### Tests re-run (PASS)

| Suite | Result |
|-------|--------|
| `@lnkpi/shared` resolveGuideRequest + catalog | 10 passed |
| web: guideSceneApply + mapPreferredSizeToAspect + guideEditIntentApply | 15 passed |
| `@lnkpi/agent` generate-guide-overlay | 2 passed |
| `services/agent-runtime` test_guide_taxonomy.py | 4 passed |

### Commit / push

- Commit: `0f9a973` `fix(web): localize guide gates and scene apply UX`
- Pushed to origin (no force); PR https://github.com/sev7n4/lnkpi/pull/278 (+ deferred preferredParams note comment)
