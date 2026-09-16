# Generic Canvas Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unnamed structure-intent utterances compile to a confirmable canvas graph (gold try-on + gold product sequence) via dump import, without matching the four platform recipes.

**Architecture:** `@lnkpi/shared` owns IR, extract, expand, lint, hash, HITL summary. Nest compiles, stores `Session.compositionPreview`, confirms by importing that dump (idempotent on hash), writes `canvas.compositionRunGroup`. Agent-runtime L0 routes structure/confirm before img2img/product_visual/ref-gen/orch; Explore deterministically previews and short-circuits the confirm chip to Nest confirm (never instantiate). Web shows the same confirm chips and Dock generate follows the run group.

**Tech Stack:** TypeScript (`@lnkpi/shared` vitest, Nest, Prisma, Vue 3), Python 3 agent-runtime (pytest). No new video vendor.

**Spec:** [docs/superpowers/specs/2026-09-16-generic-canvas-compose-design.md](../specs/2026-09-16-generic-canvas-compose-design.md)

**Out of this plan (P1):** ops template gallery, 我的模板 page, submit/review CMS, Agent 点名加载.

## Global Constraints

- Gold utterance 1 (verbatim): `@I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，写入画布，待我确认后再做生图生视频`
- Gold utterance 2 (verbatim): `@I1 是产品，@I2 是使用场景，先出一张白底再出一张场景图，连好线写到画布，先不要生成`
- Compile/lint only in `@lnkpi/shared` + Nest; runtime does not reimplement expand.
- Confirm imports frozen dump; never recompile. Same `dumpHash` is idempotent.
- P0 Explore must not bind `match_workflow_templates` / `preview_workflow_template` / `instantiate_workflow_template` / `promote_workflow_template`. Confirm chip never calls instantiate.
- `matchPlatformRecipes` returns `{ items: [] }` (offline matching). `getPlatformRecipe` may still load JSON for old canvases.
- Confirm copy: `请先确认构图，再落到画布。` / `已按构图落到画布。` / `已取消落到画布。` HITL line: `请确认是否把构图落到画布`. Never `未能更新节点，请提供节点 id`.
- All composed nodes `autoGenerate` equivalent: `data.status = 'draft'` (same as recipe compile when `autoGenerate: false`).
- No `parentId=model-turnaround`. No fifth try-on recipe file.
- Topology tests must not call live image/video models.

## File map

| File | Role |
|------|------|
| `packages/shared/src/canvas/compositionIr.ts` | Zod IR + types |
| `packages/shared/src/canvas/compositionExtract.ts` | Structure intent + primitives extract |
| `packages/shared/src/canvas/compositionExpand.ts` | IR → `lnkpi.workflow` dump |
| `packages/shared/src/canvas/compositionCopy.ts` | I0/A/B/P skeleton render + clause lint |
| `packages/shared/src/canvas/compositionLint.ts` | dump lint + sha256 hash + HITL summary |
| `packages/shared/src/canvas/composition*.test.ts` | Shared tests |
| `packages/shared/src/index.ts` | Re-export |
| `packages/shared/src/canvas/recipeCatalog.ts` | `matchPlatformRecipes` empty |
| `apps/server/prisma/schema.prisma` + migration | `compositionPreview` / `compositionPending` JSON strings |
| `apps/server/src/agent/composition.service.ts` | preview persist, confirm import, run group |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | `POST preview-composition`, `POST confirm-composition` |
| `apps/server/src/studio/*` | Video generate reads P node text |
| `services/agent-runtime/app/graph/composition_route.py` | Python structure/confirm detectors (keyword lists synced with shared) |
| `services/agent-runtime/app/graph/route_precedence.py` | L0 insert |
| `services/agent-runtime/app/graph/explore_dispatch.py` | Unbind planner tools |
| `services/agent-runtime/app/graph/nodes/explore.py` | Deterministic preview + composition confirm short-circuit |
| `services/agent-runtime/app/tools/nest_client.py` | preview/confirm composition HTTP |
| `apps/web/src/components/agent/agentChipSet.ts` | Detect 构图 HITL line |
| `apps/web` Dock generate | Honor `compositionRunGroup` |

**Shared gold constant** (copy into every test file that needs it, do not import from a missing module until Task 1 creates `compositionGold.ts`):

```ts
export const GOLD_COMPOSE_1 =
  '@I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，写入画布，待我确认后再做生图生视频'
export const GOLD_COMPOSE_2 =
  '@I1 是产品，@I2 是使用场景，先出一张白底再出一张场景图，连好线写到画布，先不要生成'
```

---

### Task 1: IR + extract + structure intent

**Files:**
- Create: `packages/shared/src/canvas/compositionGold.ts`
- Create: `packages/shared/src/canvas/compositionIr.ts`
- Create: `packages/shared/src/canvas/compositionExtract.ts`
- Create: `packages/shared/src/canvas/compositionExtract.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './canvas/compositionGold'` and extract/ir)

**Interfaces:**
- Produces:
  - `GOLD_COMPOSE_1`, `GOLD_COMPOSE_2` strings
  - `compositionIrSchema` (zod); type `CompositionIR`
  - `isCompositionStructureUtterance(text: string): boolean`
  - `extractCompositionPrimitives(utterance: string): { ok: true, primitives: CompositionIR['primitives'] } | { ok: false, code: 'extract_incomplete' }`
  - `MAX_GARMENTS = 4`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1, GOLD_COMPOSE_2 } from './compositionGold'
import {
  extractCompositionPrimitives,
  isCompositionStructureUtterance,
} from './compositionExtract'

describe('compositionExtract', () => {
  it('gold 1 is structure intent and extracts identity, garments, wantVideo', () => {
    expect(isCompositionStructureUtterance(GOLD_COMPOSE_1)).toBe(true)
    const got = extractCompositionPrimitives(GOLD_COMPOSE_1)
    expect(got).toEqual({
      ok: true,
      primitives: {
        identityRef: 'I1',
        skipI0: false,
        garmentRefs: ['I2', 'I3'],
        otherRefs: [],
        wantVideo: true,
        sequence: [],
      },
    })
  })

  it('gold 2 is structure intent with product sequence, no garments', () => {
    expect(isCompositionStructureUtterance(GOLD_COMPOSE_2)).toBe(true)
    const got = extractCompositionPrimitives(GOLD_COMPOSE_2)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.primitives.identityRef).toBe('I1')
    expect(got.primitives.garmentRefs).toEqual([])
    expect(got.primitives.otherRefs).toEqual([{ ref: 'I2', role: 'scene' }])
    expect(got.primitives.wantVideo).toBe(false)
    expect(got.primitives.sequence).toEqual(['white_bg', 'scene'])
  })

  it('does not treat 换装 or 生图生视频 alone as structure intent', () => {
    expect(isCompositionStructureUtterance('换装')).toBe(false)
    expect(isCompositionStructureUtterance('生图生视频')).toBe(false)
    expect(isCompositionStructureUtterance('改画布上那个节点的提示词')).toBe(false)
  })

  it('做一个图生视频工作流 is structure + wantVideo, not incomplete', () => {
    expect(isCompositionStructureUtterance('做一个图生视频工作流')).toBe(true)
    const got = extractCompositionPrimitives('做一个图生视频工作流')
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.primitives.wantVideo).toBe(true)
    expect(got.primitives.garmentRefs).toEqual([])
  })

  it('skipI0 only when user says already 白底三视图/四视图', () => {
    const u = GOLD_COMPOSE_1.replace('作为模特', '作为模特，已经是清晰白底三视图')
    const got = extractCompositionPrimitives(u)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.primitives.skipI0).toBe(true)
  })

  it('more than 4 garments is extract_incomplete', () => {
    const u =
      '@I1 作为模特，@I2 @I3 @I4 @I5 @I6 这些是服装图，设计一段工作流并做好连线，写入画布'
    const got = extractCompositionPrimitives(u)
    expect(got).toEqual({ ok: false, code: 'extract_incomplete' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/shared test src/canvas/compositionExtract.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Minimal implementation**

`isCompositionStructureUtterance`: true if (设计|规划|编排|做一段|做一套|做一个|搭一套) AND (工作流|流水线), OR (连线 AND (写入画布|落到画布)).

`extractCompositionPrimitives`:
- `@I([0-9]+)` mentions in order.
- identityRef: `@Ix 作为模特` or `@Ix 是产品` or first `@I` after 模特/产品指派.
- garmentRefs: mentions after 服装图 / 服装, or remaining I-refs when 换装/试衣/作为模特 (exclude identity).
- `wantVideo`: utterance includes `生图生视频` or `成片` or (`视频` and 工作流) — gold 1 hits 生图生视频. Do **not** use substring `图生视频` alone as wantVideo if you can match `生图生视频` first; gold 1 contains 生图生视频.
- `skipI0`: includes `白底三视图` or `白底四视图` or `已经是清晰白底`.
- gold 2: `@I1 是产品` → identity; `@I2 是使用场景` → otherRefs scene; `先出一张白底再出一张场景` → sequence `white_bg`,`scene`; garmentRefs empty.
- If 作为模特/换装/服装图 but no identityRef or no garmentRefs → `{ ok: false, code: 'extract_incomplete' }`.
- Gold 2 always ok with identity + scene.
- `做一个图生视频工作流` with no @refs: ok:true, empty garments, wantVideo true (conservative skeleton; expand task must not crash).

IR zod: `version` literal `'1'`; primitives as spec; copy optional with titles/promptSlots/pSlots records.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lnkpi/shared test src/canvas/compositionExtract.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/compositionGold.ts packages/shared/src/canvas/compositionIr.ts packages/shared/src/canvas/compositionExtract.ts packages/shared/src/canvas/compositionExtract.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): extract composition primitives from structure utterances

EOF
)"
```

---

### Task 2: Expand gold 1 dump (try-on + P + V)

**Files:**
- Create: `packages/shared/src/canvas/compositionCopy.ts`
- Create: `packages/shared/src/canvas/compositionExpand.ts`
- Create: `packages/shared/src/canvas/compositionExpand.test.ts`

**Interfaces:**
- Consumes: `CompositionIR`, `extractCompositionPrimitives`
- Produces:
  - `renderCompositionCopy(ir: CompositionIR): CompositionIR` (fill skeleton prompts; ignore empty copy)
  - `expandComposition(ir: CompositionIR, localRefsByRef?: Record<string, LocalRefBinding[]>): WorkflowDocument`
  - Node ids: `image-src-I1`, `image-i0`, `image-src-I2`, `image-src-I3`, `image-look-0`, `image-look-1`, `text-p`, `video-v`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import { expandComposition, renderCompositionCopy } from './compositionExpand'
import { compositionIrSchema } from './compositionIr'

it('gold 1 expands I1,I0,I2,I3,A,B,P,V with draft status and no recipe parentId', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) return
  const ir = compositionIrSchema.parse({
    version: '1',
    primitives: extracted.primitives,
    copy: {},
  })
  const dump = expandComposition(renderCompositionCopy(ir))
  const ids = dump.graph.nodes.map((n) => n.id)
  expect(ids).toEqual([
    'image-src-I1',
    'image-i0',
    'image-src-I2',
    'image-src-I3',
    'image-look-0',
    'image-look-1',
    'text-p',
    'video-v',
  ])
  for (const n of dump.graph.nodes) {
    expect(n.data.status).toBe('draft')
    expect(n.data.parentRecipeId).toBeUndefined()
  }
  const i0 = dump.graph.nodes.find((n) => n.id === 'image-i0')!
  expect(i0.data.mentionedKeys).toEqual(['image-src-I1'])
  expect(String(i0.data.prompt)).toContain('白底')
  expect(String(i0.data.prompt)).not.toMatch(/时尚大片/)
  const look0 = dump.graph.nodes.find((n) => n.id === 'image-look-0')!
  expect(look0.data.mentionedKeys).toEqual(['image-i0', 'image-src-I2'])
  const v = dump.graph.nodes.find((n) => n.id === 'video-v')!
  expect(v.data.mentionedKeys).toEqual(['image-i0', 'image-look-0', 'image-look-1'])
  expect(dump.graph.nodes.find((n) => n.id === 'text-p')!.data.prompt).toMatch(/lookbook|造型|同一/)
  const src = dump.graph.nodes.find((n) => n.id === 'image-src-I1')!
  expect(src.data.genMode).toBeUndefined()
})

it('skipI0 omits image-i0 and hangs looks on I1', () => {
  const extracted = extractCompositionPrimitives(
    GOLD_COMPOSE_1.replace('作为模特', '作为模特，已经是清晰白底三视图'),
  )
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) return
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  expect(dump.graph.nodes.map((n) => n.id)).not.toContain('image-i0')
  const look0 = dump.graph.nodes.find((n) => n.id === 'image-look-0')!
  expect(look0.data.mentionedKeys).toEqual(['image-src-I1', 'image-src-I2'])
})
```

Re-export `renderCompositionCopy` from `compositionCopy.ts` via `compositionExpand.ts` if needed so tests import one module.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/shared test src/canvas/compositionExpand.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement expand + skeleton copy**

Use `buildWorkflowDocument` from `workflowExchange.ts` (`mode: 'full'`, `exportMode: 'lightweight'`, `mediaIndex: []`).

Edges: srcI1→i0, i0→look0, srcI2→look0, i0→look1, srcI3→look1, look0→v, look1→v, i0→v, p→v (p is text; if workflow edges only connect graph, still add p→v).

Source image nodes: `mediaRole: 'uploaded'`, no genMode, `localRefs` from `localRefsByRef['I1']` when provided.

I0/A/B/V: `mediaRole: 'none'`, `genMode: 'i2i'` for images, `'v_ref'` for video.

P prompt must include 同一人 + 两套造型顺序 + lookbook; I0 prompt 白底+三视图+锁脸+禁止换装.

If `garmentRefs.length === 0` and not sequence gold-2, expand identity-only or wantVideo-only conservative graph (single image optional); do not throw.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/shared test src/canvas/compositionExpand.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/compositionCopy.ts packages/shared/src/canvas/compositionExpand.ts packages/shared/src/canvas/compositionExpand.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): expand try-on composition IR to workflow dump

EOF
)"
```

---

### Task 3: Expand gold 2 + lint + hash + HITL summary

**Files:**
- Create: `packages/shared/src/canvas/compositionLint.ts`
- Create: `packages/shared/src/canvas/compositionLint.test.ts`
- Modify: `packages/shared/src/canvas/compositionExpand.ts`
- Modify: `packages/shared/src/canvas/compositionExpand.test.ts`

**Interfaces:**
- Produces:
  - `lintCompositionDump(dump: WorkflowDocument): { ok: true } | { ok: false, code: 'compile_failed', message: string }`
  - `hashCompositionDump(dump: WorkflowDocument): string` (sha256 hex of `JSON.stringify(dump)`)
  - `summarizeCompositionDump(dump: WorkflowDocument, opts: { existingNodeCount: number }): string` — must contain `请确认是否把构图落到画布` and either `新建白底三视图` or `沿用` and `新增`

- [ ] **Step 1: Write failing tests** (append gold 2 to expand tests; new lint file)

```ts
it('gold 2 expands product white then scene, no P/V/i0 turnaround', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_2)
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) return
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  const types = dump.graph.nodes.map((n) => n.type)
  expect(types.filter((t) => t === 'image')).toHaveLength(3) // src + white + scene
  expect(dump.graph.nodes.some((n) => n.type === 'video')).toBe(false)
  expect(dump.graph.nodes.some((n) => n.id === 'text-p')).toBe(false)
  expect(dump.graph.nodes.some((n) => n.id === 'image-i0')).toBe(false)
})
```

```ts
import { createHash } from 'node:crypto'
import { GOLD_COMPOSE_1 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import { expandComposition, renderCompositionCopy } from './compositionExpand'
import { hashCompositionDump, lintCompositionDump, summarizeCompositionDump } from './compositionLint'

it('lints gold dump and hashes stably', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('extract')
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  expect(lintCompositionDump(dump)).toEqual({ ok: true })
  const h = hashCompositionDump(dump)
  expect(h).toBe(createHash('sha256').update(JSON.stringify(dump)).digest('hex'))
  expect(h).toBe(hashCompositionDump(dump))
  const summary = summarizeCompositionDump(dump, { existingNodeCount: 2 })
  expect(summary).toContain('请确认是否把构图落到画布')
  expect(summary).toContain('新建白底三视图')
  expect(summary).toContain('保留 2')
  expect(summary).toContain('新增')
})

it('rejects dataURL in dump', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('extract')
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  dump.graph.nodes[0].data.prompt = 'data:image/png;base64,aaaa'
  expect(lintCompositionDump(dump).ok).toBe(false)
})
```

- [ ] **Step 2: Run tests expecting FAIL**

Run: `pnpm --filter @lnkpi/shared test src/canvas/compositionLint.test.ts src/canvas/compositionExpand.test.ts`  
Expected: FAIL on new assertions / missing module

- [ ] **Step 3: Implement gold 2 branch + lint**

Gold 2: nodes `image-src-I1`, `image-white`, `image-scene`; mentionedKeys white←src, scene←white+src-I2 if I2 is scene otherRef as `image-src-I2`.

Lint: `validateWorkflow(dump)`; every node `data.status==='draft'`; no `data:image`; node count ≤ 24; no cycles on edges; source ids `image-src-*` must not have `genMode`.

Summary: count generating nodes (not `image-src-*`) as 新增; if `image-i0` present say 新建白底三视图 else if skip (no i0 but looks exist) say 沿用 I1 作为 I0.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/compositionLint.ts packages/shared/src/canvas/compositionLint.test.ts packages/shared/src/canvas/compositionExpand.ts packages/shared/src/canvas/compositionExpand.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): lint and summarize composition dumps

EOF
)"
```

---

### Task 4: Offline platform recipe matching

**Files:**
- Modify: `packages/shared/src/canvas/recipeCatalog.ts` (`matchPlatformRecipes` body)
- Modify: `packages/shared/src/canvas/recipeCatalog.test.ts`
- Modify: `packages/shared/src/canvas/recipePlannerEval.test.ts` (any test that expects match hits → expect `items: []` or skip match assertions)

**Interfaces:**
- `matchPlatformRecipes(_utterance: string): MatchPlatformRecipesResult` always `{ items: [] }`
- `getPlatformRecipe` / `listPlatformRecipeSummaries` / `PLATFORM_RECIPES` unchanged (old canvases + tests that validate JSON)

- [ ] **Step 1: Change failing expectation first**

In `recipeCatalog.test.ts` replace tests `帮我规划一个分镜成片` / `做一个图生视频工作流` / `蓝牙耳机详情页套图` match hits with:

```ts
it('matchPlatformRecipes is offline (empty items)', () => {
  expect(matchPlatformRecipes('做一个图生视频工作流')).toEqual({ items: [] })
  expect(matchPlatformRecipes('帮我规划一个分镜成片')).toEqual({ items: [] })
  expect(matchPlatformRecipes('蓝牙耳机详情页套图')).toEqual({ items: [] })
})
```

- [ ] **Step 2: Run** `pnpm --filter @lnkpi/shared test src/canvas/recipeCatalog.test.ts`  
Expected: FAIL on old assertions until implementation

- [ ] **Step 3: Implement empty match; keep getPlatformRecipe tests**

- [ ] **Step 4: Run recipeCatalog + recipePlannerEval tests.** Fix eval fixtures that require match parent ids: those evals are recipe-planner leftover — change match expectation to empty and skip parent assertion, **do not** delete applyDelta tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/recipeCatalog.ts packages/shared/src/canvas/recipeCatalog.test.ts packages/shared/src/canvas/recipePlannerEval.test.ts
git commit -m "$(cat <<'EOF'
fix(shared): retire platform recipe utterance matching

EOF
)"
```

---

### Task 5: Prisma session preview + Nest preview/confirm

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (`Session`)
- Create: `apps/server/prisma/migrations/20260916120000_composition_preview/migration.sql`
- Create: `apps/server/src/agent/composition.service.ts`
- Create: `apps/server/src/agent/composition.service.test.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent.module.ts` (register service)
- Modify: `packages/shared/src/index.ts` `CanvasData` add optional `compositionRunGroup?: { nodeIds: string[]; dumpHash: string; createdAt: string }`

**Interfaces:**
- Prisma `Session.compositionPreview String?` `Session.compositionPending String?`
- `CompositionService.preview(input: { sessionId, userId, utterance, copy?: object, existingNodeCount: number, attachments?: SidebarAttachment[] })`
  - Returns `{ userMessage, dumpHash, nodeTitles: string[] }` or throws `BadRequestException({ userMessage })`
- `CompositionService.confirm(input: { sessionId, userId, dumpHash: string })`
  - Returns import result `{ addedNodeIds, canvasCommands, dumpHash, idempotent?: boolean }`
- HTTP: `POST /agent/internal/preview-composition` `{ sessionId, userId, utterance, copy? }`
- HTTP: `POST /agent/internal/confirm-composition` `{ sessionId, userId, dumpHash }`

- [ ] **Step 1: Write failing Nest unit tests** (mock Prisma + `AgentCanvasToolsService.importWorkflow`)

```ts
it('preview gold 1 persists hash and does not import', async () => {
  const importWorkflow = vi.fn()
  const svc = new CompositionService(prisma, { importWorkflow } as never)
  const out = await svc.preview({
    sessionId: 's1',
    userId: 'u1',
    utterance: GOLD_COMPOSE_1,
    existingNodeCount: 0,
  })
  expect(out.dumpHash).toMatch(/^[a-f0-9]{64}$/)
  expect(out.userMessage).toContain('请确认是否把构图落到画布')
  expect(importWorkflow).not.toHaveBeenCalled()
})

it('confirm imports dump once then idempotent', async () => {
  importWorkflow.mockResolvedValue({
    addedNodeIds: ['image-i0', 'image-look-0'],
    canvasCommands: [{ type: 'focus_nodes', nodeIds: ['image-i0'] }],
  })
  await svc.preview({ sessionId: 's1', userId: 'u1', utterance: GOLD_COMPOSE_1, existingNodeCount: 0 })
  const first = await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: storedHash })
  const second = await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: storedHash })
  expect(importWorkflow).toHaveBeenCalledTimes(1)
  expect(second.idempotent).toBe(true)
  expect(second.addedNodeIds).toEqual(first.addedNodeIds)
})

it('confirm with wrong hash throws persist_missing userMessage', async () => {
  await expect(
    svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: 'dead'.repeat(16) }),
  ).rejects.toMatchObject({ response: { userMessage: '请先确认构图，再落到画布。' } })
})
```

After import, persist canvas `compositionRunGroup.nodeIds` = generating added ids only (filter out `image-src-` prefix). Store last confirmed hash on the group.

- [ ] **Step 2: Run Nest test expecting FAIL**

Run: `pnpm --filter @lnkpi/server test src/agent/composition.service.test.ts`  
Expected: FAIL missing service

- [ ] **Step 3: Migration + service + controller**

Migration SQL:

```sql
ALTER TABLE "Session" ADD COLUMN "compositionPreview" TEXT;
ALTER TABLE "Session" ADD COLUMN "compositionPending" TEXT;
```

preview: extract → if incomplete write `compositionPending` JSON `{ utterance, primitivesPartial, ts }` and throw extract_incomplete userMessage `请指明哪张是模特、哪张是服装。`  
If complete: render+expand+lint; on lint fail throw compile_failed copy; else save `compositionPreview` JSON `{ dump, hash, primitives, ts, lastImportedHash?: string }` and return summary.

confirm: parse preview; if hash mismatch throw persist_missing; if `lastImportedHash === dumpHash` return last addedNodeIds without import; else `importWorkflow({ sessionId, userId, workflow: dump })`; merge `compositionRunGroup` into parsed canvasData; set `lastImportedHash`; save canvas.

existingNodeCount: parse canvasData nodes length.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** (include prisma generate note in commit body)

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260916120000_composition_preview/migration.sql apps/server/src/agent/composition.service.ts apps/server/src/agent/composition.service.test.ts apps/server/src/agent/agent-canvas-tools.controller.ts apps/server/src/agent/agent.module.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): persist composition preview and confirm import

EOF
)"
```

---

### Task 6: Video generate reads live P text

**Files:**
- Create: `packages/shared/src/canvas/compositionVideo.ts`
- Create: `packages/shared/src/canvas/compositionVideo.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts` (`generateVideo` ~1548)
- Modify: `apps/web/src/composables/useNodeGeneration.ts` (video call ~1074)
- Modify: `packages/shared/src/index.ts` re-export

**Interfaces:**
- `resolveCompositionVideoPrompt(canvas: { nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }> }, videoNodeId: string): { prompt: string } | { error: 'empty_p_block_v' }`
- If canvas has `text-p` (or any `type==='text'` node in `compositionRunGroup.nodeIds`), use that node's `data.prompt` / `data.content`. Else use video node's own prompt.

- [ ] **Step 1: Write failing unit test** with a fake canvas: nodes `image-i0`, `image-look-0`, `text-p` (prompt `NEW SCRIPT`), `video-v` (`prompt: 'OLD'`, mentionedKeys i0+looks). Assert resolve function returns prompt `NEW SCRIPT`. Empty `text-p` prompt → `empty_p_block_v`.

- [ ] **Step 2: Run test FAIL**

- [ ] **Step 3: Implement `resolveCompositionVideoPrompt` in `compositionVideo.ts`. Call it from `StudioService.generateVideo` and from `useNodeGeneration.ts` before `canvasApi.generateVideo`. Empty P → userMessage `分镜还是空的，写好后再生成视频。`

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(studio): video generate reads composition storyboard node text

EOF
)"
```

---

### Task 7: L0 composition_confirm + composition_structure

**Files:**
- Create: `services/agent-runtime/app/graph/composition_route.py`
- Create: `services/agent-runtime/tests/test_composition_route.py`
- Modify: `services/agent-runtime/app/graph/route_precedence.py`
- Create: `services/agent-runtime/tests/test_composition_l0.py`

**Interfaces:**
- `GOLD_COMPOSE_1` python string (same as TS)
- `is_composition_confirm_chip(text) -> bool` (reuse planner chip exact 确认落到画布 / 先不改)
- `is_composition_structure_utterance(text) -> bool` — **same keyword rules as Task 1**
- `_rule_composition_confirm` / `_rule_composition_structure` inserted in `PRECEDENCE_RULES` **immediately after** `regen_no_checkpoint` and **before** `sidebar_img2img`

- [ ] **Step 1: Failing tests**

```python
GOLD = "@I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，写入画布，待我确认后再做生图生视频"

def test_gold_structure_detector():
    from app.graph.composition_route import is_composition_structure_utterance
    assert is_composition_structure_utterance(GOLD) is True
    assert is_composition_structure_utterance("换装") is False
    assert is_composition_structure_utterance("生图生视频") is False

def test_gold_l0_wins_over_img2img_and_orch(monkeypatch):
    # Build RouteContext with mentioned_keys I1 I2 I3, has_multi_image_ref True, utterance GOLD
    # apply_route_precedence → precedence_rule_id == "composition_structure", flow_mode == "canvas_agent"
```

Also: utterance `确认落到画布` → `composition_confirm`.  
Utterance with 请 + three images but **without** structure keywords should still be sidebar_img2img (regression).

Follow existing `apply_route_precedence` test fixtures in `tests/test_phase_2d3_cleanup.py` / route tests for how to build ctx.

- [ ] **Step 2: pytest FAIL**

Run: `cd services/agent-runtime && python -m pytest tests/test_composition_route.py tests/test_composition_l0.py -q`  
Expected: FAIL

- [ ] **Step 3: Implement detectors + insert rules.** `composition_structure` must also win when `ctx["composition_pending"]` is a non-empty JSON (pending extract resume). Intake must pass `composition_pending` from session into RouteContext (read `Session.compositionPending` via existing session payload if present; if intake has no session field yet, add `composition_pending` on graph state set by explore preview incomplete).

Minimal pending wiring this task: if `ctx.get("composition_pending")` truthy, `_rule_composition_structure` matches even without structure keywords.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): route composition structure intent before img2img

EOF
)"
```

---

### Task 8: Explore deterministic preview + confirm short-circuit

**Files:**
- Modify: `services/agent-runtime/app/tools/nest_client.py` (`preview_composition`, `confirm_composition`)
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Modify: `services/agent-runtime/app/graph/planner_copy.py` (composition copy constants; do not delete planner constants — unused bind)
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py` (`select_narrow_write_tools`)
- Create: `services/agent-runtime/tests/test_composition_confirm_explore.py`
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`
- Modify: `services/agent-runtime/tests/test_planner_confirm_instantiate.py` (confirm chip now prefers composition; planner instantiate tests that send 确认落到画布 without composition preview must expect **构图** no-preview copy, not instantiate)

**Interfaces:**
- `COMPOSITION_NO_PREVIEW_REPLY = "请先确认构图，再落到画布。"`
- `COMPOSITION_CANCEL_REPLY = "已取消落到画布。"`
- `COMPOSITION_LANDED_REPLY = "已按构图落到画布。"`
- `nest.preview_composition(utterance: str, copy: dict | None = None)`
- `nest.confirm_composition(dump_hash: str)`

- [ ] **Step 1: Failing explore tests**

```python
async def test_gold_preview_does_not_call_llm(monkeypatch):
    # explore node with user GOLD, nest.preview_composition returns userMessage + dumpHash
    # assert nest.preview_composition awaited
    # assert instantiate_recipe not called
    # assert reply contains 请确认是否把构图落到画布
    # assert additional_kwargs composition_dump_hash == hash
    # llm ainvoke not called

async def test_confirm_chip_imports_composition_not_instantiate():
    # prior AIMessage kwargs composition_dump_hash
    # user 确认落到画布
    # confirm_composition called with that hash
    # instantiate_recipe not called
    # reply 已按构图落到画布
    # canvas_commands forwarded

async def test_confirm_without_preview_uses_composition_copy():
    # no hash on session/kwargs
    # reply 请先确认构图，再落到画布。
    # not 未能更新节点
```

`select_narrow_write_tools(GOLD)` must **not** equal planner tools. Prefer empty write set or default minus planner. `select_narrow_write_tools("确认落到画布")` must **not** include `instantiate_workflow_template`.

- [ ] **Step 2: pytest FAIL**

- [ ] **Step 3: Implement**

Explore, **before** planner instantiate block:

1. If cancel chip → `COMPOSITION_CANCEL_REPLY` (same as planner cancel text now unified to 已取消落到画布).
2. If confirm chip → `confirm_composition(hash)` where hash is `state["composition_dump_hash"]` or kwargs scan `composition_dump_hash` (session SSOT is Nest-side; client still sends hash from last preview return stored on graph state). Set graph state `composition_dump_hash` from preview response.
3. If `is_composition_structure_utterance` OR state composition_pending: call `preview_composition`; on extract_incomplete, set pending and return that userMessage; else return userMessage, stamp kwargs `{kind: composition, dump_hash}`, **do not ainvoke**.
4. Remove/skip old instantiate path for confirm chip entirely.

`select_narrow_write_tools`: delete planner branch (`_is_planner_utterance` / `_PLANNER_CONFIRM` instantiate bind). Keep import anchors. Structure intent: return `frozenset()` write tools (CORE still has import in plan — acceptable if not bound in narrow writes).

Update `test_explore_narrow_bind.py` planner tests: GOLD planner phrases now either empty writes or default 5; **not** `_PLANNER_TOOLS`. Keep import tests.

- [ ] **Step 4: PASS** entire agent-runtime tests that fail; fix planner_confirm tests to composition behavior.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): deterministic composition preview and confirm import

EOF
)"
```

---

### Task 9: Web chips + Dock run group

**Files:**
- Modify: `apps/web/src/components/agent/agentChipSet.ts` (`RECIPE_CONFIRM_SNIPPETS` include `请确认是否把构图落到画布`)
- Modify: `apps/web/src/components/agent/agentChipSet.test.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts` (or CanvasPage generate entry): if `canvas.compositionRunGroup?.nodeIds?.length`, generate those ids in DAG order (I0 before looks before video; skip `image-src-*`; skip `text-p`).
- Test: `apps/web/src/composables/useNodeGeneration.test.ts` or new `compositionRunGroup.test.ts`

- [ ] **Step 1: Failing tests** — chip set detects 构图 HITL as `recipe_confirm` (reuse existing confirm buttons). Helper `orderedCompositionGenerateIds(canvas)` returns `['image-i0','image-look-0','image-look-1','video-v']` given gold graph + run group.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement snippet + topo order using canvas.edges** (Kahn or mentionedKeys deps). Do not generate source nodes.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): composition confirm chips and run-group generate order

EOF
)"
```

---

### Task 10: Gold regression bundle + docs pointer

**Files:**
- Create: `packages/shared/src/canvas/compositionGold.eval.test.ts` — single file asserting extract→expand→lint for both golds (already covered; add skipI0 + 做一个图生视频工作流 expand does not throw).
- Modify: `docs/superpowers/specs/2026-09-16-generic-canvas-compose-design.md` §11 checkboxes if any implementation notes needed (only if APIs diverged; prefer not rewriting spec).
- Run: `pnpm --filter @lnkpi/shared test` and `cd services/agent-runtime && python -m pytest tests/test_composition_route.py tests/test_composition_l0.py tests/test_composition_confirm_explore.py tests/test_explore_narrow_bind.py -q`

- [ ] **Step 1: Add eval test that `做一个图生视频工作流` expand has a video node and no `recipeId` of `image-to-video`.**

- [ ] **Step 2: Run full shared + targeted runtime pytest.** Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(shared): composition gold expand without i2v recipe id

EOF
)"
```

---

## Self-review (coverage)

| Spec | Task |
|------|------|
| G1–G7 expand/P/V/I0 | 1–3 |
| G10 match offline | 4 |
| G12 session preview + idempotent confirm | 5 |
| G7 V reads P | 6 |
| G13 L0 | 7 |
| G9/G14/G15/G16 explore | 8 |
| Frontend chips + run group Dock | 9 |
| Gold eval + 图生视频工作流 | 10 |
| P1 gallery/CMS | **not in this plan** |
| 二创 add single video without compose | deferred (use existing upsert after P0; spec allows later) |

No TBD. Python/TS structure keyword lists must stay synced (comment in both files: `sync: compositionExtract.ts / composition_route.py`).
