# Agent 对话隔离、历史恢复与画布产出定位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐 Cursor 模型实现 Agent 对话 thread 隔离与完整历史；修复消息截断/双写丢失；侧栏支持对话列表、滚动恢复；assistant 消息下常驻画布产出定位（单条 + 批量）。

**Architecture:** DB 新增 `AgentThread` + `AgentMessage.threadId/linkedOutputs`；Nest 为消息唯一写入方并按 thread 读取最新 N 条；Runtime `_load_history` 仅加载当前 thread；前端 Pinia + `AgentSideRail` 管理 thread 切换/localStorage；新组件 `AgentCanvasOutputs` 聚合 `executionTrace`/task 状态并持久化 `linkedOutputs`；画布 `focusNodeById` 扩展节点 1.2s 高亮。

**Tech Stack:** Prisma、NestJS、Vue 3、Pinia、Python LangGraph agent-runtime、Vitest、pytest

**Spec:** [docs/superpowers/specs/2026-08-07-agent-conversation-isolation-design.md](../specs/2026-08-07-agent-conversation-isolation-design.md)

## Global Constraints

- **新建对话隔离聊天、不隔离画布**；threadId 格式 `{sessionId}:{randomSuffix}`（复用 `createAgentThreadId`）。
- 对话列表：**首条 user 消息截断 40 字 + `formatSessionTime` 相对时间**；按 `updatedAt` **降序**。
- `getMessages` 必须返回 per-thread **最新** 100 条（`desc` + `reverse`），禁止 `asc + take` 取最早。
- Nest **唯一** 写入 `AgentMessage`；Runtime 移除 `_save_user_message` / `_save_new_assistant_messages`。
- 定位按钮 **默认可见**；2s 一次性 pulse；画布节点 **1.2s** 高亮；首次 Toast `localStorage` 键 `lnkpi:agentLocateHintShown`。
- 批量 **>4 项** 默认展示 3 +「展开全部 N 项」；**仅完成 & 失败** 显示 `[定位]`。
- Legacy 消息回填 `threadId = '{sessionId}:legacy'`；不发消息不创建 `AgentThread`。
- Commit per task；PR 前：`pnpm --filter @lnkpi/shared build`、`pnpm --filter @lnkpi/web test`、`pnpm --filter @lnkpi/server test`、`cd services/agent-runtime && python -m pytest tests/ -q --tb=short`（或本 plan 涉及子集）。

## File map

| File | Role |
| --- | --- |
| `apps/server/prisma/schema.prisma` | `AgentThread`、`AgentMessage.threadId`、`linkedOutputs` |
| `apps/server/prisma/migrations/*` | 迁移 + legacy 回填 |
| `apps/server/src/agent/agent.service.ts` | getMessages/listThreads/upsertThread/finalizeTurn+linkedOutputs |
| `apps/server/src/agent/agent.service.test.ts` | 截断、thread 过滤、linkedOutputs |
| `apps/server/src/agent/agent.controller.ts` | threads API、messages query threadId |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | getAgentMessages(threadId) |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | internal API threadId |
| `services/agent-runtime/app/runs.py` | 移除双写；thread history |
| `services/agent-runtime/app/tools/nest_client.py` | get_agent_messages(threadId) |
| `services/agent-runtime/tests/test_runs_history.py` | **NEW** — 无双写、thread 隔离 |
| `packages/shared/src/agentContract.ts` | `LinkedCanvasOutput`、threads/messages schema |
| `packages/shared/src/agentContract.test.ts` | schema 单测 |
| `apps/web/src/stores/agent.ts` | linkedOutputs on messages、loadHistory clear |
| `apps/web/src/stores/agent.test.ts` | loadHistory + linkedOutputs |
| `apps/web/src/components/agent/AgentCanvasOutputs.vue` | **NEW** — 产出列表 + 定位 |
| `apps/web/src/components/agent/agentCanvasOutputs.ts` | **NEW** — 聚合 trace/task → outputs |
| `apps/web/src/components/agent/agentCanvasOutputs.test.ts` | 聚合 + 折叠逻辑 |
| `apps/web/src/components/agent/AgentSideRail.vue` | thread 列表、scroll、outputs |
| `apps/web/src/components/agent/streamRecovery.ts` | `lastThreadStorageKey` |
| `apps/web/src/utils/formatSessionTime.ts` | **NEW** — 从 WorkflowPage 抽出复用 |
| `apps/web/src/pages/CanvasPage.vue` | `focusNodesByIds`、节点高亮 |
| `apps/web/src/styles/neo-node.css` | `.neo-node-locate-flash` 1.2s |
| `deploy/prod-agent-thread-verify.py` | **NEW** — thread + messages + 定位 smoke |

---

### Task 1: Shared — `LinkedCanvasOutput` + API contract

**Files:**
- Modify: `packages/shared/src/agentContract.ts`
- Modify: `packages/shared/src/agentContract.test.ts`

**Interfaces:**
- Produces: `LinkedCanvasOutputSchema`, `AgentThreadSummarySchema`, `GetAgentMessagesQuery`（sessionId + threadId）

- [ ] **Step 1: Write failing tests**

```typescript
import { LinkedCanvasOutputSchema } from './agentContract'

it('parses linked output', () => {
  expect(
    LinkedCanvasOutputSchema.parse({
      nodeId: 'n1',
      title: '主图',
      nodeType: 'image',
      status: 'done',
    }),
  ).toMatchObject({ nodeId: 'n1', status: 'done' })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/shared test agentContract.test.ts`

- [ ] **Step 3: Implement schemas**

```typescript
export const LinkedCanvasOutputSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  nodeType: z.string(),
  status: z.enum(['running', 'done', 'failed']),
})
export type LinkedCanvasOutput = z.infer<typeof LinkedCanvasOutputSchema>

export const AgentThreadSummarySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/agentContract.ts packages/shared/src/agentContract.test.ts
git commit -m "feat(shared): add LinkedCanvasOutput and thread summary schemas"
```

---

### Task 2: Prisma — AgentThread + message columns

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev --name agent-thread-isolation`

**Interfaces:**
- Produces: tables `AgentThread`; `AgentMessage.threadId`, `AgentMessage.linkedOutputs`

- [ ] **Step 1: Update schema**（见 spec §3.1，Session 增加 `agentThreads AgentThread[]`）

- [ ] **Step 2: Migration SQL 含 legacy 回填**

```sql
-- 每个 session 一条 legacy thread
INSERT INTO "AgentThread" ("id", "sessionId", "title", "createdAt", "updatedAt")
SELECT DISTINCT "sessionId" || ':legacy', "sessionId", '早期对话', MIN("createdAt"), MAX("createdAt")
FROM "AgentMessage"
GROUP BY "sessionId";

UPDATE "AgentMessage" SET "threadId" = "sessionId" || ':legacy' WHERE "threadId" IS NULL;
```

- [ ] **Step 3: Run migration**

Run: `cd apps/server && npx prisma migrate dev`

- [ ] **Step 4: Commit**

```bash
git add apps/server/prisma/
git commit -m "feat(db): add AgentThread and message threadId/linkedOutputs"
```

---

### Task 3: Nest — fix getMessages + listThreads + upsertThread

**Files:**
- Modify: `apps/server/src/agent/agent.service.ts`
- Create: `apps/server/src/agent/agent.service.messages.test.ts`
- Modify: `apps/server/src/agent/agent.controller.ts`

**Interfaces:**
- Produces: `getMessages(sessionId, threadId, limit?)`, `listThreads(sessionId)`, `upsertAgentThread({ id, sessionId, title? })`

- [ ] **Step 1: Write failing test for latest-N ordering**

```typescript
it('returns latest messages for thread in asc order', async () => {
  // seed 120 messages for thread t1
  const rows = await service.getMessages('s1', 's1:abc', 100)
  expect(rows).toHaveLength(100)
  expect(rows[0].content).toBe('msg-21') // not msg-1
  expect(rows[99].content).toBe('msg-120')
})
```

- [ ] **Step 2: Implement getMessages**

```typescript
async getMessages(sessionId: string, threadId: string, limit = 100) {
  const rows = await this.prisma.agentMessage.findMany({
    where: { sessionId, threadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.reverse()
}

async listThreads(sessionId: string) {
  return this.prisma.agentThread.findMany({
    where: { sessionId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })
}

async upsertAgentThread(input: { id: string; sessionId: string; title?: string }) {
  const title = (input.title?.trim() || '新对话').slice(0, 40)
  return this.prisma.agentThread.upsert({
    where: { id: input.id },
    create: { id: input.id, sessionId: input.sessionId, title },
    update: { title, updatedAt: new Date() },
  })
}
```

- [ ] **Step 3: Controller routes**

```typescript
@Get('chat/threads')
async listThreads(@Query('sessionId') sessionId: string) {
  const data = await this.agentService.listThreads(sessionId)
  return { code: 0, message: 'ok', data }
}

@Get('chat/user/messages')
async getMessages(
  @Query('sessionId') sessionId: string,
  @Query('threadId') threadId: string,
) {
  const data = await this.agentService.getMessages(sessionId, threadId)
  return { code: 0, message: 'ok', data }
}
```

- [ ] **Step 4: streamConversation — threadId on create + upsert thread**

在 user message create 加 `threadId`；首条 user 时 `upsertAgentThread({ id: threadId, sessionId, title: userMessage })`。

- [ ] **Step 5: Run tests — PASS**

Run: `pnpm --filter @lnkpi/server test agent.service.messages.test.ts`

- [ ] **Step 6: Commit**

---

### Task 4: Nest — 消除双写 + linkedOutputs 持久化

**Files:**
- Modify: `apps/server/src/agent/agent.service.ts` — `finalizeTurn` 接受 `linkedOutputs`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` — `getAgentMessages({ sessionId, threadId })`
- Modify: `services/agent-runtime/app/runs.py` — 删除 `_save_user_message` / `_save_new_assistant_messages` 调用
- Modify: `services/agent-runtime/app/tools/nest_client.py` — `get_agent_messages(thread_id=...)`
- Create: `services/agent-runtime/tests/test_message_persistence.py`

**Interfaces:**
- Consumes: Task 3 `getAgentMessages(sessionId, threadId)`
- Produces: assistant row 含 `linkedOutputs` JSON

- [ ] **Step 1: pytest — runtime 不重复 save**

```python
async def test_stream_run_does_not_call_save_agent_message(mocker):
    save = mocker.patch("app.runs._save_user_message")
    # ... run minimal stream ...
    save.assert_not_called()
```

- [ ] **Step 2: Remove runtime duplicate saves**（runs.py L613、L751-761）

- [ ] **Step 3: nest_client.get_agent_messages 增加 thread_id query**

- [ ] **Step 4: finalizeTurn 写入 linkedOutputs**

```typescript
await this.prisma.agentMessage.create({
  data: {
    sessionId,
    threadId,
    role: 'assistant',
    content: assistantText,
    toolCalls: canvasActions.length ? JSON.stringify(canvasActions) : null,
    linkedOutputs: linkedOutputs?.length ? JSON.stringify(linkedOutputs) : null,
  },
})
await this.prisma.agentThread.update({
  where: { id: threadId },
  data: { updatedAt: new Date() },
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @lnkpi/server test` + `cd services/agent-runtime && python -m pytest tests/test_message_persistence.py -v`

- [ ] **Step 6: Commit**

---

### Task 5: Frontend utils — formatSessionTime + thread storage

**Files:**
- Create: `apps/web/src/utils/formatSessionTime.ts`
- Modify: `apps/web/src/pages/WorkflowPage.vue` — import util
- Modify: `apps/web/src/components/agent/streamRecovery.ts`

- [ ] **Step 1: Extract formatSessionTime**

```typescript
export function formatSessionTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return date.toLocaleDateString()
}

export function lastThreadStorageKey(sessionId: string) {
  return `lnkpi:agentThread:${sessionId}`
}
```

- [ ] **Step 2: Vitest for formatSessionTime**

- [ ] **Step 3: Commit**

---

### Task 6: Frontend store — loadHistory(threadId) + linkedOutputs

**Files:**
- Modify: `apps/web/src/stores/agent.ts`
- Modify: `apps/web/src/stores/agent.test.ts`

**Interfaces:**
- Produces: `loadHistory(messages: AgentChatMessage[])` 解析 `linkedOutputs`；`clear()` 不变

- [ ] **Step 1: Extend AgentStreamMessage**

```typescript
export interface AgentStreamMessage {
  // ...
  linkedOutputs?: LinkedCanvasOutput[]
}
```

- [ ] **Step 2: loadHistory always replaces messages**

```typescript
function loadHistory(history: AgentChatMessage[]) {
  messages.value = history.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    attachments: parseAttachments(m.attachments),
    linkedOutputs: parseLinkedOutputs(m.linkedOutputs),
  }))
}
```

- [ ] **Step 3: Tests + commit**

---

### Task 7: AgentSideRail — thread 列表、clear/scroll、loadHistory

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

- [ ] **Step 1: Replace historyPrompts with threads list**

- Fetch `GET /agent/chat/threads?sessionId=`
- 下拉展示 title + `formatSessionTime(updatedAt)`；当前 thread 高亮
- 点击切换：`agentThreadId`、localStorage、`loadHistory`、scrollToBottom

- [ ] **Step 2: Mount / sessionId watch / new canvas**

```typescript
async function bootstrapThread() {
  agent.clear()
  const cached = localStorage.getItem(lastThreadStorageKey(props.sessionId))
  if (cached) agentThreadId.value = cached
  else {
    const threads = await fetchThreads()
    agentThreadId.value = threads[0]?.id ?? createAgentThreadId(props.sessionId)
  }
  await loadHistory()
  scrollToBottom()
}

async function loadHistory() {
  agent.clear()
  const res = await fetch(
    apiUrl(`/api/agent/chat/user/messages?sessionId=${props.sessionId}&threadId=${encodeURIComponent(agentThreadId.value)}`),
  )
  const json = await res.json()
  if (json.data?.length) agent.loadHistory(json.data)
  scrollToBottom()
}
```

- [ ] **Step 3: newAgentSession — 缩短 toast**

`ElMessage.info('已新建对话')`

- [ ] **Step 4: openPanel → scrollToBottom**

- [ ] **Step 5: Manual smoke** — 新建画布空白、切换 thread、重进恢复

- [ ] **Step 6: Commit**

---

### Task 8: agentCanvasOutputs — 聚合逻辑

**Files:**
- Create: `apps/web/src/components/agent/agentCanvasOutputs.ts`
- Create: `apps/web/src/components/agent/agentCanvasOutputs.test.ts`

**Interfaces:**
- Produces: `buildCanvasOutputs(opts): LinkedCanvasOutput[]` — 合并 trace steps、taskProgress、persisted linkedOutputs

- [ ] **Step 1: Tests**

```typescript
it('dedupes by nodeId preferring latest status', () => {
  const out = buildCanvasOutputs({
    traceSteps: [{ meta: { nodeId: 'n1' }, label: '主图', status: 'done' }],
    taskItems: [{ nodeId: 'n1', title: '主图', status: 'running' }],
  })
  expect(out).toHaveLength(1)
  expect(out[0].status).toBe('running')
})

it('collapse threshold is 4', () => {
  expect(shouldCollapseOutputs(4)).toBe(false)
  expect(shouldCollapseOutputs(5)).toBe(true)
})
```

- [ ] **Step 2: Implement buildCanvasOutputs + parseLinkedOutputs fallback from toolCalls**

- [ ] **Step 3: Commit**

---

### Task 9: AgentCanvasOutputs.vue — UI + pulse + 批量定位

**Files:**
- Create: `apps/web/src/components/agent/AgentCanvasOutputs.vue`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Emits: `focusNode(nodeId: string)`, `focusAll(nodeIds: string[])`

- [ ] **Step 1: Template**（spec §10.2–10.3）

- Header: `画布产出 · N` + optional `[全部定位]`
- Row: status icon + type icon + title + `[定位]`（done/failed only）
- Running row: `生成中…` 无按钮
- `collapsed` state when >4

- [ ] **Step 2: Pulse once**

```vue
<button
  :class="['agent-locate-btn', { 'agent-locate-btn--pulse': justCompleted }]"
/>
```

```css
.agent-locate-btn--pulse {
  animation: agent-locate-pulse 2s ease-out 1;
}
```

- [ ] **Step 3: First-use toast**

```typescript
const LOCATE_HINT_KEY = 'lnkpi:agentLocateHintShown'
function maybeShowLocateHint() {
  if (localStorage.getItem(LOCATE_HINT_KEY)) return
  localStorage.setItem(LOCATE_HINT_KEY, '1')
  ElMessage.info('点击定位可在画布中找到对应节点')
}
```

- [ ] **Step 4: Wire in AgentSideRail** — assistant bubble 下、`executionTrace` 之上

- [ ] **Step 5: Live turn — feed from trace + taskProgress; streaming 更新 outputs**

- [ ] **Step 6: Commit**

---

### Task 10: CanvasPage — focusAll + 节点 1.2s 高亮

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Modify: `apps/web/src/styles/neo-node.css`

- [ ] **Step 1: CSS one-shot flash**

```css
.neo-node-locate-flash {
  animation: neo-node-locate-flash 1.2s ease-out 1;
}
@keyframes neo-node-locate-flash {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  30% { box-shadow: 0 0 0 3px var(--neo-accent-border); }
}
```

- [ ] **Step 2: flashNodeIds ref + provide/inject or event bus**

```typescript
const locateFlashNodeIds = ref<Set<string>>(new Set())

async function focusNodeById(id: string) {
  selectOnlyNode(id)
  await vueFlowRef.value?.fitView({ nodes: [id], padding: 0.45, duration: 320, maxZoom: 1.05 })
  triggerLocateFlash([id])
}

async function focusNodesByIds(ids: string[]) {
  const valid = ids.filter((id) => nodes.value.some((n) => n.id === id))
  if (!valid.length) {
    ElMessage.warning('当前画布中没有找到对应节点')
    return
  }
  if (valid.length === 1) return focusNodeById(valid[0])
  selectOnlyNode(valid[0])
  await vueFlowRef.value?.fitView({ nodes: valid, padding: 0.55, duration: 360, maxZoom: 1.0 })
  triggerLocateFlash(valid)
}

function triggerLocateFlash(ids: string[]) {
  locateFlashNodeIds.value = new Set(ids)
  setTimeout(() => { locateFlashNodeIds.value = new Set() }, 1200)
}
```

- [ ] **Step 3: NeoBaseNode（或 wrapper）绑定 `:class="{ 'neo-node-locate-flash': locateFlashNodeIds.has(id) }"`**

- [ ] **Step 4: AgentSideRail `@focus-all="focusNodesByIds"`**

- [ ] **Step 5: Commit**

---

### Task 11: Stream path — collect linkedOutputs for finalizeTurn

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` — 在 turn 结束收集 outputs 随 API 或让 Nest 从 canvasActions 推导
- Modify: `apps/server/src/agent/agent.service.ts` — 从 `canvasActions` + `add_node` 推导 `linkedOutputs`（Nest 侧更可靠）

**Interfaces:**
- Produces: `deriveLinkedOutputs(canvasActions: CanvasAction[]): LinkedCanvasOutput[]`

- [ ] **Step 1: Nest helper**

```typescript
function deriveLinkedOutputs(actions: CanvasAction[]): LinkedCanvasOutput[] {
  return actions
    .filter((a) => a.type === 'add_node' && a.payload?.id)
    .map((a) => ({
      nodeId: a.payload.id,
      title: String(a.payload.data?.title || a.payload.data?.prompt || '未命名').slice(0, 20),
      nodeType: String(a.payload.nodeType || 'image'),
      status: 'done' as const,
    }))
}
```

- [ ] **Step 2: Merge with node_status SSE updates** — 前端 live 用 trace；持久化用 Nest 推导 + 可选 POST body `linkedOutputs` 二期

- [ ] **Step 3: Test deriveLinkedOutputs**

- [ ] **Step 4: Commit**

---

### Task 12: Integration verify script

**Files:**
- Create: `deploy/prod-agent-thread-verify.py`

- [ ] **Step 1: Script flow**

1. Login → create session
2. POST conversation with threadId A → assert 1 user + 1 assistant in DB
3. GET messages(thread A) → count 2
4. POST conversation thread B → GET messages(thread A) unchanged; thread B isolated
5. GET threads → 2 entries, desc updatedAt
6. GET messages limit 100 on seeded thread → latest wins

- [ ] **Step 2: Run locally against dev**

- [ ] **Step 3: Commit**

```bash
git add deploy/prod-agent-thread-verify.py
git commit -m "test(deploy): agent thread isolation verify script"
```

---

## Spec self-review

| Spec § | Task |
| --- | --- |
| §0 决策摘要 | All tasks |
| §1 丢失 P0 | Task 3, 4 |
| §2 概念模型 | Task 2, 3, 7 |
| §3 数据模型 | Task 2, 4 |
| §4 API | Task 3 |
| §5 前端 UX | Task 5, 6, 7 |
| §6 修复清单 | Task 3–11 |
| §7 验收 1–6 | Task 3, 4, 7 |
| §7 验收 7–9 | Task 8, 9, 10, 11 |
| §10 定位 UX | Task 8, 9, 10 |

**Placeholder scan:** none.

**Type consistency:** `LinkedCanvasOutput` defined Task 1, used Tasks 4, 6, 8, 9, 11.

---

## Execution order

```text
Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12
         └─ DB ─┘   └─ Nest/Runtime ─┘   └─ Web UX ────────────────┘
```

Task 3 可单独 hotfix 生产截断（若需提前发版）；完整隔离依赖 Task 2 migration。
