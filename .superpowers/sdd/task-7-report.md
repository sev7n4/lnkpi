# Task 7 Report: Studio/Canvas PointTxMeta

**Status:** Complete
**Branch:** `feat/points-stats-personal-center`

## Summary

- Added `consumeMeta` and `refundMeta` helpers beside `PointTxMeta`.
- Wired explicit transaction metadata into every `PointsService.consume` and `refund`
  call in studio, canvas material, and scene composer services.
- Applied text/image/audio/video categories to direct generation, `other` to scene
  composer batches, and image/video-or-other classification to platform fallback.
- Added available model and generation IDs; pre-record charges use
  `generationId: null`.
- Updated affected point, studio, material, and scene composer tests.

## TDD Evidence

- Added helper and call-site expectations first.
- Red run: helper tests failed with `consumeMeta/refundMeta is not a function`.
- Green run: required suite passed 9 files and 68 tests.

## Verification

- `pnpm --filter @lnkpi/server exec vitest run src/points src/membership src/studio/studio.fallback.test.ts src/canvas/material.fallback.test.ts`
  passed: 9 files, 68 tests.
- `pnpm --filter @lnkpi/server build` passed.
- `pnpm build` passed all workspace builds; existing Vite annotation/chunk warnings only.
- `git diff --check` passed.

## Self-review

- All charge/refund sites in the three task services pass a fourth argument.
- Refund status mapping uses `failed_refund`, `cancelled_refund`, or `byok_refund`.
- `PointsService` metadata remains optional for compatibility.
- Unrelated untracked `apps/server/prisma/prisma/` content was not modified or staged.

## Concerns

None blocking.
# Task 7 Report: Advanced Options seed / negative_prompt (G-06)

**Status:** ✅ Complete  
**Branch:** `feature/i2v-capability-productization`  
**Commit:** _(see git log after commit)_

## Summary

Exposed optional `seed` and `negativePrompt` across the canonical video generation pipeline: shared types → server DTO/orchestrator → generation adapter → Web Dock advanced panel.

## Changes

| File | Change |
|------|--------|
| `packages/shared/src/videoGeneration/types.ts` | Added optional `seed?`, `negativePrompt?` on `CanonicalVideoGenerationRequest` |
| `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts` | Read `seed` / `negativePrompt` from node data |
| `packages/shared/src/studioModelCatalog.ts` | Agnes catalog: `seed` + `negativePrompt` marked `native` |
| `apps/server/src/studio/video-generation-request.util.ts` | DTO fields + body → canonical mapping |
| `apps/server/src/studio/video-generation.orchestrator.ts` | Pass advanced options to `StudioService.generateVideo` |
| `apps/server/src/studio/studio.service.ts` | Forward to `buildVideoProviderOptions` |
| `apps/server/src/studio/studio.controller.ts` | `GenerateVideoDto` + `/video/generate` pass-through |
| `packages/agent/src/studio/generation-adapter.ts` | Native pass-through via catalog `params`; droppedFields when unsupported |
| `apps/web/src/services/studio-api.ts` | `startVideoGeneration` body fields |
| `apps/web/src/composables/useNodeGeneration.ts` | Read node data → API |
| `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` | Collapsible「高级」section (default collapsed): Seed + Negative prompt |

## Behavior

- **Seedance:** `seed` forwarded when catalog marks `seed: native`; `negativePrompt` dropped (metadata) — APIMart provider has no negative field.
- **Agnes:** both `seed` and `negativePrompt` forwarded to `AgnesVideoProvider` (`seed`, `negative_prompt` body fields).
- **UI:** values stored on node (`seed`, `negativePrompt`); patched before generate.

## Test Summary

| Command | Result |
|---------|--------|
| `pnpm build` | ✅ Pass |
| `pnpm --filter @lnkpi/shared exec vitest run src/videoGeneration/resolveCanonicalVideoRequest.test.ts` | ✅ 7/7 |
| `pnpm --filter @lnkpi/agent exec vitest run src/studio/generation-adapter.test.ts` | ✅ 32/32 |
| `cd apps/server && pnpm exec vitest run src/studio/video-generation-request.util.test.ts src/studio/studio.integration.test.ts` | ✅ 17/17 |

New assertions:
- Body/canonical mapping for seed + negativePrompt
- Adapter native pass-through (Seedance seed, Agnes both)
- Integration: Agnes `generateVideo` forwards seed/negativePrompt to mocked provider

## Gap Register

| Gap ID | Status |
|--------|--------|
| G-06 | ✅ Covered |
