# Task 7 Report: 回归总验 + 规格状态

**Status:** DONE  
**Branch:** `fix/agent-sidebar-vision-provider-context`  
**PR:** https://github.com/sev7n4/lnkpi/pull/342

## Spec status

`docs/superpowers/specs/2026-09-16-agent-sidebar-vision-provider-context-design.md`  
header → **已定稿 / 实现完成（P0+P1）**（P2 仍另排期）

## Commit

`8ea4e6bc` — `docs: mark vision ProviderContext spec complete (P0+P1)`

## Regression results

### Server (provider-context + dock)

```bash
pnpm --filter @lnkpi/server exec vitest run \
  src/provider/provider-context.test.ts \
  src/agent/agent.service.dock.test.ts
```

- Test Files: 2 passed  
- Tests: **5 passed**

### Runtime (parse / nest)

`uv` 不在 PATH；改用主仓 `.venv` + worktree `PYTHONPATH`：

```bash
cd services/agent-runtime
PYTHONPATH="$PWD" \
  /Users/4seven/workspace/lnkpi/services/agent-runtime/.venv/bin/pytest \
  tests/test_parse_sidebar_media_node.py \
  tests/test_sidebar_media_parse.py \
  tests/test_nest_client.py -q
```

- **53 passed**, 1 pydantic deprecation warning

### Web (UniversalModelSelector)

```bash
cd apps/web && pnpm exec vitest run \
  src/components/canvas/UniversalModelSelector.test.ts
```

- Tests: **2 passed**

## AC-1…8

记在 PR #342 描述中（手工验收勾选）；自动化覆盖主要为 AC-2/3/5/6 相关单测路径。

## Push / PR

- `git push -u origin HEAD` → OK  
- `gh pr create` → https://github.com/sev7n4/lnkpi/pull/342

## Notes

- 未提交本地改动的 `.superpowers/sdd/task-6-report.md`（与本任务无关）。
- P2 未实施。

---

## Post-review Important fixes (I1 / I2)

**Status:** DONE  
**Date:** 2026-09-16

### I1 — AC-8 / shared `buildTextProviderContext`

- Extracted `providerContextFromResolved` (shared map/validate used by Agent `buildTextProviderContext`).
- Wired Studio canvas text paths (`generateText`, `generatePrompt`, `expandPromptContent`) via `textGenCreds` → same helper when `providerRef` is complete (no env overlay for BYOK).
- `agent-canvas-tools` already calls `studio.generateText`, so canvas node text inherits the shared contract.
- AC-8 unit test: same `providerRef` → Agent path vs canvas `providerContextFromResolved` yield identical `source`/`baseUrl`/`apiKey`.

### I2 — D-RETRY (no 5xx in Nest/`@lnkpi/agent`)

- `generateVisionQaJson`: `RETRYABLE_STATUSES = {429}` only; timeout/Abort errors still retry; **5xx hard-fail** (no retry).
- Tests: 500 not retried; 429 retries then succeeds; timeout retries then succeeds.

### Verification

```bash
pnpm --filter @lnkpi/agent exec vitest run src/refs/vision-qa-json.test.ts
# 8 passed

pnpm --filter @lnkpi/server exec vitest run \
  src/provider/provider-context.test.ts \
  src/agent/agent.service.dock.test.ts \
  src/studio/run-vision-qa-context.test.ts \
  src/studio/studio.fallback.test.ts
# 32 passed (4 files)
```

### Concerns

- Runtime still owns outer 429/timeout retry; Nest package now aligns on no-5xx (reduces amplification). Nested 429 retry (Runtime × Nest) remains possible but bounded by D-BUDGET 180s.
- Incomplete BYOK on canvas still falls through to existing `fallback_pending` path (helper throw → `textGenCreds` env/opts fallthrough); Agent 启 run remains fail-fast on incomplete Context.
