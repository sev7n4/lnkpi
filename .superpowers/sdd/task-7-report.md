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
