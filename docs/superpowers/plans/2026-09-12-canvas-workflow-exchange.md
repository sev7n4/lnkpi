# Canvas Workflow Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade「导出打包」to a round-trippable workflow package (`workflow.json` + `media/` zip by default), add merge-into-current-canvas import, then publish W2 schema docs/validation for external agents.

**Architecture:** Shared Zod schema + `remapWorkflowIds` in `@lnkpi/shared`. Browser builds zip via `jszip` after `stream-download` fetches (no CVM temp zip). Import parses zip/json, remaps IDs, uploads media, merges into `Session.canvasData`. Agent keeps `canvasCommands.export_pack` (extended params). W2 reuses the same schema.

**Tech Stack:** Vue 3, Zod, Vitest, `jszip`, existing `useCanvasMedia` / `stream-download`, Nest Agent tools (param pass-through)

**Spec:** [docs/superpowers/specs/2026-09-12-canvas-workflow-exchange-design.md](../specs/2026-09-12-canvas-workflow-exchange-design.md)

## Global Constraints

- Default export = **full_package** zip (`workflow.json` + `media/`); **lightweight** JSON-only is optional.
- Old「仅媒体清单」remains as **advanced** option only.
- Import merges into **current** canvas; **always remap** IDs (never overwrite same ids).
- Scope: multi-select → subgraph; else full canvas.
- Do **not** build zip on CVM disk; browser-side pack only.
- Reuse existing refs fields in `data` (localRefs / mentionedKeys); do not invent a second refs syntax.
- `format` must be `"lnkpi.workflow"`, `version` `"1.0.0"`.
- Implement **W1 before W2**; W2 tasks must not start until W1 export+import green.
- Commit per task; PR before claim done: `pnpm build` + focused tests.

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/canvas/workflowExchange.ts` | Zod schema, types, `inferMediaRole`, `buildWorkflowDocument`, `remapWorkflowIds`, `validateWorkflow` |
| `packages/shared/src/canvas/workflowExchange.test.ts` | Unit tests |
| `packages/shared/src/index.ts` | Re-export |
| `apps/web/package.json` | Add `jszip` (+ `@types/jszip` if needed) |
| `apps/web/src/composables/useWorkflowExchange.ts` | Export zip/json + import merge orchestration |
| `apps/web/src/composables/useWorkflowExchange.test.ts` | Front unit tests (jszip mock) |
| `apps/web/src/composables/useCanvasMedia.ts` | Keep media-list helper; call sites migrate default to workflow export |
| `apps/web/src/pages/CanvasPage.vue` | Wire export modes + import file picker |
| `apps/web/src/components/agent/AgentSideRail.vue` | Pass through export_pack options if present |
| `apps/server/.../agent-canvas-tools.service.ts` | Optional: exportMediaPackage still returns canvasCommands; may add `exportMode`/`scope` on command |
| `docs/superpowers/specs/...` / `docs/workflow/` | W2 agent guide + golden sample |
| `services/agent-runtime/.../definitions.py` | Tool description update for workflow pack |

---

## Phase W1

### Task 1: Shared schema + remap + validate

**Files:**
- Create: `packages/shared/src/canvas/workflowExchange.ts`
- Create: `packages/shared/src/canvas/workflowExchange.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `WORKFLOW_FORMAT = 'lnkpi.workflow'`
  - `WORKFLOW_VERSION = '1.0.0'`
  - `WorkflowDocument` (zod infer)
  - `validateWorkflow(input: unknown): WorkflowDocument` (throws / returns `{ ok, data, error }`)
  - `inferMediaRole(data: Record<string, unknown>): 'generated' | 'uploaded' | 'none'`
  - `buildWorkflowDocument(input: { nodes; edges; mode; exportMode; sourceSessionId?; mediaIndex? }): WorkflowDocument`
  - `remapWorkflowIds(doc: WorkflowDocument, createId: (type: string) => string): { document: WorkflowDocument; idMap: Record<string, string> }`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'vitest'
import {
  buildWorkflowDocument,
  remapWorkflowIds,
  validateWorkflow,
  inferMediaRole,
} from './workflowExchange'

describe('workflowExchange', () => {
  it('validateWorkflow accepts minimal doc', () => {
    const doc = buildWorkflowDocument({
      nodes: [{ id: 'image-1', type: 'image', position: { x: 0, y: 0 }, data: { prompt: 'p', url: 'https://x/a.png' } }],
      edges: [],
      mode: 'full',
      exportMode: 'lightweight',
    })
    expect(doc.format).toBe('lnkpi.workflow')
    expect(doc.version).toBe('1.0.0')
    expect(validateWorkflow(doc).nodes[0].mediaRole).toMatch(/generated|uploaded|none/)
  })

  it('remapWorkflowIds rewrites edges and localRefs node ids', () => {
    const doc = buildWorkflowDocument({
      nodes: [
        { id: 'image-1', type: 'image', position: { x: 0, y: 0 }, data: { url: 'https://x/a.png', localRefs: [{ nodeId: 'image-2' }] } },
        { id: 'image-2', type: 'image', position: { x: 1, y: 0 }, data: { url: 'https://x/b.png' } },
      ],
      edges: [{ id: 'e1', source: 'image-2', target: 'image-1' }],
      mode: 'full',
      exportMode: 'full_package',
      mediaIndex: [{ nodeId: 'image-1', kind: 'image', fileName: 'a.png', path: 'media/a.png' }],
    })
    let n = 0
    const { document, idMap } = remapWorkflowIds(doc, (type) => `${type}-new-${++n}`)
    expect(idMap['image-1']).toMatch(/^image-new-/)
    expect(document.graph.edges[0].source).toBe(idMap['image-2'])
    expect(document.graph.edges[0].target).toBe(idMap['image-1'])
    expect((document.graph.nodes[0].data.localRefs as Array<{ nodeId: string }>)[0].nodeId).toBe(idMap['image-2'])
    expect(document.mediaIndex[0].nodeId).toBe(idMap['image-1'])
  })

  it('inferMediaRole detects upload vs generated', () => {
    expect(inferMediaRole({ url: 'https://x/a.png', imageVersions: [{ source: 'upload' }] })).toBe('uploaded')
    expect(inferMediaRole({ url: 'https://x/a.png', generationRecordId: 'g1' })).toBe('generated')
    expect(inferMediaRole({})).toBe('none')
  })
})
```

Adjust `localRefs` shape to match real `LocalRefBinding` in repo (read `packages/shared` / node data before coding).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/workflowExchange.test.ts
```

- [ ] **Step 3: Implement `workflowExchange.ts`**

Include Zod schemas for top-level + graph + mediaIndex; `buildWorkflowDocument` sets `exportedAt: new Date().toISOString()` and assigns `mediaRole` per node; `remapWorkflowIds` walks nodes/edges/mediaIndex and recursively replaces known id strings inside `data.localRefs` / `mentionedKeys` only when they are node ids (document exact rules in code comments).

- [ ] **Step 4: Re-export from `packages/shared/src/index.ts`**

```typescript
export * from './canvas/workflowExchange'
```

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/canvas/workflowExchange.ts packages/shared/src/canvas/workflowExchange.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): lnkpi.workflow schema and id remap"
```

---

### Task 2: Browser export — workflow zip / lightweight / advanced media-list

**Files:**
- Modify: `apps/web/package.json` (add `jszip`)
- Create: `apps/web/src/composables/useWorkflowExchange.ts`
- Create: `apps/web/src/composables/useWorkflowExchange.test.ts`
- Modify: `apps/web/src/composables/useCanvasMedia.ts` (keep `downloadMediaPackage` for advanced)
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**
- Consumes: `buildWorkflowDocument`, `downloadMediaFile` / stream-download
- Produces:
  - `exportWorkflowPackage(opts: { nodes; edges; selectedIds; sessionId?; exportMode: 'full_package' | 'lightweight' | 'media_list_only' }): Promise<{ ok: boolean; mediaOk: number; mediaFail: number }>`

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter @lnkpi/web add jszip
```

- [ ] **Step 2: Failing test — full_package builds zip with workflow.json**

Mock `downloadMediaFile` / fetch to return a tiny blob; assert JSZip contains `workflow.json` and `media/...`.

- [ ] **Step 3: Implement `exportWorkflowPackage`**

Logic:
1. If `exportMode === 'media_list_only'` → call existing `downloadMediaPackage` and return.
2. Resolve node set: `selectedIds.length ? selectedIds : all node ids`; include edges with both ends in set; expand group children like `duplicateSubgraph` if needed.
3. `buildWorkflowDocument({ mode: selectedIds.length ? 'subgraph' : 'full', exportMode: full|light, ... })`.
4. Lightweight: download `workflow.json` blob only.
5. Full: for each media node, `downloadMediaFile` → arrayBuffer → zip.file(`media/${fileName}`); write `workflow.json`; trigger zip download as `lnkpi-workflow-${Date.now()}.zip`.
6. Toast success/fail counts.

- [ ] **Step 4: Wire CanvasPage**

- Default `handlePackageDownload` / `handleExportPack` → `exportWorkflowPackage({ exportMode: 'full_package', ... })`.
- Add advanced UI (menu item or modifier): `media_list_only` and `lightweight` (minimal: two extra actions in existing download menu if present; else temporary `window` confirm is **not** allowed — use existing canvas toolbar download menu patterns).

Search CanvasPage for `@download` / download menu and extend labels:
- 「导出工作流」→ full_package (default)
- 「导出工作流（仅 JSON）」→ lightweight  
- 「仅导出媒体清单」→ media_list_only

- [ ] **Step 5: Tests PASS + commit**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useWorkflowExchange.test.ts src/composables/useCanvasMedia.test.ts
git add apps/web/package.json apps/web/pnpm-lock.yaml pnpm-lock.yaml apps/web/src/composables/useWorkflowExchange.ts apps/web/src/composables/useWorkflowExchange.test.ts apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): export canvas workflow zip package"
```

(Only stage lockfile paths that actually change.)

---

### Task 3: Browser import — merge into current canvas

**Files:**
- Modify: `apps/web/src/composables/useWorkflowExchange.ts`
- Modify: `apps/web/src/composables/useWorkflowExchange.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Possibly: upload helper already used by canvas file drop (`createFileNodeAt` / upload API)

**Interfaces:**
- Produces:
  - `importWorkflowPackage(file: File, ctx: { nodes; edges; sessionId; applyMerge: (nodes, edges) => void | Promise<void> }): Promise<{ addedNodes: number; idMap: Record<string, string> }>`

- [ ] **Step 1: Failing tests**

- Zip with two nodes + one edge → after import, `applyMerge` receives remapped nodes/edges; no id collision with seed canvas ids.
- Invalid format → throws / returns error, no merge.

- [ ] **Step 2: Implement import**

1. If `.json`, parse text; if `.zip`, JSZip.loadAsync → read `workflow.json` + `media/*`.
2. `validateWorkflow`.
3. `remapWorkflowIds` with canvas id factory (reuse `createNodeId` style from CanvasPage / shared).
4. For each mediaIndex path, read zip file → upload via existing upload API → set `data.url` on remapped node.
5. Offset positions (+80,+80) so imports are visible.
6. `applyMerge` appends nodes/edges and `persistUserEdit` / equivalent.

- [ ] **Step 3: UI**

Hidden `<input type="file" accept=".zip,.json">` + toolbar/menu「导入工作流」.

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(web): import workflow package into current canvas"
```

---

### Task 4: Agent path — export_pack triggers workflow export

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` (`canvas_command` `export_pack`)
- Modify: `apps/web/src/pages/CanvasPage.vue` `handleExportPack`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` (canvasCommands payload may include `exportMode?: 'full_package'`)
- Modify: `services/agent-runtime/app/tools/definitions.py` description
- Test: extend server test for canvasCommands shape; web handler smoke if easy

**Interfaces:**
- `canvasCommands: [{ type: 'export_pack', nodeIds: string[], exportMode?: 'full_package' | 'lightweight' }]`
- Empty `nodeIds` from Nest means「整布」for Agent export of all media nodes — **CanvasPage**: if `nodeIds.length === 0`, treat as full canvas; if non-empty, use as selection scope.

- [ ] **Step 1: Update Nest command** default `exportMode: 'full_package'` on `canvasCommands[0]`.

- [ ] **Step 2: SideRail/CanvasPage** call `exportWorkflowPackage` instead of `downloadMediaPackage`.

- [ ] **Step 3: Tool description** — say browser downloads workflow zip (graph+media), not markdown links.

- [ ] **Step 4: Tests + commit**

```bash
git commit -m "feat(agent): export_pack downloads workflow package"
```

---

## Phase W2 (after W1 merged)

### Task 5: Docs, validate CLI surface, golden sample

**Files:**
- Create: `docs/workflow/README.md` (Agent learning guide)
- Create: `docs/workflow/examples/minimal-workflow.json`
- Optionally: `packages/shared` already exports `validateWorkflow` — document usage
- Add test that loads golden sample through `validateWorkflow`

- [ ] **Step 1: Write golden JSON** matching schema (2 nodes + 1 edge, lightweight).

- [ ] **Step 2: README sections:** schema fields, how to generate, import steps, validation snippet.

- [ ] **Step 3: Test loads example + commit**

```bash
git commit -m "docs(workflow): agent guide and golden workflow sample"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| full_package zip default | T2 |
| lightweight optional | T2 |
| media_list advanced | T2 |
| subgraph vs full scope | T2 |
| schema + mediaRole | T1 |
| remap import merge | T1+T3 |
| Agent same path | T4 |
| A2.1 zip folded in | T2 |
| W2 docs/validate/golden | T5 |
| No CVM zip | T2 (browser only) |

**Placeholders:** none intentional.  
**Type names:** `exportMode` / `mode` / `mediaRole` / `remapWorkflowIds` consistent across tasks.
