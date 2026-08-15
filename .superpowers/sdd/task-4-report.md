# Task 4 Report: RefStrip Role Labels + videoMode Validation (G-09)

**Status:** ✅ Complete  
**Branch:** `feature/i2v-capability-productization`  
**Commit:** _(see git log after commit)_

## Summary

Implemented ref role badges on `DockRefStrip`, pre-generate validation in `VideoDockPanel`, and unit/component tests per plan Task 4.

## Changes

| File | Change |
|------|--------|
| `apps/web/src/components/canvas/dock-studio/shared/dockRefRoleLabels.ts` | **New** — pure helpers: `resolveRefRoleLabel`, `countValidImageRefs`, `hasUnsupportedMediaRefs` |
| `apps/web/src/components/canvas/dock-studio/shared/dockRefRoleLabels.test.ts` | **New** — 7 unit tests for role label matrix |
| `apps/web/src/components/canvas/dock-studio/shared/DockRefStrip.test.ts` | **New** — mount test: 2 image refs + `first_last_frame` → 首帧/末帧 |
| `apps/web/src/components/canvas/dock-studio/shared/DockRefStrip.vue` | Accept `videoMode`; compute and pass `roleLabel` to chips |
| `apps/web/src/components/canvas/dock-studio/shared/DockRefChip.vue` | Render bottom role badge (首帧/末帧/参考/运镜/音频) |
| `apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue` | Optional `title` prop for disabled tooltip |
| `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` | Pass `videoMode` to strip; disable generate when FLF ≠ 2 images; warning banner for unsupported V/A refs |

## Role Label Matrix

| Condition | @I1 | @I2 | @V1 | @A1 |
|-----------|-----|-----|-----|-----|
| `first_last_frame` + 2 images | 首帧 | 末帧 | 运镜 | 音频 |
| `image_to_video` + N images | 参考 | 参考 | 运镜 | 音频 |

## Validation Rules

1. **`first_last_frame` + image ref count ≠ 2** → generate button disabled, tooltip: 「严格首尾帧模式需要恰好 2 张参考图」
2. **V/A refs present but `!supportsVideoRef` / `!supportsAudioRef`** → amber warning banner: 「当前模型不支持视频/音频参考，请换 Seedance」

## Test Summary

| Command | Result |
|---------|--------|
| `pnpm exec vitest run src/components/canvas/dock-studio/shared/dockRefRoleLabels.test.ts src/components/canvas/dock-studio/shared/DockRefStrip.test.ts` | ✅ 8/8 passed |
| `pnpm --filter @lnkpi/web build` | ❌ Pre-existing TS errors in `VideoSettingsSelector.vue` (Task 3), unrelated to Task 4 |

## Gap Register

| Gap ID | Status |
|--------|--------|
| G-09 | ✅ Covered |
