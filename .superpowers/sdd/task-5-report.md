# Task 5 Report: Verify + Checklist

**Branch:** `fix/fallback-pending-dock-cancel`  
**Date:** 2026-09-12  
**Scope:** Verification only — no new feature code

---

## Step 1: Focused Vitest

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/constants/dockStudio.test.ts \
  src/utils/generationPollGate.test.ts \
  src/composables/useNodeGeneration.test.ts \
  src/components/canvas/dock-studio/shared/dockFailureChip.test.ts \
  src/components/canvas/nodeTaskChrome.test.ts
```

| Result | Detail |
|--------|--------|
| **PASS** | 5 files, 67 tests, 0 failures |
| Duration | ~5.8s |

---

## Step 2: Spec Checklist

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | `fallback_pending` → Dock 停止方块不再亮（`isDockGenerateBusy` false） | ✅ done | `dockStudio.ts` L53–55: only `generating` returns true; test L26–28; `CanvasPage.vue` L2781 uses helper for `selectedNodeGenerating` |
| 2 | cancel pending → `cancelPlatformFallback` + 节点 `error` | ✅ done | `useNodeGeneration.ts` L367–378 (`cancelFallbackPendingNodes`); tests L960–997 (studio + material + shot child) |
| 3 | poll 不把 `error` 写回 `fallback_pending` | ✅ done | `generationPollGate.ts` L37–43 blocks incoming `fallback_pending` when node is `error`/`failed`; test L50–58 |
| 4 | confirm 平台回退 happy path 测试仍绿 | ✅ done | `useNodeGeneration.test.ts` L341 `invokes requestFallbackConfirm and confirm API on studio fallback_pending` — PASS |
| 5 | `isNodeGenerating(fallback_pending)` 仍为 true（只读锁） | ✅ done | `dockStudio.ts` L45–49 unchanged; test L9–11 |

---

## Step 3: Plan Doc

| Item | Status |
|------|--------|
| `docs/superpowers/plans/2026-09-12-fallback-pending-dock-cancel.md` committed | ✅ already tracked (`git ls-files`) |
| Push branch | ⏭ skipped (not requested) |
| PR | ⏭ skipped (not requested) |

---

## Commits This Task

None — all tests passed; no code fixes required.

---

## Concerns

None. All spec checklist items verified against code and passing tests.

---

## Related Commits (Tasks 1–4)

```
0224186 fix(web): block poll from reviving fallback_pending after error
7061836 fix(web): cancel fallback_pending via cancelPlatformFallback
48e465b fix(web): stop treating fallback_pending as Dock generating
83ea683 feat(web): add isDockGenerateBusy for Dock stop-button state
```

## Final review fixes

- `apps/web/src/pages/CanvasPage.vue:528-532`：material poll 写入 `fallback_pending` 前校验子节点仍接受 poll write。
- `apps/web/src/composables/useNodeGeneration.ts:342-432`：取消前快照节点状态及任务 ID，响应后仅更新仍指向同一 pending 任务的节点；解析结构化失败信息，并吞掉 `saveCanvas` 持久化失败以避免未处理 rejection。
- `apps/web/src/composables/useNodeGeneration.ts:435-449, 691-733, 1162-1176, 1236-1254`：新生成前 best-effort 取消旧 studio/material fallback，再继续生成；legacy fan-out 同时排除 recordId 与 materialId。
- `apps/web/src/composables/useNodeGeneration.test.ts:999-1112`：覆盖结构化取消失败、异步取消竞态，以及 studio/material pending 重新生成清理。

测试命令：

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/constants/dockStudio.test.ts \
  src/utils/generationPollGate.test.ts \
  src/composables/useNodeGeneration.test.ts \
  src/components/canvas/dock-studio/shared/dockFailureChip.test.ts \
  src/components/canvas/nodeTaskChrome.test.ts
```

结果：5 个测试文件通过，71 个测试通过，0 失败。`pnpm --filter @lnkpi/web exec vue-tsc --noEmit` 通过。

剩余关注：无。
