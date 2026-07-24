# Agent Chat UX Phase-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase-1 Agent chat UX: skill gate → casual `chat`, readable confirm summary, streaming progress, actionable gen results, dock de-misleading, confirm chips, history reconcile.

**Architecture:** Runtime-first copy/events (`text_delta`); Web only for dock hide, confirm chips, and post-stream history pull. No interrupt()/skillId/`/` invoke.

**Tech Stack:** LangGraph Runtime (Python), Nest SSE passthrough, Vue `AgentSideRail`, pytest + existing graph tests.

**Spec:** `docs/superpowers/specs/2026-07-24-agent-chat-ux-phase1-design.md`  
**Parent:** `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md` §5/§12

## Global Constraints

- Do **not** fallback `intake` to `entries[0]` when no marketing intent.
- Do **not** crop `canvas-manifest`; only announce N in confirm copy.
- Do **not** wire dock `model`/`skillId`/credits to Runtime (phase 2).
- Keep per-thread busy lock behavior.
- TDD: failing test → implement → pass → commit per task group.
- Branch: `feature/agent-chat-ux-phase1` from `main`.

## File map

| File | Role |
| --- | --- |
| `services/agent-runtime/app/graph/nodes/intake.py` | Marketing intent gate; `skill_id` or null |
| `services/agent-runtime/app/graph/nodes/chat.py` | NEW casual reply node |
| `services/agent-runtime/app/graph/builder.py` | `chat` node + routing after intake |
| `services/agent-runtime/app/graph/nodes/plan.py` | Readable summary (定位 + assets + N) |
| `services/agent-runtime/app/graph/nodes/split.py` | Standalone split progress message |
| `services/agent-runtime/app/graph/nodes/orchestrate_gen.py` | Per-image progress + richer failures |
| `services/agent-runtime/app/graph/nodes/done.py` | Actionable per-node summary |
| `services/agent-runtime/app/graph/state.py` | Optional `phase` values already cover |
| `apps/web/src/components/agent/AgentSideRail.vue` | Hide dock, chips, reconcile |
| Tests under `services/agent-runtime/tests/` | Gate, chat, summary, progress |

---

### Task 1: Skill gate + `chat` node

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/chat.py`
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Test: `services/agent-runtime/tests/test_intake_gate.py` (create)

**Interfaces:**
- Produces: `intake` returns `skill_id: str | None`; when None, route to `chat`
- `chat(state) -> {phase, messages, awaiting_user: False}`
- Consumes: `default_llm` via `make_chat_node(llm=...)`

- [ ] **Step 1:** Write failing tests: `"你好"` → no skill / routes to chat; marketing brief → `enterprise-marketing-campaign`; never set skill from `entries[0]` alone
- [ ] **Step 2:** Run pytest — expect fail
- [ ] **Step 3:** Implement gate + `chat` + builder edges (`route_after_intake`)
- [ ] **Step 4:** pytest pass
- [ ] **Step 5:** Commit `feat(agent-runtime): gate non-marketing turns to chat`

---

### Task 2: Readable plan summary (P0-2, P1-3)

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/plan.py`
- Test: `services/agent-runtime/tests/test_plan_summary.py` (create) or extend `test_graph_plan_split.py`

**Interfaces:**
- `_build_confirm_message(plan_md, skill) -> str` includes: 定位摘录, asset titles from `canvas_manifest`, `N=len(items)`, 画布指引

- [ ] **Step 1:** Failing test asserts confirm message contains asset titles / `将拆解` / `营销方案`
- [ ] **Step 2:** pytest fail
- [ ] **Step 3:** Implement summary builder (prefer manifest titles over truncating LLM opener)
- [ ] **Step 4:** pytest pass
- [ ] **Step 5:** Commit `feat(agent-runtime): readable confirm summary with asset list`

---

### Task 3: Progress + actionable results (P0-1, P0-3, P2-1)

**Files:**
- Modify: `split.py`, `orchestrate_gen.py`, `done.py`, possibly `await_confirm.py` (keep confirm tip)
- Modify: `NestEventProxy` / stream only if needed for mid-gen emits (orchestrate already can append messages per completion — emit via returned messages each update; if graph only yields node end, emit incremental AIMessages from orchestrate by yielding multiple updates OR nest proxy already emits `node_status` — **prefer AIMessage progress lines inside orchestrate loop via astream updates**: return progressive state is hard in one node; **emit through nest proxy callback** or collect lines and join with `\n\n` at end of each logical phase while emitting mid-flight via `emit` if available)

**Preferred approach for mid-gen progress:** extend `NestEventProxy` or pass `emit` into orchestrate to call `emit({type:text_delta,...})` per image; keep final `done` message for summary. If emit not in node factory today, add optional `emit` to `make_orchestrate_gen_node`.

- Test: unit tests for summary formatter + orchestrate failure classification (`fallback_pending`)

- [ ] **Step 1:** Failing tests for split message standalone; done/orchestrate summary mentions `待确认平台兜底` when status is `fallback_pending`
- [ ] **Step 2:** pytest fail
- [ ] **Step 3:** Implement formatters + emit progress; classify Nest soft statuses
- [ ] **Step 4:** pytest pass
- [ ] **Step 5:** Commit `feat(agent-runtime): streaming gen progress and actionable summary`

---

### Task 4: Web dock + confirm chips + history reconcile (P1-1, P1-2, P2-2)

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Optional small test if web vitest exists for component; otherwise manual checklist

**Interfaces:**
- `awaitingConfirm` computed from last assistant message containing `请确认是否按此方案`
- Chips call `sendRaw('确认')` / `sendRaw('我要修改：')` focusing input for revise
- `finally` after stream: fetch messages and if latest assistant content longer, replace

- [ ] **Step 1:** Hide `UniversalModelSelector` + `DockCreditBadge`; add muted「规划模型由服务端配置」
- [ ] **Step 2:** Add confirm/revise chips when `awaitingConfirm && !isStreaming`
- [ ] **Step 3:** After stream ends, reconcile from `GET /api/agent/chat/user/messages?sessionId=`
- [ ] **Step 4:** Manual smoke on page (or skip if no harness)
- [ ] **Step 5:** Commit `feat(web): agent dock de-misleading, confirm chips, history reconcile`

---

### Task 5: PR + CI

- [ ] **Step 1:** `pnpm build` (or scoped) + full runtime pytest
- [ ] **Step 2:** Push branch, `gh pr create` referencing UX spec
- [ ] **Step 3:** Watch CI green

---

## Manual test plan

1. New canvas → Agent：「你好」→ short chat, **no** 营销方案 node  
2. 「便携蓝牙音箱天猫详情页方案…」→ summary lists assets + N  
3. Click「确认拆图」once → progress lines → per-node result including fallback wording if any  
4. Double confirm → busy tip  
5. Dock does not show disabled gemini selector  

## Out of scope

- `/skill` invoke, sidebar `skillId`, manifest crop, interrupt HITL, video auto-gen
