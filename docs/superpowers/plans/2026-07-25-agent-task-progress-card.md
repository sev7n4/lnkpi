# Agent Task Progress Card + Auto Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship confirm-after task progress card (SSE `task_*`), hybrid auto-retry ≤2, final summary with hints, click-to-focus nodes, and phase-1 auto video generation in the same orchestrate pipeline.

**Architecture:** Runtime emits structured `task_list` / `task_update` / `task_summary` during `split`→`orchestrate_gen`→`done`; Nest SSE passthrough unchanged; Web renders a pinned card in `AgentSideRail`. Video mirrors `runImageGeneration` via new Nest `runVideoGeneration` + Runtime proxy. Vercel proxy must stream Agent SSE (no 20s retry) so the card is visible in prod.

**Tech Stack:** LangGraph Runtime (Python), Nest Agent Canvas Tools, Vue `AgentSideRail` / `CanvasPage`, Vercel `apps/web/api/proxy.ts`, pytest + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-task-progress-card-design.md`  
**Related:** `docs/superpowers/specs/2026-07-24-agent-chat-ux-phase1-design.md` (append-split, proxy constraints)

## Global Constraints

- Auto-retry **at most 2** times for recoverable errors only; `fallback_pending` / insufficient credits / policy reject → `needs_user` (no auto-retry).
- Phase-1 card: **read-only hints + click focus node**; no in-card confirm-platform or retry API.
- Same-canvas re-confirm → **append** skeletons (do not delete prior round); new run gets a new card block.
- Do **not** wire Agent dock `model`/`skillId`/credits.
- Agent SSE via Vercel proxy: **120s, no retry, stream** (`/api/agent/chat/conversation`).
- TDD per task; branch from `main`: `feature/agent-task-progress-card`.
- After Agent turn: reload canvas SoT (`turnComplete` → `loadSession`); never `persistUserEdit` from agent canvas_actions alone.

## File map

| File | Role |
| --- | --- |
| `apps/web/api/proxy-routing.ts` | Timeout / stream / no-retry helpers |
| `apps/web/api/proxy.ts` | Stream Agent SSE; use routing helpers |
| `apps/web/src/api/proxy-routing.test.ts` | Routing unit tests |
| `apps/web/src/components/agent/AgentSideRail.vue` | Card UI; handle `task_*`; emit focus + turnComplete |
| `apps/web/src/components/agent/AgentTaskProgressCard.vue` | NEW presentational card |
| `apps/web/src/pages/CanvasPage.vue` | `handleAgentTurnComplete`; focus node from agent |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `runVideoGeneration` |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | POST `run-video-generation` |
| `services/agent-runtime/app/tools/nest_client.py` | Client method for video |
| `services/agent-runtime/app/runs.py` | Proxy emit `task_*`; `run_video_generation` |
| `services/agent-runtime/app/graph/topo.py` | Topo for image+video auto_generate |
| `services/agent-runtime/app/graph/task_events.py` | NEW helpers to build task payloads / hints |
| `services/agent-runtime/app/graph/nodes/orchestrate_gen.py` | Retry ≤2; task updates; video calls |
| `services/agent-runtime/app/graph/nodes/split.py` | Emit `task_list` after skeleton create |
| `services/agent-runtime/app/graph/nodes/done.py` | Emit `task_summary` + short copy |
| `services/agent-runtime/skills/.../canvas-manifest.yaml` | `auto_generate_video: true` |
| `services/agent-runtime/skills/.../SKILL.md` | Allow auto video |
| Specs | Mark video phase-1; cross-links |

---

### Task 1: Vercel proxy SSE fix (prod prerequisite)

**Files:**
- Create: `apps/web/api/proxy-routing.ts`
- Modify: `apps/web/api/proxy.ts`
- Create: `apps/web/src/api/proxy-routing.test.ts`
- Modify (if not already): `AgentSideRail.vue` `turnComplete`; `CanvasPage.vue` reload without agent `persistUserEdit`

**Interfaces:**
- Produces: `resolveUpstreamTimeoutMs('/api/agent/chat/conversation') === 120_000`
- Produces: `shouldRetryUpstream('POST', thatPath) === false`
- Produces: `isStreamProxyPath` → pipe body chunks (not `arrayBuffer`)
- Produces: `@turn-complete` → `loadSession()` + `fitView`

- [ ] **Step 1: Write failing routing tests**

```ts
/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildUpstreamPath,
  isStreamProxyPath,
  resolveUpstreamTimeoutMs,
  shouldRetryUpstream,
} from '../../api/proxy-routing'

describe('vercel api proxy routing', () => {
  it('maps agent conversation to 120s timeout and no retry', () => {
    const path = '/api/agent/chat/conversation'
    expect(resolveUpstreamTimeoutMs(path)).toBe(120_000)
    expect(isStreamProxyPath(path)).toBe(true)
    expect(shouldRetryUpstream('POST', path)).toBe(false)
  })
})
```

- [ ] **Step 2:** `pnpm --filter @lnkpi/web exec vitest run src/api/proxy-routing.test.ts` — fail until helpers exist

- [ ] **Step 3: Implement** `proxy-routing.ts` + wire `proxy.ts` to stream Agent paths; ensure SideRail emits `turnComplete` and CanvasPage reloads SoT (no `persistUserEdit` on agent actions)

- [ ] **Step 4:** Vitest pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/api/proxy.ts apps/web/api/proxy-routing.ts \
  apps/web/src/api/proxy-routing.test.ts \
  apps/web/src/components/agent/AgentSideRail.vue \
  apps/web/src/pages/CanvasPage.vue
git commit -m "$(cat <<'EOF'
fix(web): stream agent SSE through Vercel proxy without retry

Agent chat used the default 20s timeout and up to 3 POSTs, which
duplicated「确认」and left the UI stuck on the busy tip while wiping
append-split nodes via stale saveCanvas.
EOF
)"
```

---

### Task 2: Nest `runVideoGeneration`

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`

**Interfaces:**
- Produces: `runVideoGeneration({ sessionId, userId, nodeId }) -> { url?: string; status: string; actions: CanvasAction[] }`
- Consumes: `studio.generateVideo`, existing `pollGeneration`, account video prefs (`defaultVideoModel`, aspect/duration/resolution)
- Mirror image: set `generating` → poll → `completed`/`error`/`fallback_pending`

- [ ] **Step 1: Failing test** — stubs Studio; asserts video prefs used when node lacks fields; returns `status`/`url`/`actions`

```ts
it('runVideoGeneration falls back to account default video prefs', async () => {
  // arrange session with video node missing model; prefs have defaultVideoModel
  // expect studio.generateVideo called with prefs model + duration/aspect
})
```

- [ ] **Step 2:** Run server vitest for that file — expect fail

- [ ] **Step 3: Implement** method + DTO + `POST .../run-video-generation` (auth = service token like image)

- [ ] **Step 4:** Tests pass

- [ ] **Step 5: Commit** `feat(server): agent internal runVideoGeneration tool`

---

### Task 3: Runtime task event helpers + topo image+video

**Files:**
- Create: `services/agent-runtime/app/graph/task_events.py`
- Modify: `services/agent-runtime/app/graph/topo.py`
- Create/Modify: `services/agent-runtime/tests/test_topo.py`
- Create: `services/agent-runtime/tests/test_task_events.py`

**Interfaces:**
- Produces: `topo_sort_gen_keys(manifest) -> list[str]` for `target_type in (image, video)` and `auto_generate`
- Produces: `hint_for_error(code_or_status: str) -> str` mapping from spec §3.2
- Produces: `is_recoverable(status|exc) -> bool` — False for `fallback_pending`, insufficient points, policy

- [ ] **Step 1: Failing tests**

```python
def test_topo_includes_video_after_image_dep():
    manifest = [
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": []},
        {"key": "show_video", "target_type": "video", "auto_generate": True, "depends_on": ["hero_main"]},
    ]
    assert topo_sort_gen_keys(manifest) == ["hero_main", "show_video"]

def test_fallback_pending_not_recoverable():
    assert is_recoverable("fallback_pending") is False
    assert "确认平台" in hint_for_error("fallback_pending")
```

- [ ] **Step 2:** pytest fail

- [ ] **Step 3: Implement** helpers; keep `topo_sort_image_keys` as thin wrapper or replace call sites

- [ ] **Step 4:** pytest pass

- [ ] **Step 5: Commit** `feat(agent-runtime): task event helpers and video-aware topo`

---

### Task 4: orchestrate_gen retry + task_* emits + video

**Files:**
- Modify: `services/agent-runtime/app/runs.py` (`NestEventProxy.emit_task_*`, `run_video_generation`)
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: `services/agent-runtime/app/graph/nodes/split.py` — after batch, `emit task_list`
- Modify: `services/agent-runtime/app/graph/nodes/orchestrate_gen.py`
- Modify: `services/agent-runtime/app/graph/nodes/done.py`
- Modify: Skill `canvas-manifest.yaml` + `SKILL.md` (`auto_generate_video: true`, item `auto_generate: true`)
- Tests: `test_orchestrate_gen.py`, `test_gen_copy.py` / new `test_orchestrate_retry.py`, update `test_graph_plan_split.py` (video now generated)

**Interfaces:**
- Consumes: `nest.run_image_generation` / `nest.run_video_generation`; `nest.emit` via proxy
- For each key: `task_update` pending→running; on recoverable fail retry up to 2 with `retrying`; terminal `done`|`failed`|`needs_user`
- `done` node emits `task_summary` then short AI message from same counts

- [ ] **Step 1: Failing tests**

```python
async def test_retries_recoverable_twice_then_failed():
    # nest.run_image_generation fails with timeout twice then succeeds on 3rd
    # OR fails 3 times → status failed, attempt updates emitted
    ...

async def test_fallback_pending_needs_user_no_retry():
    # single call returns fallback_pending → needs_user, call count == 1
    ...

async def test_video_auto_generate_invokes_run_video():
    # manifest video auto_generate true → nest.run_video_generation called
    ...
```

- [ ] **Step 2:** pytest fail

- [ ] **Step 3: Implement** emit helpers on proxy:

```python
async def emit_task_list(self, items: list[dict]) -> None:
    await self._emit({"type": "task_list", "data": {"items": items}})

async def emit_task_update(self, **payload) -> None:
    await self._emit({"type": "task_update", "data": payload})

async def emit_task_summary(self, **payload) -> None:
    await self._emit({"type": "task_summary", "data": payload})
```

Wire orchestrate loop with attempt counter; call video vs image by `target_type`.

- [ ] **Step 4:** Full runtime pytest pass (`cd services/agent-runtime && python3 -m pytest tests/ -q`)

- [ ] **Step 5: Commit** `feat(agent-runtime): task progress events, retry≤2, auto video`

---

### Task 5: Web task progress card + focus

**Files:**
- Create: `apps/web/src/components/agent/AgentTaskProgressCard.vue`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` — handle `task_list`|`task_update`|`task_summary`; pin card after confirm stream
- Modify: `apps/web/src/pages/CanvasPage.vue` — `@focus-node` → `focusNodeById`
- Optional store slice for current run tasks if cleaner than local refs
- Test: small vitest for reducer/pure merge of task updates if extracted

**Interfaces:**
- Consumes SSE: `task_list` / `task_update` / `task_summary`
- Emits: `focusNode(nodeId: string)`, existing `turnComplete`
- Card shows status labels in Chinese matching spec table

- [ ] **Step 1: Failing unit test** for pure `applyTaskEvent(state, event)` helper (create `agentTaskProgress.ts`)

```ts
it('applies task_update retrying attempt', () => {
  let s = applyTaskEvent(empty, { type: 'task_list', data: { items: [{ id: 'a', title: '主图', nodeId: 'n1' }] } })
  s = applyTaskEvent(s, { type: 'task_update', data: { id: 'a', status: 'retrying', attempt: 1, maxAttempts: 2 } })
  expect(s.items[0].status).toBe('retrying')
  expect(s.items[0].attempt).toBe(1)
})
```

- [ ] **Step 2:** Vitest fail

- [ ] **Step 3: Implement** helper + card + SideRail wiring + CanvasPage focus

- [ ] **Step 4:** Vitest pass; smoke-check types

- [ ] **Step 5: Commit** `feat(web): agent task progress card with node focus`

---

### Task 6: Spec cross-updates + PR

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md` — remove “视频二期” from §0/§1.2; point to task-progress spec; update §12 acceptance
- Modify: `docs/superpowers/specs/2026-07-24-agent-chat-ux-phase1-design.md` — link confirmed task-progress spec
- Ensure `2026-07-25-agent-task-progress-card-design.md` status **已确认**

- [ ] **Step 1:** Edit docs for consistency (no conflicting “视频二期”)
- [ ] **Step 2:** `pnpm build` (or at least web+server filters used in CI) + runtime pytest
- [ ] **Step 3: Commit** `docs: confirm task progress card and phase-1 auto video`
- [ ] **Step 4:** Push branch + `gh pr create` with test plan covering: proxy no double-confirm; task card states; video auto; click focus; append-split reload

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Proxy stream / no retry / 120s | T1 |
| turnComplete canvas reload | T1 |
| `runVideoGeneration` Nest tool | T2 |
| Video-aware topo + hints | T3 |
| Retry ≤2 + task_* + auto video | T4 |
| Manifest/SKILL video auto | T4 |
| Task card UI + focus | T5 |
| Doc sync | T6 |
| No in-card confirm/retry API | Explicit non-goals (no task) |
| Append-split new card per run | T5 (new card block per `task_list`) |

## Notes for implementers

- Prefer **poll-inside Nest tool** (same as image) for video so Runtime stays simple; if Vercel 120s is insufficient in prod, follow-up: Runtime fire-and-poll with mid-stream `task_update` heartbeats (out of this plan unless tests force it).
- Reduce duplicate `text_delta` per-node success lines once card works; keep one short final summary message.
- Concurrent thread busy lock unchanged.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-25-agent-task-progress-card.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
