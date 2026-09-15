# Import/Instantiate Nest 默认顺连线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow canvas writes (`importWorkflow` / `instantiateRecipe`) default to along-edges layout on `addedNodeIds`, while keeping `connect_nodes` / `add_nodes_batch` free of auto-layout and preserving the explore tool for explicit rearrange.

**Architecture:** After merging imported nodes/edges in `AgentCanvasToolsService.importWorkflow`, call existing `layoutNodesAlongEdges` on the merged canvas scoped to `addedNodeIds` (unless `arrangeAlongEdges === false`), persist once with post-layout positions, and return `actions` that match. Soften explore/planner prompts so they no longer require a redundant arrange after import/instantiate.

**Tech Stack:** NestJS (`apps/server`), Vitest, agent-runtime prompts (Python), existing `canvas-layout.util.layoutNodesAlongEdges`.

**Spec:** [docs/superpowers/specs/2026-09-15-agent-arrange-along-edges-design.md](../specs/2026-09-15-agent-arrange-along-edges-design.md)（2026-09-16 Hybrid）

## Global Constraints

- Default `arrangeAlongEdges` is **true**; only explicit `false` skips.
- Layout scope = **`addedNodeIds` only**; never rearrange pre-existing canvas nodes.
- `gap` fixed at **40** for import path (same as `arrangeNodesAlongEdges` default).
- Do **not** auto-layout in `connectNodes` or `addNodesBatch`.
- `instantiateRecipe` already calls `importWorkflow` — do not duplicate layout in the controller.
- Keep explore tool `arrange_nodes_along_edges` registered and bound.

---

## File map

| File | Change |
|------|--------|
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `importWorkflow` optional flag + post-merge layout |
| `apps/server/src/agent/agent-canvas-tools.service.test.ts` | A7b: default arranges; `false` skips |
| `apps/server/src/agent/agent-canvas-tools.service.no-auto-layout.test.ts` | Split A7a vs A7b expectations |
| `services/agent-runtime/app/graph/nodes/explore.py` | Prompt Hybrid wording |
| `services/agent-runtime/tests/test_chat_system_prompt.py` | Assert connect-still / import-not-required |
| `services/agent-runtime/tests/test_planner_system_prompt.py` | Drop forced post-instantiate arrange |

---

### Task 1: Failing Nest tests for import default layout

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.no-auto-layout.test.ts`

- [ ] **Step 1: Extend no-auto-layout source test**

Keep asserting `connectNodes` and `addNodesBatch` slices do **not** mention `layoutNodesAlongEdges|arrangeNodesAlongEdges`.

Change the `importWorkflow` case to assert the slice **does** match `layoutNodesAlongEdges` (A7b source-level). Add a note that `arrangeAlongEdges` false path is covered by service tests, not this source scan.

- [ ] **Step 2: Add service integration assertions**

In existing `importWorkflow` tests (or a new `describe('importWorkflow along-edges')`):

1. Import a small chain workflow (A→B or A→B→C) onto empty/non-empty canvas → after call, loaded canvas positions for `addedNodeIds` match along-edges expectations (reuse spacing rules from `canvas-layout.util.test.ts`: same Y for chain, dx ≈ width+40).
2. Pre-existing node outside `addedNodeIds` keeps original `{x,y}`.
3. Call with `arrangeAlongEdges: false` → positions stay at translated import coords (no along-edges spacing).
4. Returned `actions` `add_node` payloads use the **same** positions as persisted nodes.

- [ ] **Step 3: Run tests — expect FAIL before implementation**

```bash
pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.no-auto-layout.test.ts src/agent/agent-canvas-tools.service.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.service.test.ts \
  apps/server/src/agent/agent-canvas-tools.service.no-auto-layout.test.ts
git commit -m "test(server): expect importWorkflow default along-edges layout"
```

---

### Task 2: Implement importWorkflow default layout

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`

- [ ] **Step 1: Extend input type**

```ts
async importWorkflow(input: {
  sessionId: string
  userId: string
  workflow?: unknown
  workflowUrl?: string
  arrangeAlongEdges?: boolean
}): Promise<{ ... }>
```

- [ ] **Step 2: After building `updated` merge, before/instead of single persist**

Pseudo:

```ts
const addedNodeIds = mergeNodes.map((node) => node.id)
const shouldArrange = input.arrangeAlongEdges !== false
let finalNodes = updated.nodes
if (shouldArrange) {
  finalNodes = layoutNodesAlongEdges(
    updated.nodes as LayoutNode[],
    updated.edges ?? [],
    addedNodeIds,
    40,
  ) as CanvasNode[]
}
const finalCanvas: CanvasData = { ...updated, nodes: finalNodes }
await this.persistCanvasData(input.sessionId, finalCanvas)

// Build actions from finalNodes for addedNodeIds (lookup by id)
```

Ensure `layoutNodesAlongEdges` is already imported (it is). Do **not** call `persistLayoutNodes` separately if you already persist `finalCanvas` once.

- [ ] **Step 3: Re-run Nest tests — expect PASS**

```bash
pnpm --filter @lnkpi/server exec vitest run \
  src/agent/agent-canvas-tools.service.no-auto-layout.test.ts \
  src/agent/agent-canvas-tools.service.test.ts \
  src/agent/canvas-layout.util.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.service.ts
git commit -m "feat(server): default along-edges layout on importWorkflow"
```

---

### Task 3: Soften explore / planner prompts

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Modify: `services/agent-runtime/tests/test_chat_system_prompt.py`
- Modify: `services/agent-runtime/tests/test_planner_system_prompt.py`

- [ ] **Step 1: Update `_EXPLORE_SYSTEM` rule 8**

Replace “写完拓扑后必须 arrange（含 import/instantiate）” with Hybrid text from spec §4.2:

- import/instantiate already arranged server-side — do not re-arrange same `addedNodeIds` unless user asks
- after `connect_nodes`, still call `arrange_nodes_along_edges` on sources/targets
- never pass full canvas ids

- [ ] **Step 2: Update `_PLANNER_SYSTEM`**

Remove hard “instantiate 成功后对 addedNodeIds 调用 arrange_nodes_along_edges”. Add one short line that落盘已含顺连线；用户要再整理时再调 tool.

- [ ] **Step 3: Adjust Python tests**

- `test_chat_system_prompt.py`: still asserts `arrange_nodes_along_edges` + connect obligation; assert import/instantiate are **not** listed as requiring a follow-up arrange (or assert the new “已在服务端” wording).
- `test_planner_system_prompt.py`: do **not** require instantiate→arrange sentence; optionally assert new soft wording.

```bash
cd services/agent-runtime && .venv/bin/pytest tests/test_chat_system_prompt.py tests/test_planner_system_prompt.py tests/test_arrange_along_edges_bind.py -q
```

- [ ] **Step 4: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_chat_system_prompt.py \
  services/agent-runtime/tests/test_planner_system_prompt.py
git commit -m "fix(runtime): stop requiring arrange after import/instantiate"
```

---

### Task 4: Verify + PR

- [ ] **Step 1: Local verify**

```bash
pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.test.ts src/agent/agent-canvas-tools.service.no-auto-layout.test.ts src/agent/canvas-layout.util.test.ts
cd services/agent-runtime && .venv/bin/pytest tests/test_chat_system_prompt.py tests/test_planner_system_prompt.py tests/test_arrange_along_edges_bind.py -q
```

- [ ] **Step 2: Open PR**

Title: `feat(agent): default along-edges layout on workflow import`

Body checklist from spec A7b/A7c/A9.

- [ ] **Step 3: CI green → squash merge → deploy → smoke**

Smoke: Agent instantiate or import a small chain workflow; without a second arrange tool call, new nodes should already be left-to-right along edges.

---

## Out of scope

- Exposing `arrangeAlongEdges` to the LLM tool schema (Nest-only escape hatch is enough for P0)
- Auto-layout on `connect_nodes`
- Shared package dedupe of layout helpers
