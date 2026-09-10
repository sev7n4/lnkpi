# Task 8 Report: Agent `saveNodeToAssetLibrary` 同路径

## Status
**Done**

## Changes

### `apps/server/src/agent/agent-canvas-tools.service.ts`
- Injected `PersistRemoteService`.
- Replaced `prisma.userAsset.upsert` with `persistRemote.persistRemote`.
- Returns `{ assetId, url: persistedUrl, kind }` (`replaceNodeUrl: false`).

### `apps/server/src/agent/agent.module.ts`
- Imported `AssetsModule` so `PersistRemoteService` is available to `AgentCanvasToolsService`.

### Tests
- `agent-canvas-tools.service.test.ts`: mock `PersistRemoteService`; 3 cases for save (persisted url, 503 propagation, missing URL).
- `agent-canvas-tools.sidebar.test.ts`: provide `PersistRemoteService` mock for DI.

## Verification

```bash
pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.test.ts src/agent/agent-canvas-tools.sidebar.test.ts
# ✓ 62 passed (58 + 4)
```

## Commit

```
feat(server): agent save_node_to_asset_library uses persist-remote
```

## Concerns / Follow-ups
- When adapter is unconfigured, 503 propagates from `PersistRemoteService` (via storage `putStream`); agent tool no longer writes upstream URL as a successful library entry.
- `replaceNodeUrl: false` keeps canvas node URL unchanged after agent save (same as prior upsert behavior for the node itself).
