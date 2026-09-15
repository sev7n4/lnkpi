# Image Grid Slice（宫格裁剪）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship P0 human grid-slice on image nodes (node-top「宫格裁剪 ▾」, one-click presets + refine-shell custom workbench, frontend equal-split → persist → child nodes), freezing the contract for P1 backend/Agent.

**Architecture:** Pure client slice via canvas bitmaps; reuse `persistMediaUrl` and upscale-style `addNode`+`addEdge`+grid place. Custom UI reuses refine docked chrome tokens/layout, not refine mask state. P1 Nest `POST /studio/image/slice` + Agent tool must consume the same §6.1 contract and `data.gridSlice` fields (out of P0 code path).

**Tech Stack:** Vue 3 + Vue Flow + Tailwind/neo; Vitest; existing `uploadApi` / `persistMediaUrl`.

**Spec:** [docs/superpowers/specs/2026-09-15-image-grid-slice-design.md](../specs/2026-09-15-image-grid-slice-design.md)

## Global Constraints

- Entry: **node-top**「宫格裁剪 ▾」（贴选中 image 顶缘；可与 `SelectionActionBar` 同层/合并）
- Dropdown: `2×2…7×7` **一键切**；「自定义…」进工作台
- Workbench: **精修同壳、宫格专房**（左 viewport + 右 docked；无 brush/mask/versions）
- Source node **url unchanged**; children + edges; `layoutNodesInGrid` / placement
- `cols/rows` ∈ `[1,7]`; N ≤ 49; row-major cell order
- `data.gridSlice: { sourceNodeId, index, cols, rows }` on children
- Mutex with refine session
- P0: **frontend slice only**; no Nest slice / Agent tool implementation in P0 tasks
- P1 (必做, separate plan later): backend slice + tool; **same contract & placement fields**
- No dedicated zip download; no unequal guides; no black-mask mode
- Commit per task; do not stage unrelated dirty files
- Prefer branch: `feature/image-grid-slice` from latest `main`

## File map (P0)

| File | Role |
| --- | --- |
| `apps/web/src/utils/gridSlice.ts` | `clampGridDims`, `equalSliceRects`, types |
| `apps/web/src/utils/gridSlice.test.ts` | Rect/clamp unit tests |
| `apps/web/src/composables/useGridSlice.ts` | Decode → slice blobs → persist → place nodes |
| `apps/web/src/composables/useGridSlice.test.ts` | Orchestration with mocks |
| `apps/web/src/components/canvas/grid-slice/GridSliceDropdown.vue` | Preset menu + 自定义 |
| `apps/web/src/components/canvas/grid-slice/GridSliceWorkbench.vue` | Shell host (viewport + panel) |
| `apps/web/src/components/canvas/grid-slice/GridSliceWorkViewport.vue` | Image + equal grid overlay + indices |
| `apps/web/src/components/canvas/grid-slice/GridSliceSidePanel.vue` | Presets, cols/rows, CTA |
| `apps/web/src/pages/CanvasPage.vue` | Session state, wire entry, mutex with refine, place API |
| `apps/web/src/components/canvas/SelectionActionBar.vue` (or sibling chrome) | Mount dropdown at node top |

---

### Task 1: Pure slice geometry (TDD)

**Files:**
- Create: `apps/web/src/utils/gridSlice.ts`
- Create: `apps/web/src/utils/gridSlice.test.ts`

**Requirements:**
- `clampGridDims(cols, rows)` → each in 1..7
- `equalSliceRects(width, height, cols, rows)` → `{ x, y, w, h }[]` length `cols*rows`, row-major; last col/row absorbs remainder; no gaps/overlaps; integer pixels

- [ ] **Step 1: Write failing tests** for 3×3 on 10×10 (remainder), 1×1, clamp 0→1 and 9→7

- [ ] **Step 2: Run** `pnpm --filter @lnkpi/web exec vitest run src/utils/gridSlice.test.ts` — expect FAIL

- [ ] **Step 3: Implement** minimal `gridSlice.ts`

- [ ] **Step 4: Run tests** — expect PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/gridSlice.ts apps/web/src/utils/gridSlice.test.ts
git commit -m "feat(web): add equal grid slice geometry helpers"
```

---

### Task 2: `useGridSlice` orchestration (TDD)

**Files:**
- Create: `apps/web/src/composables/useGridSlice.ts`
- Create: `apps/web/src/composables/useGridSlice.test.ts`

**Behavior:**
- Input: `{ sourceUrl, cols, rows, sourceNodeId, getSourceNode, addNode, addEdge, layoutChildren, persist }`
- Steps: load image (mockable) → `equalSliceRects` → canvas crop to `Blob`/`File` per cell → `persistMediaUrl` **all** succeed → `addNode` each with `url`, `label`, `data.gridSlice` → `addEdge` → layout
- On any persist failure: throw; **no** partial nodes (caller must not add until urls ready — implement as collect urls first)
- Export `sliceImageToFiles` pure-ish helper testable without Vue Flow

- [ ] **Step 1: Failing tests** — mock persist; assert N urls then place called once with N; persist fail → place not called

- [ ] **Step 2: Implement** composable / helpers

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/useGridSlice.ts apps/web/src/composables/useGridSlice.test.ts
git commit -m "feat(web): orchestrate grid slice persist and place hooks"
```

---

### Task 3: Node-top dropdown UI

**Files:**
- Create: `apps/web/src/components/canvas/grid-slice/GridSliceDropdown.vue`
- Modify: `SelectionActionBar.vue` **or** new `ImageNodeActionChrome.vue` wrapping bar + dropdown
- Modify: `CanvasPage.vue` (mount + handlers)

**UI:**
- Label「宫格裁剪 ▾」; items 2×2…7×7 +「自定义…」
- Emit `quick-slice(n)` / `open-custom`
- Disable when loading / no url / refine open

Wire in CanvasPage:
- `gridSliceBusy` ref
- `selectionGridSliceNode` mirrors `selectionUpscaleNode` (null if refine open)
- Position: same node-flow overlay pattern as `SelectionActionBar` (`y: abs.y - 44`); widen bar or place dropdown as sibling so it sits on **node top edge**

- [ ] **Step 1: Dropdown component + unit smoke** (optional shallow mount)

- [ ] **Step 2: Mount on canvas selection chrome; wire quick-slice → `useGridSlice` + toast**

- [ ] **Step 3: Manual/dev: 3×3 creates 9 children** (or component test with mocked place)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/grid-slice/GridSliceDropdown.vue apps/web/src/components/canvas/SelectionActionBar.vue apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): add grid-slice node-top dropdown and one-click place"
```

---

### Task 4: Custom workbench (refine-shell look)

**Files:**
- Create: `GridSliceWorkbench.vue`, `GridSliceWorkViewport.vue`, `GridSliceSidePanel.vue`
- Modify: `CanvasPage.vue` — `gridSlicePanelNode` session; render workbench when set; hide selection chrome / dock like refine
- Reuse layout helpers from `refineWorkLayout.ts` (`refineWorkInsetRight` pattern or shared inset) and panel width defaults from refine editor store if cheap; else hardcode same px as refine docked width

**Panel:** presets, cols/rows,「应用划分」,「裁剪 N 张」, cancel/Esc  
**Viewport:** image + equal grid + indices 1…N  
**Mutex:** opening workbench closes refine path disabled and vice versa

- [ ] **Step 1: Scaffold workbench shell matching refine docked layout classes**

- [ ] **Step 2: Preview updates on preset / 应用划分**

- [ ] **Step 3: Confirm runs same `useGridSlice` path; close workbench on success**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/grid-slice/ apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): add grid-slice custom workbench (refine-shell chrome)"
```

---

### Task 5: Placement polish + verify + PR

**Files:**
- `useGridSlice.ts` / `CanvasPage.vue` — multi-child grid placement (not only single offset like upscale); prefer existing `layoutNodesInGrid` from web grouping or server util ported client-side
- Select all new node ids after success
- Error toasts via `ElMessage` / existing `apiErrorMessage`

- [ ] **Step 1: Grid place N siblings without overlap on source**

- [ ] **Step 2: Run** `pnpm --filter @lnkpi/web exec vitest run src/utils/gridSlice.test.ts src/composables/useGridSlice.test.ts` and `vue-tsc -b --pretty false`

- [ ] **Step 3: Manual checklist from spec §9**

- [ ] **Step 4: Push + PR** title `feat(web): image node grid slice (宫格裁剪) P0`

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(web): image node grid slice (宫格裁剪) P0" --body "## Summary
- Node-top 宫格裁剪 dropdown (2×2…7×7 one-click + 自定义 workbench)
- Frontend equal-slice → persist → child nodes + edges
- Freezes contract for P1 backend/Agent

## Test plan
- [ ] Spec §9 checklist
- [ ] Unit tests listed above
"
```

---

## P1 follow-up (必做；另开 plan / PR，勿混进 P0)

Do **not** implement in P0 PR. When starting P1:

1. `POST /studio/image/slice` — body `{ sourceUrl|assetId, cols, rows }` → `{ urls: string[] }` same order as frontend.
2. Agent tool `grid_slice_image` — same I/O; place via canvas tools with identical `data.gridSlice`.
3. Optional: human path switch to API; keep dropdown/workbench UX.
4. Acceptance: Agent 九宫格→切开→接视频 可无头跑通；字段与 P0 子节点一致。

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| equalSliceRects / clamp | 1 |
| persist + place orchestration | 2 |
| Node-top dropdown + one-click | 3 |
| Custom workbench refine-shell | 4 |
| Layout / verify / PR | 5 |
| Backend + Agent | P1 follow-up |
