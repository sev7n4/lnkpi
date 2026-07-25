# Agent Confirm-Loop Hardening + Copy HITL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After confirm-split, keep a stable 9-item task card, draft main copy for user confirm-before-write, close the card after SSE drops, sync canvas image URLs, and strip plan-node preamble.

**Architecture:** Extend LangGraph with `draft_copy` → (same run) `orchestrate_gen` → `done` while preserving `phase=await_copy_confirm`; next user turn hits `await_copy_confirm` → `write_copy_node`. Frontend reconciles `taskProgress` from session nodes after stream end; canvas merges server `url`/`content` on poll. Nest adds `set-node-content` for confirmed draft persistence (no second Studio bill).

**Tech Stack:** LangGraph Runtime (Python/pytest), Nest Agent Canvas Tools (Vitest), Vue `AgentSideRail` / `CanvasPage` (Vitest), existing SSE `task_*`.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-confirm-loop-hardening-design.md`  
**Related:** `docs/superpowers/specs/2026-07-25-agent-task-progress-card-design.md`

## Global Constraints

- Copy HITL: draft in chat first; write node only after user confirm; default write = persist `copy_draft` (no Studio regen on confirm).
- Images/videos must not wait on copy confirm.
- `done` must **not** clear `awaiting_user` / `phase=await_copy_confirm`.
- `orchestrate_gen` must **not** emit a full replacing `task_list`.
- Vercel Agent SSE ~120s; card close via reconcile/synthesize summary is required.
- TDD per task; branch from `main`: `fix/agent-confirm-loop-hardening`.
- Do not wire Agent dock model/skillId/credits.
- Do not implement `task_summary` DB persistence (spec scheme B) in this plan.

## File map

| File | Role |
| --- | --- |
| `services/agent-runtime/app/graph/state.py` | Add phases + `copy_draft` / `copy_node_id` |
| `services/agent-runtime/app/graph/builder.py` | Routes + edges `split→draft_copy→orchestrate_gen→done` |
| `services/agent-runtime/app/graph/nodes/done.py` | Preserve copy gate flags |
| `services/agent-runtime/app/graph/nodes/draft_copy.py` | NEW: LLM draft + needs_user task_update |
| `services/agent-runtime/app/graph/nodes/await_copy_confirm.py` | NEW: confirm/revise/none gate |
| `services/agent-runtime/app/graph/nodes/write_copy_node.py` | NEW: Nest set content |
| `services/agent-runtime/app/graph/nodes/orchestrate_gen.py` | Remove second `task_list` emit |
| `services/agent-runtime/app/graph/nodes/plan.py` | Strip preamble before upsert |
| `services/agent-runtime/app/graph/plan_clean.py` | NEW: pure strip helper |
| `services/agent-runtime/app/tools/nest_client.py` | `set_node_content` |
| `services/agent-runtime/app/runs.py` | Proxy if needed for set_node_content tool |
| `apps/server/.../agent-canvas-tools.service.ts` | `setNodeContent` |
| `apps/server/.../agent-canvas-tools.controller.ts` | `POST set-node-content` |
| `apps/web/.../agentTaskProgress.ts` | Merge helpers + synthesize summary |
| `apps/web/.../taskProgressReconcile.ts` | NEW: map nodes → task items / finished |
| `apps/web/.../AgentSideRail.vue` | Post-stream reconcile loop; copy chips |
| `apps/web/.../CanvasPage.vue` | Poll `loadSession` merge; stop clobbering urls |
| `apps/web/.../canvasMerge.ts` | NEW: merge server node data over local |

---

### Task 1: Preserve copy gate through `done` + entry routing

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Modify: `services/agent-runtime/app/graph/nodes/done.py`
- Test: `services/agent-runtime/tests/test_route_entry_copy_gate.py` (create)

**Interfaces:**
- Produces: `phase` includes `"draft_copy" | "await_copy_confirm" | "write_copy_node"`
- Produces: state keys `copy_draft: str | None`, `copy_node_id: str | None`
- Produces: `route_entry(state)` → `"await_copy_confirm"` when `awaiting_user and phase==await_copy_confirm` (before `await_confirm`)
- Produces: `done(state)` keeps `awaiting_user=True` and `phase=await_copy_confirm` when those were set; otherwise existing behavior

- [ ] **Step 1: Write failing route + done tests**

```python
# services/agent-runtime/tests/test_route_entry_copy_gate.py
from app.graph.builder import route_entry
from app.graph.nodes.done import make_done_node
import asyncio

def test_route_entry_prefers_copy_gate():
    assert route_entry({
        "awaiting_user": True,
        "phase": "await_copy_confirm",
    }) == "await_copy_confirm"

def test_route_entry_still_supports_plan_confirm():
    assert route_entry({
        "awaiting_user": True,
        "phase": "await_confirm",
    }) == "await_confirm"

def test_done_preserves_copy_gate():
    done = make_done_node()
    out = asyncio.get_event_loop().run_until_complete(
        done({
            "awaiting_user": True,
            "phase": "await_copy_confirm",
            "copy_draft": "主文案草稿",
            "gen_completed": ["n1"],
            "gen_failed": [],
        })
    )
    assert out["awaiting_user"] is True
    assert out["phase"] == "await_copy_confirm"
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd services/agent-runtime && python -m pytest tests/test_route_entry_copy_gate.py -v`  
Expected: FAIL (`await_copy_confirm` not routed / done clears awaiting)

- [ ] **Step 3: Implement state + route_entry + done preserve**

In `state.py` extend `phase` Literal and add:

```python
copy_draft: str | None
copy_node_id: str | None
```

In `builder.py`:

```python
def route_entry(state: AgentRuntimeState) -> str:
    if state.get("awaiting_user") and state.get("phase") == "await_copy_confirm":
        return "await_copy_confirm"
    if state.get("awaiting_user") and state.get("phase") == "await_confirm":
        return "await_confirm"
    return "intake"
```

(Wire `await_copy_confirm` node in Task 4; for this task only update `route_entry` map keys when adding the node—or add a stub node that END so graph compiles.)

In `done.py`:

```python
if state.get("phase") == "await_copy_confirm" or (
    state.get("awaiting_user") and state.get("copy_draft")
):
    return {
        "phase": "await_copy_confirm",
        "awaiting_user": True,
        "messages": [AIMessage(content=msg)],
    }
# else existing clear awaiting
return {
    "phase": "done",
    "awaiting_user": False,
    "messages": [AIMessage(content=msg)],
}
```

- [ ] **Step 4: Re-run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/state.py \
  services/agent-runtime/app/graph/builder.py \
  services/agent-runtime/app/graph/nodes/done.py \
  services/agent-runtime/tests/test_route_entry_copy_gate.py
git commit -m "fix(agent-runtime): preserve copy HITL gate across done"
```

---

### Task 2: Nest `setNodeContent` internal API

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`
- Modify: `services/agent-runtime/app/tools/nest_client.py`

**Interfaces:**
- Produces: `setNodeContent({ sessionId, userId, nodeId, content }) → { actions }`
- Writes `data.content`, `data.status: 'completed'`
- Ownership check same as `runImageGeneration` (`userId` must own session)
- Runtime: `NestClient.set_node_content(node_id, content) → POST /agent/internal/set-node-content`

- [ ] **Step 1: Write failing Nest test**

```ts
it('setNodeContent writes content and completed status', async () => {
  // seed session owned by u1 with text node t1
  const result = await svc.setNodeContent({
    sessionId: 's1',
    userId: 'u1',
    nodeId: 't1',
    content: '静音·洁净·极简',
  })
  expect(result.actions.some((a) => a.type === 'update_node')).toBe(true)
  const canvas = await readCanvas('s1')
  expect(canvas.nodes.find((n) => n.id === 't1')?.data.content).toBe('静音·洁净·极简')
  expect(canvas.nodes.find((n) => n.id === 't1')?.data.status).toBe('completed')
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.test.ts -t setNodeContent`

- [ ] **Step 3: Implement service + controller + nest_client**

```ts
async setNodeContent(input: {
  sessionId: string
  userId: string
  nodeId: string
  content: string
}): Promise<{ actions: CanvasAction[] }> {
  const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
  if (!canvas.nodes.some((n) => n.id === input.nodeId)) {
    throw new NotFoundException('节点不存在')
  }
  const actions: CanvasAction[] = [
    {
      type: 'update_node',
      payload: {
        id: input.nodeId,
        data: { content: input.content, status: 'completed' },
      },
    },
  ]
  await this.persist(input.sessionId, canvas, actions)
  return { actions }
}
```

Controller: `@Post('set-node-content')` with DTO `sessionId`, `nodeId`, `content` (+ service token user binding as other internals).

Python:

```python
async def set_node_content(self, node_id: str, content: str) -> dict[str, Any]:
    return await self._post(
        "/agent/internal/set-node-content",
        {"sessionId": self.session_id, "nodeId": node_id, "content": content},
    )
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): internal set-node-content for copy HITL write"
```

---

### Task 3: `draft_copy` node

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/draft_copy.py`
- Create: `services/agent-runtime/tests/test_draft_copy.py`
- Modify: `services/agent-runtime/app/graph/builder.py` (add node + edge from split)

**Interfaces:**
- Consumes: `split_manifest` (find `copy_main` or first `target_type==text`), `plan_summary`, `nest.emit_task_update`, `llm`
- Produces: `copy_draft`, `copy_node_id`, `phase=await_copy_confirm`, `awaiting_user=True`, AIMessage with draft + chip hints
- Emits: `task_update(id=copy_main, status=needs_user, errorHint="请确认主文案后写入")`

- [ ] **Step 1: Failing test with FakeLLM / FakeNest**

```python
@pytest.mark.asyncio
async def test_draft_copy_sets_gate_and_needs_user():
    nest = FakeNest()
    llm = FakeLLM(responses=["# 主文案\n静音·洁净·极简\n..."])
    node = make_draft_copy_node(nest=nest, llm=llm)
    out = await node({
        "split_manifest": [
            {"key": "copy_main", "title": "主文案", "target_type": "text", "node_id": "t1"},
            {"key": "white_bg", "title": "白底图", "target_type": "image", "node_id": "i1"},
        ],
        "plan_summary": "卫生洁具方案",
    })
    assert out["phase"] == "await_copy_confirm"
    assert out["awaiting_user"] is True
    assert out["copy_node_id"] == "t1"
    assert "静音" in (out["copy_draft"] or "")
    assert any(c[0] == "emit_task_update" and c[1].get("status") == "needs_user" for c in nest.calls)
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `draft_copy.py`**

System prompt: output only the ecommerce main-copy Markdown for the plan; no chitchat.  
Emit draft via `nest.emit_text` / messages AIMessage including:

```text
【主文案草稿】
{draft}

请确认后回复「写入主文案」；如需修改请说明（例如「改成更强调节水」）。
```

If no text item in manifest: skip gate (`awaiting_user` unchanged / false), no draft.

- [ ] **Step 4: Wire graph**

```python
graph.add_node("draft_copy", make_draft_copy_node(nest=nest, llm=llm))
graph.add_edge("split", "draft_copy")
graph.add_edge("draft_copy", "orchestrate_gen")
# remove direct split → orchestrate_gen
```

- [ ] **Step 5: Tests PASS + commit**

```bash
git commit -m "feat(agent-runtime): draft_copy node before orchestrate_gen"
```

---

### Task 4: `await_copy_confirm` + `write_copy_node`

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/await_copy_confirm.py`
- Create: `services/agent-runtime/app/graph/nodes/write_copy_node.py`
- Create: `services/agent-runtime/tests/test_await_copy_confirm.py`
- Modify: `services/agent-runtime/app/graph/builder.py`

**Interfaces:**
- `classify_copy_decision(text) -> confirm|revise|none`
  - confirm hints: `写入主文案`, `确认写入`, `写入`, `用这个`, `可以写入`
  - revise: reuse revise hints from await_confirm (`改成`, `修改`, …)
- `await_copy_confirm` → sets `user_decision`
- `route_after_copy_confirm`: confirm→`write_copy_node`, revise→`draft_copy`, none→END
- `write_copy_node`: `nest.set_node_content(copy_node_id, copy_draft)`; `task_update(done)`; clear `awaiting_user`; `phase=done`

- [ ] **Step 1: Failing tests**

```python
def test_classify_write_copy():
    assert classify_copy_decision("写入主文案") == "confirm"
    assert classify_copy_decision("改成更强调节水") == "revise"

@pytest.mark.asyncio
async def test_write_copy_persists_draft():
    nest = FakeNest()
    node = make_write_copy_node(nest=nest)
    out = await node({
        "copy_node_id": "t1",
        "copy_draft": "正文A",
        "split_manifest": [{"key": "copy_main", "node_id": "t1", "title": "主文案"}],
    })
    assert any(c[0] == "set_node_content" and c[1] == ("t1", "正文A") for c in nest.calls)
    assert out["awaiting_user"] is False
```

- [ ] **Step 2: Implement nodes + builder conditional edges from START including await_copy_confirm**

```python
graph.add_conditional_edges(
    START,
    route_entry,
    {
        "intake": "intake",
        "await_confirm": "await_confirm",
        "await_copy_confirm": "await_copy_confirm",
    },
)
graph.add_conditional_edges(
    "await_copy_confirm",
    route_after_copy_confirm,
    {"write_copy_node": "write_copy_node", "draft_copy": "draft_copy", "end": END},
)
graph.add_edge("write_copy_node", END)
# revise path: draft_copy must END after re-draft when coming from copy gate
```

**Revise path detail:** When `draft_copy` runs after revise, it should END the turn (not re-enter long `orchestrate_gen`). Implement with a state flag `copy_revise_only: bool` set by await_copy_confirm on revise; `draft_copy` returns and builder uses conditional edge:

```python
def route_after_draft_copy(state):
    if state.get("copy_revise_only"):
        return "end"
    return "orchestrate_gen"
```

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat(agent-runtime): await_copy_confirm and write_copy_node"
```

---

### Task 5: Stop orchestrate from replacing `task_list`

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/orchestrate_gen.py`
- Modify: `services/agent-runtime/tests/test_orchestrate_gen.py` / `test_graph_plan_split.py`

**Interfaces:**
- Produces: orchestrate emits only `task_update` / `task_summary` / text lines — **zero** `emit_task_list` calls

- [ ] **Step 1: Assert in test that FakeNest has no `emit_task_list` during orchestrate**

- [ ] **Step 2: Delete the `emit_task_list` block in `orchestrate_gen.py` (keep updates/summary)**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "fix(agent-runtime): do not replace task_list in orchestrate_gen"
```

---

### Task 6: Plan node preamble strip

**Files:**
- Create: `services/agent-runtime/app/graph/plan_clean.py`
- Create: `services/agent-runtime/tests/test_plan_clean.py`
- Modify: `services/agent-runtime/app/graph/nodes/plan.py`

**Interfaces:**
- Produces: `strip_plan_preamble(md: str) -> str`
  - If a line matching `^#\s+` exists, return from that line to end
  - Also drop leading lines matching `/^(好的|当然|我将|下面给|以下是)/`

- [ ] **Step 1: Unit tests for strip cases** (with/without `#`, chitchat only, already clean)

- [ ] **Step 2: Implement + call in plan before `upsert_prompt_node`**

- [ ] **Step 3: Strengthen plan LLM system/human: 「只输出方案 Markdown，禁止寒暄」**

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "fix(agent-runtime): strip chitchat before writing plan node"
```

---

### Task 7: Frontend task progress reconcile + synthetic summary

**Files:**
- Create: `apps/web/src/components/agent/taskProgressReconcile.ts`
- Create: `apps/web/src/components/agent/taskProgressReconcile.test.ts`
- Modify: `apps/web/src/components/agent/agentTaskProgress.ts` (optional helpers)
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Produces: `reconcileTaskProgress(state, nodes): AgentTaskProgressState`
  - Map by `manifestKey` or title/`nodeId`
  - `completed`+url → `done`; `generating` → `running`; `fallback_pending` → `needs_user`; text with non-empty content → `done`; text empty while local item needs_user → keep `needs_user`
- Produces: `shouldFinishTaskCard(state, nodes): boolean` — no running/pending/retrying among **image/video** items (needs_user text does not block finish)
- Produces: `synthesizeSummary(state): summary` when finishing without SSE summary
- SideRail: on stream end, if `taskProgress.items.length`, poll session nodes every 4s up to 15 times OR until `shouldFinishTaskCard`, apply reconcile; set `finished` + summary

- [ ] **Step 1: Vitest cases for mapping + finish rules + synthesize**

- [ ] **Step 2: Implement module**

- [ ] **Step 3: Wire AgentSideRail finally/turnComplete path** (need session nodes: emit event to parent for nodes snapshot, or accept `getCanvasNodes` callback prop — prefer emit `requestCanvasSnapshot` / use existing turnComplete → parent passes nodes via new optional callback `onReconcileTasks`)

Minimal wiring: `emit('turnComplete')` already reloads session in CanvasPage; add `emit('reconcileTasks')` or extend turnComplete to return nodes. Simplest: **CanvasPage** after each `loadSession` during agent busy calls `sideRailRef.reconcileFromNodes(nodes)`.

Expose:

```ts
function reconcileFromNodes(nodes: CanvasNode[]) {
  taskProgress.value = reconcileTaskProgress(taskProgress.value, nodes)
  if (shouldFinishTaskCard(taskProgress.value, nodes) && !taskProgress.value.finished) {
    taskProgress.value = {
      ...taskProgress.value,
      finished: true,
      summary: taskProgress.value.summary ?? synthesizeSummary(taskProgress.value),
    }
  }
}
defineExpose({ reconcileFromNodes })
```

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(web): reconcile agent task card after SSE disconnect"
```

---

### Task 8: Canvas server-merge + poll during agent run

**Files:**
- Create: `apps/web/src/pages/canvas/canvasNodeMerge.ts`
- Create: `apps/web/src/pages/canvas/canvasNodeMerge.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**
- Produces: `mergeCanvasNodesFromServer(local, server): Node[]`
  - For matching ids: if server has non-empty `url` and local missing/different → take server url/status/generationRecordId
  - if server has non-empty `content` → take content/status
  - never let local empty url overwrite server url on subsequent save
- CanvasPage: while agent streaming OR task card not finished, `setInterval` 4s `loadSession` then merge into vue-flow nodes (do not full-replace user selection if possible)
- On agent `canvas_action` path: do **not** `saveCanvas()` immediately after apply if it would persist nodes still missing urls that server may already have — prefer `loadSession` merge first; if save needed, merge before PUT

- [ ] **Step 1: Unit test merge preferences**

```ts
it('prefers server url over local empty', () => {
  const merged = mergeCanvasNodesFromServer(
    [{ id: 'i1', data: { url: '', status: 'draft' } }],
    [{ id: 'i1', data: { url: 'https://x/a.png', status: 'completed' } }],
  )
  expect(merged[0].data.url).toBe('https://x/a.png')
  expect(merged[0].data.status).toBe('completed')
})
```

- [ ] **Step 2: Implement + wire poll in handleAgent stream start/stop**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "fix(web): merge server canvas urls during agent generation"
```

---

### Task 9: Copy confirm chips in Agent UI

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` (or confirm-chip helper)
- Test: small unit test for chip detection / message templates if pure fn extracted

**Interfaces:**
- When last assistant text includes `【主文案草稿】` or `写入主文案`, show chips: `写入主文案` | `要修改`
- Click sends that text as user message (same as 确认拆图 chips)
- Do not show plan confirm chips (`确认拆图`) while `phase` hint is copy draft

- [ ] **Step 1: Extract `detectAgentChipSet(assistantText) -> 'plan' | 'copy' | null`**

- [ ] **Step 2: Wire UI**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): chips for main-copy confirm HITL"
```

---

### Task 10: Cross-spec note + local verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-agent-task-progress-card-design.md` (lifecycle: text as needs_user; no orchestrate task_list replace)
- Modify: `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md` (pointer to confirm-loop §7)

- [ ] **Step 1: Patch those two docs with short revision notes linking the new spec**

- [ ] **Step 2: Run full relevant suites**

```bash
cd services/agent-runtime && python -m pytest tests/ -q
pnpm --filter @lnkpi/server exec vitest run src/agent
pnpm --filter @lnkpi/web exec vitest run src/components/agent src/pages/canvas
```

Expected: all PASS

- [ ] **Step 3: Commit docs + any fixes**

```bash
git commit -m "docs: link confirm-loop hardening into prior agent specs"
```

---

### Task 11: Production checklist (manual, after deploy)

- [ ] Rebuild Runtime with `enable_agent_runtime=true` (API-only deploy is insufficient)
- [ ] Clean canvas: plan → 确认拆图 → card has 9 items including 主文案 `needs_user`
- [ ] Draft appears; 写入主文案 → node content filled
- [ ] Images continue without waiting; after ~120s card still closes with summary
- [ ] Successful images visible on canvas nodes
- [ ] Plan node has no「好的，我将…」preamble

---

## Spec coverage self-check

| Spec section | Task(s) |
| --- | --- |
| §2 Copy HITL | 3, 4, 9 |
| §3 task_list stable | 5 |
| §4 disconnect close + summary | 7 |
| §5 canvas sync | 8 |
| §6 plan clean | 6 |
| §7 graph phases/edges / done preserve | 1, 3, 4 |
| Nest write API | 2 |
| Runtime rebuild reminder | 11 |
| scheme B summary persistence | explicitly out of scope |

## Placeholder scan

No TBD/TODO steps; open product default (persist draft vs Studio regen) locked to persist draft per spec §2.3 / §12.
