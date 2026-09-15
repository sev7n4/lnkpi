# Image Grid Slice P1（后端 + Agent）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pixel grid-slice to Nest (`POST /studio/image/slice` + internal Agent endpoint), switch human path to API-only (keep geometric preview), expose `grid_slice_image` tool that returns `urls[]` for existing canvas place tools.

**Architecture:** Shared `equalSliceRects`/`clampGridDims` in `@lnkpi/shared`. `ImageSliceService` uses `readImageBuffer` + sharp + `UploadService.saveUserFile`. Human `useGridSlice` calls studio API then places nodes (same `data.gridSlice` as P0). Agent Runtime calls `/agent/internal/grid-slice-image` → same service; placement via `add_nodes_batch` + `update_nodes_batch` + `connect_nodes`.

**Tech Stack:** NestJS, sharp, `@lnkpi/shared`, Vue 3 / Vitest, agent-runtime Python tools (`nest_client` / `definitions.py`).

**Spec:** [docs/superpowers/specs/2026-09-15-image-grid-slice-p1-design.md](../specs/2026-09-15-image-grid-slice-p1-design.md)  
**P0 baseline:** [docs/superpowers/specs/2026-09-15-image-grid-slice-design.md](../specs/2026-09-15-image-grid-slice-design.md)

## Global Constraints

- Human path: **API only** — delete frontend canvas pixel crop / `persistMediaUrl` slice path
- Keep workbench **geometric preview** (overlay only)
- Geometry single source: `@lnkpi/shared`; web re-exports
- `cols/rows` clamp 1..7; `GRID_SLICE_MAX_EDGE = 8192`; row-major; last col/row absorbs remainder
- Response `urls.length === cols*rows`; all-or-nothing persist
- No generation points charge
- Output PNG → `/api/uploads/{userId}/...`
- Agent: **internal** `/agent/internal/grid-slice-image` only (not JWT studio from Runtime)
- Tool does **not** place nodes; place = add_nodes_batch → update_nodes_batch (`url`, `label`, `status: completed`, `gridSlice`) → connect_nodes
- `sourceUrl` vs `nodeId`: at least one; both → prefer `sourceUrl`
- Branch: `feature/image-grid-slice-p1` from latest `main` (do not mix with unrelated fix branches)
- Commit per task; do not `git add -A` unrelated dirty files
- Prefer TDD; run targeted tests before each commit

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/gridSlice.ts` | `clampGridDims`, `equalSliceRects`, `GRID_SLICE_MAX_EDGE`, types |
| `packages/shared/src/gridSlice.test.ts` | Shared geometry tests (incl. remainder) |
| `packages/shared/src/index.ts` | Re-export |
| `apps/web/src/utils/gridSlice.ts` | Re-export shared + keep `layoutSliceChildPositions` / `GRID_SLICE_LAYOUT_GAP` locally (or move layout too if trivial) |
| `apps/server/src/studio/image-slice.service.ts` | Slice orchestration |
| `apps/server/src/studio/image-slice.service.test.ts` | Unit tests (mock read/upload) |
| `apps/server/src/studio/studio.controller.ts` | `POST image/slice` |
| `apps/server/src/studio/studio.module.ts` | Register `ImageSliceService` |
| `apps/web/src/services/studio-api.ts` | `imageSlice` client |
| `apps/web/src/composables/useGridSlice.ts` | API → place; remove canvas crop |
| `apps/web/src/composables/useGridSlice.test.ts` | Mock API |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `gridSliceImage` wrapper |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | `POST grid-slice-image` DTO |
| `services/agent-runtime/app/tools/nest_client.py` | Client method + timeout |
| `services/agent-runtime/app/tools/definitions.py` | `grid_slice_image` tool |
| `services/agent-runtime/app/tools/tool_registry.py` | Placement/tier |
| Optional skill/prompt snippet | Document place sequence for planner |

---

### Task 1: Move geometry to `@lnkpi/shared` (TDD)

**Files:**
- Create: `packages/shared/src/gridSlice.ts`
- Create: `packages/shared/src/gridSlice.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/src/utils/gridSlice.ts` — import/re-export shared geometry; keep layout helpers
- Modify: `apps/web/src/utils/gridSlice.test.ts` — still pass (import path OK)

**Interfaces:**
- Produces: `clampGridDims(cols, rows): { cols, rows }`, `equalSliceRects(w,h,cols,rows): SliceRect[]`, `GRID_SLICE_MAX_EDGE = 8192`, `type SliceRect`

- [ ] **Step 1:** Port P0 tests into `packages/shared/src/gridSlice.test.ts` (3×3 on 10×10 remainder, clamp, coverage)

- [ ] **Step 2:** Run `pnpm --filter @lnkpi/shared test -- gridSlice` (or package’s vitest/jest pattern) — FAIL until impl

- [ ] **Step 3:** Implement `packages/shared/src/gridSlice.ts` (copy from web P0); export from `index.ts`

- [ ] **Step 4:** Change web `utils/gridSlice.ts` to re-export geometry from `@lnkpi/shared`; keep `layoutSliceChildPositions` / gap

- [ ] **Step 5:** Run shared + `pnpm --filter @lnkpi/web exec vitest run src/utils/gridSlice.test.ts` — PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/gridSlice.ts packages/shared/src/gridSlice.test.ts packages/shared/src/index.ts \
  apps/web/src/utils/gridSlice.ts apps/web/src/utils/gridSlice.test.ts
git commit -m "feat(shared): extract grid slice geometry for P1 server reuse"
```

---

### Task 2: `ImageSliceService` + Studio route (TDD)

**Files:**
- Create: `apps/server/src/studio/image-slice.service.ts`
- Create: `apps/server/src/studio/image-slice.service.test.ts`
- Modify: `apps/server/src/studio/studio.module.ts` — provider + export
- Modify: `apps/server/src/studio/studio.controller.ts` — DTO + `POST('image/slice')`
- Inject: `UploadService` (ensure UploadModule imported/exported as needed)

**Interfaces:**
- Consumes: `@lnkpi/shared` geometry; `readImageBuffer` from `../media/upstream-ref-downscale`; `UploadService.saveUserFile`
- Produces: `slice({ userId, sourceUrl, cols, rows }): { urls, cols, rows, width, height }`

**Behavior:**
- Clamp cols/rows; read buffer; sharp metadata; reject if `max(w,h) > GRID_SLICE_MAX_EDGE` or invalid size
- `equalSliceRects` → sharp `extract` → png → `saveUserFile(userId, buf, \`slice-${i+1}.png\`, 'image/png')`
- Concurrency pool ≤4; on any failure throw (no partial urls in response)
- `sessionId` accepted on DTO for audit (optional verify session ownership if cheap; at least require string non-empty per spec)

- [ ] **Step 1:** Write failing service tests with mocked `readImageBuffer` / sharp fixture or buffer PNG + mock upload returning fake urls

- [ ] **Step 2:** Run server test for image-slice — FAIL

- [ ] **Step 3:** Implement service + controller endpoint returning `{ data: result }` consistent with other studio posts

- [ ] **Step 4:** Run tests — PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio/image-slice.service.ts apps/server/src/studio/image-slice.service.test.ts \
  apps/server/src/studio/studio.module.ts apps/server/src/studio/studio.controller.ts
git commit -m "feat(server): add POST /studio/image/slice via ImageSliceService"
```

---

### Task 3: Human path — API only (TDD)

**Files:**
- Modify: `apps/web/src/services/studio-api.ts` — `imageSlice(body, { timeout: 120_000 })`
- Modify: `apps/web/src/composables/useGridSlice.ts` — remove canvas crop/persist path; call API then place
- Modify: `apps/web/src/composables/useGridSlice.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue` — pass `sessionId` into `runGridSlice` / execute path
- Keep: grid-slice preview components unchanged (geometry from shared)

**Interfaces:**
- `runGridSlice` input gains `sessionId` and uses `sliceApi?: (args) => Promise<{ urls, cols, rows }>` injectable for tests
- Delete or stop exporting: `sliceImageToFiles`, `defaultLoadSliceImage`, `defaultCropSlice`, `assertSliceImageWithinLimit` (edge check server-side only)

- [ ] **Step 1:** Rewrite failing/updated tests: mock `sliceApi` success → N nodes + edges + gridSlice; mock fail → no addNode

- [ ] **Step 2:** Run `pnpm --filter @lnkpi/web exec vitest run src/composables/useGridSlice.test.ts` — FAIL

- [ ] **Step 3:** Implement API orchestration; wire `studioApi.imageSlice` + sessionId from CanvasPage

- [ ] **Step 4:** Grep web for `sliceImageToFiles|defaultCropSlice|defaultLoadSliceImage|persistMediaUrl` in grid-slice path — must be gone

- [ ] **Step 5:** Run useGridSlice + grid-slice component tests + `vue-tsc` if feasible — PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/studio-api.ts apps/web/src/composables/useGridSlice.ts \
  apps/web/src/composables/useGridSlice.test.ts apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): grid slice human path uses studio image/slice API"
```

---

### Task 4: Agent internal endpoint + Runtime tool

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` — `gridSliceImage({ sessionId, userId, sourceUrl?, nodeId?, cols, rows })` resolve url then `ImageSliceService.slice`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts` — DTO + `POST('grid-slice-image')` (mirror UpscaleImageDto style)
- Modify: agent module imports if `ImageSliceService` needs injection
- Modify: `services/agent-runtime/app/tools/nest_client.py` — `grid_slice_image` POST + timeout ≥120s
- Modify: `services/agent-runtime/app/tools/definitions.py` — StructuredTool `grid_slice_image`
- Modify: `services/agent-runtime/app/tools/tool_registry.py` — placement/tier (align with `upload_media_to_canvas` / write-light media tools)
- Tests: Nest service/controller test; runtime nest_client or definitions smoke if pattern exists

**Interfaces:**
- Produces internal API same shape as studio `data`
- Resolves: prefer `sourceUrl`; else node `data.url`; else 400

- [ ] **Step 1:** Nest unit test for resolve url + delegate to ImageSliceService

- [ ] **Step 2:** Implement Nest wrapper + route

- [ ] **Step 3:** Runtime client + tool registration; add/adjust Python tests

- [ ] **Step 4:** Document place sequence in tool description string (add/update/connect + gridSlice fields)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.service.ts apps/server/src/agent/agent-canvas-tools.controller.ts \
  services/agent-runtime/app/tools/nest_client.py services/agent-runtime/app/tools/definitions.py \
  services/agent-runtime/app/tools/tool_registry.py
# plus any new test files
git commit -m "feat(agent): grid_slice_image tool via Nest ImageSliceService"
```

---

### Task 5: Placement docs smoke + verify + PR

**Files:**
- Optional: short note in an existing agent skill or `services/agent-runtime/README.md` subsection — place sequence only (no new place tool)
- Verify checklist from spec §6.4

- [ ] **Step 1:** Manual/dev: human same-origin upload → 3×3 → 9 children + edges + `data.gridSlice`

- [ ] **Step 2:** Optional Agent mock: tool returns urls; scripted add/update/connect (or documented manual)

- [ ] **Step 3:** Run targeted suites: shared gridSlice, image-slice.service, useGridSlice, agent tools as applicable; `pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false` if cheap

- [ ] **Step 4:** Push + PR

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: image grid slice P1 (server API + Agent tool)" --body "$(cat <<'EOF'
## Summary
- Shared geometry in `@lnkpi/shared`; Nest `POST /studio/image/slice` (sharp + uploads)
- Human path API-only; geometric preview kept; frontend canvas crop removed
- Agent `grid_slice_image` via `/agent/internal/grid-slice-image`; place with existing canvas tools + `data.gridSlice`

## Spec
- docs/superpowers/specs/2026-09-15-image-grid-slice-p1-design.md

## Test plan
- [ ] Shared + ImageSliceService unit tests
- [ ] Human 3×3 on same-origin upload
- [ ] Cross-origin URL: server success or clear error (no CORS canvas fail)
- [ ] Agent tool schema / internal route test
- [ ] Child nodes: label, status completed, gridSlice fields
EOF
)"
```

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Shared geometry | 1 |
| Studio slice API + ImageSliceService | 2 |
| Human API-only + preview kept | 3 |
| Internal + Runtime tool | 4 |
| Place docs / verify / PR | 5 |

## Out of scope (do not implement)

- Unequal guides, points charge, place_grid_slice tool, frontend crop fallback, assetId dual entry
