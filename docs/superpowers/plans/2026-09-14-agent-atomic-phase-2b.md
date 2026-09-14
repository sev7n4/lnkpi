# Agent Atomic Phase 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `canvas_agent` CORE tools to place media nodes, fill dock prompts, connect edges, and `propose_generation` (pending confirm **without** calling `run_*`), so explicit「生成一张…」and workflow utterances can摆盘 without re-entering atomic subgraph.

**Architecture:** Reuse Nest `addNodesBatch` / `connectNodes` / `setNodePrompt` / `runImage|VideoGeneration`. Add agent-visible wrappers: `upsert_media_node` (single-item CORE), promote `connect_nodes` to EXPLORE/CORE with edge cap, new Nest `proposeGeneration` + runtime tool `propose_generation`. Confirm card triggers the **same Nest generate path as dock** (thin 2b wire; full SSOT/reconnect polish remains 2c). `run_*` stay `graph_only`.

**Tech Stack:** Python agent-runtime tools/registry; Nest `agent-canvas-tools`; Vue AgentSideRail interrupt/presentation chips; pytest + Vitest as needed.

**Spec:** [docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md](../specs/2026-09-14-agent-atomic-as-tools-design.md) §4.2 / §3.2  
**Depends on:** Phase 2a merged (`atomic_generate` retired).

## Global Constraints

- **H1:** `run_image_generation` / `run_video_generation` / other GEN **never** enter `model_visible_specs`.
- **H2:** No积分扣费 until user confirm (card or dock).
- **H3:** Node is SSOT for prompt/params; propose only marks pending + presents summary.
- **2b scope only:** No Phase 2d (do not delete `atomic_create` subgraph). No campaign/PV toolization.
- **Pinned opens (this plan locks):**
  1. Tool name = **`propose_generation`**
  2. Batch = **single `node_id` only** (reject list / ignore extras)
  3. Media create tool = **`upsert_media_node`** (`target_type`: `image|video|text|audio`, `prompt`, optional `title`/`node_id`)
  4. **`connect_nodes`**: promote to agent-visible CORE; **max 20 edges** per call
  5. Credit estimate on card: **optional** if Nest already has a cheap quote; not a merge blocker
  6. Confirm → execute: chip/API calls **existing Nest `runImageGeneration` / `runVideoGeneration` (or start+wait)** by `node_id` — **not** `flow_mode=atomic_create`
- Prefer TDD; branch `feature/agent-atomic-phase-2b` from latest `main`.
- Do not break Nest internal contracts; additive endpoints OK.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md` | Add §6.0.2 hard table; D9 authorize 2b |
| `services/agent-runtime/app/tools/tool_registry.py` | Placements/exposures for new + promoted tools |
| `services/agent-runtime/app/tools/definitions.py` | Wire `upsert_media_node`, `propose_generation`; keep `run_*` graph_only |
| `services/agent-runtime/app/tools/prompt_templates.py` | Tool descriptions: no `run_*`; workflow → multi-node |
| `services/agent-runtime/app/contract.py` | Request/response models for propose / upsert_media |
| `services/agent-runtime/app/runs.py` / nest client | Forward new Nest routes |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | `POST propose-generation`, reuse add-nodes-batch |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `proposeGeneration`, optional `upsertMediaNode` wrapper |
| `apps/web/src/components/agent/*` | Show propose presentation; confirm → dock-equivalent generate by nodeId |
| `services/agent-runtime/tests/test_phase_2b_*.py` | B1–B9 |
| `apps/server` / web tests | Nest + chip wiring |

---

### §6.0.2 Phase 2b 验收硬表（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **B1** | `build_tool_plan().visible_names` | contains `propose_generation`, `upsert_media_node`; **not** `run_image_generation` / `run_video_generation` |
| **B2** | `connect_nodes` exposure | **CORE** (agent-visible); still not destructive |
| **B3** | `propose_generation` Nest/runtime (unit, mock) | sets pending on node; **zero** calls to `runImageGeneration` / `runVideoGeneration` |
| **B4** | `upsert_media_node(image, prompt=…)` mock Nest | returns `nodeId`; canvas action add/update image node |
| **B5** | Agent system/tool text | states must not call `run_*`; propose then wait for user confirm |
| **B6** | Routing regression | WORKFLOW / 「帮我生成一张…」 still `flow_mode=canvas_agent` (2a A5/A6) |
| **B7** | Confirm path (integration or Nest+web unit) | confirm with `nodeId` invokes **same** generate service method as dock (assert shared function / endpoint), not `atomic_create` route |
| **B8** | `propose_generation` with missing prompt | returns error; no pending; no run_* |
| **B9** | Production smoke (post-deploy) | 「帮我生成一张蓝色天空产品主图」+ `defaultTextModel` → `canvas_agent` + tool evidence (`upsert_media_node` and/or `propose_generation`) OR node appears pending; **no** atomic「基于引用内容…」card; confirm/dock can start gen |

**2b 明确不验收：** 断线恢复 SSOT 精修（2c）、删 atomic 子图（2d）、多节点工作流完美拓扑（尽力 + B9 soft on tools）。

---

### Task 0: Branch + spec §6.0.2 + authorize 2b

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md`
- Create: this plan file (already)

- [ ] **Step 1:** `git fetch origin main && git checkout -b feature/agent-atomic-phase-2b origin/main`
- [ ] **Step 2:** Insert §6.0.2 table above into spec; set D9 execution = Phase 2b authorized
- [ ] **Step 3:** Commit docs

```bash
git add docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md \
  docs/superpowers/plans/2026-09-14-agent-atomic-phase-2b.md
git commit -m "$(cat <<'EOF'
docs: authorize Phase 2b propose/upsert media tools plan

EOF
)"
```

---

### Task 1: Failing tests B1–B3 / B8

**Files:**
- Create: `services/agent-runtime/tests/test_phase_2b_propose_tools.py`

- [ ] **Step 1: Write failing tests** for B1 (visible set), B3 (propose mock never calls run_*), B8 (missing prompt)

```python
def test_b1_propose_and_upsert_visible_run_gen_not():
    from app.tools.tool_plan import build_tool_plan
    plan = build_tool_plan()
    assert "propose_generation" in plan.visible_names
    assert "upsert_media_node" in plan.visible_names
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names
```

- [ ] **Step 2:** Run → expect FAIL
- [ ] **Step 3:** Commit failing tests

---

### Task 2: Nest `proposeGeneration` + `upsertMediaNode`

**Files:**
- Modify: `agent-canvas-tools.service.ts`, `.controller.ts`, DTOs, tests

**Interfaces:**
- `POST /agent/internal/upsert-media-node` → `{ nodeId, actions }`
- `POST /agent/internal/propose-generation` → `{ nodeId, status: 'pending_confirm', summary, actions }` — **no** studio generate call

- [ ] **Step 1:** Service tests fail then pass for upsert image node + propose without generate
- [ ] **Step 2:** Implement `upsertMediaNode` (wrap single `addNodesBatch` item or dedicated add_node)
- [ ] **Step 3:** Implement `proposeGeneration`: require non-empty prompt on node; set `data.status='pending_confirm'` (or agreed flag); return summary fields (type, prompt preview, model prefs if present)
- [ ] **Step 4:** Commit

---

### Task 3: Runtime tools + registry exposure

**Files:**
- `tool_registry.py`: `upsert_media_node` / `propose_generation` → `ToolPlacement.EXPLORE`; `connect_nodes` → `EXPLORE` (leave `add_nodes_batch` GRAPH_NODE)
- Override exposure if comprehension still marks GRAPH_NODE-only: ensure `connect_nodes` CORE visible
- `definitions.py` + nest client forwarders + `contract.py`
- Cap `connect_nodes` edges to 20 in tool coroutine

- [ ] **Step 1:** Implement tools; B1 passes
- [ ] **Step 2:** B3: FakeNest records calls; propose must not invoke run_* methods
- [ ] **Step 3:** Commit

---

### Task 4: Explore prompt / tool descriptions

**Files:**
- `prompt_templates.py` / explore system prompt builder

- [ ] State clearly: never call `run_*`; use `upsert_media_node` → `set_node_prompt` / `connect_nodes` → `propose_generation`; wait for user
- [ ] Workflow utterances: prefer multiple nodes over one atomic-style node
- [ ] Commit

---

### Task 5: Frontend confirm → dock-equivalent generate (B7)

**Files:**
- `AgentSideRail.vue` / presentation host / interrupt gate as needed

- [ ] On propose tool result / SSE presentation `kind` (e.g. `generation_propose`): show confirm chip
- [ ] Confirm calls existing node generation entry (same function dock uses) with `nodeId`
- [ ] Cancel clears `pending_confirm`
- [ ] Vitest for mapping / handler
- [ ] Commit

---

### Task 6: Regression + PR

- [ ] Run: phase_2a + phase_2b + tool_plan + route tests; Nest unit tests for new endpoints
- [ ] Open PR: Phase 2b only; cite §6.0.2 B1–B9
- [ ] After merge/deploy: B9 production smoke

## Rollback

- Hide `propose_generation` / `upsert_media_node` from CORE (revert placement) behind flag if needed
- Never restore `atomic_generate` hard as default
- Never put `run_*` in visible

## Done when

- [ ] B1–B8 green in CI
- [ ] B9 production smoke after deploy
- [ ] 2c/2d **not** started in same PR
