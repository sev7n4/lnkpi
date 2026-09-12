# Workflow Import Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed `(+80,+80)` import offset with blank-space placement (prefer viewport interior, else viewport-right exterior) and `fitView` onto imported nodes after merge.

**Architecture:** Pure geometry helpers (bbox / collide / `computeImportTranslation`) live in `useWorkflowExchange.ts` (or a tiny colocated `workflowImportPlacement.ts` if the composable grows). `importWorkflowPackage` takes optional viewport + fit callbacks from `CanvasPage` via `ImportWorkflowPackageContext`. Root nodes share one `(dx,dy)`; group children keep relative coords.

**Tech Stack:** Vue 3, Vue Flow (`fitView` / `getViewport` on existing `vueFlowRef`), Vitest

**Spec:** [docs/superpowers/specs/2026-09-12-workflow-import-placement-design.md](../specs/2026-09-12-workflow-import-placement-design.md)

## Global Constraints

- Whole-subgraph **uniform translation** only — do not reshuffle topology.
- Group **children keep relative positions**; keep `extent: 'parent'` / `expandParent: true`.
- Constants (verbatim from spec): estimate `W=280 H=180`, margin `M=64`, step `STEP=120`, fitView `padding: 0.2`, `duration: 300`.
- Empty canvas: place near viewport center-right (or origin if no viewport), still call fit when provided.
- Remove sole reliance on `IMPORT_POSITION_OFFSET = 80` as the placement strategy.
- Commit per task; PR before claim done: focused web tests + `pnpm build` (or web+shared build) green.

## File map

| File | Role |
| --- | --- |
| `apps/web/src/composables/workflowImportPlacement.ts` | Pure: `Rect`, `unionNodeBBox`, `rectsOverlap`, `viewportToFlowRect`, `computeImportTranslation` |
| `apps/web/src/composables/workflowImportPlacement.test.ts` | Unit tests for translation / non-overlap |
| `apps/web/src/composables/useWorkflowExchange.ts` | Wire translation into `toMergeNodes` / `importWorkflowPackage`; extend context |
| `apps/web/src/composables/useWorkflowExchange.test.ts` | Import tests: no overlap vs seed canvas; child relative; fit callback invoked |
| `apps/web/src/pages/CanvasPage.vue` | Pass `getViewport`, `getContainerSize`, `fitImportedNodes` |

---

### Task 1: Pure placement geometry + tests

**Files:**
- Create: `apps/web/src/composables/workflowImportPlacement.ts`
- Create: `apps/web/src/composables/workflowImportPlacement.test.ts`

**Interfaces:**

```typescript
export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type NodeLike = {
  id: string
  type?: string
  position: Point
  parentNode?: string
  parentId?: string
}

export const IMPORT_NODE_ESTIMATE = { width: 280, height: 180 } as const
export const IMPORT_PLACE_MARGIN = 64
export const IMPORT_PLACE_STEP = 120

export function isRootNode(node: NodeLike, idSet?: Set<string>): boolean
export function unionNodeBBox(nodes: NodeLike[], estimate?: Size): Rect | null
export function rectsOverlap(a: Rect, b: Rect, margin?: number): boolean
export function viewportToFlowRect(
  viewport: { x: number; y: number; zoom: number },
  container: Size,
): Rect
export function computeImportTranslation(input: {
  importNodes: NodeLike[]
  canvasNodes: NodeLike[]
  viewport?: { x: number; y: number; zoom: number }
  containerSize?: Size
}): Point // { x: dx, y: dy }
```

- [x] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'vitest'
import {
  computeImportTranslation,
  rectsOverlap,
  unionNodeBBox,
  viewportToFlowRect,
  IMPORT_PLACE_MARGIN,
} from './workflowImportPlacement'

describe('workflowImportPlacement', () => {
  it('viewportToFlowRect matches (-x/zoom, -y/zoom, w/zoom, h/zoom)', () => {
    const r = viewportToFlowRect({ x: -100, y: -50, zoom: 2 }, { width: 800, height: 600 })
    expect(r).toEqual({ x: 50, y: 25, width: 400, height: 300 })
  })

  it('separates import bbox from overlapping canvas with margin', () => {
    const canvasNodes = [{ id: 'a', position: { x: 0, y: 0 } }]
    const importNodes = [{ id: 'b', position: { x: 0, y: 0 } }]
    const { x: dx, y: dy } = computeImportTranslation({
      importNodes,
      canvasNodes,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 1000, height: 800 },
    })
    const placed = importNodes.map((n) => ({
      ...n,
      position: { x: n.position.x + dx, y: n.position.y + dy },
    }))
    const a = unionNodeBBox(canvasNodes)!
    const b = unionNodeBBox(placed)!
    expect(rectsOverlap(a, b, IMPORT_PLACE_MARGIN)).toBe(false)
  })

  it('keeps child relative coords out of translation input roots', () => {
    // computeImportTranslation only uses roots; test isRootNode / union ignores children
    const nodes = [
      { id: 'g', type: 'group', position: { x: 10, y: 10 } },
      { id: 'c', position: { x: 5, y: 5 }, parentNode: 'g' },
    ]
    const box = unionNodeBBox(nodes)!
    expect(box.x).toBe(10)
    expect(box.y).toBe(10)
  })
})
```

- [x] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/workflowImportPlacement.test.ts
```

- [x] **Step 3: Implement `workflowImportPlacement.ts`** per spec §3 (candidate order: viewport-right interior → below → step → viewport exterior right → canvas bottom-right fallback).

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add apps/web/src/composables/workflowImportPlacement.ts apps/web/src/composables/workflowImportPlacement.test.ts
git commit -m "feat(web): blank-space translation for workflow import"
```

---

### Task 2: Wire import path + CanvasPage fitView

**Files:**
- Modify: `apps/web/src/composables/useWorkflowExchange.ts`
- Modify: `apps/web/src/composables/useWorkflowExchange.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**

```typescript
export interface ImportWorkflowPackageContext {
  // existing fields...
  getViewport?: () => { x: number; y: number; zoom: number }
  getContainerSize?: () => { width: number; height: number }
  fitImportedNodes?: (nodeIds: string[]) => void | Promise<void>
}
```

- [x] **Step 1: Failing / extend import tests**

- Seed canvas node at `(0,0)`; import json with root at `(0,0)` → `applyMerge` nodes’ root positions must not overlap seed bbox (± margin).
- Parent+child import: child `position` unchanged relative to file; parent shifted by same dx/dy as translation.
- `fitImportedNodes` mock called with remapped ids after merge.

- [x] **Step 2: Implement**

1. Delete `IMPORT_POSITION_OFFSET`-only path (or keep unused constant removed).
2. After remap + media upload, `const { x: dx, y: dy } = computeImportTranslation({ importNodes: remapped.graph.nodes, canvasNodes: ctx.nodes, viewport: ctx.getViewport?.(), containerSize: ctx.getContainerSize?.() })`.
3. `toMergeNodes(doc, { dx, dy })` applies translation to roots only.
4. `await ctx.applyMerge(...)` then `await ctx.fitImportedNodes?.(mergeNodes.map(n => n.id))`.

- [x] **Step 3: CanvasPage**

In `onWorkflowImportSelected`, add:

```typescript
getViewport: () => vueFlowRef.value?.getViewport?.() ?? { x: 0, y: 0, zoom: 1 },
getContainerSize: () => {
  const el = vueFlowRef.value?.$el as HTMLElement | undefined
  const rect = el?.getBoundingClientRect?.()
  return { width: rect?.width || 1000, height: rect?.height || 800 }
},
fitImportedNodes: async (ids) => {
  await vueFlowRef.value?.fitView({ nodes: ids, padding: 0.2, duration: 300 })
},
```

(Match existing `fitView` call sites around `CanvasPage.vue` ~1181/1194.)

- [x] **Step 4: Tests PASS**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/workflowImportPlacement.test.ts src/composables/useWorkflowExchange.test.ts
```

- [x] **Step 5: Commit**

```bash
git commit -m "feat(web): place workflow imports in blank space and fit view"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Uniform translation | T1+T2 |
| Viewport-first then exterior | T1 |
| Margin 64 / step 120 / estimate 280×180 | T1 |
| Children relative unchanged | T1+T2 |
| fitView after merge | T2 |
| No fixed +80-only | T2 |

**Placeholders:** none.  
**Handoff:** After plan commit, execute via Subagent-Driven (recommended) or Inline.

---

## Status (2026-09-12)

- Merged: PR #287 (placement + viewport free-axis clamp), PR #291 (`fitImportedViewport` / fitBounds fallback).
- Prod verified by user: import places in blank space and viewport fits imported nodes.
- Spec closed for implementation tasks; remaining polish is YAGNI (empty-canvas center-right, deeper candidate-path tests).
