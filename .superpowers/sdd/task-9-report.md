# Task 9 Report: ProfilePage points cards

## Status

Implemented the ProfilePage points summary and ledger card UI against the Task 8 response contracts.

## Changes

- Added the `7d` / `month` / `all` range switcher, defaulting to the current month.
- Added text, image, audio, and video consumption cards with category filtering.
- Added visually distinct refund and grant cards with kind filtering, plus conditional other consumption.
- Migrated transactions to the wrapped `items` / `nextCursor` response and added pagination.
- Added transaction detail cards with reason, kind/category badges, signed amount, model, timestamp, and truncated generation ID.
- Added loading, retry, filtered empty, and clear-filter states.
- Preserved the existing profile, balance, membership, and dark neo styling.

## Verification

- `pnpm --dir apps/web build` (from the target worktree): passed.
- `git diff --check -- apps/web/src/pages/ProfilePage.vue`: passed.
- Self-review: no fake generation route was introduced; only a truncated ID is shown.

## Manual checklist

- [ ] Default view selects “本月”.
- [ ] Switching to “近 7 天” and “全部” refreshes summary and ledger.
- [ ] Clicking “图片” filters detail records; clicking again clears it.
- [ ] Consume/refund/grant chips and refund/grant cards filter records.
- [ ] Every detail card shows a timestamp; model and generation ID appear when available.
- [ ] Refund/grant summaries and positive/negative transaction amounts are visually distinct.
- [ ] Empty filters show “暂无该时间范围的账单记录”.

## Notes

No page test was added because this area has no existing page-test pattern; build/type-check and the manual checklist cover this UI task.
