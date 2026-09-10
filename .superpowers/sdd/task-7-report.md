# Task 7 Report: 前端 `saveAssetToLibrary` 接线

## Status
**Done**

## Changes

### `apps/web/src/services/assets-api.ts`
- Added `PersistRemotePayload`, `PersistRemoteResult` types.
- Extended `SaveUserAssetPayload` with optional `sessionId`, `replaceNodeUrl`.
- Added `assetsApi.persistRemote()` → `POST /assets/persist-remote`.

### `apps/web/src/composables/useAssetLibrary.ts`
- Upstream URLs (`isUpstreamMediaUrl`) → `assetsApi.persistRemote`.
- Local `/api/uploads/` paths → `assetsApi.saveMine` (unchanged path).
- 503 responses show storage-not-configured message.

### Canvas call sites (optional `sessionId`)
- `CanvasNodeImage.vue`, `CanvasNodeVideo.vue`, `CanvasNodeAudio.vue` pass `sessionId` from route.

### Tests
- Created `useAssetLibrary.test.ts` (2 cases, TDD).

## Verification

```bash
pnpm --filter @lnkpi/web test -- useAssetLibrary
# ✓ 2 passed
```

## Commit

```
feat(web): persist upstream assets via persist-remote on save
```

## Concerns / Follow-ups
- `CanvasAssetPanel` upload path still calls `saveAssetToLibrary` without `sessionId` (acceptable per spec — backend scans all user sessions).
- No E2E against real COS; relies on server Task 5–6 + manual smoke when storage is configured.
