# Task 4 Report
Status: 完成 generation-adapter 视频扩展与公共导出。
Commit: `3a06fa6 feat(agent): native video refs for seedance and agnes keyframes`
Tests: `pnpm --filter @lnkpi/agent test -- generation-adapter.test.ts`（16 passed）。
Build: `pnpm --filter @lnkpi/agent build` 与 `pnpm build` 通过。
Concerns: Server/Provider 接线属于后续 Task 5/6；本任务仅提供 providerOptions。

## Review Fix
Status: 已统一提示词与 provider 使用的有效引用 bundle，并在首尾帧过滤后推断场景。
Tests: `pnpm --filter @lnkpi/agent test -- generation-adapter.test.ts`（18 passed）。
Build: `pnpm build` 通过。

## Second Review Fix
Status: `ensureSeedanceRefTags` 先剥离超出 bundle 的 @Image/@Video/@Audio/@图片 标签，再用 `\b` 精确匹配补全缺失标签（修复 @Image10 误匹配 @Image1）。
Commit: `fix(agent): sanitize out-of-range seedance ref tags in prompt`
Tests: `pnpm --filter @lnkpi/agent test -- generation-adapter.test.ts`（20 passed）。
