# Agent Topology Preview HITL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement方案门（确认前不写画布 + 结构化选项）、骨架预览（Mermaid + 画布）、`await_topo`、出图门、Skill `full|trimmed` 双模式。

**Architecture:** LangGraph phases: `plan` (draft only) → `await_confirm` → `write_plan_node` → `split` (no gen) → `draft_copy` → `await_topo` → `orchestrate_gen`. Remove auto `pending_orchestrate` bg gen after draft. Frontend chips for numbered plan options + topo/copy.

**Tech Stack:** Python LangGraph Runtime, Nest canvas tools, Vue AgentSideRail chips, vitest/pytest.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-topology-preview-hitl-design.md`（已确认）

## Global Constraints

- 方案节点仅在「确认方案」后写入；确认前禁止 `upsert_prompt_node`。
- 出图仅在「确认出图」后；禁止 draft 后 `pending_orchestrate` 自动出图。
- Mermaid 画资产拓扑（`depends_on`），非 LangGraph 控制流。
- `trimmed` 只能选模板内 key + 依赖闭包。
- 复测必须覆盖 `full` 与 `trimmed`。
- B/C（三视图链、Dock 手工后执行）不在本计划。

---

## File map

| File | Responsibility |
| --- | --- |
| `services/agent-runtime/app/graph/state.py` | `plan_draft`, `topology_mode`, `phase=await_topo` |
| `services/agent-runtime/app/graph/builder.py` | Wire `write_plan_node`, `await_topo`; routes |
| `services/agent-runtime/app/graph/nodes/plan.py` | Summary + structured options; no canvas write |
| `services/agent-runtime/app/graph/nodes/write_plan_node.py` | **New** — upsert confirmed plan + confirmed summary |
| `services/agent-runtime/app/graph/nodes/await_confirm.py` | Classify 1/A, 2/B, 3/C |
| `services/agent-runtime/app/graph/nodes/split.py` | Mode full/trimmed; emit Mermaid; no gen |
| `services/agent-runtime/app/graph/nodes/await_topo.py` | **New** — classify confirm_gen / topo_revise / none |
| `services/agent-runtime/app/graph/nodes/topo_revise.py` | **New** — NL → Nest + manifest + Mermaid |
| `services/agent-runtime/app/graph/mermaid_topo.py` | **New** — manifest → mermaid string |
| `services/agent-runtime/app/graph/topo_trim.py` | **New** — trimmed key selection + closure |
| `services/agent-runtime/app/runs.py` | Remove/gate auto bg orchestrate; only after confirm_gen |
| `services/agent-runtime/skills/.../SKILL.md` + `canvas-manifest.yaml` | `topology_mode_default` |
| `apps/web/.../agentChipSet.ts` | plan/topo/copy chip detection |
| `apps/web/.../AgentSideRail.vue` | Render numbered option chips |

---

### Task 1: State + Skill config

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/skills/enterprise-marketing-campaign/SKILL.md`
- Modify: `services/agent-runtime/skills/enterprise-marketing-campaign/assets/canvas-manifest.yaml`

- [ ] Add `plan_draft: str | None`, `topology_mode: Literal["full","trimmed"] | None`, phase `await_topo` / `write_plan_node`
- [ ] Add `topology_mode_default: full` to skill metadata / manifest defaults
- [ ] Commit: `chore(agent-runtime): state fields for topology preview HITL`

---

### Task 2: Mermaid + trim helpers (TDD)

**Files:**
- Create: `services/agent-runtime/app/graph/mermaid_topo.py`
- Create: `services/agent-runtime/app/graph/topo_trim.py`
- Create: `services/agent-runtime/tests/test_mermaid_topo.py`
- Create: `services/agent-runtime/tests/test_topo_trim.py`

- [ ] Write failing tests: mermaid labels use titles; edge from depends_on; trim keeps closure
- [ ] Implement helpers
- [ ] Pytest pass
- [ ] Commit: `feat(agent-runtime): mermaid topo + trimmed manifest helpers`

---

### Task 3: plan without canvas write + structured options

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/plan.py`
- Modify: `services/agent-runtime/app/graph/nodes/await_confirm.py`
- Modify: `services/agent-runtime/tests/test_graph_plan_split.py` (expect no upsert until confirm)

- [ ] Failing test: after first `plan` invoke, nest has no `upsert_prompt_node`
- [ ] `plan` stores `plan_draft`, emits summary + options text (1/A 推荐理由, 2/B, 3/C); no nest upsert
- [ ] `await_confirm` classifies `1`/`A`/`确认方案` → confirm; `2`/`B`/`3`/`C`/修改 → revise
- [ ] Pytest pass
- [ ] Commit: `feat(agent-runtime): plan draft-only with structured confirm options`

---

### Task 4: write_plan_node

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/write_plan_node.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Create: `services/agent-runtime/tests/test_write_plan_node.py`

- [ ] Failing test: write_plan_node upserts cleaned draft and sets plan_node_id; emits 已确认摘要
- [ ] Implement node (reuse `plan_clean.strip_plan_preamble`)
- [ ] Wire: `await_confirm` confirm → `write_plan_node` → `split`
- [ ] Commit: `feat(agent-runtime): write_plan_node after scheme confirm`

---

### Task 5: split emits Mermaid; apply topology_mode; no gen

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/split.py`
- Modify: `services/agent-runtime/app/graph/nodes/draft_copy.py` (`pending_orchestrate` default false / remove auto-arm)
- Modify: `services/agent-runtime/app/runs.py` (do not bg-orchestrate unless confirm_gen armed)

- [ ] Failing test: split message includes mermaid; trimmed mode fewer items; no image gen in confirm turn until topo confirm
- [ ] Resolve mode from state or skill default; trim when needed
- [ ] Append Mermaid to split (or separate emit_text)
- [ ] Ensure draft_copy does **not** set pending_orchestrate for auto bg; runs.py only arms after explicit confirm_gen path
- [ ] Commit: `feat(agent-runtime): split skeleton preview without auto image gen`

---

### Task 6: await_topo + topo_revise + orchestrate on confirm_gen

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/await_topo.py`
- Create: `services/agent-runtime/app/graph/nodes/topo_revise.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Create: `services/agent-runtime/tests/test_await_topo.py`

- [ ] Failing tests: confirm_gen → orchestrate; 「删掉 Banner」updates manifest; route_entry hits await_topo
- [ ] `await_topo` decisions: confirm_gen | topo_revise | none (and defer copy to existing copy gate when message is copy-confirm — prefer copy gate in route_entry first)
- [ ] `topo_revise`: LLM or heuristic parse → Nest mutations → remint Mermaid → stay await_topo
- [ ] Graph: draft_copy → done/end with phase await_topo; route_entry await_topo → node; confirm_gen → orchestrate_gen → done
- [ ] Commit: `feat(agent-runtime): await_topo gate and live topo revise`

---

### Task 7: Frontend chips

**Files:**
- Modify or create: `apps/web/src/components/agent/agentChipSet.ts`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify/create tests: `agentChipSet.test.ts`

- [ ] Detect plan options (snippet like `1`/`A` 确认方案 or dedicated marker)
- [ ] Detect topo chips（确认出图 / 要改拓扑）
- [ ] Keep copy chips
- [ ] sendPreset for `1` / `A` / 确认出图 etc.
- [ ] Vitest pass
- [ ] Commit: `feat(web): structured plan and topo confirm chips`

---

### Task 8: Cross-doc pointer + verification

**Files:**
- Touch: specs already synced; optional one-line in task-progress-card if needed

- [ ] Runtime pytest full suite
- [ ] Web vitest agent chip/reconcile
- [ ] Manual checklist in PR: full path + trimmed path; no plan node before confirm; no gen before 确认出图
- [ ] Commit if doc nits: `docs: topology preview HITL impl notes`

---

## Execution handoff

After this plan is approved for coding:

1. Create worktree/branch `feature/agent-topology-preview-hitl` from main  
2. Use subagent-driven-development or executing-plans  
3. Deploy with `enable_agent_runtime=true` after merge  

**Stop here for human gate:** reply「开始实现」to execute Tasks 1–8.
