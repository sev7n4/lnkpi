# Task 6 report: Stop — no canvas walk, no prod V1, no copy/parse work

Branch: `feature/composition-source-bind`  
HEAD: `2772b7ff` `fix(agent): always forward composition attachments and void dump hash on bind fail`  
Compared to: `origin/main...HEAD`  
Date: 2026-09-17

Gate is **clean**. No violation commit. Working tree has only untracked `deploy/__pycache__/` (not committed).

---

## Step 1 — forbidden files not in branch diff — **PASS**

Command:

```bash
git diff --name-only origin/main...HEAD
```

Output (name-only list):

```
apps/server/src/agent/agent-canvas-tools.service.test.ts
apps/server/src/agent/agent-canvas-tools.service.ts
apps/server/src/agent/composition.service.test.ts
apps/server/src/agent/composition.service.ts
docs/superpowers/plans/2026-09-17-composition-source-bind.md
docs/superpowers/specs/2026-09-16-generic-canvas-compose-design.md
docs/superpowers/specs/2026-09-17-composition-land-production-gaps.md
docs/superpowers/specs/2026-09-17-composition-source-bind-design.md
packages/shared/src/canvas/compositionBind.test.ts
packages/shared/src/canvas/compositionBind.ts
packages/shared/src/index.ts
packages/shared/src/canvas/compositionExtract.test.ts
packages/shared/src/canvas/compositionExtract.ts
services/agent-runtime/app/graph/nodes/explore.py
services/agent-runtime/app/tools/nest_client.py
services/agent-runtime/tests/test_composition_confirm_explore.py
services/agent-runtime/tests/test_nest_client.py
```

Forbidden filenames checked (must **not** appear):

- `deploy/prod-phase-v2-bare-gen-verify.py`
- `deploy/prod-phase-2d3-h8-verify.py`
- 2e.1 / 2e.3 harnesses (`prod-phase-2e*`)
- `compositionCopy.ts`
- `sidebar_media_parse.py` (`MAX_PARSE_IMAGE_URLS`)

Second command:

```bash
git diff --name-only origin/main...HEAD | rg 'prod-phase-v2-bare-gen-verify|prod-phase-2d3-h8-verify|prod-phase-2e|2e1|2e3|compositionCopy|sidebar_media_parse'
```

Output: empty → `PASS: no forbidden filenames`

Also checked every commit on `origin/main..HEAD` for those paths: none.

Constraint strings `MAX_PARSE_IMAGE_URLS` / `prefix_assistant_reply` / `P_SKELETON_PROMPT` / `MEDIA_CREATE_HINTS` appear only in **docs** (plan + gap spec “do not change”), not in code diffs.

---

## Step 2 — no canvas walk / completed-image fallback in composition bind — **PASS**

Command:

```bash
git diff origin/main...HEAD | rg -n 'canvas\.nodes\.filter|completed-image|completed image fallback|scrape canvas completed'
```

Grep hits:

| Line in diff | Match | Verdict |
|---|---|---|
| `+      canvas.nodes = canvas.nodes.filter((n: { id: string }) => !nodeIds.includes(n.id))` (×2) | `apps/server/src/agent/composition.service.test.ts` E-B4 / E-B6 | Test mock of `removeNodes` for **same-slot replace**. Deletes by id. Does **not** fill `I*` from completed images. |
| `+- Do not scrape canvas completed nodes to fill \`I*\`` | plan Global Constraints | Docs restating the ban. |
| `+    canvas.nodes = canvas.nodes.filter(...)` | plan Task 3 snippet | Same test helper copied into the plan. |
| `+- [ ] **Step 2:** Grep the diff for \`canvas.nodes.filter\` / completed-image fallback...` | plan Task 6 | This gate itself. |

Scoped implementation check:

```bash
git diff origin/main...HEAD -- \
  packages/shared/src/canvas/compositionBind.ts \
  packages/shared/src/canvas/compositionBind.test.ts \
  apps/server/src/agent/composition.service.ts \
  | rg -n 'canvas\.nodes\.filter|completed.?image|scrape'
```

Output: empty → **no canvas-walk fallback in bind implementation**.

Bind path uses only sidebar attachments:

- `localRefsByRefFromSidebarAttachments(utterance, input.attachments)` → chip-key then unlabeled index fallback on **attachments**, never canvas nodes.
- `compositionSourcesBound` requires `localRefs[].url` on required `I*`.
- `importWorkflow` change copies `localRefs[0].url` from the **imported dump graph** into persist (Task 4 / B1), not from live completed canvas images.

---

## Step 3 — do not run production oral against H8 session — **CONFIRMED (not run)**

Did **not** run production oral against `cmu4kmyy6000fo301p08o6zjn`.  
Did **not** invoke V2 / H8 / 2e.1 / 2e.3 harnesses in this task.

Post-merge reminder (unchanged): new canvas + real sidebar chips; never reuse H8 session `cmu4kmyy6000fo301p08o6zjn`.

Historical note (this worktree was reused): older terminals from 2026-09-14–16 ran other prod harnesses (2b / V2). V2 used session `cmu4gcz9t0004mw01x5ud5wmv`, not H8. Not part of this knife.

---

## Files changed (this task)

None. No revert. No commit.

Untracked (left alone, not staged):

- `deploy/__pycache__/prod-phase-2e3-v1-verify.cpython-311.pyc` (mtime 2026-09-17 03:38)

---

## Self-review (author)

1. **Spec coverage (plan map):** B1 → Task 2+4. B2 chip-key + no canvas + reuse-via-state attachments → Task 1+5. B3 void persist + clear hash → Task 2+5. B4/B5/B6 slot replace/overlay → Task 3. B7 → Task 5 narrow-write. **B8 → this Task 6 (no extra work).** B9 gold-1 tests → Task 2. E-B5 oral extract → Task 1. E-B8 → Task 2+5. Mapping holds; this task adds no product code.

2. **Placeholder scan:** no `TBD` / `FIXME` / `XXX` in code diffs (`*.ts` / `*.py`).

3. **Types / names:** `compositionSlotKey`, `COMPOSITION_BIND_MISSING`, `removeNodes` consistent across `compositionBind.ts`, `packages/shared/src/index.ts` (`export * from './canvas/compositionBind'`), `composition.service.ts`, and tests. `slotKey` formula has no `wantVideo`. Bind-fail copy is verbatim; tests assert it does not contain `请确认是否把构图落到画布`.

4. **import url gap:** Task 4 is present (`37f0809c` persist `localRefs` url on import). Confirm still would show「上传图片」without it; that commit is on the branch.

B8 “不做” items not started: no one-click run-group **change**, no parse cap / `MAX_PARSE_IMAGE_URLS`, no P/look copy, no HITL rewrite, no dirty-canvas wipe, no canvas scrape for bind. Existing `compositionRunGroup` write on confirm is **pre-existing on `origin/main`**, not introduced here.

---

## Issues / concerns

- Untracked `deploy/__pycache__/prod-phase-2e3-v1-verify.cpython-311.pyc` is leftover bytecode from compiling the 2e.3 harness on this reused worktree. Source harness is **not** in `origin/main...HEAD`. Do not commit.
- `canvas.nodes.filter` **does** appear in the branch diff, but only as E-B4/E-B6 `removeNodes` test mocks (and the plan quoting that helper). Not a completed-image bind fallback. Calling this out so a literal “any filter in the diff” reading is not confused with a gate fail.
- This PR still must not gold-run live; post-deploy use a **new** canvas.

---

## Verdict

| Step | Result |
|------|--------|
| 1 name-only forbidden files | PASS |
| 2 composition-bind canvas walk | PASS |
| 3 no prod oral vs H8 | CONFIRMED (not run) |
| Fix/commit | none (gate clean) |
