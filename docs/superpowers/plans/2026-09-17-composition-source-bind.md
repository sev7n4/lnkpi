# Composition Source Bind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Try-on composition source nodes carry `@I*` image urls; missing bind cannot confirm (and voids a stale confirm persist); same slotKey confirm replaces the previous land instead of stacking a second tree.

**Architecture:** Keep Nest HTTP preview/confirm and the composition compiler. Move chip-key attachment mapping + slotKey into `@lnkpi/shared`. Preview refuses to persist a confirmable dump unless every required `I*` has `localRefs.url`. `importWorkflow` must persist those urls (today it only reads `data.url` / `mediaIndex`, so localRefs-only dumps land as empty shells). Confirm on the same slotKey calls existing `removeNodes` then import. Runtime always forwards `attachments` (including `[]`) and clears `composition_dump_hash` on bind-fail. Do not walk the canvas graph.

**Tech Stack:** TypeScript (`packages/shared`, Nest `CompositionService`), Vitest, Python agent-runtime pytest.

**Spec:** [docs/superpowers/specs/2026-09-17-composition-source-bind-design.md](../specs/2026-09-17-composition-source-bind-design.md) B1–B9, E-B1–E-B8.

## Global Constraints

- Do not change composition routing, empty write-set, or confirm-before-`propose`
- No `run_*`, no mandatory `propose`, no 2e.3 hand-build, no `MEDIA_CREATE_HINTS` expansion
- Do not scrape canvas completed nodes to fill `I*`
- Do not change `prefix_assistant_reply`, `MAX_PARSE_IMAGE_URLS`, or `P_SKELETON_PROMPT`
- Bind-fail copy (verbatim): `参考图还没挂到构图上。请确认侧栏 @I1 起仍在本轮，或先把图加入 Agent 引用。`
- Bind-fail must **not** contain `请确认是否把构图落到画布`
- `slotKey = `${identityRef ?? ''}::${[...garmentRefs].sort().join(',')}::${skipI0 ? '1' : '0'}`` — no `wantVideo`
- Gold 1 preview/confirm tests **must** pass I1–I3 attachments; the no-attachment gold-1 confirm-sentence test is retired (E-B2)
- Production oral (verbatim): `@I1 这个是模特， @I2  @I3  @I4  @I5 这几个是服装，请帮我设计一套模特换装工作流方案，含一键生图生视频`
- `SIDEBAR_ATTACHMENT_MAX` is 5; E-B5 uses exactly five image attachments
- Branch from this docs HEAD (`docs/composition-land-gaps`) as `feature/composition-source-bind`, or keep implementing on this branch
- This PR does **not** run the production gold against live; post-deploy use a **new** canvas (never H8 session `cmu4kmyy6000fo301p08o6zjn`)
- Prod login (post-deploy only): `BASE_URL=http://119.29.173.89:8888` `PHONE=17279698608` `CODE=123456`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/canvas/compositionExtract.ts` | `这个是模特` / `这几个是服装` |
| `packages/shared/src/canvas/compositionBind.ts` | **new** — slotKey, required keys, chip-key `localRefs` map, `COMPOSITION_BIND_MISSING` |
| `packages/shared/src/index.ts` | re-export bind helpers |
| `apps/server/src/agent/composition.service.ts` | bind gate, void confirm persist, slotKey replace |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `importWorkflow` copies `localRefs[0].url` into persist/`data.url` |
| `services/agent-runtime/app/tools/nest_client.py` | always send `attachments` (even `[]`) |
| `services/agent-runtime/app/graph/nodes/explore.py` | bind-fail: no confirm sentence, `composition_dump_hash: None` |
| Tests listed per task | E-B1–E-B8 |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-composition-source-bind-design.md` (header 状态 + 实现 plan)
- Create: this plan file

**Interfaces:**
- Consumes: approved spec B1–B9
- Produces: spec header links here

- [ ] **Step 1:** Spec header `状态` → **已批准**；加一行 `实现 plan：` 链到本文件。

- [ ] **Step 2: Commit** (docs only)

```bash
git add docs/superpowers/specs/2026-09-17-composition-source-bind-design.md \
  docs/superpowers/plans/2026-09-17-composition-source-bind.md
git commit -m "$(cat <<'EOF'
docs(agent): plan composition source bind and same-slot replace

EOF
)"
```

---

### Task 1: Shared extract + slotKey + chip-key mapping (RED then GREEN)

**Files:**
- Create: `packages/shared/src/canvas/compositionBind.ts`
- Create: `packages/shared/src/canvas/compositionBind.test.ts`
- Modify: `packages/shared/src/canvas/compositionExtract.ts`
- Modify: `packages/shared/src/canvas/compositionExtract.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export bind module)

**Interfaces:**
- Consumes: `CompositionIR['primitives']`, `LocalRefBinding`
- Produces:
  - `COMPOSITION_BIND_MISSING` string constant (exact spec copy)
  - `compositionSlotKey(primitives): string`
  - `requiredCompositionRefKeys(primitives): string[]`
  - `localRefsByRefFromSidebarAttachments(utterance: string, attachments: unknown[] | undefined): Record<string, LocalRefBinding[]>`
  - `compositionSourcesBound(requiredKeys: string[], byRef: Record<string, LocalRefBinding[]>): boolean` — true iff every key has `byRef[key][0].url` non-empty

- [ ] **Step 1: RED extract test** — append to `compositionExtract.test.ts`:

```ts
it('production oral 这个是模特 / 这几个是服装 extracts I1 + I2-I5', () => {
  const u =
    '@I1 这个是模特， @I2  @I3  @I4  @I5 这几个是服装，请帮我设计一套模特换装工作流方案，含一键生图生视频'
  expect(isCompositionStructureUtterance(u)).toBe(true)
  const got = extractCompositionPrimitives(u)
  expect(got).toEqual({
    ok: true,
    primitives: {
      identityRef: 'I1',
      skipI0: false,
      garmentRefs: ['I2', 'I3', 'I4', 'I5'],
      otherRefs: [],
      wantVideo: true,
      sequence: [],
    },
  })
})
```

- [ ] **Step 2: Run extract test (expect RED)**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/compositionExtract.test.ts
```

Expected: FAIL on `identityRef` and/or `garmentRefs` (current regex misses `这个是模特` / `这几个`).

- [ ] **Step 3: Fix extract** in `findIdentityRef` / `findGarmentRefs` only:

```ts
// identity: try 这个是模特 before 是模特
const asModel = text.match(/@?I([0-9]+)\s*(?:作为模特|这个是模特|是模特|模特)/)
// garment cluster:
for (const m of text.matchAll(/((?:@?I[0-9]+\s*)+)(?:这两个|这些|这几个)?是?服装/g)) {
```

Do **not** add 换装 to structure intent. Keep `MAX_GARMENTS = 4`.

- [ ] **Step 4: RED bind tests** — `compositionBind.test.ts` (file may 404 until created; write tests first):

```ts
import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import {
  COMPOSITION_BIND_MISSING,
  compositionSlotKey,
  compositionSourcesBound,
  localRefsByRefFromSidebarAttachments,
  requiredCompositionRefKeys,
} from './compositionBind'

const GOLD_ATTS = [
  { id: 'a1', mediaType: 'image', sourceKind: 'upload', label: 'I1', url: 'https://cdn.example/i1.png' },
  { id: 'a2', mediaType: 'image', sourceKind: 'upload', label: '@I2', url: 'https://cdn.example/i2.png' },
  { id: 'a3', mediaType: 'image', sourceKind: 'upload', label: '图', url: 'https://cdn.example/i3.png' },
]

it('slotKey ignores wantVideo and copy', () => {
  const a = extractCompositionPrimitives(GOLD_COMPOSE_1)
  const b = extractCompositionPrimitives(
    '@I1 作为模特，@I2 @I3 这两个是服装图，设计一套工作流并写入画布',
  )
  if (!a.ok || !b.ok) throw new Error('extract')
  expect(compositionSlotKey(a.primitives)).toBe('I1::I2,I3::0')
  expect(compositionSlotKey(b.primitives)).toBe(compositionSlotKey(a.primitives))
  expect(a.primitives.wantVideo).not.toBe(b.primitives.wantVideo)
})

it('maps by chip label not upload order', () => {
  const shuffled = [GOLD_ATTS[1], GOLD_ATTS[0], GOLD_ATTS[2]]
  const map = localRefsByRefFromSidebarAttachments(GOLD_COMPOSE_1, shuffled)
  expect(map.I1[0].url).toContain('i1.png')
  expect(map.I2[0].url).toContain('i2.png')
  expect(map.I3[0].url).toContain('i3.png') // leftover unlabeled → remaining mentioned key
})

it('bound false without urls', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('extract')
  const keys = requiredCompositionRefKeys(extracted.primitives)
  expect(keys).toEqual(['I1', 'I2', 'I3'])
  expect(compositionSourcesBound(keys, {})).toBe(false)
  expect(COMPOSITION_BIND_MISSING).toContain('参考图还没挂到构图上')
})
```

- [ ] **Step 5: Implement `compositionBind.ts`**

Chip key: from `refKey` / `label` / `id` matching `/^@?I(\d+)$/i` → `I{n}`.  
Unlabeled images fill remaining **mentioned** `@I*` keys in attachment order (utterance `@I` set, else `I1…` by index).  
`attachmentToLocalRef`: require `url` or `id`; `sourceKind` `asset` stays asset, everything else `upload` (Sidebar `canvasNode` → upload).  
`skipI0` missing → treat as false in slotKey.

Re-export from `packages/shared/src/index.ts`.

- [ ] **Step 6: Run shared tests**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/compositionExtract.test.ts src/canvas/compositionBind.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/canvas/compositionExtract.ts \
  packages/shared/src/canvas/compositionExtract.test.ts \
  packages/shared/src/canvas/compositionBind.ts \
  packages/shared/src/canvas/compositionBind.test.ts \
  packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): bind composition I* from chip keys and oral extract

EOF
)"
```

---

### Task 2: Preview bind gate + void stale persist (E-B1, E-B2, E-B8)

**Files:**
- Modify: `apps/server/src/agent/composition.service.ts` — delete local `localRefsByRefFromSidebarAttachments` / `attachmentToLocalRef`; import from `@lnkpi/shared`
- Modify: `apps/server/src/agent/composition.service.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers + `COMPOSITION_BIND_MISSING`
- Produces: `preview` throws `BadRequestException({ userMessage: COMPOSITION_BIND_MISSING })` when unbound; persist has no `hash`/`dump` but **keeps** `lastImportedHash` / `lastAddedNodeIds` / `lastImportedSlotKey`; confirmable persist still `{ dump, hash, primitives, slotKey, ts, last* }`

- [ ] **Step 1: Rewrite gold-1 tests (this is the RED)**

Change `preview gold 1 persists hash and does not import` to pass three attachments (copy the existing `stamps sidebar image localRefs` fixture). Assert `image-src-I1/I2/I3` have urls and `userMessage` contains `请确认是否把构图落到画布`.

Change `confirm imports dump once then idempotent` to use the same attachments.

Add:

```ts
it('E-B2 preview without attachments does not persist confirmable hash', async () => {
  const { prisma, sessions } = createPrisma()
  const svc = new CompositionService(prisma, { importWorkflow: vi.fn() } as never)
  sessions.get('s1')!.compositionPreview = JSON.stringify({
    dump: { version: '1', graph: { nodes: [], edges: [] } },
    hash: 'ab'.repeat(32),
    primitives: {},
    ts: new Date().toISOString(),
    lastImportedHash: 'old',
    lastAddedNodeIds: ['keep-me'],
    lastImportedSlotKey: 'I1::I2,I3::0',
  })
  await expect(
    svc.preview({ sessionId: 's1', userId: 'u1', utterance: GOLD_COMPOSE_1, existingNodeCount: 0 }),
  ).rejects.toMatchObject({ response: { userMessage: COMPOSITION_BIND_MISSING } })
  const stored = JSON.parse(sessions.get('s1')!.compositionPreview!) as {
    hash?: string
    dump?: unknown
    lastAddedNodeIds?: string[]
  }
  expect(stored.hash).toBeUndefined()
  expect(stored.dump).toBeUndefined()
  expect(stored.lastAddedNodeIds).toEqual(['keep-me'])
  expect(COMPOSITION_BIND_MISSING).not.toContain('请确认是否把构图落到画布')
})

it('E-B8 confirm after bind-fail persist_missing', async () => {
  const { prisma } = createPrisma()
  const importWorkflow = vi.fn()
  const svc = new CompositionService(prisma, { importWorkflow } as never)
  await expect(
    svc.preview({ sessionId: 's1', userId: 'u1', utterance: GOLD_COMPOSE_1, existingNodeCount: 0 }),
  ).rejects.toMatchObject({ response: { userMessage: COMPOSITION_BIND_MISSING } })
  await expect(
    svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: 'ab'.repeat(32) }),
  ).rejects.toMatchObject({ response: { userMessage: '请先确认构图，再落到画布。' } })
  expect(importWorkflow).not.toHaveBeenCalled()
})
```

Keep `preview gold 1 stamps sidebar image localRefs…` (already has attachments).

- [ ] **Step 2: Run** (expect RED on no-attachment gold-1 and new tests)

```bash
pnpm --filter @lnkpi/server exec vitest run src/agent/composition.service.test.ts
```

- [ ] **Step 3: Implement preview gate**

After `extractCompositionPrimitives` succeeds:

```ts
const byRef = localRefsByRefFromSidebarAttachments(utterance, input.attachments)
const required = requiredCompositionRefKeys(extracted.primitives)
const previous = parseLandedMeta(session.compositionPreview)
if (!compositionSourcesBound(required, byRef)) {
  await this.prisma.session.update({
    where: { id: session.id },
    data: {
      compositionPreview: JSON.stringify({
        lastImportedHash: previous?.lastImportedHash,
        lastAddedNodeIds: previous?.lastAddedNodeIds,
        lastImportedSlotKey: previous?.lastImportedSlotKey,
        ts,
      }),
      compositionPending: JSON.stringify({ utterance, primitivesPartial: {}, ts }),
    },
  })
  throw new BadRequestException({ userMessage: COMPOSITION_BIND_MISSING })
}
```

Then expand with `byRef`. Persist confirmable preview including `slotKey: compositionSlotKey(extracted.primitives)` and copy previous `last*` fields.

Split parsers:

- `parseConfirmablePreview` — requires `hash` + `dump` (confirm uses this; same as today’s `parseStoredPreview`)
- `parseLandedMeta` — returns lastImported* even when hash/dump absent

`confirm` must use `parseConfirmablePreview` so bind-fail persist yields persist_missing.

- [ ] **Step 4: Run composition.service tests** — Expected: PASS (replace tests in Task 3 may not exist yet).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/composition.service.ts \
  apps/server/src/agent/composition.service.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): refuse composition confirm without sidebar source urls

EOF
)"
```

---

### Task 3: Same-slot confirm replaces previous land (E-B4, E-B6)

**Files:**
- Modify: `apps/server/src/agent/composition.service.ts` `confirm`
- Modify: `apps/server/src/agent/composition.service.test.ts`

**Interfaces:**
- Consumes: `canvasTools.removeNodes({ sessionId, nodeIds })` (already at `agent-canvas-tools.service.ts` ~734)
- Produces: if `lastImportedSlotKey === slotKey` and `lastAddedNodeIds.length` and hash differs → `removeNodes` then `importWorkflow`; different identity slotKey → import without remove (overlay)

- [ ] **Step 1: RED tests**

Extend `createPrisma` mocks with `removeNodes` that deletes listed ids from `sessions.get('s1').canvasData`.

```ts
it('E-B4 same slotKey second confirm replaces rather than stacking', async () => {
  const { prisma, sessions } = createPrisma()
  const importWorkflow = mockImportWritingCanvas(sessions)
  const removeNodes = vi.fn(async ({ nodeIds }: { nodeIds: string[] }) => {
    const row = sessions.get('s1')!
    const canvas = JSON.parse(row.canvasData || '{"nodes":[],"edges":[]}')
    canvas.nodes = canvas.nodes.filter((n: { id: string }) => !nodeIds.includes(n.id))
    row.canvasData = JSON.stringify(canvas)
    return { actions: [] }
  })
  const svc = new CompositionService(prisma, { importWorkflow, removeNodes } as never)
  const atts = [/* I1 I2 I3 urls as in stamps test */]
  const firstUtterance =
    '@I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，写入画布'
  const first = await svc.preview({
    sessionId: 's1', userId: 'u1', utterance: firstUtterance, existingNodeCount: 0, attachments: atts,
  })
  const landed = await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: first.dumpHash })
  const second = await svc.preview({
    sessionId: 's1', userId: 'u1', utterance: GOLD_COMPOSE_1, existingNodeCount: 3, attachments: atts,
  })
  expect(second.dumpHash).not.toBe(first.dumpHash) // wantVideo added
  await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: second.dumpHash })
  expect(removeNodes).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 's1', nodeIds: landed.addedNodeIds }),
  )
  expect(importWorkflow).toHaveBeenCalledTimes(2)
})

it('E-B6 different identity overlays', async () => {
  // first GOLD_COMPOSE_1 + I1-I3, confirm; second utterance identity I6 + new atts; confirm
  // expect removeNodes not called; importWorkflow twice
})
```

- [ ] **Step 2: Run** — expect RED (`removeNodes` undefined / not called).

- [ ] **Step 3: Implement confirm**

After persist_missing and same-hash idempotent checks:

```ts
const slotKey = preview.slotKey ?? compositionSlotKey(preview.primitives)
if (
  preview.lastImportedSlotKey === slotKey &&
  (preview.lastAddedNodeIds?.length ?? 0) > 0 &&
  preview.lastImportedHash !== input.dumpHash
) {
  await this.canvasTools.removeNodes({
    sessionId: input.sessionId,
    nodeIds: preview.lastAddedNodeIds!,
  })
}
```

Then existing `importWorkflow`. Persist `lastImportedSlotKey: slotKey`.

`removeNodes` already drops incident edges; that is acceptable (composition trees do not share edges with H8 leftovers).

- [ ] **Step 4: Run composition.service tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): replace same-slot composition land instead of stacking

EOF
)"
```

---

### Task 4: importWorkflow persists localRefs urls (empty-shell fix)

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` `importWorkflow` url collection (~2118)
- Test: `apps/server/src/agent/agent-canvas-tools.service.test.ts` (or nearest import-workflow test file — search `importWorkflow` tests; add there)

**Interfaces:**
- Consumes: dump node `data.localRefs[0].url`
- Produces: `urlByNodeId` includes that url so `persistRemote` + `node.data.url` are set; `localRefs` still present on merged canvas node

- [ ] **Step 1: RED** — import a one-node workflow whose data is `{ localRefs: [{ id: 'a', mediaType: 'image', sourceKind: 'upload', label: 'I1', url: 'https://cdn.example/i1.png' }] }` and **no** `data.url`. Assert persisted canvas node has `data.url` (or persistedUrl) and still has `localRefs`.

Mock `persistRemote` to echo `persistedUrl: url`.

- [ ] **Step 2: Run** — FAIL because `urlByNodeId` ignores localRefs.

- [ ] **Step 3: After reading `node.data.url` / mediaIndex, also:**

```ts
const refs = node.data?.localRefs
if (Array.isArray(refs) && refs[0] && typeof refs[0] === 'object') {
  const refUrl = String((refs[0] as { url?: string }).url ?? '').trim()
  if (refUrl && !urlByNodeId.has(node.id)) {
    urlByNodeId.set(node.id, { url: refUrl, kind: inferPersistKind(node.type) })
  }
}
```

Skip `data:image` urls (lint already forbids them in composition dumps).

- [ ] **Step 4: Run import tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(agent): persist composition source urls from localRefs on import

EOF
)"
```

---

### Task 5: Runtime always forwards attachments; bind-fail clears dump hash (E-B2b, E-B7)

**Files:**
- Modify: `services/agent-runtime/app/tools/nest_client.py` `preview_composition`
- Modify: `services/agent-runtime/tests/test_nest_client.py`
- Modify: `services/agent-runtime/app/graph/nodes/explore.py` composition preview `except AgentToolError`
- Modify: `services/agent-runtime/tests/test_composition_confirm_explore.py`

**Interfaces:**
- Consumes: `nest.sidebar_attachments` (explore already copies `state.sidebar_attachments`)
- Produces: JSON always has `"attachments": list` (possibly `[]`); bind-fail assistant has no confirm sentence and `composition_dump_hash` is None in kwargs **and** state

- [ ] **Step 1: RED nest test** — change `test_preview_composition` to expect `"attachments": []` in body. Add:

```python
@pytest.mark.asyncio
async def test_preview_composition_sends_empty_attachments_list(nest_client, captured):
    nest_client.sidebar_attachments = []
    await nest_client.preview_composition("设计一段模特换装的工作流并做好连线，写入画布")
    assert _last(captured)["json"]["attachments"] == []
```

Existing `test_preview_composition_forwards_sidebar_attachments` stays.

- [ ] **Step 2: RED explore bind-fail**

```python
@pytest.mark.asyncio
async def test_bind_fail_clears_dump_hash_and_has_no_confirm_chip():
    from app.errors import AgentToolError
    llm = _llm()
    nest = _nest()
    nest.preview_composition = AsyncMock(
        side_effect=AgentToolError({
            "message": "参考图还没挂到构图上。请确认侧栏 @I1 起仍在本轮，或先把图加入 Agent 引用。",
        })
    )
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content=GOLD_COMPOSE_1)],
        "composition_dump_hash": DUMP_HASH,
    })
    text = result["messages"][0].content
    assert HITL_CONFIRM not in text
    assert "参考图还没挂到构图上" in text
    assert result["messages"][0].additional_kwargs.get("composition_dump_hash") in (None, "")
    assert result.get("composition_dump_hash") in (None, "")
    llm.ainvoke.assert_not_called()
```

If `AgentToolError` ctor differs, match `from_exception` / existing explore bind-fail patterns in this file.

- [ ] **Step 3: Implement**

`preview_composition`:

```python
body["attachments"] = list(self.sidebar_attachments or [])
```

Explore `except AgentToolError` on preview: `extra["composition_dump_hash"] = None`; do **not** set `additional[COMPOSITION_DUMP_HASH_KW]` on bind-fail (no dumpHash in result). `_chip_out(..., extra_state=extra)` so LangGraph state clears the old hash.

E-B2b is covered: explore already sets `nest.sidebar_attachments = list(attachments)` from state before preview; always-forward makes Nest see them even when the previous `if self.sidebar_attachments` skipped `[]`.

- [ ] **Step 4: Run**

```bash
cd services/agent-runtime && python3.11 -m pytest \
  tests/test_nest_client.py tests/test_composition_confirm_explore.py \
  tests/test_explore_narrow_bind.py -q
```

Expected: PASS. `select_narrow_write_tools(GOLD_COMPOSE_1)` still empty writes (E-B7). Add an assert in an existing gold-1 explore test: `select_narrow_write_tools(GOLD_COMPOSE_1)` disjoint from `propose_generation` / `upsert_media_node` if not already present.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(agent): always forward composition attachments and void dump hash on bind fail

EOF
)"
```

---

### Task 6: Stop — no canvas walk, no prod V1, no copy/parse work

**Files:** none required

- [ ] **Step 1:** `git diff --name-only origin/main...HEAD` must **not** include `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`, 2e.1/2e.3 harnesses, `compositionCopy.ts`, `sidebar_media_parse.py` (`MAX_PARSE_IMAGE_URLS`).

- [ ] **Step 2:** Grep the diff for `canvas.nodes.filter` / completed-image fallback in composition bind — **must not** exist.

- [ ] **Step 3:** Do not run production oral against `cmu4kmyy6000fo301p08o6zjn`. Post-merge: new canvas + real sidebar chips.

---

## Self-review (author)

1. **Spec coverage:** B1 → Task 2+4. B2 chip-key + no canvas + reuse-via-state attachments → Task 1+5. B3 void persist + clear hash → Task 2+5. B4/B5/B6 slot replace/overlay → Task 3. B7 → Task 5 narrow-write. B8 → Task 6. B9 gold-1 tests → Task 2. E-B5 oral extract → Task 1. E-B8 → Task 2+5.
2. **Placeholder scan:** no TBD.
3. **Types:** `compositionSlotKey` / `COMPOSITION_BIND_MISSING` / `removeNodes` names consistent across tasks.
4. **import url gap:** Task 4 is required even when Task 2 stamps localRefs — otherwise confirm still shows「上传图片」.
