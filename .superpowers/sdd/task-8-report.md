# Task 8 Report: API Docs + refs×videoMode Integration Tests (G-12)

**Status:** ✅ Complete  
**Branch:** `feature/i2v-capability-productization`  
**Commit:** _(pending)_

## Summary

Added appendix §A to the I2V audit spec documenting `POST /studio/video/start` refs × videoMode example matrix (S2/S4/S5/S6) with JSON request samples and refWire routing table. Created server integration tests that exercise the canonical request → bundle → `buildVideoProviderOptions` path for each matrix row.

## Changes

| File | Change |
|------|--------|
| `docs/superpowers/specs/2026-08-15-i2v-upstream-capability-audit-design.md` | Appendix §A: scenario matrix, 4 JSON examples, refWire routing table |
| `apps/server/src/studio/video-generation.integration.test.ts` | New: 4 integration tests for G-12 matrix rows |

## Matrix Coverage

| videoMode | refs | scenario | Assertions |
|---|---|---|---|
| `image_to_video` | 1×I | S2 | `apimart_multimodal`, `returnLastFrame`, `referenceImages` |
| `first_last_frame` | 2×I | S5 | `apimart_first_last`, `imageWithRoles` first/last |
| `image_to_video` | 2×I | S4 | `apimart_multimodal`, 2× `referenceImages` |
| `text_to_video` | 1×V | S6 | `apimart_multimodal`, `refVideoMode: native`, `referenceVideos` |

## Test Summary

| Command | Result |
|---------|--------|
| `pnpm exec vitest run src/studio/video-generation.integration.test.ts` (apps/server) | ✅ 4/4 passed |

## Gap Register

| Gap ID | Status |
|--------|--------|
| G-12 API 缺 refs+videoMode 组合说明 | ✅ Covered |
