# Agent import_workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agent tool `import_workflow` that merges a `lnkpi.workflow` JSON (inline or URL) into the current session via Nest, using the same `@lnkpi/shared` validate/remap/placement as the browser UI.

**Architecture:** Move `workflowImportPlacement` into `@lnkpi/shared`. Nest `POST /agent/internal/import-workflow` validates, remaps, places, best-effort persistRemote, `persistCanvasData`, returns actions + optional `focus_nodes`. Runtime registers a write tool calling Nest. No CVM zip; no browser-only import command as primary path.

**Tech Stack:** NestJS, Zod/`@lnkpi/shared`, Vitest, agent-runtime Python tools, existing `PersistRemoteService` / `persistCanvasData`

**Spec:** [docs/superpowers/specs/2026-09-12-agent-import-workflow-design.md](../specs/2026-09-12-agent-import-workflow-design.md)

## Global Constraints

- Same `validateWorkflow` + `remapWorkflowIds` as UI import.
- Placement via shared `computeImportTranslation` (no viewport on Nest).
- Media: persist when possible; keep original URL + count failures otherwise.
- Input: `workflow` XOR `workflowUrl` (`workflow` wins if both).
- No zip/base64 v1; no CVM disk packs.
- `fitImportedViewport` stays in web only.
- Commit per task; PR with `pnpm build` + focused tests green.

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/canvas/workflowImportPlacement.ts` | Moved pure geometry |
| `packages/shared/src/canvas/workflowImportPlacement.test.ts` | Moved/extended unit tests |
| `packages/shared/src/index.ts` | Re-export |
| `apps/web/src/composables/workflowImportPlacement.ts` | Thin re-export from `@lnkpi/shared` **or** delete + update imports |
| `apps/server/.../agent-canvas-tools.service.ts` | `importWorkflow()` |
| `apps/server/.../agent-canvas-tools.controller.ts` | `POST import-workflow` |
| `apps/server/.../agent-canvas-tools.service.test.ts` | Nest unit tests |
| `services/agent-runtime/app/tools/definitions.py` | Tool + schema |
| `services/agent-runtime/app/tools/nest_client.py` | HTTP client |
| `docs/workflow/README.md` | Document Agent import path |

---

### Task 1: Move placement geometry to `@lnkpi/shared`

**Files:**
- Create: `packages/shared/src/canvas/workflowImportPlacement.ts`
- Create: `packages/shared/src/canvas/workflowImportPlacement.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify/Delete: `apps/web/src/composables/workflowImportPlacement.ts` (+ tests import path)

- [ ] **Step 1:** Copy current web placement module + tests into shared (adjust import paths).
- [ ] **Step 2:** Export from `packages/shared/src/index.ts`.
- [ ] **Step 3:** Point web `useWorkflowExchange` / tests at `@lnkpi/shared` (or thin re-export file).
- [ ] **Step 4:** Run:

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/workflowImportPlacement.test.ts
pnpm --filter @lnkpi/web exec vitest run src/composables/workflowImportPlacement.test.ts src/composables/useWorkflowExchange.test.ts src/composables/fitImportedViewport.test.ts
```

- [ ] **Step 5:** Commit `refactor(shared): move workflow import placement into shared package`

---

### Task 2: Nest `importWorkflow` + internal route

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`
- DTO near other agent internal DTOs (same controller file or sibling)

**Behavior:**

1. `loadOwnedSession` / `loadSession`.
2. Resolve document: `workflow` or fetch `workflowUrl` (http/https, timeout, size cap).
3. `validateWorkflow` → `remapWorkflowIds((type) => nextNodeId(type))`.
4. `computeImportTranslation({ importNodes: remapped.nodes, canvasNodes: canvas.nodes })`.
5. Apply `dx,dy` to roots only (same rules as web `toMergeNodes`).
6. For each media URL on remapped nodes / mediaIndex: try `persistRemote.persistRemote(url)`; on failure keep url, `mediaFail++`.
7. Append nodes/edges to canvas; `persistCanvasData`.
8. Build `actions` consistent with other merge tools (or return enough for proxy — mirror `duplicateNode` / batch patterns in this service).
9. `canvasCommands: [{ type: 'focus_nodes', nodeIds: addedRootOrAllIds }]`.

- [ ] **Step 1:** Failing tests — minimal doc merges; invalid rejected; overlap separation without viewport; persist fail keeps url.
- [ ] **Step 2:** Implement service + `POST import-workflow`.
- [ ] **Step 3:** Tests PASS.
- [ ] **Step 4:** Commit `feat(server): import-workflow internal tool merges lnkpi.workflow JSON`

---

### Task 3: Agent runtime tool wiring

**Files:**
- Modify: `services/agent-runtime/app/tools/definitions.py`
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: tool registry / explore allowlists if write tools need explicit registration (match `add_nodes_batch`)

- [ ] **Step 1:** Add `ImportWorkflowInput` (`workflow: dict | None`, `workflow_url: str | None`).
- [ ] **Step 2:** `NestCanvasClient.import_workflow(...)` → POST.
- [ ] **Step 3:** Register `StructuredTool` `import_workflow` with description: merge workflow JSON into current canvas (remap ids; not zip).
- [ ] **Step 4:** Commit `feat(agent-runtime): add import_workflow tool`

---

### Task 4: Docs + golden path note

**Files:**
- Modify: `docs/workflow/README.md`
- Modify: parent exchange design §6 status if needed

- [ ] **Step 1:** Document Agent `import_workflow` (inline JSON / URL); point to Nest + shared validate.
- [ ] **Step 2:** Commit `docs(workflow): agent import_workflow usage`

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| validate + remap shared | T1/T2 |
| placement shared, no viewport | T1/T2 |
| workflow \| workflowUrl | T2/T3 |
| persist-or-keep media | T2 |
| Nest persist + actions + focus | T2 |
| Runtime tool | T3 |
| No zip v1 | all |
| Docs | T4 |

**Placeholders:** none.  
**Handoff:** Execute via Subagent-Driven Development after plan commit.
