# Task 6 Report: Video generate reads live P text

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feature/generic-canvas-compose-spec`  
**Commit:** `e2d19349` `feat(studio): video generate reads composition storyboard node text`

## What shipped

Shared helper `resolveCompositionVideoPrompt(canvas, videoNodeId)` in `packages/shared/src/canvas/compositionVideo.ts`, re-exported from `packages/shared/src/index.ts`.

Priority:

1. Node id `text-p` → `data.prompt` or `data.content` (trim). Empty → `{ error: 'empty_p_block_v' }` even if the video node still has `OLD`.
2. Else first `type === 'text'` node whose id appears in `compositionRunGroup.nodeIds` (same prompt/content rule).
3. Else the video node’s own `data.prompt` (trim). Missing video node and no P block → `{ prompt: '' }` (not `empty_p_block_v`).

Call sites:

- **Web** `useNodeGeneration.ts`: before `studioApi.startVideoGeneration` (canvas V) and shot-child `canvasApi.generateVideo`. Empty P patches the video node `status: error` with `分镜还是空的，写好后再生成视频。` and returns without calling the API. Success passes `resolved.prompt` as the request prompt; the node’s stored prompt is not overwritten with P text.
- **Nest** `resolveVideoStartRequest` (`POST /studio/video/start`): when `canvas` and `nodeId` are present, replaces `request.prompt`. Empty P → `BadRequestException('分镜还是空的，写好后再生成视频。')`.
- **Nest** `StudioService.generateVideo`: when `scope.sessionId` and `scope.nodeId` are set, loads session canvas and resolves before charging. Standalone VideoStudioPage (no canvas scope) is unchanged.

Client canvas passed to the helper is `{ nodes: deps.nodes.value mapped to {id,type,data} }`. `compositionRunGroup` is omitted on the client (Task 9 / `flowToCanvasData` not expanded). Server session canvas already persists `compositionRunGroup`.

## TDD evidence

### Shared `compositionVideo.test.ts`

**RED** (test file only, module missing):

```
FAIL  src/canvas/compositionVideo.test.ts
Error: Cannot find module './compositionVideo'
```

**GREEN** after implement + re-export:

```
✓ src/canvas/compositionVideo.test.ts (7 tests)
Test Files  1 passed (1)
```

Includes the brief case: nodes `image-i0`, `image-look-0`, `text-p` prompt `NEW SCRIPT`, `video-v` prompt `OLD` → `{ prompt: 'NEW SCRIPT' }`. Empty `text-p` → `empty_p_block_v`. Also covers run-group text fallback, video-node fallback, missing video node → `{ prompt: '' }`, and `content` when `prompt` is empty.

### Nest `video-generation-request.util.test.ts`

**RED** (tests added, util not wired):

```
× replaces video node snapshot with live text-p prompt
  expected 'OLD' to be 'NEW SCRIPT'
× throws when composition text-p is empty
  expected function to throw an error, but it didn't
```

**GREEN** after wiring `resolveCompositionVideoPrompt` in `resolveVideoStartRequest`:

```
✓ src/studio/video-generation-request.util.test.ts (6 tests)
```

### Web `useNodeGeneration.test.ts`

**RED:**

```
× canvas video generate reads live text-p instead of video snapshot
  expected 'OLD' to be 'NEW SCRIPT'
× blocks video generate when text-p is empty
  expected spy not to be called, but called 1 times with "OLD"
× shot-linked video generate reads live text-p prompt
  expected canvasApi.generateVideo prompt 'NEW SCRIPT', received 'OLD'
```

**GREEN** after wiring:

```
✓ src/composables/useNodeGeneration.test.ts (57 tests)
```

## Commands run (focused, as dispatched)

```
pnpm --filter @lnkpi/shared test src/canvas/compositionVideo.test.ts
pnpm --filter @lnkpi/server test src/studio/video-generation-request.util.test.ts
pnpm --filter @lnkpi/web test src/composables/useNodeGeneration.test.ts
```

Did not run the full studio integration suite.

## Self-review

- Shared resolver matches the dispatch contract; `text-p` wins over video snapshot.
- Canvas V uses `startVideoGeneration`, not shot `generateVideo` ~1074. Both canvas V and shot-child video paths resolve live P.
- Empty P is rejected on client (no API) and on Nest start/generate (400) before points consume.
- Did not implement Dock run-group, L0, Explore, or `flowToCanvasData` extras.

## Concerns

1. **Client omits `compositionRunGroup`.** Live P still works via node id `text-p`. Run-group fallback is covered on the server (session canvas) and in the shared unit tests. Client fallback without `text-p` would use the video node prompt until Task 9 lands run-group on the client canvas.
2. **`VideoGenerationOrchestrator.start` still persists `request.prompt` onto the video node** (`update_node` with `prompt`). That can copy live P onto V after start. Subsequent generates still prefer live `text-p`, so this does not restore snapshot-as-source-of-truth. Out of scope to change persist.
3. **Shot-node `generateShot` (~1074) is unchanged.** Composition V is a video node, not a shot generate.
4. **Prisma mock** `createPrismaMock()` now includes `session.findUnique → null` so `generateVideo` with canvas scope does not throw in unit tests that lack a session row.

## Files

- Create: `packages/shared/src/canvas/compositionVideo.ts`
- Create: `packages/shared/src/canvas/compositionVideo.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/studio/video-generation-request.util.ts`
- Modify: `apps/server/src/studio/video-generation-request.util.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.test-utils.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

## Fix

**Problem:** `resolveVideoStartRequest` called `resolveCompositionVideoPrompt` whenever `canvas && nodeId`. Missing video node and no P block returns `{ prompt: '' }`, which overwrote the body prompt instead of falling through. `startVideoGeneration` always passes a parsed canvas (empty if JSON is missing), so the client live prompt was wiped and the orchestrator reported `节点缺少 prompt`.

**Change:** Only replace `request.prompt` when a composition P block is actually used (`text-p` or a run-group text node). If the video node is missing and there is no P, keep the original body-prompt fallback. Empty P still throws `empty_p_block_v` / `分镜还是空的，写好后再生成视频。`.

**Test added:** canvas exists, `nodeId` not in canvas, body has a prompt → resolved request keeps that prompt.

### Covering tests

- `apps/server/src/studio/video-generation-request.util.test.ts`
- `packages/shared/src/canvas/compositionVideo.test.ts`

### Commands + output

```
pnpm --filter @lnkpi/server test src/studio/video-generation-request.util.test.ts
```

RED (test only, before util change):

```
 ❯ src/studio/video-generation-request.util.test.ts (7 tests | 1 failed)
   × resolveVideoStartRequest > keeps body prompt when canvas exists but video node and P block are absent
     → expected '' to be 'body prompt'
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

GREEN after util change:

```
 RUN  v3.2.7 /Users/4seven/workspace/lnkpi/apps/server

 ✓ src/studio/video-generation-request.util.test.ts (7 tests) 8ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  21:00:26
   Duration  1.81s (transform 475ms, setup 0ms, collect 1.14s, tests 8ms, environment 0ms, prepare 170ms)
```

```
pnpm --filter @lnkpi/shared test src/canvas/compositionVideo.test.ts
```

```
 RUN  v3.2.7 /Users/4seven/workspace/lnkpi/packages/shared

 ✓ src/canvas/compositionVideo.test.ts (7 tests) 12ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  21:00:29
   Duration  794ms (transform 118ms, setup 0ms, collect 100ms, tests 12ms, environment 0ms, prepare 242ms)
```
