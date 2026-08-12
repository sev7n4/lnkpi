# PR-4: Agent turn metadata persist

**Branch:** `feature/agent-turn-metadata-persist`

## Tasks

- [ ] Prisma `AgentMessage.metadata`
- [ ] `@lnkpi/shared` `AgentMessageMetadata` type
- [ ] `agent.service.ts` collect + finalizeTurn
- [ ] `executionTraceReducer.replayExecutionTraceEvents`
- [ ] `agent.ts` loadHistory + `AgentSideRail` history presentation

## Test

```bash
pnpm build
pnpm --filter @lnkpi/server exec vitest run src/agent/agent.service.test.ts
```
