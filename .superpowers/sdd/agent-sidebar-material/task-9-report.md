# Task 9 Report: AgentAssetPicker

**Status:** Done  
**Date:** 2026-08-07

## Summary

The Agent sidebar now provides a light asset-library dialog through the `[📁]` action. Selecting one of the user's image, video, or audio assets adds it to the pending reference strip as a `sourceKind: 'asset'` attachment.

## Changes

| File | Change |
|------|--------|
| `apps/web/src/components/agent/AgentAssetPicker.vue` | New searchable asset-library dialog that loads user assets and emits a normalized sidebar attachment on selection. |
| `apps/web/src/components/agent/AgentSideRail.vue` | Added the `[📁]` action and wired picker results to `sidebar.addFromPayload()`. |
| `apps/web/src/components/agent/AgentAssetPicker.test.ts` | Added a component test for the selected asset payload. |

## Test results

```bash
pnpm --filter @lnkpi/web test -- AgentAssetPicker.test.ts
# 1 passed

pnpm --filter @lnkpi/web exec vue-tsc -b
# passed
```

## Commit

```text
feat(web): agent sidebar asset library picker
```
