# Task 6 Report: S8 Continue Shot — lastFrameUrl Writeback + 「接下一段」(G-08)

**Status:** ✅ Complete  
**Branch:** `feature/i2v-capability-productization`  
**Commit:** `52c80a9` — `feat(web): persist lastFrameUrl and add continue-shot action for Seedance`

## Summary

Verified Apimart `lastFrameUrl` already flows through `applyStudioRecord` for completed video records; added regression test. Added Seedance-only「接下一段」button that creates a sibling video node pre-wired with the prior segment's last frame as an image ref, preserving prompt/settings and auto-connecting an edge.

## Changes

| File | Change |
|------|--------|
| `apps/web/src/composables/useNodeGeneration.test.ts` | New test: completed video record metadata → `patchNodeData({ lastFrameUrl })` |
| `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` | `showContinueShotButton` when `node.data.lastFrameUrl` + `supportsReturnLastFrame`;「接下一段」button emits `continueShot` |
| `apps/web/src/components/canvas/dock-studio/DockStudioRouter.vue` | Pass through `continueShot` emit |
| `apps/web/src/components/canvas/DockStudioToolbar.vue` | Pass through `continueShot` emit |
| `apps/web/src/pages/CanvasPage.vue` | `handleContinueShot()` — sibling video node + localRef from lastFrame + edge from self |

## Behavior

### lastFrameUrl writeback (verified, no code change needed)

`useNodeGeneration.applyStudioRecord` already patches `lastFrameUrl` from `parseRecordLastFrameUrl(record)` when `record.type === 'video'` and status is `completed`.

### 「接下一段」 workflow

1. Visible when node has `lastFrameUrl` and model capabilities include `supportsReturnLastFrame` (Seedance).
2. Click creates a new video node to the right of the current node.
3. New node inherits prompt, `videoModel`, `videoSettings`; sets `videoMode: image_to_video`.
4. Adds local ref `{ label: 上一镜末帧, url: lastFrameUrl }`.
5. Auto edge: `source → sibling`.

Existing「延续上一镜」(upstream `lastFrameUrl`) remains unchanged.

## Test Summary

| Command | Result |
|---------|--------|
| `pnpm exec vitest run src/composables/useNodeGeneration.test.ts` | ✅ 42/42 passed |
| `pnpm build` | ✅ Passed |

## Gap Register

| Gap ID | Status |
|--------|--------|
| G-08 S8 连续镜 lastFrameUrl + 接下一段 | ✅ Covered |
