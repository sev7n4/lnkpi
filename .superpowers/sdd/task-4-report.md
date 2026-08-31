# Task 4 Report: PointsService structured ledger meta + balanceAfter

**Status:** Complete
**Branch:** `feat/points-stats-personal-center`

## Summary

- Added optional `PointTxMeta` parameters to `consume` and `refund`.
- Explicit metadata is persisted without reason-based category overrides.
- Omitted metadata is derived through `mapReasonToPointFields` using the signed transaction amount.
- Both operations read the post-update balance in the same transaction and persist it as `balanceAfter`.
- Existing call sites remain source-compatible; no studio/canvas call sites were rewritten.

## TDD Evidence

1. Updated `points.service.test.ts` first with explicit metadata, fallback mapping, and `balanceAfter` assertions.
2. Red run: 4 expected assertion failures because structured fields were absent.
3. Green run: `points.service.test.ts` passed 6/6.

## Verification

- `pnpm --filter @lnkpi/server test -- src/points`: 4 files, 26/26 tests passed.
- `pnpm --filter @lnkpi/server build`: passed.
- `pnpm build`: passed all workspace builds; Vite emitted existing chunk-size and third-party annotation warnings only.

## Self-review

- Insufficient-balance behavior remains atomic and creates no ledger row.
- Non-positive consume/refund behavior remains a no-op.
- Nullable `model`, `generationId`, and missing user balance are normalized to `null`.
- No optional `grant` method was added; membership integration remains in Task 6.

## Concerns

None blocking. Refund still preserves its existing behavior when the user update matches no row; this task did not change that contract.
