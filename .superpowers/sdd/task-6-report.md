# Task 6 实施报告：Server Studio + Material 视频接线

## 完成内容

- Studio 与 Material 视频生成均改用 `buildVideoReferenceBundle` 组装图片、视频、音频引用。
- 视频 prompt 合并向 `mergeRefsToPrompt` 传入图片引用描述，并通过 `buildEffectiveVideoPrompt` 生成含引用标签及一致性约束的最终提示词。
- 使用 `buildVideoProviderOptions` 与 `buildVideoProviderGenerateOptions` 生成完整 provider 参数，并原样传给 `createVideoProvider().generate()`。
- Material 支持在 refs 缺少图片时使用节点 `referenceImageUrl` 作为后备引用图。
- 图片、视频、音频引用 URL 均经过公共媒体地址解析；有效引用数组写入生成元数据，供失败回退链路保留。
- 仅提供参考音频时，在扣费和创建生成记录前抛出 `BadRequestException('参考音频须配合参考图或视频')`。

## 测试覆盖

- Studio：完整图片/视频/音频引用、视频合并图片描述、有效 prompt、完整 providerOptions、仅音频拒绝。
- Material：完整引用链路、节点后备参考图、仅音频扣费前拒绝、BYOK fallback prompt 与引用保留。

## 验证结果

- `pnpm --filter @lnkpi/server test -- studio.fallback.test.ts studio.integration.test.ts material.fallback.test.ts material.service.test.ts`
  - 4 个测试文件、49 项测试全部通过。
- `pnpm --filter @lnkpi/server build`
  - 通过。
- `pnpm build`
  - shared、agent、web、server 全仓构建通过。
- 编辑文件 IDE lint
  - 无诊断。

# Task 6 Report: Frontend store — loadHistory + linkedOutputs

**Branch:** `feat/agent-conversation-isolation`  
**Commit:** `feat(web): agent store linkedOutputs in loadHistory`

## Summary

Extended the Pinia agent store so `loadHistory` parses persisted `linkedOutputs` JSON into typed `LinkedCanvasOutput[]` on each message, and always replaces the in-memory messages array (no append/merge).

## Changes

| File | Action |
|------|--------|
| `apps/web/src/stores/agent.ts` | **Modified** — `AgentStreamMessage.linkedOutputs`, `parseLinkedOutputs()`, updated `loadHistory()` |
| `apps/web/src/stores/agent.test.ts` | **Modified** — tests for linkedOutputs restore + replace semantics |

## API

```typescript
export interface AgentStreamMessage {
  // ...
  linkedOutputs?: LinkedCanvasOutput[]
}

function parseLinkedOutputs(raw: string | undefined | null): LinkedCanvasOutput[] | undefined
// JSON.parse → validate each item with LinkedCanvasOutputSchema → undefined if empty/invalid

function loadHistory(history: AgentChatMessage[]): void
// messages.value = history.map(...) — full replace, not append
```

## Verification

```bash
pnpm --filter @lnkpi/web test agent.test.ts
```

```
✓ src/stores/agent.test.ts (4 tests)
Test Files  1 passed (1)
Tests       4 passed (4)
```

## Notes

- `AgentChatMessage` in `@lnkpi/shared` does not yet declare `linkedOutputs?: string`; store uses local `PersistedAgentMessage` cast until shared type is extended.
- `clear()` unchanged — thread bootstrap in Task 7 will call `clear()` before `loadHistory()`.

## Status

- [x] Step 1: Extend `AgentStreamMessage` with `linkedOutputs`
- [x] Step 2: `loadHistory` always replaces messages + `parseLinkedOutputs`
- [x] Step 3: Tests + commit
